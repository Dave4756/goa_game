'use strict';

(function installUnifiedRuntimeV16() {
  const seen = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = type => `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let itemDragIndex = null;
  let matchmakingWaiting = false;

  function accept(id) {
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    setTimeout(() => seen.delete(id), 15000);
    return true;
  }

  function emitGameEvent(event) {
    if (gameMode !== 'multiplayer' || !socket || !multiplayerRoom) return;
    socket.emit('game:event', { roomCode: multiplayerRoom, event: { eventId: event.eventId || uid(event.type || 'event'), ...event } });
  }

  function syncNow(reason = 'update') {
    if (gameMode !== 'multiplayer' || !socket || applyingNetworkState) return;
    socket.emit('game:state', {
      reason,
      myField: clone(playerField), opponentField: clone(opponentField),
      myTrash: clone(playerTrash), opponentTrash: clone(opponentTrash),
      handCount: myHand.length
    });
  }
  window.syncAllGameState = syncNow;

  function fieldCard(side, index) {
    const id = side === 'own' ? 'player-field-slots' : 'opponent-field-slots';
    return document.getElementById(id)?.children?.[index] || null;
  }

  function safeImage(url) {
    return String(url || '').replace(/["'()\\]/g, '');
  }

  function playCardFly(card, side, index, kind = 'deploy') {
    document.querySelectorAll('.unified-fx-card').forEach(node => node.remove());
    const target = fieldCard(side, index) || document.getElementById(side === 'own' ? 'player-field-slots' : 'opponent-field-slots');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const startX = window.innerWidth / 2;
    const startY = side === 'own' ? window.innerHeight * .88 : window.innerHeight * .12;
    const endX = rect.left + rect.width / 2;
    const endY = rect.top + rect.height / 2;
    const root = document.createElement('div');
    root.className = 'unified-fx-card';
    root.style.cssText = `position:fixed;left:${startX}px;top:${startY}px;width:105px;height:178px;max-width:105px;max-height:178px;margin:-89px 0 0 -52px;padding:6px;box-sizing:border-box;overflow:hidden;border-radius:10px;border:4px solid ${kind === 'evolution' ? '#74b9ff' : '#f1c40f'};background:#ecf0f1;box-shadow:0 0 36px ${kind === 'evolution' ? '#0984e3' : '#f1c40f'};z-index:30001;pointer-events:none;`;
    root.innerHTML = `<div style="width:85px;height:123px;max-width:85px;max-height:123px;overflow:hidden;border-radius:6px;background-image:url('${safeImage(card?.image)}');background-size:cover;background-position:center;background-repeat:no-repeat"></div><div style="height:35px;padding-top:6px;color:#2c3e50;font-size:10px;font-weight:900;text-align:center;overflow:hidden">${card?.name || '카드'}</div>`;
    document.body.appendChild(root);
    const dx = endX - startX, dy = endY - startY;
    root.animate([
      { opacity: 0, transform: 'scale(.42) rotate(-10deg)' },
      { opacity: 1, offset: .18 },
      { opacity: 1, transform: `translate(${dx}px,${dy}px) scale(1.1) rotate(2deg)`, offset: .78 },
      { opacity: 0, transform: `translate(${dx}px,${dy}px) scale(.96) rotateY(80deg)` }
    ], { duration: kind === 'evolution' ? 2300 : 1500, easing: 'cubic-bezier(.18,.82,.22,1)', fill: 'forwards' });
    setTimeout(() => root.remove(), kind === 'evolution' ? 2400 : 1600);
  }

  window.animateMonsterDeploy = (card, index, remote = false) => playCardFly(card, remote ? 'opponent' : 'own', index, 'deploy');

  function playSkillFx(event, remote) {
    const attackerSide = remote ? 'opponent' : 'own';
    const targetSide = remote ? 'own' : 'opponent';
    const attacker = fieldCard(attackerSide, Number(event.attackerIndex) || 0);
    const targetZone = document.getElementById(targetSide === 'own' ? 'player-field-slots' : 'opponent-field-slots');
    const targets = event.multi ? [...(targetZone?.children || [])] : [fieldCard(targetSide, Number(event.targetIndex) || 0)].filter(Boolean);
    if (!attacker || !targets.length) return;
    const from = attacker.getBoundingClientRect();
    targets.forEach((target, n) => {
      const to = target.getBoundingClientRect();
      const root = document.createElement('div');
      const fx = event.effect || 'impact';
      root.className = `skill-v16 skill-v16-${fx}`;
      root.style.setProperty('--sx', `${from.left + from.width / 2}px`);
      root.style.setProperty('--sy', `${from.top + from.height / 2}px`);
      root.style.setProperty('--tx', `${to.left + to.width / 2}px`);
      root.style.setProperty('--ty', `${to.top + to.height / 2}px`);
      root.style.setProperty('--delay', `${n * 90}ms`);
      root.innerHTML = `<div class="skill-v16-name">${event.skillName || 'SKILL'}</div><div class="skill-v16-shot"></div><div class="skill-v16-impact"></div>`;
      document.body.appendChild(root);
      target.classList.add(`skill-v16-hit-${fx}`);
      setTimeout(() => target.classList.remove(`skill-v16-hit-${fx}`), 1050);
      setTimeout(() => root.remove(), 1600 + n * 90);
    });
  }

  function playItemFx(event, remote) {
    const side = remote ? (event.targetSide === 'own' ? 'opponent' : 'own') : 'own';
    const target = event.targetIndex == null ? document.getElementById('battle-board') : fieldCard(side, Number(event.targetIndex) || 0);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const root = document.createElement('div');
    root.className = 'unified-item-fx';
    root.style.cssText = `position:fixed;left:${remote ? window.innerWidth / 2 : window.innerWidth / 2}px;top:${remote ? window.innerHeight * .18 : window.innerHeight * .8}px;width:70px;height:94px;max-width:70px;max-height:94px;overflow:hidden;border-radius:9px;background:#fff;border:3px solid #f1c40f;box-shadow:0 0 25px #f1c40f;z-index:30000;pointer-events:none;`;
    root.innerHTML = `<div style="width:70px;height:68px;background:url('${safeImage(event.item?.image)}') center/cover no-repeat"></div><div style="color:#2c3e50;font-size:8px;text-align:center;font-weight:800">${event.item?.name || '아이템'}</div>`;
    document.body.appendChild(root);
    const start = root.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - (start.left + start.width / 2);
    const dy = rect.top + rect.height / 2 - (start.top + start.height / 2);
    root.animate([{opacity:0,transform:'scale(.6)'},{opacity:1,offset:.2},{opacity:1,transform:`translate(${dx}px,${dy}px) scale(1.05)`,offset:.75},{opacity:0,transform:`translate(${dx}px,${dy}px) scale(.35)`}],{duration:1000,easing:'ease-out',fill:'forwards'});
    setTimeout(() => root.remove(), 1050);
  }

  function renderOpponentHand(count) {
    let zone = document.getElementById('opponent-hand-v16');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'opponent-hand-v16';
      document.getElementById('opponent-field-zone')?.appendChild(zone);
    }
    if (!zone) return;
    const safeCount = Math.max(0, Math.min(20, Number(count) || 0));
    zone.innerHTML = `<div class="opponent-hand-v16-label">상대 손패 ${safeCount}장</div><div class="opponent-hand-v16-cards">${Array.from({length: Math.min(safeCount, 12)},(_,i)=>`<div class="opponent-back-v16" style="--i:${i}">GOA</div>`).join('')}</div>`;
  }

  function showOpponentCard(card) {
    let overlay = document.getElementById('opponent-card-modal-v16');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'opponent-card-modal-v16';
      overlay.onclick = () => overlay.classList.remove('active');
      document.body.appendChild(overlay);
    }
    const skills = (card.skills || []).map(skill => `<div class="opponent-skill-v16"><strong>${skill.name}</strong><span>${skill.description || ''}</span><em>${skill.damage != null ? `피해 ${skill.damage}` : skill.heal ? `회복 ${skill.heal}` : skill.statusType || '효과'}</em></div>`).join('');
    const items = (card.equippedItems || []).map(item => `<span>${item.name}</span>`).join('') || '없음';
    overlay.innerHTML = `<div class="opponent-modal-v16" onclick="event.stopPropagation()"><h3>상대 카드 상세 정보</h3><div class="opponent-preview-v16"><div class="opponent-preview-art-v16" style="background-image:url('${safeImage(card.image)}')"></div><h4>${card.name}</h4><b>HP ${card.currentHp ?? card.hp} / ${card.hp}</b>${skills}<div class="opponent-items-v16">장착 아이템: ${items}</div></div><button type="button" onclick="document.getElementById('opponent-card-modal-v16').classList.remove('active')">닫기</button></div>`;
    overlay.classList.add('active');
  }

  function updateInteractionFocus() {
    const activeSkill = selectedAttackerIndex !== null && activeSkillIndex !== null;
    const activeItem = pendingItemCardIndex !== null || itemDragIndex !== null;
    document.body.classList.toggle('interaction-focus-v16', activeSkill || activeItem);
    document.querySelectorAll('.interaction-valid-v16,.interaction-source-v16').forEach(el => el.classList.remove('interaction-valid-v16','interaction-source-v16'));
    if (activeSkill) {
      fieldCard('own', selectedAttackerIndex)?.classList.add('interaction-source-v16');
      document.querySelectorAll('#opponent-field-slots .card-ui').forEach(el => el.classList.add('interaction-valid-v16'));
    }
    if (activeItem) {
      document.querySelectorAll('#player-field-slots .card-ui').forEach((el,index) => {
        el.classList.add('interaction-valid-v16');
        el.dataset.dropLabel = `이 카드에 적용 (${playerField[index]?.name || ''})`;
      });
    }
  }

  const oldRender = window.renderBattleUI;
  window.renderBattleUI = function () {
    const result = oldRender.apply(this, arguments);
    requestAnimationFrame(updateInteractionFocus);
    clearTimeout(window.renderBattleUI.__v16Hand);
    window.renderBattleUI.__v16Hand = setTimeout(() => {
      if (gameMode === 'multiplayer' && socket && !applyingNetworkState) socket.emit('game:hand', { count: myHand.length });
    }, 80);
    return result;
  };

  document.addEventListener('click', event => {
    const cardEl = event.target.closest('#opponent-field-slots .card-ui');
    if (!cardEl || selectedAttackerIndex !== null) return;
    const index = [...cardEl.parentElement.children].indexOf(cardEl);
    if (opponentField[index]) {
      event.stopPropagation();
      showOpponentCard(opponentField[index]);
    }
  }, true);

  document.addEventListener('dragstart', event => {
    const el = event.target.closest('#battle-player-hand .card-ui');
    if (!el) return;
    const index = [...el.parentElement.children].indexOf(el);
    const card = myHand[index];
    if (card && (card.type === 'ITEM' || card.type === 'NORMAL_ITEM' || card.type === 'EVOLUTION')) {
      itemDragIndex = index;
      requestAnimationFrame(updateInteractionFocus);
    }
  }, true);
  document.addEventListener('dragend', () => { itemDragIndex = null; updateInteractionFocus(); }, true);
  document.addEventListener('drop', () => { itemDragIndex = null; setTimeout(updateInteractionFocus, 0); }, true);

  const oldExecute = window.executeTargetSkill;
  window.executeTargetSkill = function (pIdx, sIdx, targetIdx) {
    const skill = playerField[pIdx]?.skills?.[sIdx];
    if (skill) {
      const event = { type:'skill', effect:skill.effect || skill.element || skill.statusType || 'impact', skillName:skill.name, attackerIndex:pIdx, targetIndex:targetIdx, multi:skill.type === 'multi' };
      playSkillFx(event,false); emitGameEvent(event);
    }
    return oldExecute.apply(this,arguments);
  };

  const oldItemUse = window.playItemUseEffect;
  window.playItemUseEffect = function (item,targetIndex,sourceIndex,suppressNetwork=false) {
    const event={type:'item',item:{id:item?.id,name:item?.name,image:item?.image},targetSide:targetIndex==null?'board':'own',targetIndex};
    playItemFx(event,false);
    if(!suppressNetwork) emitGameEvent(event);
  };

  const oldDrawItem = window.useDrawItemFromHand;
  window.useDrawItemFromHand = function (index) {
    const result=oldDrawItem.apply(this,arguments);
    setTimeout(()=>syncNow('draw-item'),1000);
    return result;
  };

  const oldDropItem = window.dropItemToSpecificMonster;
  window.dropItemToSpecificMonster = function(index,event){
    const before=playerField[index]?.id;
    const result=oldDropItem.apply(this,arguments);
    const after=playerField[index];
    if(before&&after?.id&&before!==after.id){const evt={type:'evolution',fieldIndex:index,card:clone(after)};playCardFly(after,'own',index,'evolution');emitGameEvent(evt);}
    setTimeout(()=>syncNow('item-or-evolution'),50);
    return result;
  };

  function attachSocket(){
    if(!socket||socket.__unifiedV16)return false;
    socket.__unifiedV16=true;
    socket.on('room:state',state=>renderOpponentHand(state?.opponentHandCount));
    socket.on('game:event',payload=>{
      const e=payload?.event||payload;if(!e||!accept(e.eventId))return;
      if(e.type==='skill')playSkillFx(e,true);
      if(e.type==='item')playItemFx(e,true);
      if(e.type==='deploy'){const i=Number(e.fieldIndex)||0;if(e.card?.id)opponentField[i]=clone(e.card);renderBattleUI();playCardFly(e.card,'opponent',i,'deploy');}
      if(e.type==='evolution'){const i=Number(e.fieldIndex)||0;if(e.card?.id)opponentField[i]=clone(e.card);renderBattleUI();playCardFly(e.card,'opponent',i,'evolution');}
      if(e.type==='draw'&&typeof playDrawSequenceEffect==='function')playDrawSequenceEffect({style:e.drawStyle||'normal',count:e.count||1,remote:true});
      if(e.type==='coin'&&typeof window.playNetworkCoinEffect==='function')window.playNetworkCoinEffect(e.isFirst,e.firstName);
      if(e.type==='awakening'&&typeof showAwakeningEffect==='function')showAwakeningEffect(e.card||{},true);
      if(e.type==='status-all'&&e.statusType==='confusion'){playerField.forEach(c=>c.isConfused=true);renderBattleUI();}
    });
    return true;
  }
  const timer=setInterval(()=>{if(attachSocket())clearInterval(timer)},100);
})();
