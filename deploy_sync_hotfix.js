'use strict';

// Load this file after network.js.
(function installRealtimeDeploySync() {
  const handledDeployEffects = new Set();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeCard(card) {
    const normalized = clone(card || {});
    if (!normalized.id) return null;
    if (normalized.currentHp == null && normalized.hp != null) normalized.currentHp = normalized.hp;
    if (!Array.isArray(normalized.equippedItems)) normalized.equippedItems = [];
    normalized.shieldTurns = Number(normalized.shieldTurns) || 0;
    normalized.shieldPercent = Number(normalized.shieldPercent) || 0;
    normalized.damageBonus = Number(normalized.damageBonus) || 0;
    normalized.damageReduction = Number(normalized.damageReduction) || 0;
    normalized.turnHeal = Number(normalized.turnHeal) || 0;
    return normalized;
  }

  function applyRemoteDeploy(effect) {
    if (!effect || effect.type !== 'deploy') return;
    if (effect.effectId && handledDeployEffects.has(effect.effectId)) return;
    if (effect.effectId) {
      handledDeployEffects.add(effect.effectId);
      setTimeout(() => handledDeployEffects.delete(effect.effectId), 12000);
    }

    const fieldIndex = Math.max(0, Math.min(2, Number(effect.fieldIndex) || 0));
    const deployedCard = normalizeCard(effect.card);
    if (!deployedCard) return;

    opponentField[fieldIndex] = deployedCard;
    opponentField = opponentField.filter(Boolean).slice(0, 3);
    renderBattleUI();
  }

  function attachSocketListener() {
    if (!socket || socket.__deploySyncHotfixInstalled) return false;
    socket.__deploySyncHotfixInstalled = true;
    socket.on('battle:fx', payload => applyRemoteDeploy(payload?.effect || payload));
    return true;
  }

  const listenerTimer = setInterval(() => {
    if (attachSocketListener()) clearInterval(listenerTimer);
  }, 100);

  const originalBroadcastDeployEffect = window.broadcastDeployEffect;
  window.broadcastDeployEffect = function broadcastDeployEffect(card, fieldIndex) {
    const safeIndex = Math.max(0, Math.min(2, Number(fieldIndex) || 0));
    const runtimeCard = normalizeCard(playerField[safeIndex] || card);
    if (!runtimeCard) return;

    const effectId = typeof createEffectId === 'function'
      ? createEffectId('deploy')
      : `deploy-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    if (typeof emitMultiplayerEffect === 'function') {
      emitMultiplayerEffect({
        type: 'deploy',
        effectId,
        fieldIndex: safeIndex,
        card: runtimeCard
      });
    } else if (typeof window.broadcastMultiplayerEffect === 'function') {
      window.broadcastMultiplayerEffect({
        type: 'deploy',
        effectId,
        fieldIndex: safeIndex,
        card: runtimeCard
      });
    } else if (typeof originalBroadcastDeployEffect === 'function') {
      originalBroadcastDeployEffect(card, safeIndex);
    }

    if (gameMode === 'multiplayer' && socket) {
      socket.emit('battle:deploy', {
        fieldIndex: safeIndex,
        card: runtimeCard
      });
    }
  };
})();
