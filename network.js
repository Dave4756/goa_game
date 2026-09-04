let gameMode = 'bot', socket = null, roomCode = null, multiplayerStarted = false, applyingState = false, readySent = false;
function showTurnSplash(isMine, first = false) {
  let el = document.getElementById('turn-splash');
  if (!el) { el = document.createElement('div'); el.id = 'turn-splash'; document.body.appendChild(el); }
  el.className = `turn-splash ${isMine ? 'mine' : 'enemy'} active`;
  el.innerHTML = `<div>${first ? '게임 시작' : '턴 전환'}</div><strong>${isMine ? '내 턴' : '상대 턴'}</strong>`;
  setTimeout(() => el.classList.remove('active'), 1500);
}
function showRemoteMotion(data) {
  const board = document.getElementById('battle-board'); if (!board) return;
  const effect = document.createElement('div'); effect.className = 'remote-card-motion';
  effect.innerHTML = `<div class="remote-motion-card"><img src="${data.card?.image || ''}"><b>${data.card?.name || '상대 카드'}</b><span>${data.skill?.name || data.kind || ''}</span></div>`;
  board.appendChild(effect); setTimeout(() => effect.remove(), 1200);
  if (data.kind === 'item') {
    setTimeout(() => {
      const target = data.targetIndex == null ? null : document.getElementById('opponent-field-slots')?.children[data.targetIndex];
      target?.classList.add('remote-item-hit'); setTimeout(() => target?.classList.remove('remote-item-hit'), 700);
    }, 550);
  }
}
function multiplayerLobby() {
  if (!myDeck.length) return alert('먼저 덱을 구성해주세요.');
  if (!socket) {
    socket = io();
    socket.on('battle:state', applyState);
    socket.on('battle:motion', showRemoteMotion);
  }
  let code = prompt('방을 만들려면 빈칸으로 확인, 참가하려면 방 코드를 입력하세요.');
  if (code === null) return;
  if (!code.trim()) socket.emit('room:create', { name: playerNickname }, r => { if (r.ok) alert(`방 코드: ${r.code}`); });
  else socket.emit('room:join', { code: code.trim(), name: playerNickname }, r => { if (!r.ok) alert(r.message); });
}
function beginMulti() {
  gameMode = 'multiplayer'; readySent = false; multiplayerStarted = false; isMyTurn = false; initBattle(); opponentField = [];
  document.getElementById('opponent-name').innerText = '상대 준비 중'; renderBattleUI();
}
function applyState(state) {
  roomCode = state.code;
  if (state.count === 2 && gameMode !== 'multiplayer') beginMulti();
  if (gameMode !== 'multiplayer') return;
  const wasStarted = multiplayerStarted, wasMyTurn = isMyTurn;
  applyingState = true;
  if (state.started) {
    multiplayerStarted = true; playerField = state.myField; opponentField = state.opponentField;
    isMyTurn = state.myTurn; isInitialDeploymentPhase = false;
    document.getElementById('opponent-name').innerText = state.opponentName;
  } else if (state.count === 2) opponentField = state.opponentField;
  renderBattleUI(); updateTurnIndicator(); applyingState = false;
  if (state.started && (!wasStarted || wasMyTurn !== isMyTurn)) showTurnSplash(isMyTurn, !wasStarted);
}
function emitReady() {
  if (gameMode === 'multiplayer' && !applyingState && !readySent && !isInitialDeploymentPhase && playerField.length) {
    readySent = true; socket.emit('battle:ready', { field: playerField });
  }
}
window.emitBattleMotion = data => {
  if (gameMode === 'multiplayer' && multiplayerStarted && isMyTurn) socket.emit('battle:motion', { kind: 'skill', ...data });
};
window.emitItemMotion = data => {
  if (gameMode === 'multiplayer' && multiplayerStarted && isMyTurn) socket.emit('battle:motion', { kind: 'item', ...data });
};
const baseRender = renderBattleUI;
renderBattleUI = function () { baseRender(); setTimeout(emitReady, 0); };
const baseEnd = endMyTurn;
endMyTurn = function () {
  if (gameMode !== 'multiplayer') return baseEnd();
  if (!multiplayerStarted || !isMyTurn) return;
  processEndTurnStatusEffects('player', () => {
    isMyTurn = false; resetActionState(); renderBattleUI(); updateTurnIndicator();
    socket.emit('battle:commit', { myField: playerField, opponentField });
  });
};
const baseDummy = dummyTurnAction;
dummyTurnAction = function () { if (gameMode === 'multiplayer') return; return baseDummy(); };
window.addEventListener('DOMContentLoaded', () => {
  const menu = document.querySelector('#main-menu .menu-buttons');
  const match = [...menu.querySelectorAll('button')].find(b => b.textContent.includes('매치'));
  if (match) { match.textContent = '봇 대전'; match.onclick = () => { gameMode = 'bot'; startMatchmakingProcess(); }; }
  const multi = document.createElement('button'); multi.textContent = '온라인 멀티플레이'; multi.onclick = multiplayerLobby; menu.appendChild(multi);
});
