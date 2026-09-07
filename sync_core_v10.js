'use strict';

(function installSyncCoreV10() {
  const seen = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const accept = id => {
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    setTimeout(() => seen.delete(id), 12000);
    return true;
  };

  // img 태그를 사용하지 않고 고정 크기 background-image만 사용한다.
  window.animateMonsterDeploy = function (card, fieldIndex, remote = false) {
    const slots = document.getElementById(remote ? 'opponent-field-slots' : 'player-field-slots');
    const target = slots?.children?.[fieldIndex] || slots;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const image = String(card?.image || '').replace(/["'()]/g, '');
    const root = document.createElement('div');
    root.className = 'safe-deploy-fx';
    root.style.cssText = 'position:fixed;inset:0;z-index:25000;pointer-events:none;overflow:hidden;';
    root.innerHTML = `<div class="safe-deploy-back">GOA</div><div class="safe-deploy-front"><div class="safe-deploy-image" style="background-image:url('${image}')"></div><strong>${card?.name || '몬스터'}</strong></div><div class="safe-deploy-ring"></div>`;
    root.style.setProperty('--sx', `${window.innerWidth / 2}px`);
    root.style.setProperty('--sy', `${remote ? window.innerHeight * .12 : window.innerHeight * .88}px`);
    root.style.setProperty('--tx', `${rect.left + rect.width / 2}px`);
    root.style.setProperty('--ty', `${rect.top + rect.height / 2}px`);
    document.body.appendChild(root);
    setTimeout(() => root.remove(), 1700);
  };

  // 기존 game.js가 호출하는 배치 함수 자체를 교체한다.
  window.broadcastDeployEffect = function (card, fieldIndex) {
    const snapshot = clone(playerField[fieldIndex] || card);
    const effect = { type: 'deploy', effectId: uid('deploy'), fieldIndex, card: snapshot };
    if (typeof window.broadcastMultiplayerEffect === 'function') window.broadcastMultiplayerEffect(effect);
    if (gameMode === 'multiplayer' && socket) socket.emit('battle:deploy', { fieldIndex, card: snapshot });
  };

  window.syncEvolutionNow = function (fieldIndex) {
    if (gameMode !== 'multiplayer' || !socket || !playerField[fieldIndex]) return;
    const card = clone(playerField[fieldIndex]);
    const effect = { type: 'evolution', effectId: uid('evolution'), fieldIndex, card };
    socket.emit('battle:evolve', { fieldIndex, card });
    socket.emit('battle:fx', { roomCode: multiplayerRoom, effect });
  };

  // 진화 함수 호출 전후를 비교해 실시간 전송한다.
  const originalDropItem = window.dropItemToSpecificMonster;
  window.dropItemToSpecificMonster = function (fieldIndex, event) {
    const before = playerField[fieldIndex]?.id;
    const result = originalDropItem(fieldIndex, event);
    const after = playerField[fieldIndex];
    if (before && after?.id && before !== after.id && after.type === 'EVOLUTION') {
      setTimeout(() => window.syncEvolutionNow(fieldIndex), 0);
    }
    return result;
  };

  function attach() {
    if (!socket || socket.__syncCoreV10) return false;
    socket.__syncCoreV10 = true;

    socket.on('battle:fx', payload => {
      const effect = payload?.effect || payload;
      if (!effect || !accept(effect.effectId)) return;
      if (effect.type === 'deploy') {
        const index = Math.max(0, Math.min(2, Number(effect.fieldIndex) || 0));
        const card = clone(effect.card || {});
        if (!card.id) return;
        if (card.currentHp == null) card.currentHp = card.hp;
        if (!Array.isArray(card.equippedItems)) card.equippedItems = [];
        opponentField[index] = card;
        opponentField = opponentField.filter(Boolean).slice(0, 3);
        renderBattleUI();
        requestAnimationFrame(() => window.animateMonsterDeploy(card, index, true));
      }
      if (effect.type === 'draw') {
        playDrawSequenceEffect({ style: effect.drawStyle || 'normal', count: effect.count || 1, remote: true });
      }
      if (effect.type === 'evolution') {
        const index = Math.max(0, Math.min(2, Number(effect.fieldIndex) || 0));
        if (effect.card?.id) opponentField[index] = clone(effect.card);
        renderBattleUI();
        if (typeof playEvolutionVisual === 'function') playEvolutionVisual(effect, true);
      }
    });

    socket.on('battle:coin', result => {
      const old = document.getElementById('network-coin-v10');
      if (old) old.remove();
      const root = document.createElement('div');
      root.id = 'network-coin-v10';
      root.innerHTML = `<div class="network-coin-v10 ${result?.isFirst ? 'first' : 'second'}"><b>선공</b><i>후공</i></div><strong>${result?.isFirst ? '내가 선공!' : `${result?.firstName || '상대'} 선공 · 나는 후공`}</strong>`;
      document.body.appendChild(root);
      setTimeout(() => root.remove(), 4300);
    });
    return true;
  }
  const timer = setInterval(() => { if (attach()) clearInterval(timer); }, 100);
})();
