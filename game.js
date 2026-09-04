let playerNickname = "플레이어1";
let cardDatabase = [];
let myDeck = [];
let battleDeck = [];
let myHand = [];
let playerField = [];
let opponentField = [];
let playerTrash = []; // 플레이어 트레쉬(무덤) 데이터
let opponentTrash = []; // 상대 트레쉬 데이터
let isMyTurn = true;
let hasDrawnThisTurn = false;
let consumableItemUsedThisTurn = {}; // 이번 턴에 사용한 소모형 아이템 종류 추적

let selectedAttackerIndex = null;
let activeSkillIndex = null;
let isInitialDeploymentPhase = false;
let pendingItemCardIndex = null;

function changeScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function loadSavedData() {
    const savedNickname = localStorage.getItem('playerNickname');
    if (savedNickname) {
        playerNickname = savedNickname;
        document.getElementById('display-nickname').innerText = playerNickname;
    }

    const savedDeck = localStorage.getItem('myDeck');
    if (savedDeck) {
        try {
            const savedCards = JSON.parse(savedDeck);
            myDeck = savedCards
                .map(savedCard => cardDatabase.find(card => card.id === savedCard.id))
                .filter(Boolean)
                .map(card => JSON.parse(JSON.stringify(card)));
            localStorage.setItem('myDeck', JSON.stringify(myDeck));
        } catch (e) {
            myDeck = [];
        }
    }
}

function saveNickname() {
    const input = document.getElementById('nickname-input');
    if (input.value.trim() !== "") {
        playerNickname = input.value.trim();
        document.getElementById('display-nickname').innerText = playerNickname;
        localStorage.setItem('playerNickname', playerNickname);
        alert(`닉네임이 [${playerNickname}](으)로 설정되었습니다.`);
        changeScreen('main-menu');
    } else {
        alert("올바른 닉네임을 입력해주세요.");
    }
}

async function loadCards() {
    try {
        const res = await fetch('cards.json', { cache: 'no-store' });
        cardDatabase = await res.json();
        loadSavedData();
        renderCardCollection();
        renderMyDeck();
    } catch (e) { console.error("데이터 로드 실패", e); }
}

function renderCardCollection() {
    const box = document.getElementById('card-collection');
    box.innerHTML = '';
    // 각성 카드(isUnobtainable)는 보관함에서 제외
    cardDatabase.filter(c => c.id !== 'dummy_card' && !c.isUnobtainable).forEach(card => {
        const el = createCardDOM(card, false, null);
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify(card));
        });
        el.addEventListener('click', () => addCardToDeck(card));
        box.appendChild(el);
    });
}

function addCardToDeck(card) {
    const count = myDeck.filter(c => c.id === card.id).length;
    if (count >= 2) {
        alert("동일한 카드는 덱에 최대 2장까지만 넣을 수 있습니다!");
        return;
    }
    if (myDeck.length >= 20) {
        alert("덱은 최대 20장까지 구성할 수 있습니다.");
        return;
    }
    myDeck.push(JSON.parse(JSON.stringify(card)));
    saveAndRenderDeck();
}

function removeCardFromDeck(idx) {
    myDeck.splice(idx, 1);
    saveAndRenderDeck();
}

function saveAndRenderDeck() {
    localStorage.setItem('myDeck', JSON.stringify(myDeck));
    renderMyDeck();
}

function renderMyDeck() {
    const deckBox = document.getElementById('my-deck');
    document.getElementById('deck-count').innerText = myDeck.length;
    deckBox.innerHTML = '';
    myDeck.forEach((card, idx) => {
        const el = createCardDOM(card, false, null);
        el.addEventListener('click', () => {
            removeCardFromDeck(idx);
        });
        deckBox.appendChild(el);
    });
}

// ---------------------------------------------------------
// 합쳐진 createCardDOM 함수 (상태 이상 오라/배지 적용)
// ---------------------------------------------------------
function createCardDOM(card, isBattleField = false, fIdx = null) {
    const div = document.createElement('div');
    div.classList.add('card-ui');

    let skillsHtml = '';
    const elementInfo = {
        normal: { label: '노말', color: '#7f8c8d' },
        water: { label: '물', color: '#3498db' },
        electric: { label: '전기', color: '#f1c40f' },
        fire: { label: '불', color: '#e74c3c' },
        grass: { label: '풀', color: '#27ae60' }
    };

    if (card.skills) {
        card.skills.forEach((s) => {
            const isItemCard = card.type === 'ITEM' || card.type === 'NORMAL_ITEM';
            const element = !isItemCard
                ? (elementInfo[s.element || 'normal'] || elementInfo.normal)
                : null;
            let valueText = '';
            if (typeof s.damage === 'number') valueText = `피해 ${s.damage}`;
            else if (s.heal) valueText = `회복 ${s.heal}`;
            else if (s.shieldPercent) valueText = `방어 ${s.shieldPercent}%`;
            else if (s.attackBonus) valueText = `공격 +${s.attackBonus}`;
            else if (s.damageReduction) valueText = `피해 감소 ${s.damageReduction}`;
            else if (s.turnHeal) valueText = `턴 회복 ${s.turnHeal}`;

            const statusNames = {
                sleep: '잠듦', paralysis: '감전', confusion: '혼란',
                burn: '화상', poison: '중독'
            };
            const statusText = s.statusType ? statusNames[s.statusType] || s.statusType : '';
            const description = s.description || '스킬 설명을 입력하세요.';

            skillsHtml += `
                <div class="skill-info-block">
                    <div class="skill-info-top">
                        ${element ? `<span class="skill-element" style="background:${element.color};">${element.label}</span>` : ''}
                        <strong class="skill-name">${s.name}</strong>
                    </div>
                    <div class="skill-values">${[valueText, statusText].filter(Boolean).join(' · ') || '효과'}</div>
                    <div class="skill-description">${description}</div>
                </div>`;
        });
    }

    let hpDisplay = card.currentHp !== undefined ? card.currentHp : (card.hp !== undefined ? card.hp : '');
    let headerRight = hpDisplay !== '' ? `HP ${hpDisplay}` : `아이템`;

    let attachedItemsHtml = '';
    if (isBattleField && card.equippedItems && card.equippedItems.length > 0) {
        attachedItemsHtml = `<div style="font-size:7px; color:#27ae60; background:#ecf0f1; padding:1px; margin-top:2px; border-radius:2px;">장착: ${card.equippedItems.map(i => i.name).join(', ')}</div>`;
    }

    // 상태 이상 배지 및 오라(Aura) 처리 (합쳐진 코드)
    let statusBadgesHtml = '';
    let auraHtml = '';

    if (isBattleField) {
        let statuses = [];
        // 잠듦
        if (card.isSleep) {
            statuses.push(`<span style="background:#62c7e8; color:#153e4a; padding:1px 3px; border-radius:3px; font-size:10px; font-weight:bold;">잠듦</span>`);
            auraHtml += `<div class="card-aura sleep-aura" aria-hidden="true"></div>`;
        }
        // 감전
        if (card.isParalyzed) {
            statuses.push(`<span style="background:#f1c40f; color:#2c3e50; padding:1px 3px; border-radius:3px; font-size:10px; font-weight:bold;">감전</span>`);
            auraHtml += `<div class="card-aura paralysis-aura" aria-hidden="true"></div>`;
        }
        // 혼란
        if (card.isConfused) {
            statuses.push(`<span style="background:#d35400; color:white; padding:1px 3px; border-radius:3px; font-size:10px; font-weight:bold;">혼란</span>`);
            auraHtml += `<div class="card-aura confuse-aura" aria-hidden="true"></div>`;
        }
        // 화상
        if (card.isBurned) {
            statuses.push(`<span style="background:#e74c3c; color:white; padding:1px 3px; border-radius:3px; font-size:10px; font-weight:bold;">화상</span>`);
            auraHtml += `<div class="card-aura burn-aura" aria-hidden="true"></div>`;
        }
        // 중독
        if (card.isPoisoned) {
            statuses.push(`<span style="background:#8e44ad; color:white; padding:1px 3px; border-radius:3px; font-size:10px; font-weight:bold;">중독</span>`);
            auraHtml += `<div class="card-aura poison-aura" aria-hidden="true"></div>`;
        }

        if (statuses.length > 0) {
            statusBadgesHtml = `<div style="position:absolute; top:-10px; left:0; display:flex; gap:4px; z-index:15;">${statuses.join('')}</div>`;
        }

        // 기존 오라 효과 유지
        if (card.damageBonus > 0) {
            auraHtml += `<div class="card-aura damage-aura" aria-hidden="true"></div>`;
        }
        if (card.damageReduction > 0) {
            auraHtml += `<div class="card-aura reduction-aura" aria-hidden="true"></div>`;
        }
        if (card.turnHeal > 0 && !card.isSleep) { // 잠듦 상태와 겹치지 않게 우선순위 조정 가능
            auraHtml += `<div class="card-aura heal-aura" aria-hidden="true"></div>`;
        }
        if (card.redirectAttackTarget) {
            auraHtml += `<div class="card-aura redirect-aura" aria-hidden="true"></div>`;
        }
    }

    div.innerHTML = `
        ${auraHtml}
        ${statusBadgesHtml}
        <div class="card-header">
            <span>${card.name.replace(/\n/g, '<br>')}</span>
            <span style="color:#c0392b;">${headerRight}</span>
        </div>
        <div class="card-img-box">
            <img src="${card.image}" alt="${card.name}" onerror="this.style.display='none'">
        </div>
        <div class="card-skills-box">${skillsHtml} ${attachedItemsHtml}</div>
    `;

    const cardImage = div.querySelector('img');
    if (cardImage) cardImage.draggable = false;

    if (isBattleField) {
        div.addEventListener('dragover', (e) => e.preventDefault());
        div.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropItemToSpecificMonster(fIdx, e);
        });

        div.addEventListener('click', (e) => {
            e.stopPropagation();

            // 상대 카드는 renderBattleUI에서 등록한 대상 선택 이벤트만 사용합니다.
            // 스킬 타겟 선택 중 확대 모달이 열리는 것을 방지합니다.
            if (fIdx === null) return;

            if (pendingItemCardIndex !== null) {
                applyTargetItemToMonster(fIdx);
            } else {
                openCardModal(card, fIdx);
            }
        });
    }

    return div;
}

