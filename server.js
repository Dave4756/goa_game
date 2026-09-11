const express = require('express'), http = require('http'), fs = require('fs'), path = require('path');
const app = express(), server = http.createServer(app), { Server } = require('socket.io'), io = new Server(server, { pingTimeout: 20000, pingInterval: 10000 });

const ROOT = __dirname, cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf8')), byId = Object.fromEntries(cards.map(c => [c.id, c]));
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/image', express.static(path.join(ROOT, 'image')));

const dataDir = process.env.DATA_DIR || ROOT, profileFile = path.join(dataDir, 'profiles.json');
fs.mkdirSync(dataDir, { recursive: true });

let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(profileFile, 'utf8')) } catch { }
const persist = () => fs.writeFileSync(profileFile, JSON.stringify(profiles, null, 2));

const obtainable = id => byId[id] && !byId[id].isUnobtainable && id !== 'dummy_card';
function validDeck(deck) {
  const n = {};
  return Array.isArray(deck) && deck.length <= 20 && deck.every(id => obtainable(id) && ((n[id] = (n[id] || 0) + 1) <= 2));
}

app.get('/healthz', (_, r) => r.send('ok'));
app.get('/api/cards', (_, r) => r.json(cards));
app.get('/api/profile/:id', (q, r) => r.json(profiles[q.params.id] || null));
app.post('/api/profile', (q, r) => {
  const { playerId, name, deck } = q.body || {};
  if (!playerId || !String(name || '').trim() || !validDeck(deck)) return r.status(400).json({ error: '닉네임 또는 덱 구성이 올바르지 않습니다.' });
  profiles[playerId] = { name: String(name).trim().slice(0, 20), deck: [...deck] };
  persist();
  r.json(profiles[playerId]);
});

let queue = [], games = new Map(), seq = 0;
const uid = () => `u_${Date.now()}_${++seq}`;
const monster = id => ({ uid: uid(), id, hp: byId[id].hp, maxHp: byId[id].hp, status: [], items: [] });

function shuffled(a) { return [...a].sort(() => Math.random() - .5); }
function opening(ids) {
  const deck = shuffled(ids), hand = [], mi = deck.findIndex(id => byId[id]?.hp != null);
  if (mi >= 0) hand.push(deck.splice(mi, 1)[0]);
  while (hand.length < 3 && deck.length) hand.push(deck.shift());
  return { deck, hand };
}

function human(socketId, playerId, p) {
  const o = opening(p.deck);
  return { socketId, playerId, name: p.name, deck: o.deck, hand: o.hand, field: [], trash: [], bot: false, turn: { drawn: false, consumables: [] } };
}

function bot() {
  return { socketId: null, playerId: 'BOT', name: '허수아비 봇', deck: [], hand: [], field: [monster('dummy_card'), monster('dummy_card'), monster('dummy_card')], trash: [], bot: true, turn: { drawn: true, consumables: [] } };
}

const units = p => p.field;
function clientPlayer(p, self) {
  return { name: p.name, deckCount: p.deck.length, hand: self ? p.hand : [], handCount: p.hand.length, field: p.field, trash: p.trash, drawn: p.turn.drawn };
}

function state(g, you) {
  return { id: g.id, you, turn: g.turn, ended: g.ended, winner: g.winner || null, players: g.players.map((p, i) => clientPlayer(p, i === you)) };
}

function emitState(g, e) {
  g.players.filter(p => p.socketId).forEach(p => io.to(p.socketId).emit('game:state', state(g, g.players.indexOf(p))));
  if (e) g.players.filter(p => p.socketId).forEach(p => io.to(p.socketId).emit('game:event', e));
}

const gameOf = sid => [...games.values()].find(g => g.players.some(p => p.socketId === sid));

function createGame(a, b) {
  const g = { id: `g_${Date.now()}_${++seq}`, players: [a, b], turn: 0, ended: false, winner: null };
  games.set(g.id, g);
  [a, b].filter(p => p.socketId).forEach(p => io.sockets.sockets.get(p.socketId)?.join(g.id));
  emitState(g, { kind: 'start', text: b.bot ? '허수아비 봇전 시작!' : '매치 성사!' });
}

