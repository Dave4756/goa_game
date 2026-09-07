'use strict';

(function () {
  const processed = new Set();

  function slot(side, index) {
    const id = side === 'player' ? 'player-field-slots' : 'opponent-field-slots';
    return document.getElementById(id)?.children?.[index] || null;
  }

  function effectId(prefix = 'fx') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  window.createBattleEffectId = effectId;

  window.acceptBattleEffect = function (id) {
    if (!id) return true;
    if (processed.has(id)) return false;
    processed.add(id);
    setTimeout(() => processed.delete(id), 12000);
    return true;
  };

  window.playConfiguredSkillEffect = function (payload, remote = false) {
    const attackerSide = remote ? 'opponent' : 'player';
    const targetSide = remote ? 'player' : 'opponent';
    const attacker = slot(attackerSide, Number(payload.attackerIndex) || 0);
    const targetContainer = document.getElementById(targetSide === 'player' ? 'player-field-slots' : 'opponent-field-slots');
    const targets = payload.multi
      ? [...(targetContainer?.children || [])]
      : [slot(targetSide, Number(payload.targetIndex) || 0)].filter(Boolean);
    if (!attacker || !targets.length) return;

    const from = attacker.getBoundingClientRect();
    targets.forEach((target, index) => {
      const to = target.getBoundingClientRect();
      const root = document.createElement('div');
      root.className = `configured-skill-fx fx-${payload.effect || 'impact'}`;
      root.style.setProperty('--sx', `${from.left + from.width / 2}px`);
      root.style.setProperty('--sy', `${from.top + from.height / 2}px`);
      root.style.setProperty('--tx', `${to.left + to.width / 2}px`);
      root.style.setProperty('--ty', `${to.top + to.height / 2}px`);
      root.style.setProperty('--delay', `${index * 100}ms`);
      root.innerHTML = `<div class="fx-skill-title">${payload.skillName || 'SKILL'}</div><div class="fx-projectile"></div><div class="fx-impact"></div>`;
      document.body.appendChild(root);
      target.classList.add(`fx-hit-${payload.effect || 'impact'}`);
      setTimeout(() => target.classList.remove(`fx-hit-${payload.effect || 'impact'}`), 1050);
      setTimeout(() => root.remove(), 1600 + index * 100);
    });
  };

  window.playEvolutionEffect = function (payload, remote = false) {
    const target = slot(remote ? 'opponent' : 'player', Number(payload.fieldIndex) || 0);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const root = document.createElement('div');
    root.className = 'simple-evolution-fx';
    root.style.setProperty('--x', `${r.left + r.width / 2}px`);
    root.style.setProperty('--y', `${r.top + r.height / 2}px`);
    root.innerHTML = `<div class="evolution-ring one"></div><div class="evolution-ring two"></div><div class="evolution-preview"><img src="${payload.card?.image || ''}" alt=""><strong>${payload.card?.name || '진화'}</strong></div><div class="evolution-caption">EVOLUTION!</div>`;
    document.body.appendChild(root);
    setTimeout(() => root.remove(), 2400);
  };
})();