function startMatchmakingProcess() {
    if (myDeck.length === 0) {
        alert("최소 1장 이상의 덱을 구성해야 매치할 수 있습니다!");
        return;
    }
    changeScreen('coin-screen');

    const coin = document.getElementById('coin');
    const resultText = document.getElementById('coin-result-text');
    resultText.innerText = "동전을 던지는 중...";

    const rand = Math.random();
    const isHeads = rand < 0.5;
    const baseRotations = 1800;
    const targetRotation = isHeads ? baseRotations : baseRotations + 180;

    coin.style.transition = 'none';
    coin.style.transform = 'rotateY(0deg)';

    void coin.offsetWidth;

    setTimeout(() => {
        coin.style.transition = 'transform 2s cubic-bezier(0.15, 0.85, 0.35, 1)';
        coin.style.transform = `rotateY(${targetRotation}deg)`;
    }, 50);

    setTimeout(() => {
        if (isHeads) {
            resultText.innerText = "앞면! 선공으로 시작합니다!";
            isMyTurn = true;
        } else {
            resultText.innerText = "뒷면! 후공입니다 (상대 먼저)";
            isMyTurn = false;
        }

        setTimeout(() => {
            initBattle();
        }, 1200);
    }, 2000);
}

// ---------------------------------------------------------
// 합쳐진 initBattle 함수 (봇 허수아비 템플릿 설정 포함)
// ---------------------------------------------------------
function initBattle() {
    changeScreen('battle-screen');
    document.getElementById('display-player-name').innerText = playerNickname;

    battleDeck = JSON.parse(JSON.stringify(myDeck));
    shuffleArray(battleDeck);

    myHand = [];
    playerField = [];
    playerTrash = [];
    opponentTrash = [];
    hasDrawnThisTurn = false;
    consumableItemUsedThisTurn = {};
    isInitialDeploymentPhase = true;
    pendingItemCardIndex = null;

    drawInitialHand();

    // 봇 허수아비 템플릿과 사회친화력 아이템 불러오기 (합쳐진 코드)
    const dummyTemplate = cardDatabase.find(c => c.id === 'dummy_card');
    const socialItem = cardDatabase.find(c => c.id === 'item_social_power');

    // 아이템이 존재하면 깊은 복사로 객체 생성
    const socialItemObj = socialItem ? JSON.parse(JSON.stringify(socialItem)) : null;

    // 허수아비 3마리에 사회친화력(턴당 회복 10) 장착 설정
    opponentField = [
        {
            ...JSON.parse(JSON.stringify(dummyTemplate)),
            currentHp: dummyTemplate.hp,
            shieldTurns: 0,
            shieldPercent: 0,
            damageBonus: 0,
            equippedItems: socialItemObj ? [socialItemObj] : [],
            turnHeal: socialItemObj ? 10 : 0
        },
        {
            ...JSON.parse(JSON.stringify(dummyTemplate)),
            currentHp: dummyTemplate.hp,
            shieldTurns: 0,
            shieldPercent: 0,
            damageBonus: 0,
            equippedItems: socialItemObj ? [socialItemObj] : [],
            turnHeal: socialItemObj ? 10 : 0
        },
        {
            ...JSON.parse(JSON.stringify(dummyTemplate)),
            currentHp: dummyTemplate.hp,
            shieldTurns: 0,
            shieldPercent: 0,
            damageBonus: 0,
            equippedItems: socialItemObj ? [socialItemObj] : [],
            turnHeal: socialItemObj ? 10 : 0
        }
    ];

    document.getElementById('battle-action-info').innerText = "전투 시작! 손패에서 필드에 내보낼 몬스터 카드를 클릭하세요.";

    renderBattleUI();
    updateTurnIndicator();

    if (!isMyTurn) {
        setTimeout(dummyTurnAction, 1000);
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function drawInitialHand() {
    let monsterIndices = [];
    battleDeck.forEach((card, idx) => {
        if (card.type !== 'ITEM' && card.type !== 'NORMAL_ITEM' && card.type !== 'EVOLUTION') {
            monsterIndices.push(idx);
        }
    });

    if (monsterIndices.length > 0) {
        let mIdx = monsterIndices[0];
        myHand.push(battleDeck.splice(mIdx, 1)[0]);
    }

    while (myHand.length < 3 && battleDeck.length > 0) {
        let randCard = battleDeck.shift();
        myHand.push(randCard);
    }
}

function drawCardFromDeck() {
    if (isInitialDeploymentPhase) {
        document.getElementById('battle-action-info').innerText = "먼저 시작 몬스터 카드를 필드에 내놓아야 합니다!";
        return;
    }
    if (pendingItemCardIndex !== null) {
        cancelItemUsage();
    }
    if (!isMyTurn) {
        document.getElementById('battle-action-info').innerText = "상대 턴에는 덱을 뽑을 수 없습니다!";
        return;
    }
    if (hasDrawnThisTurn) {
        document.getElementById('battle-action-info').innerText = "이미 이번 턴에 카드를 뽑았습니다!";
        return;
    }
    if (battleDeck.length === 0) {
        document.getElementById('battle-action-info').innerText = "덱에 남은 카드가 없습니다!";
        return;
    }

    const drawnCard = battleDeck.shift();
    hasDrawnThisTurn = true;

    animateCardDraw(drawnCard);

    setTimeout(() => {
        myHand.push(drawnCard);
        renderBattleUI();
    }, 600);
}

function renderBattleUI() {
    const handZone = document.getElementById('battle-player-hand');
    handZone.innerHTML = '';
    myHand.forEach((card, idx) => {
        const el = createCardDOM(card, false, null);
        const handCenter = (myHand.length - 1) / 2;
        const handOffset = idx - handCenter;
        el.style.setProperty('--hand-angle', `${handOffset * 6}deg`);
        el.style.setProperty('--hand-y', `${Math.abs(handOffset) * 5}px`);
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'handIndex', index: idx }));
        });

        el.style.cursor = "pointer";
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isInitialDeploymentPhase) {
                if (card.type === 'ITEM' || card.type === 'NORMAL_ITEM' || card.type === 'EVOLUTION') {
                    document.getElementById('battle-action-info').innerText = "시작 카드로는 일반 몬스터 카드만 내보낼 수 있습니다!";
                    return;
                }
                const deployed = myHand.splice(idx, 1)[0];
                playerField.push({
                    ...deployed,
                    currentHp: deployed.hp,
                    shieldTurns: 0,
                    shieldPercent: 0,
                    equippedItems: [],
                    damageBonus: 0,
                    damageReduction: 0,
                    turnHeal: 0
                });
                isInitialDeploymentPhase = false;
                document.getElementById('battle-action-info').innerText = "필드 카드를 클릭하여 상세정보 및 스킬을 사용하세요.";
                renderBattleUI();
            } else {
                openHandCardModal(card);
            }
        });

        handZone.appendChild(el);
    });

    const playerSlots = document.getElementById('player-field-slots');
    playerSlots.innerHTML = '';
    if (playerField.length === 0) {
        playerSlots.innerHTML = `<div class="battle-slot-empty">${isInitialDeploymentPhase ? '카드를 선택해주세요' : '필드 비어있음'}</div>`;
    } else {
        playerField.forEach((card, fIdx) => {
            const el = createCardDOM(card, true, fIdx);
            if (selectedAttackerIndex === fIdx) {
                el.classList.add('selected-attacker');
            }
            playerSlots.appendChild(el);
        });
    }

    const opponentSlots = document.getElementById('opponent-field-slots');
    opponentSlots.innerHTML = '';
    opponentField.forEach((card, oIdx) => {
        const el = createCardDOM(card, true, null); // 봇 카드도 오라/배지 렌더링을 위해 true로 변경
        el.querySelector('.card-header span:nth-child(2)').innerText = `HP ${card.currentHp}`;

        if (selectedAttackerIndex !== null && isMyTurn && !isInitialDeploymentPhase) {
            el.classList.add('targetable');
            el.addEventListener('click', () => {
                // 수정된 스킬 실행 래퍼(상태이상 체크) 적용
                executeTargetSkill(selectedAttackerIndex, activeSkillIndex, oIdx);
            });
        }
        opponentSlots.appendChild(el);
    });

    updateOpponentTrashUI();
    updateDeckAndTrashUI();
}

