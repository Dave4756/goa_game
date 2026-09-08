'use strict';

(function () {
  const deepClone = value => JSON.parse(JSON.stringify(value));
  const effectId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let matchmakingWaiting = false;

  function emitEffect(effect) {
    if (gameMode !== 'multiplayer' || !socket || !multiplayerRoom) return;
    socket.emit('battle:fx', { roomCode: multiplayerRoom, effect: { effectId: effect.effectId || effectId(effect.type), ...effect } });
  }
  function syncState(reason) {
    if (gameMode !== 'multiplayer' || !socket || applyingNetworkState) return;
    socket.emit('battle:sync', {
      reason,
      myField: deepClone(playerField), opponentField: deepClone(opponentField),
      myTrash: deepClone(playerTrash), opponentTrash: deepClone(opponentTrash),
      handCount: myHand.length
    });
  }
  function safeUrl(value) {
    return String(value || '').replace(/["'()\\]/g, '');
  }

  // 가방/제비뽑기는 전용 DOM을 생성하지 않고 공통 아이템 연출만 사용합니다.
  window.useDrawItemFromHand = function (handIndex) {
    const item = myHand[handIndex];
    if (!item) return;
    const skill = item.skills?.[0] || {};
    const drawn = [];
    if (skill.type === 'draw_monster') {
      const index = battleDeck.findIndex(card => !['ITEM', 'NORMAL_ITEM', 'EVOLUTION'].includes(card.type));
      if (index < 0) return void (document.getElementById('battle-action-info').innerText = '덱에 뽑을 몬스터가 없습니다.');
      drawn.push(battleDeck.splice(index, 1)[0]);
    } else if (skill.type === 'draw_random') {
      const count = Math.min(Number(skill.count) || 2, battleDeck.length);
      for (let index = 0; index < count; index++) drawn.push(battleDeck.splice(Math.floor(Math.random() * battleDeck.length), 1)[0]);
      if (!drawn.length) return;
    } else return;

    playItemUseEffect(item, null, handIndex);
    myHand.splice(handIndex, 1);
    playerTrash.push(item);
    consumableItemUsedThisTurn[skill.type] = true;
    document.getElementById('battle-action-info').innerText = `[${item.name}] 사용! ${drawn.length}장을 뽑았습니다.`;
    setTimeout(() => {
      myHand.push(...drawn);
      renderBattleUI();
      syncState('draw-item');
    }, 900);
  };

  // 모든 아이템 연출의 이미지는 고정 크기 background-image로 표시합니다.
  window.playItemUseEffect = function (item, targetIndex = null, sourceIndex = null, suppressNetwork = false) {
    document.querySelectorAll('.item-use-effect').forEach(node => node.remove());
    const source = sourceIndex !== null ? document.querySelectorAll('#battle-player-hand .card-ui')[sourceIndex] : null;
    const target = targetIndex !== null ? document.getElementById('player-field-slots')?.children[targetIndex] : document.getElementById('battle-board');
    if (!target) return;
    const from = source?.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const root = document.createElement('div');
    root.className = 'item-use-effect';
    root.style.cssText = 'position:fixed;inset:0;z-index:18000;pointer-events:none;overflow:hidden';
    root.innerHTML = `<div class="item-effect-card"><div class="item-effect-art" style="background-image:url('${safeUrl(item?.image)}')"></div><span>${item?.name || '아이템'}</span></div><div class="item-effect-ring"></div>`;
    root.style.setProperty('--item-start-x', `${from ? from.left + from.width / 2 : window.innerWidth / 2}px`);
    root.style.setProperty('--item-start-y', `${from ? from.top + from.height / 2 : window.innerHeight * .75}px`);
    root.style.setProperty('--item-end-x', `${to.left + to.width / 2}px`);
    root.style.setProperty('--item-end-y', `${to.top + to.height / 2}px`);
    document.body.appendChild(root);
    if (!suppressNetwork) emitEffect({ type: 'item', item: { id: item?.id, name: item?.name, image: item?.image }, targetSide: targetIndex === null ? 'board' : 'own', targetIndex });
    setTimeout(() => root.remove(), 1000);
  };

  // 하품 등 상태이상 연출도 raw 텍스트 DOM이 화면 밖에 노출되지 않도록 자체 스타일을 사용합니다.
  window.showStatusSkillEffect = function (statusType, attackerIndex, targetIndex, remote = false) {
    const fromElement = document.getElementById(remote ? 'opponent-field-slots' : 'player-field-slots')?.children[attackerIndex];
    const target = document.getElementById(remote ? 'player-field-slots' : 'opponent-field-slots')?.children[targetIndex];
    if (!target) return;
    const from = (fromElement || target).getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const x = from.left + from.width / 2, y = from.top + from.height / 2;
    const orb = document.createElement('div');
    orb.className = 'safe-status-orb';
    orb.textContent = statusType === 'sleep' ? 'Z z z' : String(statusType || 'STATUS').toUpperCase();
    orb.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${statusType === 'sleep' ? 76 : 48}px;height:44px;max-width:76px;max-height:48px;overflow:hidden;display:flex;align-items:center;justify-content:center;z-index:19000;pointer-events:none;border-radius:50%;background:${statusType === 'sleep' ? '#dff6ff' : '#f1c40f'};color:#2471a3;font-weight:900;box-shadow:0 0 25px #74b9ff;transform:translate(-50%,-50%)`;
    document.body.appendChild(orb);
    const dx = to.left + to.width / 2 - x, dy = to.top + to.height / 2 - y;
    orb.animate([{opacity:0,transform:'translate(-50%,-50%) scale(.3)'},{opacity:1,offset:.2},{opacity:1,transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.15)`,offset:.78},{opacity:0,transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.8)`}],{duration:1250,easing:'ease-out',fill:'forwards'});
    setTimeout(() => orb.remove(), 1300);
  };

  // 상태이상 아이템은 턴 종료를 기다리지 않고 즉시 동기화합니다.
  const originalConfuse = window.useConfuseAllItem;
  window.useConfuseAllItem = function (handIndex) {
    const item = myHand[handIndex];
    const result = originalConfuse.apply(this, arguments);
    emitEffect({ type: 'status-all', statusType: 'confusion', duration: item?.skills?.[0]?.duration || 1 });
    syncState('confuse-all');
    return result;
  };

  // 동전 결과를 상대에게 같은 결과로 재생합니다.
  const originalCoin = window.showStatusCoinTossAnimation;
  window.showStatusCoinTossAnimation = function (statusName, success, fail) {
    const random = Math.random() < .5;
    emitEffect({ type: 'coin-sync', statusName, isHeads: random });
    ensureCoinTossModal();
    const modal = document.getElementById('coin-toss-modal');
    const coin = document.getElementById('toss-coin');
    const message = document.getElementById('toss-message');
    modal.classList.add('active'); coin.className = 'coin'; message.style.color = 'white';
    message.innerText = `[${statusName}] 상태! 동전을 던집니다...`;
    setTimeout(() => {
      coin.classList.add(random ? 'toss-heads' : 'toss-tails');
      setTimeout(() => {
        message.innerText = random ? '앞면! 행동에 성공했습니다.' : '뒷면! 행동에 실패했습니다.';
        message.style.color = random ? '#2ecc71' : '#e74c3c';
        setTimeout(() => { modal.classList.remove('active'); message.style.color = 'white'; random ? success() : fail(); syncState('coin-result'); }, 1200);
      }, 2000);
    }, 100);
  };
  function playRemoteCoin(name, heads) {
    ensureCoinTossModal();
    const modal = document.getElementById('coin-toss-modal');
    const coin = document.getElementById('toss-coin');
    const message = document.getElementById('toss-message');
    modal.classList.add('active'); coin.className='coin'; message.style.color='white'; message.innerText=`[${name}] 상대 동전 판정...`;
    setTimeout(()=>{coin.classList.add(heads?'toss-heads':'toss-tails');setTimeout(()=>{message.innerText=heads?'앞면':'뒷면';message.style.color=heads?'#2ecc71':'#e74c3c';setTimeout(()=>modal.classList.remove('active'),1200)},2000)},100);
  }

  // 각성 연출에는 전체 카드 상태와 필드 위치를 포함하고 즉시 서버 상태를 갱신합니다.
  const originalAwakening = window.showAwakeningEffect;
  window.showAwakeningEffect = function (card, suppressNetwork = false) {
    const result = originalAwakening(card, true);
    if (!suppressNetwork) {
      emitEffect({ type: 'awakening-sync', fieldIndex: playerField.indexOf(card), card: deepClone(card) });
      syncState('awakening');
    }
    return result;
  };

  // 아이템 부착/일반 드로우 뒤 손패와 카드 상태를 즉시 보냅니다.
  const originalApplyItem = window.applyTargetItemToMonster;
  window.applyTargetItemToMonster = function () { const result = originalApplyItem.apply(this, arguments); setTimeout(() => syncState('item-attach'), 0); return result; };
  const originalDraw = window.drawCardFromDeck;
  window.drawCardFromDeck = function () { const before = myHand.length; const result = originalDraw.apply(this, arguments); setTimeout(() => { if (myHand.length > before) syncState('normal-draw'); }, 700); return result; };

  function renderOpponentHand(count) {
    let box = document.getElementById('opponent-hand-count');
    if (!box) { box = document.createElement('div'); box.id = 'opponent-hand-count'; document.getElementById('opponent-field-zone')?.appendChild(box); }
    if (!box) return;
    const value = Math.max(0, Math.min(20, Number(count) || 0));
    box.innerHTML = `<strong>상대 패 ${value}장</strong><div class="opponent-hand-backs">${Array.from({length:Math.min(value,12)},(_,i)=>`<div class="opponent-hand-back" style="--hand-index:${i}">GOA</div>`).join('')}</div>`;
  }

  // v18 필수 기능: 빠른 매치메이킹을 이 기준 파일 안에 고정합니다.
  window.ensureMultiplayerUI = function () {
    if (document.getElementById('multiplayer-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="multiplayer-overlay"><div class="multiplayer-panel"><h2>온라인 멀티플레이</h2><p id="multiplayer-status">플레이 방식을 선택하세요.</p><button id="quick-match-btn">빠른 매치메이킹</button><button id="code-mode-btn">방 코드로 플레이</button><div id="code-mode-panel" hidden><input id="multiplayer-room-code" maxlength="6" placeholder="방 코드 6자리"><div class="multiplayer-buttons"><button id="create-room-btn">방 만들기</button><button id="join-room-btn">방 참가</button></div></div><button id="close-multiplayer-btn" class="back-btn">닫기</button></div></div>`);
    document.getElementById('quick-match-btn').onclick=(clickEvent)=>{connectSocket();if(matchmakingWaiting){socket.emit('matchmaking:cancel');matchmakingWaiting=false;clickEvent.currentTarget.textContent='빠른 매치메이킹';setMultiplayerStatus('매치메이킹 취소');}else{socket.emit('matchmaking:join',{name:playerNickname});matchmakingWaiting=true;clickEvent.currentTarget.textContent='매치메이킹 취소';setMultiplayerStatus('상대를 찾는 중...');}};
    document.getElementById('code-mode-btn').onclick=()=>{const p=document.getElementById('code-mode-panel');p.hidden=!p.hidden};
    document.getElementById('create-room-btn').onclick=createMultiplayerRoom;document.getElementById('join-room-btn').onclick=joinMultiplayerRoom;document.getElementById('close-multiplayer-btn').onclick=closeMultiplayerUI;
  };

  function attachSocket() {
    if (!socket || socket.__v19Attached) return false;
    socket.__v19Attached = true;
    socket.on('room:state', state => renderOpponentHand(state?.opponentHandCount));
    socket.on('matchmaking:waiting',()=>setMultiplayerStatus('상대를 찾는 중...'));
    socket.on('matchmaking:matched',({roomCode})=>{matchmakingWaiting=false;multiplayerRoom=roomCode;setMultiplayerStatus(`매칭 완료 ${roomCode}`)});
    socket.on('battle:coin', ({isFirst,firstName}) => playRemoteCoin('선공 결정', !!isFirst));
    socket.on('battle:fx', payload => {
      const effect = payload?.effect || payload;
      if (effect?.type === 'status-all' && effect.statusType === 'confusion') { playerField.forEach(card => { card.isConfused=true; card.confusedTurns=effect.duration||1; }); renderBattleUI(); }
      if (effect?.type === 'coin-sync') playRemoteCoin(effect.statusName || '상태 판정', !!effect.isHeads);
      if (effect?.type === 'awakening-sync') { const index=Math.max(0,Math.min(2,Number(effect.fieldIndex)||0)); if(effect.card?.id) opponentField[index]=deepClone(effect.card); renderBattleUI(); originalAwakening(effect.card||{},true); }
    });
    return true;
  }
  const timer=setInterval(()=>{if(attachSocket())clearInterval(timer)},100);

  const originalRender = window.renderBattleUI;
  window.renderBattleUI = function () {
    const result = originalRender.apply(this, arguments);
    clearTimeout(window.renderBattleUI.__handTimer);
    window.renderBattleUI.__handTimer=setTimeout(()=>{if(gameMode==='multiplayer'&&socket&&!applyingNetworkState)socket.emit('battle:hand-count',{count:myHand.length})},80);
    return result;
  };
})();
