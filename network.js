let gameMode = 'bot';
let socket = null;
let multiplayerRoom = null;
let multiplayerStarted = false;
let applyingNetworkState = false;
let readySent = false;
const processedEffectIds = new Set();

function ensureMultiplayerUI() {
  if (document.getElementById('multiplayer-overlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="multiplayer-overlay">
      <div class="multiplayer-panel">
        <h2>온라인 멀티플레이</h2>
        <p id="multiplayer-status">빠른 매치를 찾거나 방을 만들고 참가하세요.</p>
        <input id="multiplayer-room-code" maxlength="6" placeholder="방 코드 6자리">
        <div class="multiplayer-buttons">
          <button id="quick-match-btn">빠른 매치</button>
          <button id="create-room-btn">방 만들기</button>
          <button id="join-room-btn">방 참가</button>
          <button id="close-multiplayer-btn" class="back-btn">닫기</button>
        </div>
      </div>
    </div>`);
  document.getElementById('create-room-btn').onclick = createMultiplayerRoom;
  document.getElementById('join-room-btn').onclick = joinMultiplayerRoom;
  document.getElementById('quick-match-btn').onclick = joinMatchmaking;
  document.getElementById('close-multiplayer-btn').onclick = closeMultiplayerUI;
}

function installModeButtons() {
  const menu = document.querySelector('#main-menu .menu-buttons');
  if (!menu || document.getElementById('multiplayer-menu-btn')) return;
  const matchmakingButton = [...menu.querySelectorAll('button')].find(b => b.textContent.includes('매치'));
  if (matchmakingButton) {
    matchmakingButton.textContent = '봇 대전';
    matchmakingButton.onclick = () => { gameMode = 'bot'; startMatchmakingProcess(); };
  }
  const button = document.createElement('button');
  button.id = 'multiplayer-menu-btn';
  button.textContent = '온라인 멀티플레이';
  button.onclick = openMultiplayerUI;
  menu.appendChild(button);
}

function connectSocket() {
  if (socket) return socket;
  socket = io();
  socket.on('room:state', applyRoomState);
  socket.on('battle:fx', receiveMultiplayerEffect);
  socket.on('room:notice', message => setMultiplayerStatus(message));
  socket.on('battle:started', () => { multiplayerStarted = true; });
  socket.on('matchmaking:waiting', () => setMultiplayerStatus('빠른 매치에서 상대를 찾는 중...'));
  socket.on('matchmaking:matched', ({ roomCode }) => {
    multiplayerRoom = roomCode;
    setMultiplayerStatus(`상대를 찾았습니다! 방 ${roomCode}`);
  });
  socket.on('disconnect', () => setMultiplayerStatus('서버 연결이 끊어졌습니다.'));
  return socket;
}
function joinMatchmaking() {
  validateMultiplayerDeck(() => connectSocket().emit('matchmaking:join', { name: playerNickname }));
}

function validateMultiplayerDeck(onValid) {
  const client = connectSocket();
  client.emit('battle:validate-deck', { deck: myDeck.map(card => ({ id: card.id })) }, result => {
    if (result?.ok) return onValid();
    setMultiplayerStatus(`온라인 대전에는 검증된 카드가 ${result?.minimum || 3}장 이상 필요합니다. (현재 ${result?.count || 0}장)`);
  });
}
function openMultiplayerUI() {
  if (!myDeck.length) return alert('먼저 덱을 구성해주세요.');
  ensureMultiplayerUI();
  connectSocket();
  document.getElementById('multiplayer-overlay').classList.add('active');
}
function closeMultiplayerUI() {
  document.getElementById('multiplayer-overlay')?.classList.remove('active');
}
function setMultiplayerStatus(message) {
  const el = document.getElementById('multiplayer-status');
  if (el) el.textContent = message;
}
function createMultiplayerRoom() {
  validateMultiplayerDeck(() => connectSocket().emit('room:create', { name: playerNickname }, result => {
    if (!result.ok) return setMultiplayerStatus(result.message);
    multiplayerRoom = result.roomCode;
    document.getElementById('multiplayer-room-code').value = result.roomCode;
    setMultiplayerStatus(`방 코드 ${result.roomCode}, 상대를 기다리는 중...`);
  }));
}
function joinMultiplayerRoom() {
  const roomCode = document.getElementById('multiplayer-room-code').value.trim().toUpperCase();
  validateMultiplayerDeck(() => connectSocket().emit('room:join', { roomCode, name: playerNickname }, result => {
    if (!result.ok) return setMultiplayerStatus(result.message);
    multiplayerRoom = result.roomCode;
    setMultiplayerStatus(`방 ${result.roomCode}에 참가했습니다.`);
  }));
}
function beginMultiplayerBattle() {
  gameMode = 'multiplayer';
  multiplayerStarted = false;
  readySent = false;
  syncPrivateCounts.lastSignature = null;
  closeMultiplayerUI();
  isMyTurn = false;
  initBattle();
  opponentField = [];
  document.getElementById('opponent-name').innerText = '상대 준비 중';
  document.getElementById('turn-indicator').innerText = '시작 몬스터를 놓아주세요';
  document.getElementById('turn-indicator').style.color = '#2ecc71';
  document.getElementById('battle-action-info').innerText = '시작 몬스터 1장을 배치하세요. 양쪽 배치 후 선공이 결정됩니다.';
  renderBattleUI();
}
function applyRoomState(state) {
  multiplayerRoom = state.roomCode;
  setMultiplayerStatus(`방 코드 ${state.roomCode} · ${state.playerCount}/2명`);
  if (state.playerCount === 2 && gameMode !== 'multiplayer') beginMultiplayerBattle();
  if (gameMode !== 'multiplayer') return;

  applyingNetworkState = true;
  window.multiplayerOpponentDeckCount = Number(state.opponentDeckCount) || 0;
  renderOpponentHand(state.opponentHandCount || 0);
  if (state.started) {
    multiplayerStarted = true;
    playerField = JSON.parse(JSON.stringify(state.myField || []));
    opponentField = JSON.parse(JSON.stringify(state.opponentField || []));
    playerTrash = JSON.parse(JSON.stringify(state.myTrash || playerTrash || []));
    opponentTrash = JSON.parse(JSON.stringify(state.opponentTrash || opponentTrash || []));
    isMyTurn = !!state.isMyTurn;
    isInitialDeploymentPhase = false;
    document.getElementById('opponent-name').innerText = state.opponentName;
    document.getElementById('battle-action-info').innerText = isMyTurn ? '내 턴입니다.' : '상대 턴을 기다리는 중입니다.';
  } else if (state.playerCount === 2) {
    playerField = JSON.parse(JSON.stringify(state.myField || playerField || []));
    opponentField = JSON.parse(JSON.stringify(state.opponentField || []));
    document.getElementById('opponent-name').innerText = state.opponentName;
    isMyTurn = false;
    isInitialDeploymentPhase = playerField.length === 0;
    const waiting = playerField.length > 0;
    document.getElementById('turn-indicator').innerText = waiting ? '상대 시작 몬스터 대기 중' : '시작 몬스터를 놓아주세요';
    document.getElementById('turn-indicator').style.color = '#2ecc71';
    document.getElementById('battle-action-info').innerText = waiting ? '내 시작 몬스터 배치 완료. 상대 배치를 기다립니다.' : '손패에서 시작 몬스터 1장을 배치하세요.';
  }
  renderBattleUI();
  if (state.started) updateTurnIndicator();
  applyingNetworkState = false;
}

function renderOpponentHand(count) {
  let zone = document.getElementById('opponent-hand-zone');
  if (!zone) return;
  const visible = Math.min(10, Math.max(0, Number(count) || 0));
  zone.innerHTML = Array.from({ length: visible }, (_, index) =>
    `<div class="opponent-card-back" style="--opponent-hand-index:${index}" aria-hidden="true"></div>`
  ).join('');
}

function syncPrivateCounts() {
  if (gameMode !== 'multiplayer' || applyingNetworkState || !socket || !multiplayerRoom) return;
  const signature = `${myHand.length}:${battleDeck.length}`;
  if (syncPrivateCounts.lastSignature === signature) return;
  syncPrivateCounts.lastSignature = signature;
  socket.emit('battle:private-counts', { handCount: myHand.length, deckCount: battleDeck.length });
}
function sendReadyIfNeeded() {
  if (gameMode !== 'multiplayer' || applyingNetworkState || readySent || isInitialDeploymentPhase || !playerField.length) return;
  readySent = true;
  socket.emit('battle:ready', { field: playerField });
  document.getElementById('battle-action-info').innerText = '상대의 시작 몬스터 배치를 기다리는 중입니다.';
}
function mapRemoteSide(side) {
  if (side === 'own') return 'opponent';
  if (side === 'opponent') return 'own';
  return side;
}

window.broadcastMultiplayerEffect = function (effect) {
  if (gameMode !== 'multiplayer' || applyingNetworkState || !socket || !multiplayerRoom) return;
  socket.emit('battle:fx', { roomCode: multiplayerRoom, effect });
};

function acceptMultiplayerEffect(effect) {
  if (!effect?.effectId) return true;
  if (processedEffectIds.has(effect.effectId)) return false;
  processedEffectIds.add(effect.effectId);
  setTimeout(() => processedEffectIds.delete(effect.effectId), 12000);
  return true;
}
function receiveMultiplayerEffect(payload) {
  if (gameMode !== 'multiplayer') return;
  const effect = payload?.effect || payload;
  if (!effect?.type || !acceptMultiplayerEffect(effect)) return;
  if (effect.type === 'item') return playRemoteItemEffect(effect);
  if (effect.type === 'draw') {
    playDrawSequenceEffect({ style: effect.drawStyle || 'normal', count: effect.count || 1, remote: true });
    animateOpponentCardDraw(effect.count || 1);
    return;
  }
  if (effect.type === 'coin-effect') {
    const side = mapRemoteSide(effect.targetSide);
    const targets = side === 'own' ? playerField : opponentField;
    const target = targets?.[Number(effect.targetIndex) || 0];
    if (!target) return;
    if (effect.heads) target.currentHp = Math.min(target.hp, target.currentHp + (Number(effect.amount) || 50));
    else target.currentHp = Math.max(target.hyperFocusTurns > 0 ? 1 : 0, target.currentHp - (Number(effect.amount) || 50));
    renderBattleUI();
    return;
  }
  if (effect.type === 'hand-reset') {
    battleDeck.push(...myHand.splice(0));
    shuffleArray(battleDeck);
    renderBattleUI();
    document.getElementById('battle-action-info').innerText = '상대 효과로 손패가 덱으로 돌아갔습니다.';
    return;
  }
  if (effect.type === 'deploy') {
    const index = Math.max(0, Math.min(2, Number(effect.fieldIndex) || 0));
    const card = JSON.parse(JSON.stringify(effect.card || {}));
    if (!card.id) return;
    if (card.currentHp == null) card.currentHp = card.hp;
    if (!Array.isArray(card.equippedItems)) card.equippedItems = [];
    opponentField[index] = card;
    opponentField = opponentField.filter(Boolean).slice(0, 3);
    renderBattleUI();
    requestAnimationFrame(() => animateMonsterDeploy(card, index, true));
    return;
  }
  if (effect.type === 'skill') {
    showStatusSkillEffect(effect.skillEffect || 'generic', Number(effect.attackerIndex) || 0, Number(effect.targetIndex) || 0, true);
    return;
  }
  if (effect.type === 'awakening') {
    showAwakeningEffect(effect.card || {}, true);
    return;
  }
  if (effect.type === 'evolution') {
    const index = Math.max(0, Math.min(2, Number(effect.fieldIndex) || 0));
    const card = JSON.parse(JSON.stringify(effect.card || {}));
    if (!card.id) return;
    opponentField[index] = card;
    renderBattleUI();
    showAwakeningEffect(card, true);
    return;
  }
  if (effect.type === 'damage') {
    const isPlayerTarget = mapRemoteSide(effect.targetSide) === 'own';
    const attackerIsPlayer = mapRemoteSide(effect.attackerSide) === 'own';
    showDamageFloatingEffect(Number(effect.targetIndex), isPlayerTarget,
      Number(effect.damage) || 0, Number(effect.bonusDamage) || 0,
      effect.attackerIndex == null ? null : Number(effect.attackerIndex), attackerIsPlayer);
  }
}

function animateOpponentCardDraw(count) {
  const source = document.getElementById('opponent-deck-pile');
  const destination = document.getElementById('opponent-hand-zone');
  if (!source || !destination) return;
  const from = source.getBoundingClientRect();
  const to = destination.getBoundingClientRect();
  const cards = Math.min(5, Math.max(1, Number(count) || 1));
  for (let index = 0; index < cards; index++) {
    const card = document.createElement('div');
    card.className = 'opponent-card-back remote-draw-card';
    card.style.cssText = `position:fixed;z-index:26000;left:${from.left + from.width / 2}px;top:${from.top + from.height / 2}px;margin:0;transform:translate(-50%,-50%);`;
    document.body.appendChild(card);
    card.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.55) rotateY(0deg)' },
      { opacity: 1, offset: .2, transform: 'translate(-50%,-50%) scale(1.1) rotateY(180deg)' },
      { opacity: 0, transform: `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px,${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(.7) rotateY(360deg)` }
    ], { duration: 720, delay: index * 160, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => card.remove();
  }
}

function playRemoteItemEffect(effect) {
  const side = mapRemoteSide(effect.targetSide);
  const target = side === 'own'
    ? document.getElementById('player-field-slots')?.children[effect.targetIndex]
    : side === 'opponent'
      ? document.getElementById('opponent-field-slots')?.children[effect.targetIndex]
      : document.getElementById('battle-board');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'item-use-effect';
  el.innerHTML = `<div class="item-effect-card"><img src="${effect.item?.image || ''}" alt=""><span>${effect.item?.name || '아이템'}</span></div><div class="item-effect-ring"></div>`;
  el.style.setProperty('--item-start-x', `${window.innerWidth / 2}px`);
  el.style.setProperty('--item-start-y', `${window.innerHeight * .18}px`);
  el.style.setProperty('--item-end-x', `${rect.left + rect.width / 2}px`);
  el.style.setProperty('--item-end-y', `${rect.top + rect.height / 2}px`);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function commitMultiplayerTurn() {
  socket.emit('battle:commit', {
    myField: playerField, opponentField,
    myTrash: playerTrash, opponentTrash, endTurn: true
  });
}

const originalRenderBattleUI = renderBattleUI;
renderBattleUI = function () {
  originalRenderBattleUI();
  setTimeout(sendReadyIfNeeded, 0);
  setTimeout(syncPrivateCounts, 0);
};

const originalEndMyTurn = endMyTurn;
endMyTurn = function () {
  if (gameMode !== 'multiplayer') return originalEndMyTurn();
  if (!multiplayerStarted || !isMyTurn) return;

  const passiveHealEffects = [];
  playerField.forEach(p => {
    if (p.hyperFocusTurns > 0) p.hyperFocusTurns--;
    if (p.shieldTurns > 0) p.shieldTurns--;
    if (p.redirectAttackTarget && p.redirectAttackDuration > 0) {
      p.redirectAttackDuration--;
      if (p.redirectAttackDuration <= 0) p.redirectAttackTarget = false;
    }
    if (p.isParalyzed && p.paralyzedTurns > 0) {
      p.paralyzedTurns--;
      if (p.paralyzedTurns <= 0) p.isParalyzed = false;
    }
    if (p.turnHeal && p.currentHp > 0 && !p.isSleep) {
      const before = p.currentHp;
      p.currentHp = Math.min(p.hp, p.currentHp + p.turnHeal);
      if (p.currentHp > before) passiveHealEffects.push({ monster: p, amount: p.currentHp - before });
    }
  });
  processEndTurnStatusEffects('player', () => {
    isMyTurn = false;
    hasDrawnThisTurn = false;
    resetActionState();
    renderBattleUI();
    updateTurnIndicator();
    commitMultiplayerTurn();
  });
};

const originalDummyTurnAction = dummyTurnAction;
dummyTurnAction = function () {
  if (gameMode === 'multiplayer') return;
  return originalDummyTurnAction();
};

window.addEventListener('DOMContentLoaded', () => {
  ensureMultiplayerUI();
  installModeButtons();
});