function openHandCardModal(card) {
    let overlay = document.getElementById('card-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'card-modal-overlay';
        overlay.onclick = closeCardModal;
        document.body.appendChild(overlay);
    }

    let skillsHtml = '';
    if (card.skills) {
        card.skills.forEach((s) => {
            let desc = s.name;
            if (s.damage) desc += `(${s.damage})`;
            else if (s.heal) desc += `(회복${s.heal})`;
            else if (s.shieldPercent) desc += `(방어${s.shieldPercent}%)`;
            else if (s.attackBonus) desc += `(공격 데미지+${s.attackBonus})`;
            else if (s.damageReduction) desc += `(받는 피해-${s.damageReduction})`;
            else if (s.turnHeal) desc += `(턴당 회복+${s.turnHeal})`;

            skillsHtml += `<div style="font-size:9px; color:#555; margin-top:2px;">${desc}</div>`;
        });
    }

    let actionBtnHtml = '';
    const handIdx = myHand.findIndex(c => c === card);
    if ((card.type === 'ITEM' || card.type === 'NORMAL_ITEM') && handIdx !== -1 && !isInitialDeploymentPhase) {
        actionBtnHtml = `<button class="skill-btn" style="background:#8e44ad; color:white; margin-top:10px; width:100%;" onclick="startItemUsageFromModal(${handIdx})">이 아이템 사용하기</button>`;
    }

    let headerRight = card.hp !== undefined ? `HP ${card.hp}` : `아이템`;

    overlay.innerHTML = `
        <div class="modal-content" onclick="event.stopPropagation()">
            <h3>손패 카드 미리보기</h3>
            <div class="modal-card-large">
                <div class="card-header">
                    <span>${card.name}</span>
                    <span style="color:#c0392b;">${headerRight}</span>
                </div>
                <div class="card-img-box">
                    <img src="${card.image}" alt="${card.name}" onerror="this.style.display='none'">
                </div>
                <div class="card-skills-box">${skillsHtml}</div>
            </div>
            ${actionBtnHtml}
            <button class="back-btn" style="width:100%; margin-top:5px;" onclick="closeCardModal()">닫기</button>
        </div>
    `;
    overlay.classList.add('active');
}

function startItemUsageFromModal(handIdx) {
    closeCardModal();
    if (!isMyTurn) {
        document.getElementById('battle-action-info').innerText = "상대 턴에는 아이템을 사용할 수 없습니다!";
        return;
    }
    const itemCard = myHand[handIdx];
    const skill = itemCard.skills && itemCard.skills[0] ? itemCard.skills[0] : {};

    const consumableTypes = ['draw_monster', 'draw_random', 'redirect_attack', 'confuse_all'];
    if (consumableTypes.includes(skill.type)) {
        if (consumableItemUsedThisTurn[skill.type]) {
            document.getElementById('battle-action-info').innerText = `[${itemCard.name}] - 같은 종류의 소모형 아이템은 한 턴에 하나만 사용 가능합니다!`;
            return;
        }
    }

    if (skill.type === 'draw_monster' || skill.type === 'draw_random') {
        useDrawItemFromHand(handIdx);
        return;
    }

    if (skill.type === 'redirect_attack') {
        pendingItemCardIndex = handIdx;
        document.getElementById('battle-action-info').innerText = `[${itemCard.name}]을(를) 사용합니다. 다음 턴 상대의 공격 대상이 될 내 필드 몬스터를 클릭하세요!`;
        renderBattleUI();
        return;
    }

    if (skill.type === 'confuse_all') {
        useConfuseAllItem(handIdx);
        return;
    }

    pendingItemCardIndex = handIdx;
    document.getElementById('battle-action-info').innerText = `[${itemCard.name}]을(를) 적용할 내 필드 몬스터를 클릭하세요! (취소하려면 덱 클릭)`;
    renderBattleUI();
}

function useDrawItemFromHand(handIdx) {
    const itemCard = myHand[handIdx];
    playItemUseEffect(itemCard);
    const skill = itemCard.skills && itemCard.skills[0] ? itemCard.skills[0] : {};
    const drawnCards = [];

    if (skill.type === 'draw_monster') {
        const monsterIndex = battleDeck.findIndex(card =>
            card.type !== 'ITEM' && card.type !== 'NORMAL_ITEM' && card.type !== 'EVOLUTION'
        );
        if (monsterIndex === -1) {
            document.getElementById('battle-action-info').innerText = "덱에 뽑을 수 있는 몬스터 카드가 없습니다!";
            return;
        }
        drawnCards.push(battleDeck.splice(monsterIndex, 1)[0]);
    } else if (skill.type === 'draw_random') {
        const drawCount = Math.min(skill.count || 2, battleDeck.length);
        for (let i = 0; i < drawCount; i++) {
            const randomIndex = Math.floor(Math.random() * battleDeck.length);
            drawnCards.push(battleDeck.splice(randomIndex, 1)[0]);
        }
        if (drawnCards.length === 0) {
            document.getElementById('battle-action-info').innerText = "덱에 남은 카드가 없습니다!";
            return;
        }
    }

    myHand.splice(handIdx, 1);
    playerTrash.push(itemCard);

    consumableItemUsedThisTurn[skill.type] = true;

    drawnCards.forEach((card, idx) => {
        setTimeout(() => {
            animateCardDraw(card);
        }, idx * 200);
    });

    document.getElementById('battle-action-info').innerText = `[${itemCard.name}] 사용! ${drawnCards.length}장을 뽑았습니다.`;

    setTimeout(() => {
        myHand.push(...drawnCards);
        renderBattleUI();
    }, (drawnCards.length - 1) * 200 + 600);
}

function useConfuseAllItem(handIdx) {
    const itemCard = myHand[handIdx];
    playItemUseEffect(itemCard);
    const skill = itemCard.skills && itemCard.skills[0] ? itemCard.skills[0] : {};

    opponentField.forEach(opponent => {
        opponent.isConfused = true;
        opponent.confusedTurns = skill.duration || 1;
    });

    myHand.splice(handIdx, 1);
    playerTrash.push(itemCard);
    consumableItemUsedThisTurn[skill.type] = true;

    document.getElementById('battle-action-info').innerText = `[${itemCard.name}] 사용! 상대 모든 몹이 혼란 상태가 되었습니다!`;
    renderBattleUI();
}

function animateCardDraw(card) {
    const deckElement = document.getElementById('player-deck-pile');
    if (!deckElement) return;

    const deckRect = deckElement.getBoundingClientRect();
    const deckX = deckRect.left + deckRect.width / 2;
    const deckY = deckRect.top + deckRect.height / 2;

    const handZone = document.getElementById('battle-player-hand');
    if (!handZone) return;

    const handRect = handZone.getBoundingClientRect();
    const handCenterX = handRect.left + handRect.width / 2;
    const handCenterY = handRect.top + handRect.height / 2;

    const flyingCard = document.createElement('div');
    flyingCard.style.position = 'fixed';
    flyingCard.style.width = '105px';
    flyingCard.style.height = '145px';
    flyingCard.style.borderRadius = '6px';
    flyingCard.style.zIndex = '10005';
    flyingCard.style.pointerEvents = 'none';
    flyingCard.style.background = '#ecf0f1';
    flyingCard.style.border = '2px solid #34495e';
    flyingCard.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
    flyingCard.style.left = deckX + 'px';
    flyingCard.style.top = deckY + 'px';
    flyingCard.style.transform = 'translate(-50%, -50%)';

    const cardName = (card.name || '?').replace(/\n/g, '<br>');
    flyingCard.innerHTML = `<div style="padding: 8px; text-align: center; color: #2c3e50; font-size: 10px; font-weight: bold; line-height: 1.2;">${cardName}</div>`;

    document.body.appendChild(flyingCard);

    const moveX = handCenterX - deckX;
    const moveY = handCenterY - deckY;

    flyingCard.animate([
        {
            opacity: '0',
            transform: 'translate(-50%, -50%) scale(0.8)'
        },
        {
            opacity: '1',
            transform: `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px)) scale(1)`
        }
    ], {
        duration: 600,
        easing: 'cubic-bezier(0.25, 0.8, 0.35, 1)',
        fill: 'forwards'
    }).onfinish = () => {
        flyingCard.remove();
    };
}

function playItemUseEffect(itemCard, targetFieldIndex = null) {
    const source = document.querySelector('#battle-player-hand .card-ui');
    const target = targetFieldIndex !== null
        ? document.getElementById('player-field-slots')?.children[targetFieldIndex]
        : document.getElementById('battle-board');
    if (!target) return;

    const startRect = source?.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const effect = document.createElement('div');
    effect.className = 'item-use-effect';
    effect.innerHTML = `
        <div class="item-effect-card">
            <img src="${itemCard.image || ''}" alt="">
            <span>${(itemCard.name || '아이템').replace(/\\n/g, '<br>')}</span>
        </div>
        <div class="item-effect-ring"></div>`;

    const startX = startRect ? startRect.left + startRect.width / 2 : window.innerWidth / 2;
    const startY = startRect ? startRect.top + startRect.height / 2 : window.innerHeight * 0.75;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    effect.style.setProperty('--item-start-x', `${startX}px`);
    effect.style.setProperty('--item-start-y', `${startY}px`);
    effect.style.setProperty('--item-end-x', `${endX}px`);
    effect.style.setProperty('--item-end-y', `${endY}px`);
    document.body.appendChild(effect);
    setTimeout(() => effect.remove(), 950);
}

