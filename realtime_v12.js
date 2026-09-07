'use strict';

(function installRealtimeV12() {
  const seen = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));
  const effectId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const accept = id => {
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    setTimeout(() => seen.delete(id), 12000);
    return true;
  };

  function emitEffect(effect) {
    if (gameMode !== 'multiplayer' || !socket || !multiplayerRoom) return;
    socket.emit('battle:fx', { roomCode: multiplayerRoom, effect: { effectId: effect.effectId || effectId(effect.type), ...effect } });
  }

  function syncState(reason) {
    if (gameMode !== 'multiplayer' || !socket || applyingNetworkState) return;
    socket.emit('battle:sync', {
      reason,
      myField: clone(playerField),
      opponentField: clone(opponentField),
      myTrash: clone(playerTrash),
      opponentTrash: clone(opponentTrash),
      handCount: myHand.length
    });
  }

  function renderOpponentHand(count) {
    let zone = document.getElementById('opponent-hand-backs');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'opponent-hand-backs';
      document.getElementById('opponent-field-zone')?.appendChild(zone);
    }
    if (!zone) return;
    const safeCount = Math.max(0, Math.min(20, Number(count) || 0));
    const cards = Array.from({ length: Math.min(safeCount, 12) }, (_, index) => `<div class="opponent-card-back" style="--i:${index}">GOA</div>`).join('');
    zone.innerHTML = `<span class="opponent-hand-label">상대 패 ${safeCount}장</span><div class="opponent-card-backs">${cards}</div>`;
  }

  function attachSocket() {
    if (!socket || socket.__realtimeV12Installed) return false;
    socket.__realtimeV12Installed = true;

    socket.on('room:state', state => renderOpponentHand(state?.opponentHandCount));
    socket.on('battle:fx', payload => {
      const effect = payload?.effect || payload;
      if (!effect || !accept(effect.effectId)) return;

      if (effect.type === 'draw') {
        playDrawSequenceEffect({ style: effect.drawStyle || 'normal', count: effect.count || 1, remote: true });
      }

      if (effect.type === 'item-status' && effect.statusType === 'confusion') {
        if (typeof playRemoteItemEffect === 'function') playRemoteItemEffect(effect);
        playerField.forEach(card => {
          card.isConfused = true;
          card.confusedTurns = effect.duration || 1;
        });
        renderBattleUI();
      }

      if (effect.type === 'evolution') {
        const index = Math.max(0, Math.min(2, Number(effect.fieldIndex) || 0));
        if (effect.card?.id) opponentField[index] = clone(effect.card);
        renderBattleUI();
        if (typeof playEvolutionVisual === 'function') playEvolutionVisual(effect, true);
      }
    });
    return true;
  }

  const attachTimer = setInterval(() => {
    if (attachSocket()) clearInterval(attachTimer);
  }, 100);

  const originalRenderBattleUI = window.renderBattleUI;
  window.renderBattleUI = function () {
    const result = originalRenderBattleUI.apply(this, arguments);
    clearTimeout(window.renderBattleUI.__handTimer);
    window.renderBattleUI.__handTimer = setTimeout(() => {
      if (gameMode === 'multiplayer' && socket && !applyingNetworkState) socket.emit('battle:hand-count', { count: myHand.length });
    }, 100);
    return result;
  };

  const originalDrawCard = window.drawCardFromDeck;
  window.drawCardFromDeck = function () {
    const before = myHand.length;
    const result = originalDrawCard.apply(this, arguments);
    setTimeout(() => {
      if (myHand.length > before) syncState('normal-draw');
    }, 700);
    return result;
  };

  const originalDrawItem = window.useDrawItemFromHand;
  window.useDrawItemFromHand = function (handIndex) {
    const item = myHand[handIndex];
    const result = originalDrawItem.apply(this, arguments);
    const delay = item?.id === 'item_bookbag' || item?.id === 'item_kim_seonga_lottery' ? 1500 : 900;
    setTimeout(() => syncState('draw-item'), delay);
    return result;
  };

  const originalConfuseAll = window.useConfuseAllItem;
  window.useConfuseAllItem = function (handIndex) {
    const item = myHand[handIndex];
    const result = originalConfuseAll.apply(this, arguments);
    emitEffect({
      type: 'item-status',
      item: { id: item?.id, name: item?.name || '기습 수행평가', image: item?.image || '' },
      statusType: 'confusion',
      duration: item?.skills?.[0]?.duration || 1,
      all: true,
      targetSide: 'opponent'
    });
    syncState('confuse-all');
    return result;
  };

  const originalDropItem = window.dropItemToSpecificMonster;
  window.dropItemToSpecificMonster = function (fieldIndex, event) {
    const beforeId = playerField[fieldIndex]?.id;
    const result = originalDropItem.apply(this, arguments);
    const after = playerField[fieldIndex];
    if (beforeId && after?.id && beforeId !== after.id && after.type === 'EVOLUTION') {
      const card = clone(after);
      emitEffect({ type: 'evolution', fieldIndex, card });
      if (gameMode === 'multiplayer' && socket) socket.emit('battle:evolve', { fieldIndex, card });
      syncState('evolution');
    }
    return result;
  };
})();
