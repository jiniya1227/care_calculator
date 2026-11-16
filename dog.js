/* 강아지 '보리'의 말풍선 (index.html)
   app.js가 보내는 신호(ltc:update, ltc:view)를 듣고, 상황에 맞는 말을 해요. 계산에는 손대지 않아요. */
(function () {
  'use strict';
  var won = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원'; };
  var last = {};
  var updates = 0;

  var CALC_MSG = [
    '등급과 요일, 이용 시간을 골라 주세요. 식비·간식비는 센터마다 달라요.',
    '한 번에 몇 시간 오시는지 골라 주세요. 한도 안에서 가장 긴 시간을 먼저 골라 뒀어요.',
    '방과 식비를 골라 주세요. 요양원은 하루 비용으로 계산해요.'
  ];
  var ME_MSG = '지금 고른 조건이에요. 바꾸고 싶으면 아래 버튼을 눌러 주세요.';

  function say(key, text, tilt) {
    var el = document.querySelector('[data-dog="' + key + '"]');
    if (!el || last[key] === text) return;
    last[key] = text;
    el.textContent = text;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (tilt) {
      var d = el.parentNode.querySelector('.dog');
      if (d) { d.classList.remove('tilt'); void d.offsetWidth; d.classList.add('tilt'); }
    }
  }

  function onUpdate(R, mode) {
    updates++;
    say('calc', CALC_MSG[mode] || CALC_MSG[0]);
    say('me', ME_MSG);
    if (updates === 1) return;                       // 처음에는 인사말을 그대로 둬요
    if (R.unavailable) say('home', R.unavailable + '. 다른 등급이나 장소를 골라 주세요.', true);
    else if (R.excess > 0) say('home', '앗, 월 한도를 넘었어요. 넘은 ' + won(R.excess) + '은 전액 본인 부담이에요.', true);
    else if (mode < 2 && R.G && R.L && R.G / R.L >= 0.95) say('home', '한도가 거의 다 찼어요. 조금 더 쓰면 넘을 수 있어요.', true);
    else say('home', '이번 달 예상은 ' + won(R.total) + '이에요. 조건을 바꾸면 바로 다시 계산해 드려요.');
  }

  document.addEventListener('ltc:update', function (e) { onUpdate(e.detail.R, e.detail.mode); });
  document.addEventListener('ltc:view', function (e) {
    var d = document.querySelector('#view-' + e.detail.view + ' .dog');
    if (d) { d.classList.remove('tilt'); void d.offsetWidth; d.classList.add('tilt'); }
  });
  document.addEventListener('animationend', function (e) {
    if (e.target.classList && e.target.classList.contains('tilt')) e.target.classList.remove('tilt');
  });

  // app.js가 먼저 한 번 계산을 마쳤으니, 지금 상태로 안내 문구를 맞춰 둬요.
  if (window.LTC) {
    var S = window.LTC.state;
    onUpdate(window.LTC.calc(S, S.mode), S.mode);
    updates = 0;
  }
})();