function applyTargetItemToMonster(fIdx) {
    if (pendingItemCardIndex === null) return;

    const itemCard = myHand[pendingItemCardIndex];
    const targetMonster = playerField[fIdx];
    const skill = itemCard.skills && itemCard.skills[0] ? itemCard.skills[0] : {};
    playItemUseEffect(itemCard, fIdx);

    if (skill.type === 'draw_monster' || skill.type === 'draw_random') {
        useDrawItemFromHand(pendingItemCardIndex);
        pendingItemCardIndex = null;
        return;
    }

    if (skill.type === 'redirect_attack') {
        targetMonster.redirectAttackTarget = true;
        targetMonster.redirectAttackDuration = skill.duration || 1;

        document.getElementById('battle-action-info').innerText = `[${itemCard.name}] 사용! [${targetMonster.name}]이(가) 다음 턴 상대의 공격 대상으로 고정됩니다.`;

        myHand.splice(pendingItemCardIndex, 1);
        playerTrash.push(itemCard);
        consumableItemUsedThisTurn[skill.type] = true;

        pendingItemCardIndex = null;
        renderBattleUI();
        return;
    }

    if (skill.type === 'confuse_all') {
        useConfuseAllItem(pendingItemCardIndex);
        pendingItemCardIndex = null;
        return;
    }

    if (!targetMonster.equippedItems) targetMonster.equippedItems = [];
    if (targetMonster.equippedItems.some(i => i.id === itemCard.id)) {
        alert("이미 동일한 아이템이 장착되어 있습니다!");
        pendingItemCardIndex = null;
        renderBattleUI();
        return;
    }

    targetMonster.equippedItems.push(itemCard);

    if (skill.type === 'heal' || skill.heal) {
        let healAmount = skill.heal || 20;
        targetMonster.currentHp = Math.min(targetMonster.hp, targetMonster.currentHp + healAmount);
        showFloatingEffect(fIdx, true, `+${healAmount}`, true);
    } else if (skill.type === 'buff' || skill.attackBonus) {
        let bonus = skill.attackBonus || 10;
        targetMonster.damageBonus = (targetMonster.damageBonus || 0) + bonus;
    } else if (skill.type === 'passive_reduction') {
        targetMonster.damageReduction = (targetMonster.damageReduction || 0) + (skill.damageReduction || 10);
    } else if (skill.type === 'passive_heal') {
        targetMonster.turnHeal = (targetMonster.turnHeal || 0) + (skill.turnHeal || 10);
        showFloatingEffect(fIdx, true, `턴당 회복 +${skill.turnHeal || 10}`, true);
    }

    document.getElementById('battle-action-info').innerText = `[${itemCard.name}] 장착! [${targetMonster.name}]에게 적용되었습니다.`;

    const requiredItemIds = ['item_acting_power', 'item_learning_power', 'item_social_power'];
    const hasAllItems = requiredItemIds.every(reqId =>
        targetMonster.equippedItems.some(item => item.id === reqId)
    );

    if (hasAllItems) {
        const awakenedTemplate = cardDatabase.find(c => c.id === 'card_003'); // 각성_전장현
        if (awakenedTemplate) {
            const currentHpRatio = targetMonster.currentHp / targetMonster.hp;

            targetMonster.id = awakenedTemplate.id;
            targetMonster.name = awakenedTemplate.name;
            targetMonster.image = awakenedTemplate.image;
            targetMonster.type = awakenedTemplate.type;
            targetMonster.hp = awakenedTemplate.hp;
            targetMonster.currentHp = Math.round(awakenedTemplate.hp * currentHpRatio);
            targetMonster.skills = JSON.parse(JSON.stringify(awakenedTemplate.skills));

            document.getElementById('battle-action-info').innerText = `✨ 아이템 3종 세트 완성! [${targetMonster.name}]이(가) 각성했습니다!`;
            showFloatingEffect(fIdx, true, "각성 완료!", true);
        }
    }

    myHand.splice(pendingItemCardIndex, 1);
    pendingItemCardIndex = null;
    renderBattleUI();
}

function dropItemToSpecificMonster(targetFIdx, e) {
    e.preventDefault();
    if (isInitialDeploymentPhase || !isMyTurn) return;

    const dataStr = e.dataTransfer.getData('text/plain');
    try {
        const data = JSON.parse(dataStr);
        if (data.type === 'handIndex') {
            const handIdx = data.index;
            const card = myHand[handIdx];

            if (card.type === 'ITEM' || card.type === 'NORMAL_ITEM') {
                const skill = card.skills && card.skills[0] ? card.skills[0] : {};

                const consumableTypes = ['draw_monster', 'draw_random', 'redirect_attack', 'confuse_all'];
                if (consumableTypes.includes(skill.type)) {
                    if (consumableItemUsedThisTurn[skill.type]) {
                        document.getElementById('battle-action-info').innerText = `[${card.name}] - 같은 종류의 소모형 아이템은 한 턴에 하나만 사용 가능합니다!`;
                        return;
                    }
                }

                if (skill.type === 'draw_monster' || skill.type === 'draw_random') {
                    useDrawItemFromHand(handIdx);
                    return;
                }

                if (skill.type === 'redirect_attack') {
                    pendingItemCardIndex = handIdx;
                    applyTargetItemToMonster(targetFIdx);
                    return;
                }

                if (skill.type === 'confuse_all') {
                    useConfuseAllItem(handIdx);
                    return;
                }

                pendingItemCardIndex = handIdx;
                applyTargetItemToMonster(targetFIdx);
            } else if (card.type === 'EVOLUTION') {
                const targetMonster = playerField[targetFIdx];

                if (targetMonster.id === card.evolvesFrom) {
                    playerField[targetFIdx] = {
                        ...card,
                        currentHp: card.hp,
                        shieldTurns: targetMonster.shieldTurns,
                        shieldPercent: targetMonster.shieldPercent,
                        equippedItems: targetMonster.equippedItems || [],
                        damageBonus: targetMonster.damageBonus || 0,
                        damageReduction: targetMonster.damageReduction || 0,
                        turnHeal: targetMonster.turnHeal || 0
                    };

                    myHand.splice(handIdx, 1);
                    document.getElementById('battle-action-info').innerText = `✨ [${targetMonster.name}]이(가) [${card.name}](으)로 진화했습니다!`;
                    showFloatingEffect(targetFIdx, true, "진화 완료!", true);
                    renderBattleUI();
                } else {
                    document.getElementById('battle-action-info').innerText = "이 카드는 지정된 대상 몬스터 위에만 진화시킬 수 있습니다!";
                }
            }
        }
    } catch (err) {
        console.error("드롭 처리 오류", err);
    }
}

function cancelItemUsage() {
    pendingItemCardIndex = null;
    document.getElementById('battle-action-info').innerText = "필드 카드를 클릭하여 상세정보 및 스킬을 사용하세요.";
    renderBattleUI();
}

function updateDeckAndTrashUI() {
    const dropzone = document.getElementById('player-field-dropzone');
    let pileContainer = document.getElementById('player-pile-container');
    if (!pileContainer) {
        pileContainer = document.createElement('div');
        pileContainer.id = 'player-pile-container';
        dropzone.appendChild(pileContainer);
    }

    let existingPile = document.getElementById('player-deck-pile');
    if (!existingPile) {
        const pile = document.createElement('div');
        pile.id = 'player-deck-pile';
        pile.classList.add('deck-pile');
        pile.onclick = () => {
            if (pendingItemCardIndex !== null) cancelItemUsage();
            else drawCardFromDeck();
        };

        pileContainer.appendChild(pile);
        existingPile = pile;
    }

    let existingTrash = document.getElementById('player-trash-pile');
    if (!existingTrash) {
        const trash = document.createElement('div');
        trash.id = 'player-trash-pile';
        trash.classList.add('deck-pile', 'trash-pile');
        trash.onclick = () => openTrashModal(playerTrash, '플레이어 트레쉬 (무덤)');
        pileContainer.appendChild(trash);
        existingTrash = trash;
    }
    existingTrash.innerHTML = `트레쉬<br>(${playerTrash.length}장)<br><span style="font-size:9px; color:#bdc3c7;">클릭하여 보기</span>`;

    if (pendingItemCardIndex !== null) {
        existingPile.classList.remove('disabled');
        existingPile.innerHTML = `취소하기<br><span style="font-size:9px; color:#e74c3c;">클릭하여 취소</span>`;
    } else if (isInitialDeploymentPhase) {
        existingPile.classList.add('disabled');
        existingPile.innerHTML = `내 덱<br>(${battleDeck.length}장)<br><span style="font-size:9px; color:#e74c3c;">시작 카드 선택 중</span>`;
    } else if (hasDrawnThisTurn) {
        existingPile.classList.add('disabled');
        existingPile.innerHTML = `내 덱<br>(${battleDeck.length}장)<br><span style="font-size:9px; color:#f39c12;">드로우 완료</span>`;
    } else {
        existingPile.classList.remove('disabled');
        existingPile.innerHTML = `내 덱<br>(${battleDeck.length}장)<br><span style="font-size:9px; color:#f1c40f;">클릭 드로우</span>`;
    }
}

