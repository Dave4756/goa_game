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
        <p id="multiplayer-status">방을 만들거나 참가하세요.</p>
        <input id="multiplayer-room-code" maxlength="6" placeholder="방 코드 6자리">
        <div class="multiplayer-buttons">
          <button id="create-room-btn">방 만들기</button>
          <button id="join-room-btn">방 참가</button>
          <button id="close-multiplayer-btn" class="back-btn">닫기</button>
        </div>
      </div>
    </div>`);
  document.getElementById('create-room-btn').onclick = createMultiplayerRoom;
  document.getElementById('join-room-btn').onclick = joinMultiplayerRoom;
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
  socket.on('disconnect', () => setMultiplayerStatus('서버 연결이 끊어졌습니다.'));
  return socket;
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
  connectSocket().emit('room:create', { name: playerNickname }, result => {
    if (!result.ok) return setMultiplayerStatus(result.message);
    multiplayerRoom = result.roomCode;
    document.getElementById('multiplayer-room-code').value = result.roomCode;
    setMultiplayerStatus(`방 코드 ${result.roomCode}, 상대를 기다리는 중...`);
  });
}
function joinMultiplayerRoom() {
  const roomCode = document.getElementById('multiplayer-room-code').value.trim().toUpperCase();
  connectSocket().emit('room:join', { roomCode, name: playerNickname }, result => {
    if (!result.ok) return setMultiplayerStatus(result.message);
    multiplayerRoom = result.roomCode;
    setMultiplayerStatus(`방 ${result.roomCode}에 참가했습니다.`);
  });
}
function beginMultiplayerBattle() {
  gameMode = 'multiplayer';
  multiplayerStarted = false;
  readySent = false;
  closeMultiplayerUI();
  isMyTurn = false;
  initBattle();
  opponentField = [];
  document.getElementById('opponent-name').innerText = '상대 준비 중';
  document.getElementById('battle-action-info').innerText = '시작 몬스터 1장을 배치하세요. 양쪽 배치 후 선공이 결정됩니다.';
  renderBattleUI();
}
function applyRoomState(state) {
  multiplayerRoom = state.roomCode;
  setMultiplayerStatus(`방 코드 ${state.roomCode} · ${state.playerCount}/2명`);
  if (state.playerCount === 2 && gameMode !== 'multiplayer') beginMultiplayerBattle();
  if (gameMode !== 'multiplayer') return;

  applyingNetworkState = true;
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
    opponentField = JSON.parse(JSON.stringify(state.opponentField || []));
    document.getElementById('opponent-name').innerText = state.opponentName;
  }
  renderBattleUI();
  updateTurnIndicator();
  applyingNetworkState = false;
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
    return;
  }
  if (effect.type === 'deploy') {
    requestAnimationFrame(() => animateMonsterDeploy(effect.card || {}, Number(effect.fieldIndex) || 0, true));
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
  if (effect.type === 'damage') {
    const isPlayerTarget = mapRemoteSide(effect.targetSide) === 'own';
    const attackerIsPlayer = mapRemoteSide(effect.attackerSide) === 'own';
    showDamageFloatingEffect(Number(effect.targetIndex), isPlayerTarget,
      Number(effect.damage) || 0, Number(effect.bonusDamage) || 0,
      effect.attackerIndex == null ? null : Number(effect.attackerIndex), attackerIsPlayer);
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
};

const originalEndMyTurn = endMyTurn;
endMyTurn = function () {
  if (gameMode !== 'multiplayer') return originalEndMyTurn();
  if (!multiplayerStarted || !isMyTurn) return;

  const passiveHealEffects = [];
  playerField.forEach(p => {
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
