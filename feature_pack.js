'use strict';

(function installGoaFeaturePack() {
  const seenFx = new Set();
  let matchmakingJoined = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function fxId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function sendFx(effect) {
    if (gameMode !== 'multiplayer' || !socket || !multiplayerRoom) return;
    socket.emit('battle:fx', {
      roomCode: multiplayerRoom,
      effect: { effectId: fxId(effect.type || 'fx'), ...effect }
    });
  }

  function acceptFx(effect) {
    if (!effect?.effectId) return true;
    if (seenFx.has(effect.effectId)) return false;
    seenFx.add(effect.effectId);
    setTimeout(() => seenFx.delete(effect.effectId), 12000);
    return true;
  }

  function fieldSlot(side, index) {
    const id = side === 'own' ? 'player-field-slots' : 'opponent-field-slots';
    return document.getElementById(id)?.children[index] || null;
  }

  function playSkillVisual(effect, remote = false) {
    const attackerSide = remote ? 'opponent' : 'own';
    const targetSide = remote ? 'own' : 'opponent';
    const attacker = fieldSlot(attackerSide, Number(effect.attackerIndex) || 0);
    const targets = effect.multi
      ? [...(document.getElementById(targetSide === 'own' ? 'player-field-slots' : 'opponent-field-slots')?.children || [])]
      : [fieldSlot(targetSide, Number(effect.targetIndex) || 0)].filter(Boolean);
    if (!attacker || !targets.length) return;

    const a = attacker.getBoundingClientRect();
    targets.forEach((target, i) => {
      const t = target.getBoundingClientRect();
      const el = document.createElement('div');
      const element = effect.element || 'normal';
      el.className = `skill-cast-fx skill-${element} ${effect.multi ? 'multi' : ''}`;
      el.style.setProperty('--sx', `${a.left + a.width / 2}px`);
      el.style.setProperty('--sy', `${a.top + a.height / 2}px`);
      el.style.setProperty('--tx', `${t.left + t.width / 2}px`);
      el.style.setProperty('--ty', `${t.top + t.height / 2}px`);
      el.style.setProperty('--delay', `${i * 90}ms`);
      el.innerHTML = `<div class="skill-projectile"></div><div class="skill-impact-burst"></div><div class="skill-name-flash">${effect.skillName || 'SKILL'}</div>`;
      document.body.appendChild(el);
      target.classList.add(`hit-${element}`);
      setTimeout(() => target.classList.remove(`hit-${element}`), 900);
      setTimeout(() => el.remove(), 1350 + i * 90);
    });
  }

  function playEvolutionVisual(effect, remote = false) {
    const side = remote ? 'opponent' : 'own';
    const target = fieldSlot(side, Number(effect.fieldIndex) || 0);
    const rect = target?.getBoundingClientRect();
    if (!rect) return;
    const el = document.createElement('div');
    el.className = 'evolution-fx';
    el.style.setProperty('--evo-x', `${rect.left + rect.width / 2}px`);
    el.style.setProperty('--evo-y', `${rect.top + rect.height / 2}px`);
    el.innerHTML = `<div class="evo-ring r1"></div><div class="evo-ring r2"></div><div class="evo-card"><img src="${effect.card?.image || ''}" alt=""><strong>${effect.card?.name || '진화'}</strong></div><div class="evo-title">EVOLUTION!</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  function playRemoteItemGuaranteed(effect) {
    if (typeof playRemoteItemEffect === 'function') {
      playRemoteItemEffect(effect);
      return;
    }
    const side = effect.targetSide === 'own' ? 'opponent' : effect.targetSide === 'opponent' ? 'own' : 'board';
    const target = side === 'board' ? document.getElementById('battle-board') : fieldSlot(side, Number(effect.targetIndex) || 0);
    const rect = target?.getBoundingClientRect();
    if (!rect) return;
    const el = document.createElement('div');
    el.className = 'remote-item-fx';
    el.style.setProperty('--ix', `${rect.left + rect.width / 2}px`);
    el.style.setProperty('--iy', `${rect.top + rect.height / 2}px`);
    el.innerHTML = `<div class="remote-item-card"><img src="${effect.item?.image || ''}" alt=""><strong>${effect.item?.name || '아이템'}</strong></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  function installSocketExtensions() {
    if (!socket || socket.__goaFeaturePack) return false;
    socket.__goaFeaturePack = true;

    socket.on('battle:fx', payload => {
      const effect = payload?.effect || payload;
      if (!effect || !acceptFx(effect)) return;
      if (effect.type === 'item') playRemoteItemGuaranteed(effect);
      if (effect.type === 'skill-cast') playSkillVisual(effect, true);
      if (effect.type === 'evolution') playEvolutionVisual(effect, true);
    });

    socket.on('matchmaking:waiting', () => {
      matchmakingJoined = true;
      setMultiplayerStatus('자동 매칭 상대를 찾는 중...');
    });

    socket.on('matchmaking:matched', ({ roomCode }) => {
      matchmakingJoined = false;
      multiplayerRoom = roomCode;
      setMultiplayerStatus(`매칭 완료! 방 ${roomCode}`);
    });
    return true;
  }

  const socketTimer = setInterval(() => {
    if (installSocketExtensions()) clearInterval(socketTimer);
  }, 100);

  function installMatchmakingButton() {
    ensureMultiplayerUI();
    const panel = document.querySelector('.multiplayer-panel');
    if (!panel || document.getElementById('quick-match-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'quick-match-btn';
    btn.textContent = '빠른 매치 찾기';
    btn.onclick = () => {
      connectSocket();
      if (matchmakingJoined) {
        socket.emit('matchmaking:cancel');
        matchmakingJoined = false;
        btn.textContent = '빠른 매치 찾기';
        setMultiplayerStatus('자동 매칭을 취소했습니다.');
      } else {
        socket.emit('matchmaking:join', { name: playerNickname });
        btn.textContent = '매칭 취소';
      }
    };
    panel.insertBefore(btn, panel.querySelector('.multiplayer-buttons'));
  }

  const originalOpenMultiplayerUI = window.openMultiplayerUI;
  window.openMultiplayerUI = function () {
    originalOpenMultiplayerUI();
    installMatchmakingButton();
  };

  // 시작 단계에서는 턴 배너 대신 배치 안내를 표시합니다.
  const originalBeginMultiplayerBattle = window.beginMultiplayerBattle;
  window.beginMultiplayerBattle = function () {
    originalBeginMultiplayerBattle();
    lastTurnBannerKey = 'initial-deployment';
    const indicator = document.getElementById('turn-indicator');
    if (indicator) {
      indicator.textContent = '시작 몬스터 배치';
      indicator.style.color = '#2ecc71';
    }
    const info = document.getElementById('battle-action-info');
    if (info) info.textContent = '손패에서 시작 몬스터 1장을 필드에 배치하세요.';
    if (typeof showTurnChangeEffect === 'function') showTurnChangeEffect('시작 몬스터 배치', 'mine');
  };

  // 스킬 실행 순간 속성별 연출을 양쪽에 보냅니다.
  const originalExecuteTargetSkill = window.executeTargetSkill;
  window.executeTargetSkill = function (pIdx, sIdx, targetOIdx) {
    const attacker = playerField[pIdx];
    const skill = attacker?.skills?.[sIdx];
    if (skill) {
      const effect = {
        type: 'skill-cast',
        attackerIndex: pIdx,
        targetIndex: targetOIdx,
        skillName: skill.name,
        element: skill.statusType === 'sleep' ? 'sleep' : (skill.element || 'normal'),
        multi: skill.type === 'multi'
      };
      playSkillVisual(effect, false);
      sendFx(effect);
    }
    return originalExecuteTargetSkill(pIdx, sIdx, targetOIdx);
  };

  // 진화 전후 카드를 비교해 간단한 진화 연출을 재생합니다.
  const originalDropItem = window.dropItemToSpecificMonster;
  window.dropItemToSpecificMonster = function (targetFIdx, event) {
    const beforeId = playerField[targetFIdx]?.id;
    const result = originalDropItem(targetFIdx, event);
    const after = playerField[targetFIdx];
    if (after && beforeId && after.id !== beforeId && after.type === 'EVOLUTION') {
      const effect = { type: 'evolution', fieldIndex: targetFIdx, card: clone(after) };
      setTimeout(() => playEvolutionVisual(effect, false), 0);
      sendFx(effect);
    }
    return result;
  };

  window.addEventListener('DOMContentLoaded', installMatchmakingButton);
})();