function updateOpponentTrashUI() {
    const fieldZone = document.getElementById('opponent-field-zone');
    let existingTrash = document.getElementById('opponent-trash-pile');
    if (!existingTrash) {
        const trash = document.createElement('div');
        trash.id = 'opponent-trash-pile';
        trash.classList.add('deck-pile', 'trash-pile');
        trash.onclick = () => openTrashModal(opponentTrash, '상대 트레쉬 (무덤)');
        fieldZone.appendChild(trash);
        existingTrash = trash;
    }
    existingTrash.innerHTML = `상대 트레쉬<br>(${opponentTrash.length}장)<br><span style="font-size:9px; color:#bdc3c7;">클릭하여 보기</span>`;
}

function openTrashModal(trashCards = playerTrash, title = '플레이어 트레쉬 (무덤)') {
    let overlay = document.getElementById('card-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'card-modal-overlay';
        overlay.onclick = closeCardModal;
        document.body.appendChild(overlay);
    }

    let trashContentHtml = '';
    if (trashCards.length === 0) {
        trashContentHtml = `<div style="text-align:center; color:#888; padding:20px;">트레쉬 칸이 비어있습니다.</div>`;
    } else {
        trashContentHtml = `<div class="equipped-items-grid" style="margin: 15px 0;">`;
        trashCards.forEach((card) => {
            const cardEl = createCardDOM(card, false, null);
            cardEl.classList.add('attached-item-card');
            trashContentHtml += cardEl.outerHTML;
        });
        trashContentHtml += `</div>`;
    }

    overlay.innerHTML = `
        <div class="modal-content" onclick="event.stopPropagation()">
            <h3>${title}</h3>
            ${trashContentHtml}
            <button class="back-btn" style="width:100%; margin-top:10px;" onclick="closeCardModal()">닫기</button>
        </div>
    `;
    overlay.classList.add('active');
}

function allowDrop(e) { e.preventDefault(); }

function dropToField(e) {
    e.preventDefault();
    if (!isMyTurn) {
        document.getElementById('battle-action-info').innerText = "상대 턴에는 카드를 낼 수 없습니다!";
        return;
    }

    const dataStr = e.dataTransfer.getData('text/plain');
    try {
        const data = JSON.parse(dataStr);
        if (data.type === 'handIndex') {
            const handIdx = data.index;
            const card = myHand[handIdx];

            if (isInitialDeploymentPhase && (card.type === 'ITEM' || card.type === 'NORMAL_ITEM' || card.type === 'EVOLUTION')) {
                document.getElementById('battle-action-info').innerText = "시작 배치는 몬스터 카드만 드래그할 수 있습니다!";
                return;
            }

            if (card.type === 'ITEM' || card.type === 'NORMAL_ITEM') {
                if (playerField.length === 0) {
                    document.getElementById('battle-action-info').innerText = "아이템을 장착할 필드 몬스터가 없습니다!";
                    return;
                }
                pendingItemCardIndex = handIdx;
                applyTargetItemToMonster(0);
                return;
            } else if (card.type === 'EVOLUTION') {
                document.getElementById('battle-action-info').innerText = "진화 카드는 대상 몬스터 카드 위에 직접 드래그해야 합니다!";
                return;
            }

            myHand.splice(handIdx, 1);
            playerField.push({
                ...card,
                currentHp: card.hp,
                shieldTurns: 0,
                shieldPercent: 0,
                equippedItems: [],
                damageBonus: 0,
                damageReduction: 0,
                turnHeal: 0
            });
            if (isInitialDeploymentPhase) {
                isInitialDeploymentPhase = false;
                document.getElementById('battle-action-info').innerText = "필드 카드를 클릭하여 상세정보 및 스킬을 사용하세요.";
            }
            renderBattleUI();
        }
    } catch (err) {
        if (dataStr !== "") {
            const card = myHand.splice(dataStr, 1)[0];
            if (card.type === 'ITEM' || card.type === 'NORMAL_ITEM' || card.type === 'EVOLUTION') return;
            playerField.push({
                ...card,
                currentHp: card.hp,
                shieldTurns: 0,
                shieldPercent: 0,
                equippedItems: [],
                damageBonus: 0,
                damageReduction: 0,
                turnHeal: 0
            });
            if (isInitialDeploymentPhase) {
                isInitialDeploymentPhase = false;
                document.getElementById('battle-action-info').innerText = "필드 카드를 클릭하여 상세정보 및 스킬을 사용하세요.";
            }
            renderBattleUI();
        }
    }
}

function openCardModal(card, fIdx) {
    if (isInitialDeploymentPhase || pendingItemCardIndex !== null) return;
    let overlay = document.getElementById('card-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'card-modal-overlay';
        overlay.onclick = closeCardModal;
        document.body.appendChild(overlay);
    }

    let skillsHtml = '';
    if (card.skills) {
        card.skills.forEach((s, sIdx) => {
            let desc = s.name;
            if (s.damage) desc += `(${s.damage})`;
            else if (s.heal) desc += `(회복${s.heal})`;
            else if (s.shieldPercent) desc += `(방어${s.shieldPercent}%)`;

            skillsHtml += `<button class="skill-btn" onclick="useSkillFromModal(${fIdx}, ${sIdx})">${desc}</button>`;
        });
    }

    let equippedItemsHtml = '';
    if (card.equippedItems && card.equippedItems.length > 0) {
        const itemCardsHtml = card.equippedItems.map(item => {
            const cardEl = createCardDOM(item, false, null);
            cardEl.classList.add('attached-item-card');
            return cardEl.outerHTML;
        }).join('');

        equippedItemsHtml = `
            <div class="equipped-items-panel">
                <div class="equipped-items-title">부착된 아이템</div>
                <div class="equipped-items-grid">${itemCardsHtml}</div>
            </div>
        `;
    } else {
        equippedItemsHtml = `
            <div style="margin-top:10px; padding:6px; background:#f9f9f9; border-radius:5px; border:1px solid #ddd; text-align:center;">
                <div style="font-size:10px; color:#888;">부착된 아이템 없음</div>
            </div>
        `;
    }

    overlay.innerHTML = `
        <div class="modal-content" onclick="event.stopPropagation()">
            <h3>필드 카드 상세 정보</h3>
            <div class="modal-card-large">
                <div class="card-header">
                    <span>${card.name}</span>
                    <span style="color:#c0392b;">HP ${card.currentHp} / ${card.hp}</span>
                </div>
                <div class="card-img-box">
                    <img src="${card.image}" alt="${card.name}" onerror="this.style.display='none'">
                </div>
                <div class="card-skills-box">${skillsHtml}</div>
            </div>
            ${equippedItemsHtml}
            <button class="back-btn" style="width:100%; margin-top:10px;" onclick="closeCardModal()">닫기</button>
        </div>
    `;
    overlay.classList.add('active');
}

function closeCardModal() {
    const overlay = document.getElementById('card-modal-overlay');
    if (overlay) overlay.classList.remove('active');
}