function tryMatch() {
  queue = queue.filter(x => io.sockets.sockets.has(x.sid));
  while (queue.length > 1) {
    const a = queue.shift(), b = queue.shift();
    createGame(human(a.sid, a.pid, a.profile), human(b.sid, b.pid, b.profile));
  }
}

function locate(g, id) {
  for (const p of g.players) for (const u of units(p)) if (u.uid === id) return { p, u };
  return null;
}

const itemSkill = id => byId[id]?.skills?.[0];
const equipTypes = new Set(['passive_reduction', 'buff', 'passive_heal']);
const targetless = new Set(['draw_monster', 'draw_random', 'confuse_all', 'cleanse_all', 'return_opponent_hand']);

function damage(u, amount) {
  for (const id of u.items) {
    const s = itemSkill(id);
    if (s?.type === 'passive_reduction') amount -= s.damageReduction || 0;
  }
  const shield = Math.max(0, ...u.status.filter(s => s.type === 'shield').map(s => s.value));
  amount = Math.max(0, Math.round(amount * (1 - shield / 100)));
  u.hp = u.status.some(s => s.type === 'survive') ? Math.max(1, u.hp - amount) : Math.max(0, u.hp - amount);
  return amount;
}

function effect(g, pi, sk, target, source, itemId) {
  const me = g.players[pi], op = g.players[1 - pi];
  let dealt = 0, amount = sk.damage || 0;

  if (source) {
    for (const id of source.items) {
      const s = itemSkill(id);
      if (s?.type === 'buff') amount += s.attackBonus || 0;
    }
    const pass = byId[source.id]?.passive;
    if (pass?.type === 'equipment_damage_bonus') amount += source.items.length * (pass.amountPerItem || 0);
  }

  if (target && amount) dealt = damage(target, amount);
  if (target && sk.heal) target.hp = Math.min(target.maxHp, target.hp + sk.heal);
  if (target && sk.type === 'shield') target.status.push({ type: 'shield', value: sk.shieldPercent, duration: sk.duration || 1 });
  if (target && sk.statusType) target.status.push({ type: sk.statusType, duration: sk.duration || 1 });
  if (target && equipTypes.has(sk.type)) target.items.push(itemId);
  if (target && sk.type === 'survive_at_one') target.status.push({ type: 'survive', duration: sk.duration || 1 });
  if (sk.type === 'cleanse_all') units(me).forEach(u => u.status = []);
  if (sk.type === 'draw_random') for (let i = 0; i < (sk.count || 1) && me.deck.length && me.hand.length < 7; i++) me.hand.push(me.deck.shift());
  if (sk.type === 'draw_monster') {
    const i = me.deck.findIndex(id => byId[id]?.hp != null);
    if (i >= 0 && me.hand.length < 7) me.hand.push(me.deck.splice(i, 1)[0]);
  }
  if (sk.type === 'confuse_all') units(op).forEach(u => u.status.push({ type: 'confusion', duration: sk.duration || 1 }));
  if (target && sk.type === 'coin_heal_or_damage') Math.random() < .5 ? target.hp = Math.min(target.maxHp, target.hp + sk.amount) : damage(target, sk.amount);
  if (sk.type === 'return_opponent_hand') { op.deck.push(...op.hand); op.hand = []; op.deck = shuffled(op.deck); }
  if (target && sk.type === 'redirect_attack') target.status.push({ type: 'redirect', duration: sk.duration || 1 });

  return dealt;
}

function cleanup(p) {
  p.field = p.field.filter(u => {
    if (u.hp > 0) return true;
    p.trash.push(u.id, ...u.items);
    return false;
  });
}

function defeated(p) {
  return !p.field.length && !p.hand.some(id => byId[id]?.hp != null) && !p.deck.some(id => byId[id]?.hp != null);
}

