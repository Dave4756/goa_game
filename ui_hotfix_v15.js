'use strict';

(function installUiHotfixV15() {
  const clone = value => JSON.parse(JSON.stringify(value));

  function cleanOldEffects() {
    document.querySelectorAll('.deploy-card-effect,.draw-sequence-effect,.bookbag-fx,.lottery-fx,.item-use-effect,.v15-effect').forEach(node => node.remove());
  }

  function safeArt(url) {
    return String(url || '').replace(/["'()\\]/g, '');
  }

  function placeFixedCard(root, image, name, startX, startY, endX, endY) {
    const card = document.createElement('div');
    card.className = 'v15-effect';
    Object.assign(card.style, {
      position: 'fixed', left: `${startX}px`, top: `${startY}px`, width: '105px', height: '178px',
      maxWidth: '105px', maxHeight: '178px', margin: '-89px 0 0 -52px', padding: '6px',
      boxSizing: 'border-box', overflow: 'hidden', borderRadius: '10px', border: '4px solid #f1c40f',
      background: '#ecf0f1', boxShadow: '0 0 32px #f1c40f', zIndex: '30001', pointerEvents: 'none'
    });
    const art = document.createElement('div');
    Object.assign(art.style, {
      width: '85px', height: '123px', maxWidth: '85px', maxHeight: '123px', overflow: 'hidden',
      borderRadius: '6px', backgroundImage: `url("${safeArt(image)}")`, backgroundSize: 'cover',
      backgroundPosition: 'center', backgroundRepeat: 'no-repeat'
    });
    const label = document.createElement('div');
    label.textContent = name || '몬스터';
    Object.assign(label.style, { color: '#2c3e50', fontSize: '10px', fontWeight: '800', textAlign: 'center', paddingTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden' });
    card.append(art, label);
    root.appendChild(card);
    const dx = endX - startX;
    const dy = endY - startY;
    card.animate([
      { opacity: 0, transform: 'scale(.45) rotate(-9deg)' },
      { opacity: 1, offset: .2 },
      { opacity: 1, transform: `translate(${dx}px,${dy}px) scale(1.08) rotate(2deg)`, offset: .78 },
      { opacity: 0, transform: `translate(${dx}px,${dy}px) scale(.96) rotateY(85deg)` }
    ], { duration: 1450, easing: 'cubic-bezier(.18,.82,.22,1)', fill: 'forwards' });
  }

  window.animateMonsterDeploy = function (card, fieldIndex, remote = false) {
    cleanOldEffects();
    const slots = document.getElementById(remote ? 'opponent-field-slots' : 'player-field-slots');
    const target = slots?.children?.[fieldIndex] || slots;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const root = document.createElement('div');
    root.className = 'v15-effect';
    Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '30000', pointerEvents: 'none', overflow: 'hidden' });
    document.body.appendChild(root);
    placeFixedCard(root, card?.image, card?.name, window.innerWidth / 2, remote ? window.innerHeight * .12 : window.innerHeight * .88, rect.left + rect.width / 2, rect.top + rect.height / 2);
    setTimeout(() => root.remove(), 1550);
  };

  function commonItemEffect(item, remote = false) {
    cleanOldEffects();
    const root = document.createElement('div');
    root.className = 'v15-effect';
    Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '30000', pointerEvents: 'none', overflow: 'hidden' });
    document.body.appendChild(root);
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    placeFixedCard(root, item?.image, item?.name || '아이템', x, remote ? window.innerHeight * .18 : window.innerHeight * .78, x, y);
    setTimeout(() => root.remove(), 1550);
  }

  window.playRemoteItemEffect = function (effect) {
    commonItemEffect(effect?.item, true);
  };

  window.useDrawItemFromHand = function (handIdx) {
    const itemCard = myHand[handIdx];
    if (!itemCard) return;
    const skill = itemCard.skills?.[0] || {};
    const drawnCards = [];
    if (skill.type === 'draw_monster') {
      const index = battleDeck.findIndex(card => !['ITEM', 'NORMAL_ITEM', 'EVOLUTION'].includes(card.type));
      if (index < 0) {
        document.getElementById('battle-action-info').innerText = '덱에 뽑을 수 있는 몬스터 카드가 없습니다!';
        return;
      }
      drawnCards.push(battleDeck.splice(index, 1)[0]);
    } else if (skill.type === 'draw_random') {
      const count = Math.min(Number(skill.count) || 2, battleDeck.length);
      for (let i = 0; i < count; i++) drawnCards.push(battleDeck.splice(Math.floor(Math.random() * battleDeck.length), 1)[0]);
      if (!drawnCards.length) return;
    } else return;

    commonItemEffect(itemCard, false);
    if (gameMode === 'multiplayer' && socket && multiplayerRoom) {
      socket.emit('battle:fx', {
        roomCode: multiplayerRoom,
        effect: { type: 'item', effectId: `item-${Date.now()}-${Math.random()}`, item: { id: itemCard.id, name: itemCard.name, image: itemCard.image }, targetSide: 'board', targetIndex: null }
      });
    }
    myHand.splice(handIdx, 1);
    playerTrash.push(itemCard);
    consumableItemUsedThisTurn[skill.type] = true;
    document.getElementById('battle-action-info').innerText = `[${itemCard.name}] 사용! ${drawnCards.length}장을 뽑았습니다.`;
    setTimeout(() => {
      myHand.push(...drawnCards);
      renderBattleUI();
      if (typeof window.syncMultiplayerStateNow === 'function') window.syncMultiplayerStateNow('draw-item');
    }, 900);
  };

  // 매치메이킹 UI가 빠진 배포본에서도 복구합니다.
  function installQuickMatch() {
    if (document.getElementById('quick-match-btn')) return;
    const panel = document.querySelector('.multiplayer-panel');
    const buttons = panel?.querySelector('.multiplayer-buttons');
    if (!panel || !buttons) return;
    const button = document.createElement('button');
    button.id = 'quick-match-btn';
    button.type = 'button';
    button.textContent = '빠른 매치메이킹';
    button.style.cssText = 'width:100%;margin:10px 0;background:linear-gradient(135deg,#8e44ad,#3498db);';
    let waiting = false;
    button.onclick = () => {
      connectSocket();
      if (waiting) {
        socket.emit('matchmaking:cancel');
        waiting = false;
        button.textContent = '빠른 매치메이킹';
        setMultiplayerStatus('매치메이킹을 취소했습니다.');
      } else {
        socket.emit('matchmaking:join', { name: playerNickname });
        waiting = true;
        button.textContent = '매치메이킹 취소';
        setMultiplayerStatus('상대를 찾는 중입니다...');
      }
    };
    panel.insertBefore(button, buttons);
    socket?.on('matchmaking:matched', ({ roomCode }) => {
      waiting = false;
      multiplayerRoom = roomCode;
      button.textContent = '빠른 매치메이킹';
    });
  }

  const originalOpen = window.openMultiplayerUI;
  if (typeof originalOpen === 'function') {
    window.openMultiplayerUI = function () {
      const result = originalOpen.apply(this, arguments);
      installQuickMatch();
      return result;
    };
  }
  window.addEventListener('DOMContentLoaded', installQuickMatch);
})();