// ---------------------------------------------------------
// 상태이상 애니메이션 함수 및 모달 세팅 (합쳐진 코드)
// ---------------------------------------------------------
function ensureCoinTossModal() {
    if (!document.getElementById('coin-toss-modal')) {
        const modalHtml = `
            <div id="coin-toss-modal">
                <div class="coin-container">
                    <div class="coin" id="toss-coin">
                        <div class="coin-face coin-front">앞(성공)</div>
                        <div class="coin-face coin-back">뒤(실패)</div>
                    </div>
                </div>
                <div class="toss-message" id="toss-message">동전을 던집니다!</div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
}

function showStatusCoinTossAnimation(statusName, successCallback, failCallback) {
    ensureCoinTossModal();

    const modal = document.getElementById('coin-toss-modal');
    const coin = document.getElementById('toss-coin');
    const message = document.getElementById('toss-message');

    modal.classList.add('active');
    coin.className = 'coin'; 
    message.innerText = `[${statusName}] 상태! 동전을 던집니다...`;

    const isHeads = Math.random() < 0.5;

    setTimeout(() => {
        if (isHeads) {
            coin.classList.add('toss-heads');
        } else {
            coin.classList.add('toss-tails');
        }

        setTimeout(() => {
            if (isHeads) {
                message.innerText = "앞면! 행동에 성공했습니다.";
                message.style.color = "#2ecc71";
            } else {
                message.innerText = "뒷면! 행동에 실패했습니다.";
                message.style.color = "#e74c3c";
            }

            setTimeout(() => {
                modal.classList.remove('active');
                message.style.color = "white"; 

                if (isHeads) {
                    successCallback();
                } else {
                    failCallback();
                }
            }, 1500);

        }, 2000);

    }, 100);
}

// 행동 전 상태이상 검사 래퍼 함수 (합쳐진 코드)
function tryAction(attackerCard, actionCallback, failedTurnCallback = finishActionAndEndTurn) {
    if (attackerCard.isSleep) {
        showStatusCoinTossAnimation('잠듦 깨기',
            () => {
                attackerCard.isSleep = false;
                delete attackerCard.sleepTurns;
                document.getElementById('battle-action-info').innerText = `[${attackerCard.name}]이(가) 잠에서 깨어났습니다!`;
                actionCallback();
            },
            () => {
                // 뒷면이면 잠듦은 무기한 유지됩니다.
                document.getElementById('battle-action-info').innerText = `[${attackerCard.name}]은(는) 계속 자고 있습니다. 행동할 수 없습니다!`;
                failedTurnCallback();
            }
        );
        return;
    }

    if (attackerCard.isConfused) {
        showStatusCoinTossAnimation('혼란 극복',
            () => {
                // 혼란은 앞면일 때만 해제됩니다.
                attackerCard.isConfused = false;
                delete attackerCard.confusedTurns;
                document.getElementById('battle-action-info').innerText = `[${attackerCard.name}]이(가) 혼란을 이겨냈습니다!`;
                actionCallback();
            },
            () => {
                // 자해해도 혼란은 유지됩니다.
                const damage = Math.floor(attackerCard.hp * 0.2);
                attackerCard.currentHp = Math.max(0, attackerCard.currentHp - damage);
                document.getElementById('battle-action-info').innerText = `[${attackerCard.name}]이(가) 혼란으로 자신을 공격했습니다! (-${damage} HP, 혼란 유지)`;

                const pIdx = playerField.indexOf(attackerCard);
                const oIdx = opponentField.indexOf(attackerCard);
                if (pIdx !== -1) {
                    showDamageFloatingEffect(pIdx, true, damage, 0, null, true);
                } else if (oIdx !== -1) {
                    showDamageFloatingEffect(oIdx, false, damage, 0, null, false);
                }

                checkFieldDeaths();
                renderBattleUI();
                failedTurnCallback();
            }
        );
        return;
    }

    actionCallback();
}
// ---------------------------------------------------------
// 스킬 실행 함수 수정 (tryAction 적용)
// ---------------------------------------------------------
function useSkillFromModal(fIdx, sIdx) {
    if (!isMyTurn) {
        document.getElementById('battle-action-info').innerText = "내 턴이 아닙니다!";
        return;
    }

    const attacker = playerField[fIdx];
    closeCardModal();

    // 자기 자신에게 쓰는 스킬(힐, 방어)인지 타겟팅 스킬(공격, 상태이상)인지 구분
    const skill = attacker.skills[sIdx];
    const isSelfTargetSkill = skill.type === 'heal' || skill.type === 'shield';

    if (isSelfTargetSkill) {
        tryAction(attacker, () => {
            if (skill.type === 'heal') {
                let healVal = skill.heal || 10;
                attacker.currentHp = Math.min(attacker.hp, attacker.currentHp + healVal);

                showFloatingEffect(fIdx, true, `+${healVal}`, true);
                document.getElementById('battle-action-info').innerText = `[${attacker.name}] 체력 회복 +${healVal}`;
                finishActionAndEndTurn();
            } else if (skill.type === 'shield') {
                attacker.shieldTurns = skill.duration || 2;
                attacker.shieldPercent = skill.shieldPercent || 30;
                document.getElementById('battle-action-info').innerText = `[${attacker.name}] 방어태세 발동 (${attacker.shieldPercent}% 감소)`;
                finishActionAndEndTurn();
            }
        });
    } else {
        // 타겟팅 스킬의 경우, 타겟을 클릭할 때 tryAction을 수행하도록 설정
        selectedAttackerIndex = fIdx;
        activeSkillIndex = sIdx;
        document.getElementById('battle-action-info').innerText = `[${skill.name}]의 타겟(상대 몬스터)을 클릭하세요!`;
        renderBattleUI();
    }
}

function executeTargetSkill(pIdx, sIdx, targetOIdx) {
    const attacker = playerField[pIdx];
    
    // 공격 시도 전 상태이상 체크 (tryAction 래퍼 사용)
    tryAction(attacker, () => {
        executeTargetSkillLogic(pIdx, sIdx, targetOIdx);
    });
}

function executeTargetSkillLogic(pIdx, sIdx, targetOIdx) {
    const attacker = playerField[pIdx];
    if (!attacker || !attacker.skills || !attacker.skills[sIdx]) {
        resetActionState();
        renderBattleUI();
        return;
    }

    const skill = attacker.skills[sIdx];
    const bonusDmg = attacker.damageBonus || 0;
    const damageEffects = [];
    const deathEffects = [];

    if (skill.type === 'status') {
        const target = opponentField[targetOIdx];
        if (!target) {
            document.getElementById('battle-action-info').innerText = '선택한 대상이 존재하지 않습니다.';
            resetActionState();
            renderBattleUI();
            return;
        }

        let actualDamage = 0;
        if (typeof skill.damage === 'number' && skill.damage > 0) {
            actualDamage = calculateDamage(skill.damage + bonusDmg, target, attacker);
            target.currentHp = Math.max(0, target.currentHp - actualDamage);
            damageEffects.push({ target, targetIndex: targetOIdx, damage: actualDamage });
        }

        // 즉시 피해로 쓰러지지 않은 대상에게 상태이상을 부여합니다.
        if (target.currentHp > 0 && skill.statusType) {
            applyStatusEffect(target, skill.statusType, skill.duration);
        }

        const statusNames = {
            sleep: '잠듦',
            paralysis: '감전',
            confusion: '혼란',
            burn: '화상',
            poison: '중독'
        };
        const statusName = statusNames[skill.statusType] || skill.statusType || '상태이상';

        if (actualDamage > 0 && target.currentHp > 0) {
            document.getElementById('battle-action-info').innerText = `[${attacker.name}]의 [${skill.name}]! [${target.name}]에게 ${actualDamage} 피해와 [${statusName}] 부여!`;
        } else if (actualDamage > 0) {
            document.getElementById('battle-action-info').innerText = `[${attacker.name}]의 [${skill.name}]! [${target.name}]에게 ${actualDamage} 피해를 주어 쓰러뜨렸습니다!`;
        } else {
            document.getElementById('battle-action-info').innerText = `[${target.name}]에게 [${statusName}] 상태를 부여했습니다!`;
        }
    } else if (skill.type === 'multi') {
        const baseDmg = typeof skill.damage === 'number' ? skill.damage : 20;
        const totalDmg = baseDmg + bonusDmg;

        opponentField.forEach((target, oIdx) => {
            const actualDamage = calculateDamage(totalDmg, target, attacker);
            target.currentHp = Math.max(0, target.currentHp - actualDamage);
            damageEffects.push({ target, targetIndex: oIdx, damage: actualDamage });

            if (actualDamage > 0 && target.isSleep) {
                target.isSleep = false;
                delete target.sleepTurns;
            }
            if (actualDamage > 0 && target.currentHp > 0 && skill.statusType) {
                applyStatusEffect(target, skill.statusType, skill.duration);
            }
        });

        document.getElementById('battle-action-info').innerText = `광역기 [${skill.name}] 발동!`;
    } else {
        const target = opponentField[targetOIdx];
        if (!target) {
            document.getElementById('battle-action-info').innerText = '선택한 대상이 존재하지 않습니다.';
            resetActionState();
            renderBattleUI();
            return;
        }

        const baseDmg = typeof skill.damage === 'number' ? skill.damage : 10;
        const totalDmg = calculateDamage(baseDmg + bonusDmg, target, attacker);
        target.currentHp = Math.max(0, target.currentHp - totalDmg);
        damageEffects.push({ target, targetIndex: targetOIdx, damage: totalDmg });

        if (totalDmg > 0 && target.isSleep) {
            target.isSleep = false;
            delete target.sleepTurns;
        }
        if (totalDmg > 0 && target.currentHp > 0 && skill.statusType) {
            applyStatusEffect(target, skill.statusType, skill.duration);
        }

        document.getElementById('battle-action-info').innerText = `[${target.name}]에게 ${totalDmg} 데미지 부여!`;
    }

    damageEffects.forEach(effect => {
        if (effect.target.currentHp <= 0) {
            const targetSlot = document.getElementById('opponent-field-slots')?.children[effect.targetIndex];
            if (targetSlot) {
                deathEffects.push({
                    sourceRect: targetSlot.getBoundingClientRect(),
                    damage: effect.damage,
                    isPlayerField: false
                });
            }
        }
    });

    checkFieldDeaths();
    renderBattleUI();
    playDeathEffects(deathEffects);

    damageEffects.forEach(effect => {
        const currentIndex = opponentField.indexOf(effect.target);
        if (currentIndex !== -1) {
            showDamageFloatingEffect(currentIndex, false, effect.damage, bonusDmg, pIdx, true);
        }
    });

    setTimeout(finishActionAndEndTurn, 1000);
}

function calculateDamage(baseDmg, target, attacker) {
    let actualDamage = baseDmg;

    if (target.shieldTurns > 0) {
        actualDamage = Math.floor(actualDamage * (1 - target.shieldPercent / 100));
    }

    if (target.isParalyzed && attacker) {
        const skill = attacker.skills && attacker.skills[0] ? attacker.skills[0] : {};
        if (skill.name && (skill.name.includes('물') || skill.name.includes('전기') ||
            skill.name.includes('볼트') || skill.name.includes('쇼크'))) {
            actualDamage = Math.floor(actualDamage * 1.5);
        }
    }

    return Math.max(0, actualDamage);
}

function applyStatusEffect(target, statusType, duration) {
    if (statusType === 'sleep') {
        // 잠듦은 지속시간 없이 앞면이 나올 때까지 유지됩니다.
        target.isSleep = true;
        delete target.sleepTurns;
    } else if (statusType === 'paralysis') {
        target.isParalyzed = true;
        target.paralyzedTurns = duration || 1;
    } else if (statusType === 'confusion') {
        target.isConfused = true;
        delete target.confusedTurns;
    } else if (statusType === 'burn') {
        target.isBurned = true;
    } else if (statusType === 'poison') {
        target.isPoisoned = true;
    }
}

function checkFieldDeaths() {
    playerField = playerField.filter(monster => {
        if (monster.currentHp <= 0) {
            playerTrash.push(monster);
            if (monster.equippedItems && monster.equippedItems.length > 0) {
                playerTrash.push(...monster.equippedItems);
            }
            return false;
        }
        return true;
    });

    opponentField = opponentField.filter(monster => {
        if (monster.currentHp <= 0) {
            opponentTrash.push(monster);
            if (monster.equippedItems && monster.equippedItems.length > 0) {
                opponentTrash.push(...monster.equippedItems);
            }
            return false;
        }
        return true;
    });
}

function showDamageFloatingEffect(targetIndex, isPlayerField, totalDmg, bonusDmg, attackerIndex = null, attackerIsPlayer = !isPlayerField) {
    const containerId = isPlayerField ? 'player-field-slots' : 'opponent-field-slots';
    const container = document.getElementById(containerId);
    if (!container || !container.children[targetIndex]) return;

    const targetSlot = container.children[targetIndex];
    const rect = targetSlot.getBoundingClientRect();

    if (attackerIndex !== null) {
        showAttackEffect(attackerIndex, attackerIsPlayer, targetSlot);
    }
    targetSlot.classList.add('card-hit');
    setTimeout(() => targetSlot.classList.remove('card-hit'), 480);
    showImpactEffect(targetSlot);

    const effectEl = document.createElement('div');
    effectEl.style.position = 'fixed';
    effectEl.style.left = `${rect.left + rect.width / 2}px`;
    effectEl.style.top = `${rect.top + rect.height / 3}px`;
    effectEl.style.transform = 'translate(-50%, -50%)';
    effectEl.style.zIndex = '9999';
    effectEl.style.fontWeight = 'bold';
    effectEl.style.fontSize = '18px';
    effectEl.style.pointerEvents = 'none';
    effectEl.style.transition = 'all 0.8s ease-out';

    let htmlText = `<span style="color: #e74c3c; text-shadow: 1px 1px 2px black;">-${totalDmg}</span>`;
    if (bonusDmg > 0) {
        htmlText += ` <span style="color: #3498db; text-shadow: 1px 1px 2px black;">(+${bonusDmg})</span>`;
    }
    effectEl.innerHTML = htmlText;

    document.body.appendChild(effectEl);

    requestAnimationFrame(() => {
        effectEl.style.transform = 'translate(-50%, -80px) scale(1.2)';
        effectEl.style.opacity = '0';
    });

    setTimeout(() => {
        effectEl.remove();
    }, 800);
}

function showAttackEffect(attackerIndex, attackerIsPlayer, targetSlot) {
    const attackerContainerId = attackerIsPlayer ? 'player-field-slots' : 'opponent-field-slots';
    const attackerContainer = document.getElementById(attackerContainerId);
    const attackerSlot = attackerContainer && attackerContainer.children[attackerIndex];
    if (!attackerSlot) return;

    const attackerRect = attackerSlot.getBoundingClientRect();
    const targetRect = targetSlot.getBoundingClientRect();
    const projectile = document.createElement('div');
    projectile.className = 'attack-effect';
    projectile.style.left = `${attackerRect.left + attackerRect.width / 2}px`;
    projectile.style.top = `${attackerRect.top + attackerRect.height / 2}px`;
    projectile.style.setProperty('--attack-x', `${targetRect.left - attackerRect.left}px`);
    projectile.style.setProperty('--attack-y', `${targetRect.top - attackerRect.top}px`);
    document.body.appendChild(projectile);
    setTimeout(() => projectile.remove(), 420);
}

function showImpactEffect(targetSlot) {
    const impact = document.createElement('div');
    impact.className = 'impact-effect';
    targetSlot.appendChild(impact);
    setTimeout(() => impact.remove(), 420);
}

function playDeathEffects(deathEffects) {
    deathEffects.forEach(death => {
        const trashId = death.isPlayerField ? 'player-trash-pile' : 'opponent-trash-pile';
        const trashPile = document.getElementById(trashId);
        if (!trashPile) return;

        const sourceRect = death.sourceRect;
        const trashRect = trashPile.getBoundingClientRect();
        const clone = document.createElement('div');
        clone.className = 'card-death-flight';
        clone.style.left = `${sourceRect.left}px`;
        clone.style.top = `${sourceRect.top}px`;
        clone.style.width = `${sourceRect.width}px`;
        clone.style.height = `${sourceRect.height}px`;
        clone.style.setProperty('--trash-x', `${trashRect.left + trashRect.width / 2 - (sourceRect.left + sourceRect.width / 2)}px`);
        clone.style.setProperty('--trash-y', `${trashRect.top + trashRect.height / 2 - (sourceRect.top + sourceRect.height / 2)}px`);
        clone.innerHTML = '<span class="death-card-mark">KO</span>';
        document.body.appendChild(clone);

        const damageEl = document.createElement('div');
        damageEl.className = 'death-damage';
        damageEl.innerText = `-${death.damage}`;
        damageEl.style.left = `${sourceRect.left + sourceRect.width / 2}px`;
        damageEl.style.top = `${sourceRect.top + sourceRect.height / 3}px`;
        document.body.appendChild(damageEl);

        const burst = document.createElement('div');
        burst.className = 'death-burst';
        burst.style.left = `${sourceRect.left + sourceRect.width / 2}px`;
        burst.style.top = `${sourceRect.top + sourceRect.height / 2}px`;
        document.body.appendChild(burst);

        setTimeout(() => burst.remove(), 520);
        setTimeout(() => damageEl.remove(), 720);
        setTimeout(() => clone.remove(), 720);
    });
}

function showFloatingEffect(targetIndex, isPlayerField, text, isHeal = false) {
    const containerId = isPlayerField ? 'player-field-slots' : 'opponent-field-slots';
    const container = document.getElementById(containerId);
    if (!container || !container.children[targetIndex]) return;

    const targetSlot = container.children[targetIndex];
    const rect = targetSlot.getBoundingClientRect();

    const effectEl = document.createElement('div');
    effectEl.style.position = 'fixed';
    effectEl.style.left = `${rect.left + rect.width / 2}px`;
    effectEl.style.top = `${rect.top + rect.height / 3}px`;
    effectEl.style.transform = 'translate(-50%, -50%)';
    effectEl.style.zIndex = '9999';
    effectEl.style.fontWeight = 'bold';
    effectEl.style.fontSize = '18px';
    effectEl.style.pointerEvents = 'none';
    effectEl.style.transition = 'all 0.8s ease-out';

    const color = isHeal ? '#2ecc71' : '#e74c3c';
    effectEl.innerHTML = `<span style="color: ${color}; text-shadow: 1px 1px 2px black;">${text}</span>`;

    document.body.appendChild(effectEl);

    requestAnimationFrame(() => {
        effectEl.style.transform = 'translate(-50%, -80px) scale(1.2)';
        effectEl.style.opacity = '0';
    });

    setTimeout(() => {
        effectEl.remove();
    }, 800);
}

function finishActionAndEndTurn() {
    resetActionState();
    endMyTurn();
}

function resetActionState() {
    selectedAttackerIndex = null;
    activeSkillIndex = null;
}

function processStatusRecoveryQueue(queue, index, doneCallback) {
    if (index >= queue.length) {
        checkFieldDeaths();
        renderBattleUI();
        if (typeof doneCallback === 'function') doneCallback();
        return;
    }

    const effect = queue[index];
    const monster = effect.monster;
    const field = effect.isPlayerField ? playerField : opponentField;

    // 앞선 상태 피해로 쓰러졌거나 필드에서 사라진 몬스터는 건너뜁니다.
    if (!field.includes(monster) || monster.currentHp <= 0) {
        processStatusRecoveryQueue(queue, index + 1, doneCallback);
        return;
    }

    // 피해를 먼저 적용합니다.
    monster.currentHp = Math.max(0, monster.currentHp - effect.damage);
    const monsterIndex = field.indexOf(monster);
    renderBattleUI();

    if (monsterIndex !== -1) {
        showDamageFloatingEffect(monsterIndex, effect.isPlayerField, effect.damage, 0, null, !effect.isPlayerField);
    }

    document.getElementById('battle-action-info').innerText = `[${monster.name}]이(가) [${effect.statusName}]으로 ${effect.damage} 피해를 받았습니다.`;

    // 상태 피해로 쓰러지면 회복 동전은 던지지 않습니다.
    if (monster.currentHp <= 0) {
        checkFieldDeaths();
        renderBattleUI();
        setTimeout(() => processStatusRecoveryQueue(queue, index + 1, doneCallback), 700);
        return;
    }

    // 화상과 중독은 피해를 받은 직후 각각 독립적으로 해제 동전을 던집니다.
    setTimeout(() => {
        showStatusCoinTossAnimation(
            `${monster.name} ${effect.statusName} 해제`,
            () => {
                if (effect.statusType === 'burn') monster.isBurned = false;
                if (effect.statusType === 'poison') monster.isPoisoned = false;
                document.getElementById('battle-action-info').innerText = `[${monster.name}]의 [${effect.statusName}] 상태가 해제되었습니다!`;
                renderBattleUI();
                setTimeout(() => processStatusRecoveryQueue(queue, index + 1, doneCallback), 300);
            },
            () => {
                document.getElementById('battle-action-info').innerText = `[${monster.name}]의 [${effect.statusName}] 상태가 유지됩니다.`;
                renderBattleUI();
                setTimeout(() => processStatusRecoveryQueue(queue, index + 1, doneCallback), 300);
            }
        );
    }, 600);
}

function processEndTurnStatusEffects(endingSide, doneCallback) {
    const queue = [];

    // 화상: 상태에 걸린 몬스터 소유자의 턴 종료에만 20 피해
    const ownerField = endingSide === 'player' ? playerField : opponentField;
    const ownerIsPlayer = endingSide === 'player';
    ownerField.forEach(monster => {
        if (monster.currentHp > 0 && monster.isBurned) {
            queue.push({ monster, statusType: 'burn', statusName: '화상', damage: 20, isPlayerField: ownerIsPlayer });
        }
    });

    // 중독: 내 턴과 상대 턴 모두, 양쪽 필드에서 매 턴 종료마다 10 피해
    playerField.forEach(monster => {
        if (monster.currentHp > 0 && monster.isPoisoned) {
            queue.push({ monster, statusType: 'poison', statusName: '중독', damage: 10, isPlayerField: true });
        }
    });
    opponentField.forEach(monster => {
        if (monster.currentHp > 0 && monster.isPoisoned) {
            queue.push({ monster, statusType: 'poison', statusName: '중독', damage: 10, isPlayerField: false });
        }
    });

    processStatusRecoveryQueue(queue, 0, doneCallback);
}

function endMyTurn() {
    const passiveHealEffects = [];
    playerField.forEach(p => {
        if (p.shieldTurns > 0) p.shieldTurns--;
        if (p.turnHeal && p.currentHp > 0 && !p.isSleep) {
            const previousHp = p.currentHp;
            p.currentHp = Math.min(p.hp, p.currentHp + p.turnHeal);
            if (p.currentHp > previousHp) passiveHealEffects.push({ monster: p, amount: p.currentHp - previousHp });
        }
        if (p.redirectAttackTarget && p.redirectAttackDuration > 0) {
            p.redirectAttackDuration--;
            if (p.redirectAttackDuration <= 0) p.redirectAttackTarget = false;
        }
        if (p.isParalyzed && p.paralyzedTurns > 0) {
            p.paralyzedTurns--;
            if (p.paralyzedTurns <= 0) p.isParalyzed = false;
        }
    });

    passiveHealEffects.forEach(effect => {
        const currentIndex = playerField.indexOf(effect.monster);
        if (currentIndex !== -1) showFloatingEffect(currentIndex, true, `+${effect.amount}`, true);
    });

    // 상태 피해 및 모든 해제 동전이 끝난 뒤에 상대 턴을 시작합니다.
    processEndTurnStatusEffects('player', () => {
        isMyTurn = false;
        hasDrawnThisTurn = false;
        resetActionState();
        updateTurnIndicator();
        renderBattleUI();
        setTimeout(dummyTurnAction, 1000);
    });
}

// 상대 필드의 잠든 모든 카드를 순서대로 독립 판정합니다.
function processOpponentSleepChecks(cards, index, doneCallback) {
    if (index >= cards.length) {
        doneCallback();
        return;
    }

    const monster = cards[index];
    if (!opponentField.includes(monster) || monster.currentHp <= 0 || !monster.isSleep) {
        processOpponentSleepChecks(cards, index + 1, doneCallback);
        return;
    }

    showStatusCoinTossAnimation(
        `${monster.name} 잠듦 깨기`,
        () => {
            monster.isSleep = false;
            delete monster.sleepTurns;
            document.getElementById('battle-action-info').innerText = `[${monster.name}]이(가) 잠에서 깨어났습니다!`;
            renderBattleUI();
            setTimeout(() => processOpponentSleepChecks(cards, index + 1, doneCallback), 250);
        },
        () => {
            document.getElementById('battle-action-info').innerText = `[${monster.name}]은(는) 계속 자고 있습니다.`;
            renderBattleUI();
            setTimeout(() => processOpponentSleepChecks(cards, index + 1, doneCallback), 250);
        }
    );
}

function dummyTurnAction() {
    opponentField.forEach(o => {
        if (o.shieldTurns > 0) o.shieldTurns--;
        if (o.isParalyzed && o.paralyzedTurns > 0) {
            o.paralyzedTurns--;
            if (o.paralyzedTurns <= 0) o.isParalyzed = false;
        }
        if (o.turnHeal && o.currentHp > 0 && !o.isSleep) {
            const previousHp = o.currentHp;
            o.currentHp = Math.min(o.hp, o.currentHp + o.turnHeal);
            if (o.currentHp > previousHp) {
                const oIdx = opponentField.indexOf(o);
                showFloatingEffect(oIdx, false, `+${o.currentHp - previousHp}`, true);
            }
        }
    });

    renderBattleUI();

    if (playerField.length === 0 || opponentField.length === 0) {
        endBotTurn();
        return;
    }

    // 잠든 카드가 3장이면 각 카드마다 동전을 한 번씩 총 3번 던집니다.
    processOpponentSleepChecks([...opponentField], 0, () => {
        const activeBots = opponentField.filter(bot => bot.currentHp > 0 && !bot.isSleep);
        if (activeBots.length === 0) {
            document.getElementById('battle-action-info').innerText = '상대의 모든 몬스터가 잠들어 행동할 수 없습니다.';
            setTimeout(endBotTurn, 500);
            return;
        }

        const randomBot = activeBots[Math.floor(Math.random() * activeBots.length)];
        const baseBotDmg = randomBot.skills?.[0]?.damage ?? 1;
        const botBonus = randomBot.damageBonus || 0;
        let totalBotDmg = baseBotDmg + botBonus;
        const redirectTargets = playerField.map((m, idx) => m.redirectAttackTarget ? idx : -1).filter(idx => idx !== -1);
        const targetPlayerIdx = redirectTargets.length > 0 ? redirectTargets[0] : Math.floor(Math.random() * playerField.length);
        const targetMonster = playerField[targetPlayerIdx];
        const deathEffects = [];

        // 잠듦은 위에서 이미 카드별 판정했으며, 여기서는 혼란 등을 판정합니다.
        tryAction(randomBot, () => {
            if (targetMonster.damageReduction) totalBotDmg = Math.max(0, totalBotDmg - targetMonster.damageReduction);
            if (targetMonster.shieldTurns > 0) totalBotDmg = Math.floor(totalBotDmg * (1 - targetMonster.shieldPercent / 100));

            targetMonster.currentHp = Math.max(0, targetMonster.currentHp - totalBotDmg);
            document.getElementById('battle-action-info').innerText = `상대 [${randomBot.name}]의 공격! [${targetMonster.name}]이(가) ${totalBotDmg} 데미지를 입었습니다.`;

            if (targetMonster.currentHp <= 0) {
                const targetSlot = document.getElementById('player-field-slots')?.children[targetPlayerIdx];
                if (targetSlot) deathEffects.push({ sourceRect: targetSlot.getBoundingClientRect(), damage: totalBotDmg, isPlayerField: true });
            }

            checkFieldDeaths();
            renderBattleUI();
            playDeathEffects(deathEffects);
            const currentTargetIndex = playerField.indexOf(targetMonster);
            const currentAttackerIndex = opponentField.indexOf(randomBot);
            if (currentTargetIndex !== -1 && currentAttackerIndex !== -1) {
                showDamageFloatingEffect(currentTargetIndex, true, totalBotDmg, botBonus, currentAttackerIndex, false);
            }
            setTimeout(endBotTurn, 1000);
        }, () => {
            renderBattleUI();
            setTimeout(endBotTurn, 500);
        });
    });
}

function endBotTurn() {
    // 상대 턴 종료 상태 피해 및 해제 동전이 모두 끝난 뒤 내 턴으로 전환합니다.
    processEndTurnStatusEffects('opponent', () => {
        isMyTurn = true;
        hasDrawnThisTurn = false;
        consumableItemUsedThisTurn = {};
        updateTurnIndicator();
        renderBattleUI();
    });
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    if (isMyTurn) {
        indicator.innerText = "내 턴 (행동 가능)";
        indicator.style.color = "#f1c40f";
    } else {
        indicator.innerText = "상대 턴 대기 중...";
        indicator.style.color = "#e74c3c";
    }
}

loadCards();