function nextTurn(g) {
  g.players.forEach(cleanup);
  for (let i = 0; i < 2; i++) {
    if (defeated(g.players[i])) {
      g.ended = true;
      g.winner = g.players[1 - i].name;
      return;
    }
  }
  g.turn = 1 - g.turn;
  const p = g.players[g.turn];
  p.turn = { drawn: false, consumables: [] };
  units(p).forEach(u => {
    u.items.forEach(id => {
      const s = itemSkill(id);
      if (s?.type === 'passive_heal') u.hp = Math.min(u.maxHp, u.hp + (s.turnHeal || 0));
    });
    u.status = u.status.map(s => ({ ...s, duration: s.duration - 1 })).filter(s => s.duration > 0);
  });
}

function botAct(g) {
  if (g.ended || !g.players[g.turn].bot) return;
  setTimeout(() => {
    if (g.ended) return;
    const b = g.players[1], h = g.players[0], src = b.field[0], target = h.field[0];
    if (src && target) effect(g, 1, itemSkill('dummy_card'), target, src);
    nextTurn(g);
    emitState(g, { kind: 'skill', actor: 1, sourceUid: src?.uid, targetUids: target ? [target.uid] : [], skillName: '몸통박치기', damage: 10, text: '허수아비 봇: 몸통박치기' });
  }, 700);
}

