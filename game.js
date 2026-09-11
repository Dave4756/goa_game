const GAME_STATE = {
  SETUP: 'SETUP',
  COIN_TOSS: 'COIN_TOSS',
  PLAYING: 'PLAYING'
};

class CardGame {
  constructor() {
    this.state = GAME_STATE.SETUP;
    this.turnCount = 1;
    this.currentTurn = null;
    
    this.inmyeonCard = {
      name: '인면어',
      placedTurn: 0
    };
  }

  startCoinToss() {
    this.state = GAME_STATE.COIN_TOSS;
    
    const modal = document.getElementById('coin-modal');
    const coin = document.getElementById('coin');
    modal.classList.remove('hidden');
    
    const isP1First = Math.random() < 0.5 ? 0 : 1;
    const rotations = 1800 + (isP1First === 0 ? 0 : 180);
    coin.style.transform = `rotateY(${rotations}deg)`;

    setTimeout(() => {
      modal.classList.add('hidden');
      coin.style.transform = 'rotateY(0deg)';
      
      this.currentTurn = isP1First === 0 ? 1 : 2;
      this.state = GAME_STATE.PLAYING;
      
      this.inmyeonCard.placedTurn = this.turnCount;
      showTurnBanner(`PLAYER ${this.currentTurn} 선공!`);
    }, 3200);
  }

  nextTurn() {
    this.turnCount += 1;
    this.currentTurn = this.currentTurn === 1 ? 2 : 1;
    showTurnBanner(`PLAYER ${this.currentTurn} TURN`);
  }
}

const game = new CardGame();

function showTurnBanner(text) {
  const banner = document.getElementById('turn-banner');
  const bannerText = document.getElementById('turn-text');
  
  bannerText.innerText = text;
  banner.classList.remove('hidden');
  
  requestAnimationFrame(() => banner.classList.add('show'));

  setTimeout(() => {
    banner.classList.remove('show');
    setTimeout(() => banner.classList.add('hidden'), 400);
  }, 1500);
}

document.getElementById('btn-setup').addEventListener('click', () => {
  if (game.state === GAME_STATE.SETUP) {
    game.startCoinToss();
  }
});

const gyaradosCard = document.getElementById('card-gyarados');
gyaradosCard.addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('cardName', '갸라도스');
});

const inmyeonCardElement = document.getElementById('card-inmyeon');
inmyeonCardElement.addEventListener('dragover', (e) => {
  e.preventDefault();
});

inmyeonCardElement.addEventListener('drop', (e) => {
  e.preventDefault();
  
  if (game.state !== GAME_STATE.PLAYING) {
    alert('게임 진행 중에만 진화할 수 있습니다.');
    return;
  }

  const draggedCardName = e.dataTransfer.getData('cardName');
  
  if (draggedCardName === '갸라도스') {
    if (game.inmyeonCard.placedTurn === game.turnCount) {
      showTurnBanner("배치한 턴에는 진화 불가!");
      return;
    }
    
    inmyeonCardElement.innerText = '갸라도스';
    inmyeonCardElement.classList.remove('base-card');
    inmyeonCardElement.classList.add('evo-card');
    gyaradosCard.remove();
    
    showTurnBanner("갸라도스로 진화!");
  }
});