let gameMode = 'bot';
let socket = null;
let multiplayerRoom = null;
let multiplayerStarted = false;
let applyingNetworkState = false;
let readySent = false;

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
function commitMultiplayerTurn() {
  socket.emit('battle:commit', { myField: playerField, opponentField, endTurn: true });
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