io.on('connection', s => {
  s.emit('server:ready');

  s.on('match:join', (pid, ack) => {
    const p = profiles[pid];
    if (!p || !p.deck.some(id => byId[id]?.hp != null)) {
      ack?.({ ok: false, error: '몬스터가 포함된 덱을 저장하세요.' });
      return;
    }
    queue = queue.filter(x => x.sid !== s.id && x.pid !== pid);
    queue.push({ sid: s.id, pid, profile: p });
    ack?.({ ok: true });
    s.emit('match:waiting', '상대를 찾는 중...');
    tryMatch();
  });

  s.on('match:cancel', () => {
    queue = queue.filter(x => x.sid !== s.id);
    s.emit('match:cancelled');
  });

  s.on('bot:start', (pid, ack) => {
    const p = profiles[pid];
    if (!p || !p.deck.some(id => byId[id]?.hp != null)) {
      ack?.({ ok: false, error: '몬스터가 포함된 덱을 저장하세요.' });
      return;
    }
    queue = queue.filter(x => x.sid !== s.id);
    ack?.({ ok: true });
    createGame(human(s.id, pid, p), bot());
  });

  s.on('game:action', (a, ack) => {
    const g = gameOf(s.id);
    if (!g || g.ended) return ack?.({ ok: false, error: '게임이 없습니다.' });

    const pi = g.players.findIndex(p => p.socketId === s.id), me = g.players[pi], op = g.players[1 - pi];
    if (g.turn !== pi) return ack?.({ ok: false, error: '내 턴이 아닙니다.' });

    let ev = null, end = false;

    if (a.type === 'draw') {
      if (me.turn.drawn) return ack?.({ ok: false, error: '이번 턴에는 이미 드로우했습니다.' });
      if (!me.deck.length) return ack?.({ ok: false, error: '덱이 비었습니다.' });
      if (me.hand.length >= 7) return ack?.({ ok: false, error: '손패는 최대 7장입니다.' });
      me.hand.push(me.deck.shift());
      me.turn.drawn = true;
      ev = { kind: 'draw', actor: pi, text: `${me.name}: 카드 드로우` };
    } 
    else if (a.type === 'play') {
      const hi = me.hand.indexOf(a.cardId);
      const c = byId[a.cardId];

      if (hi < 0 || !c) return ack?.({ ok: false, error: '손패에 없는 카드입니다.' });

      // 1. 몬스터 카드 소환 처리
      if (c.hp != null) {
        if (me.field.length >= 3) return ack?.({ ok: false, error: '필드는 몬스터 3장까지입니다.' });
        const u = monster(c.id);
        me.field.push(u);
        me.hand.splice(hi, 1);
        ev = { kind: 'summon', actor: pi, uid: u.uid, text: `${me.name}: ${c.name} 소환` };
      } 
      // 2. 아이템 카드 사용 처리
      else {
        const sk = itemSkill(c.id);
        const isEquip = equipTypes.has(sk?.type);
        const consumable = !!c.isConsumable || !isEquip;

        let found = locate(g, a.targetUid);
        let target = found?.u;

        if (!target && !targetless.has(sk?.type)) {
          target = (sk?.type === 'coin_heal_or_damage') ? (me.field[0] || op.field[0]) : me.field[0];
        }

        if (consumable && me.turn.consumables.includes(c.id)) {
          return ack?.({ ok: false, error: '같은 종류의 소모 아이템은 턴당 한 번만 사용 가능합니다.' });
        }

        if (!target && !targetless.has(sk?.type)) {
          return ack?.({ ok: false, error: '필드에 대상 몬스터가 없습니다.' });
        }

        if (isEquip) {
          if (found && found.p !== me) {
            return ack?.({ ok: false, error: '장착 아이템은 내 몬스터에게만 사용할 수 있습니다.' });
          }
          if (target && target.items.includes(c.id)) {
            return ack?.({ ok: false, error: '같은 종류의 장착 아이템은 한 카드에 하나만 장착할 수 있습니다.' });
          }
        }

        effect(g, pi, sk, target, null, c.id);
        me.hand.splice(hi, 1);

        if (!isEquip) {
          me.trash.push(c.id);
          me.turn.consumables.push(c.id);
        }

        ev = {
          kind: isEquip ? 'equip' : 'item',
          actor: pi,
          targetUid: target?.uid,
          itemId: c.id,
          itemType: sk?.type,
          text: `${me.name}: ${c.name} 사용`
        };
      }
    } 
    else if (a.type === 'skill') {
      const source = me.field.find(u => u.uid === a.sourceUid);
      if (!source) return ack?.({ ok: false, error: '내 필드 카드만 스킬을 사용할 수 있습니다.' });

      const c = byId[source.id], sk = c?.skills?.[a.skillIndex];
      if (!sk) return ack?.({ ok: false, error: '스킬이 없습니다.' });

      const blocked = source.status.find(x => x.type === 'sleep' || x.type === 'paralysis');
      if (blocked) {
        source.status = source.status.filter(x => x !== blocked);
        ev = { kind: 'status', actor: pi, text: `${c.name}: 상태이상으로 행동 불가` };
        end = true;
      } else {
        const found = locate(g, a.targetUid);
        let targets = [];

        if (sk.type === 'multi') targets = op.field;
        else if (sk.type === 'heal' || sk.type === 'shield') targets = [found?.p === me ? found.u : source];
        else {
          let target = found?.p === op ? found.u : null;
          const redirect = op.field.find(u => u.status.some(x => x.type === 'redirect'));
          if (redirect && sk.type === 'single') target = redirect;
          if (!target) return ack?.({ ok: false, error: '공격할 상대 카드를 선택하세요.' });
          targets = [target];
        }

        targets.forEach(t => effect(g, pi, sk, t, source));
        ev = {
          kind: 'skill',
          actor: pi,
          sourceUid: source.uid,
          targetUids: targets.map(x => x.uid),
          element: sk.element,
          skillType: sk.type,
          skillName: sk.name,
          damage: sk.damage || 0,
          heal: sk.heal || 0,
          text: `${me.name}: ${sk.name}`
        };
        end = true;
      }
    } 
    else if (a.type === 'skip') {
      ev = { kind: 'skip', actor: pi, text: `${me.name}: 턴 스킵` };
      end = true;
    } 
    else return ack?.({ ok: false, error: '알 수 없는 행동입니다.' });

    if (end) nextTurn(g);
    emitState(g, ev);
    ack?.({ ok: true });
    if (end) botAct(g);
  });

  s.on('disconnect', () => {
    queue = queue.filter(x => x.sid !== s.id);
    const g = gameOf(s.id);
    if (g && !g.ended && !g.players[1].bot) {
      g.ended = true;
      g.winner = g.players.find(p => p.socketId !== s.id)?.name;
      emitState(g, { kind: 'leave', text: '상대 연결 종료' });
    }
  });
});

server.listen(process.env.PORT || 3000, () => console.log(`GOA Card Game v7 on ${process.env.PORT || 3000}`));
