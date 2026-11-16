/* 부모님 장기요양 본인부담 계산기 — 계산과 동작 (강아지 버전 index.html이 씀)
   수가·한도액·부담률은 아래 DATA 블록 한 곳에만 있어요. 매년 1월 이 숫자만 바꾸세요. */
(function () {
'use strict';

/* ==CALC-START== ★ 계산 부분 (화면과 상관없는 순수 계산) ★ */

/* ★★ 매년 1월 새 고시가 나오면 아래 DATA 숫자만 바꾸세요 ★★ */
var DATA = {
  year: 2026,
  weeksPerMonth: 4.35,
  // 주야간보호 한 달 이용일수: 이 요일 조합은 아래 일수로 고정해요(wk=평일, sat=토요일). 월~금 22일, 월~토 25일.
  // 그 밖의 요일 조합은 일주일 횟수 × 4.35를 반올림해요.
  // 주야간보호를 월 15일 이상(1일 8시간 이상) 이용하면 월 한도액을 아래 비율(%) 범위에서 추가 산정 (고시 제13조).
  // 1·2등급 10%, 3~5등급 20% (판본마다 달라 확인 필요). 인지지원등급은 규정을 확인하지 못해 0(적용 안 함).
  limitBoost: { minDays: 15, minBand: 2, pct: { '1': 10, '2': 10, '3': 20, '4': 20, '5': 20, 'c': 0 } },
  dayMonth: { '12345': { wk: 22, sat: 0 }, '123456': { wk: 22, sat: 3 } },                 // 한 달 횟수 = 일주일 횟수 × 4.35 → 반올림
  // 등급별 재가급여 월 한도액 · 주야간보호 1일 급여비용(3~6 / 6~8 / 8~10 시간)
  grades: [
    { key: '1', name: '1등급',        limit: 2512900, fac: '1', day: [41820, 56060, 69730] },
    { key: '2', name: '2등급',        limit: 2331200, fac: '2', day: [38720, 51930, 64590] },
    { key: '3', name: '3등급',        limit: 1528200, fac: '3', day: [35740, 47940, 59640] },
    { key: '4', name: '4등급',        limit: 1409700, fac: '3', day: [34120, 46300, 58010] },
    { key: '5', name: '5등급',        limit: 1208900, fac: '3', day: [32490, 44650, 56360] },
    { key: 'c', name: '인지지원등급', limit: 676320,  fac: null, day: [32490, 44650, 56360] }
  ],
  bands: ['3~6시간', '6~8시간', '8~10시간'],
  // 방문요양 1회 급여비용 (분 → 원). 2시간 30분(150분)·3시간(180분)은 모든 등급, 3시간 30분(210분)·4시간(240분)은 1·2등급만 선택할 수 있어요.
  visit: { 150: 50640, 180: 57020, 210: 63530, 240: 70080 },
  visitLongFrom: 210, visitLongGrades: ['1', '2'],
  // 시설급여 1일 비용 (3은 3~5등급)
  facility: {
    home:  { '1': 93070, '2': 86340, '3': 81540 },
    group: { '1': 74590, '2': 69210, '3': 63800 }
  },
  // 본인부담률(%) — home: 재가(주야간보호·방문요양), fac: 시설(요양원)
  rates: {
    general: { label: '일반',          home: 15, fac: 20 },
    r40:     { label: '감경 40%',      home: 9,  fac: 12 },
    r60:     { label: '감경 60%',      home: 6,  fac: 8 },
    free:    { label: '의료급여 면제', home: 0,  fac: 0 }
  },
  surcharge: { dayHoliday: 30, visitSun: 30, visitHoliday: 50 },   // 가산율(%)
  defaults: { meal: 3500, snack: 1500 }
};

var DAYNAMES = '월화수목금토일';
var MODE_NAMES = ['주야간보호', '방문요양', '요양원'];
var ROOM_NAMES = { multi: '다인실', double: '2인실', single: '1인실' };

function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function won(n) { return fmt(n) + '원'; }
function num(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.floor(v) : 0; }
function monthCount(n) { return Math.round(n * DATA.weeksPerMonth); }
function gradeOf(k) { for (var i = 0; i < DATA.grades.length; i++) if (DATA.grades[i].key === String(k)) return DATA.grades[i]; return DATA.grades[3]; }
function rateOf(k) { return DATA.rates[k] || DATA.rates.general; }
function labelDays(days) { return days.slice().sort(function (a, b) { return a - b; }).map(function (d) { return DAYNAMES[d - 1]; }).join(''); }
function weekDays(n) { var a = []; for (var i = 1; i <= n && i <= 7; i++) a.push(i); return a; }   // 주 N회 = 월요일부터 N일 (주 6회는 토요일, 주 7회는 일요일 포함)
function weekLabel(v) { return '주 ' + (v.perWeek || v.days.length) + '회'; }
function minLabel(m) { return m < 60 ? m + '분' : Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : ''); }
function surUnit(unit, pct) { return Math.floor(unit * (100 + pct) / 100); }
function copy(o) { return JSON.parse(JSON.stringify(o)); }

function defaultState() {
  return {
    mode: 0, grade: '4', reduce: 'general',
    day: {
      days: [1, 2, 3, 4, 5, 6], band: 2, satBand: 'same', meal: 'both',
      mealPrice: DATA.defaults.meal, snack: DATA.defaults.snack, hol: 0,
      boost: true, withVisit: false,
      visit: { days: [1, 2, 3, 4, 5], perWeek: 5, minutes: 180, hol: 0, auto: false, billing: { on: false, wk: 0, sun: 0, hol: 0 } },
      billing: { on: false, wk: 22, sat: 0, sun: 0 }
    },
    visit: { days: [1, 2, 3, 4, 5], perWeek: 5, minutes: 180, auto: true, hol: 0, billing: { on: false, wk: 22, sun: 0, hol: 0 } },
    fac: { type: 'home', room: 'multi', roomExtra: 0, meal: DATA.defaults.meal, snack: DATA.defaults.snack, beauty: 0, days: 30 }
  };
}

/* ---- 방문요양 횟수·금액 ---- */
function visitAllowed(gKey, m) { return m < DATA.visitLongFrom || DATA.visitLongGrades.indexOf(String(gKey)) >= 0; }
function visitCounts(v) {
  if (v.billing.on) return { wk: num(v.billing.wk), sat: 0, sun: num(v.billing.sun), hol: num(v.billing.hol) };
  var nWk = v.days.filter(function (x) { return x <= 5; }).length;
  var wk = nWk ? monthCount(nWk) : 0;
  var sat = v.days.indexOf(6) >= 0 ? monthCount(1) : 0;
  var sun = v.days.indexOf(7) >= 0 ? monthCount(1) : 0;
  var hol = Math.min(num(v.hol), wk);
  return { wk: wk - hol, sat: sat, sun: sun, hol: hol };
}
function visitCalc(gKey, v) {
  var unit = DATA.visit[visitAllowed(gKey, v.minutes) ? v.minutes : 180] || 0;   // 3~5등급은 210분 이상 불가
  var c = visitCounts(v);
  var sunU = surUnit(unit, DATA.surcharge.visitSun);
  var holU = surUnit(unit, DATA.surcharge.visitHoliday);
  var G = (c.wk + c.sat) * unit + c.sun * sunU + c.hol * holU;
  return { unit: unit, sunU: sunU, holU: holU, wk: c.wk, sat: c.sat, sun: c.sun, hol: c.hol, G: G, count: c.wk + c.sat + c.sun + c.hol };
}
function visitMaxMinutes(S) {
  var L = gradeOf(S.grade).limit;
  var list = Object.keys(DATA.visit).map(Number).filter(function (m) { return visitAllowed(S.grade, m); }).sort(function (a, b) { return b - a; });
  for (var i = 0; i < list.length; i++) {
    var v = copy(S.visit); v.minutes = list[i];
    if (visitCalc(S.grade, v).G <= L) return list[i];
  }
  return list[list.length - 1];
}
function autoVisit(S) { S.visit.minutes = visitMaxMinutes(S); S.visit.auto = true; }

/* ---- 주야간보호 날수 ---- */
function dayCounts(d) {
  if (d.billing.on) return { wk: num(d.billing.wk), sat: num(d.billing.sat), hol: num(d.billing.sun) };
  var nWk = d.days.filter(function (x) { return x <= 5; }).length;
  var wk = nWk ? monthCount(nWk) : 0;
  var sat = d.days.indexOf(6) >= 0 ? monthCount(1) : 0;
  var hol = d.days.indexOf(7) >= 0 ? monthCount(1) : 0;
  var fixed = DATA.dayMonth[d.days.slice().sort(function (a, b) { return a - b; }).join('')];
  if (fixed) { wk = fixed.wk; sat = fixed.sat; hol = 0; }      // 월~금 22일, 월~토 25일
  var hw = Math.min(num(d.hol), wk);
  return { wk: wk - hw, sat: sat, hol: hol + hw };
}

/* ---- 재가 공통 마무리 (한도·본인부담) ---- */
function finishHome(G, L, ratePct) {
  var covered = Math.min(G, L);
  var burden = Math.floor(covered * ratePct / 1000) * 10;      // 10원 미만 버림
  var excess = Math.max(0, G - L);
  return { burden: burden, excess: excess };
}

function calcDay(S) {
  var g = gradeOf(S.grade), d = S.day, rate = rateOf(S.reduce);
  var wkU = g.day[d.band];
  var satIdx = d.satBand === 'same' ? d.band : Number(d.satBand);
  var satU = g.day[satIdx];
  var holU = surUnit(wkU, DATA.surcharge.dayHoliday);
  var c = dayCounts(d);
  var G = c.wk * wkU + c.sat * satU + c.hol * holU;
  var rows = [];
  if (c.wk) rows.push({ label: '평일 ' + c.wk + '일', sub: DATA.bands[d.band] + ' × ' + won(wkU), amt: c.wk * wkU });
  if (c.sat) rows.push({ label: '토요일 ' + c.sat + '일', sub: DATA.bands[satIdx] + ' × ' + won(satU), amt: c.sat * satU });
  if (c.hol) rows.push({ label: '일요일·공휴일 ' + c.hol + '일', sub: '30% 가산 ' + won(holU) + ' × ' + c.hol + '일', amt: c.hol * holU });
  var dayOnlyG = G;                                   // 주야간보호만의 급여비용 (방문요양 합산 전)
  var vis = null;
  if (d.withVisit && g.key !== 'c') {
    var vv = copy(d.visit); vv.billing.on = d.billing.on; vv.hol = 0;
    vis = visitCalc(S.grade, vv);
    G += vis.G;
    rows.push({ label: '주야간보호 소계', cls: 'subt', amt: dayOnlyG });
    rows.push({ label: '+ 방문요양 ' + vis.count + '회', sub: minLabel(vv.minutes) + ' (일요일·공휴일 가산 포함)', amt: vis.G });
  }
  var days = c.wk + c.sat + c.hol;
  // 월 15일 이상(하루 8시간 이상) 이용하면 한도액 증액
  var minBand = DATA.limitBoost.minBand;
  var longDays = (d.band >= minBand ? c.wk + c.hol : 0) + (satIdx >= minBand ? c.sat : 0);
  var boostPct = DATA.limitBoost.pct[g.key] || 0;
  var boost = (d.boost !== false && boostPct && longDays >= DATA.limitBoost.minDays) ? Math.floor(g.limit * boostPct / 100) : 0;
  var Leff = g.limit + boost;
  var fin = finishHome(G, Leff, rate.home);
  var mealN = d.meal === 'both' ? 2 : 1;
  var mealCost = num(d.mealPrice) * mealN * days;
  var snackCost = num(d.snack) * days;
  var nonCov = mealCost + snackCost;
  rows.push({ k: 'sum', label: '급여비용 합계', amt: G });
  rows.push({ label: '월 한도액 (' + g.name + ')', amt: g.limit });
  if (boost) rows.push({ label: '한도액 증액 (' + boostPct + '% 범위)', sub: '월 15일 이상 · 하루 8시간 이상 이용', amt: boost });
  rows.push({ label: '급여 본인부담 (' + rate.home + '%)', sub: '한도 안 금액 × ' + rate.home + '%, 10원 미만 버림', amt: fin.burden, cls: fin.burden ? '' : 'zero' });
  rows.push({ label: '한도 초과분', sub: '한도를 넘은 부분은 전액 본인', amt: fin.excess, cls: fin.excess ? 'over' : 'zero' });
  rows.push({ k: 'head', label: '공단 지원이 없는 항목', sub: '센터마다 달라요 · 센터에 확인해서 직접 넣어 주세요' });
  rows.push({ label: d.meal === 'both' ? '점심·저녁 ' + won(num(d.mealPrice)) + ' × 2끼 × ' + days + '일' : '점심 ' + won(num(d.mealPrice)) + ' × ' + days + '일', amt: mealCost, cls: mealCost ? '' : 'zero' });
  rows.push({ label: '간식비 ' + won(num(d.snack)) + ' × ' + days + '일', amt: snackCost, cls: snackCost ? '' : 'zero' });
  var total = fin.burden + fin.excess + nonCov;
  rows.push({ k: 'total', label: '이번 달 내실 금액', amt: total });
  var desc = '주야간보호센터 ' + (d.days.length ? labelDays(d.days) : '(요일 선택 전)') + ' ' + DATA.bands[d.band];
  if (d.days.indexOf(6) >= 0 && d.satBand !== 'same') desc += ' (토요일 ' + DATA.bands[satIdx] + ')';
  desc += ' (한 달 ' + (d.billing.on ? '' : '약 ') + days + '일)';
  if (vis) desc += ' + 방문요양 ' + weekLabel(d.visit) + ' ' + minLabel(d.visit.minutes) + ' (한 달 ' + vis.count + '회)';
  desc += ', 식사 ' + (d.meal === 'both' ? '점심과 저녁' : '점심만') + ', 간식';
  return {
    mode: 0, G: G, L: Leff, boost: boost, boostPct: boostPct, dayG: dayOnlyG, vis: vis, rate: rate, burden: fin.burden, excess: fin.excess, nonCov: nonCov, other: 0,
    total: total, rows: rows, desc: desc, days: days, empty: days === 0,
    short: (d.days.length ? labelDays(d.days) : '요일 선택 전') + ' ' + DATA.bands[d.band] + ', 한 달 ' + days + '일',
    parts: '(급여 본인부담 ' + won(fin.burden) + ' + 한도 초과분 ' + won(fin.excess) + ' + 식비·간식비 ' + won(nonCov) + ')'
  };
}

function calcVisit(S) {
  var g = gradeOf(S.grade), v = S.visit, rate = rateOf(S.reduce);
  if (g.key === 'c') return { mode: 1, unavailable: '인지지원등급은 이용할 수 없어요' };
  var vc = visitCalc(S.grade, v);
  var G = vc.G;
  var rows = [];
  var wkSat = vc.wk + vc.sat;
  if (wkSat) rows.push({ label: (v.billing.on || vc.sat ? '월~토 ' : '평일 ') + wkSat + '회', sub: minLabel(v.minutes) + ' × ' + won(vc.unit), amt: wkSat * vc.unit });
  if (vc.sun) rows.push({ label: '일요일 ' + vc.sun + '회', sub: '30% 가산 ' + won(vc.sunU) + ' × ' + vc.sun + '회', amt: vc.sun * vc.sunU });
  if (vc.hol) rows.push({ label: '공휴일 ' + vc.hol + '회', sub: '50% 가산 ' + won(vc.holU) + ' × ' + vc.hol + '회', amt: vc.hol * vc.holU });
  var fin = finishHome(G, g.limit, rate.home);
  rows.push({ k: 'sum', label: '급여비용 합계', amt: G });
  rows.push({ label: '월 한도액 (' + g.name + ')', amt: g.limit });
  rows.push({ label: '급여 본인부담 (' + rate.home + '%)', sub: '한도 안 금액 × ' + rate.home + '%, 10원 미만 버림', amt: fin.burden, cls: fin.burden ? '' : 'zero' });
  rows.push({ label: '한도 초과분', sub: '한도를 넘은 부분은 전액 본인', amt: fin.excess, cls: fin.excess ? 'over' : 'zero' });
  var total = fin.burden + fin.excess;
  rows.push({ k: 'total', label: '이번 달 내실 금액', amt: total });
  return {
    mode: 1, G: G, L: g.limit, rate: rate, burden: fin.burden, excess: fin.excess, nonCov: 0, other: 0,
    total: total, rows: rows, days: vc.count, empty: vc.count === 0,
    desc: '방문요양 ' + weekLabel(v) + ' 한 번에 ' + minLabel(v.minutes) + ' (한 달 ' + (v.billing.on ? '' : '약 ') + vc.count + '회)',
    short: weekLabel(v) + ' ' + minLabel(v.minutes) + ', 한 달 ' + vc.count + '회',
    parts: '(급여 본인부담 ' + won(fin.burden) + ' + 한도 초과분 ' + won(fin.excess) + ')'
  };
}

function calcFac(S) {
  var g = gradeOf(S.grade), f = S.fac, rate = rateOf(S.reduce);
  if (!g.fac) return { mode: 2, unavailable: '인지지원등급은 입소할 수 없어요' };
  var days = Math.max(28, Math.min(31, num(f.days)));
  var daily = DATA.facility[f.type][g.fac];
  var base = daily * days;
  var burden = Math.floor(base * rate.fac / 1000) * 10;
  var mealCost = num(f.meal) * 3 * days;
  var snackCost = num(f.snack) * days;
  var roomCost = f.room === 'multi' ? 0 : num(f.roomExtra) * days;
  var beauty = num(f.beauty);
  var nonCov = mealCost + snackCost;
  var other = roomCost + beauty;
  var typeName = f.type === 'home' ? '요양원' : '노인요양공동생활가정';
  var rows = [
    { label: '급여비용 ' + won(daily) + ' × ' + days + '일', sub: typeName + ' · ' + g.name, amt: base },
    { label: '급여 본인부담 (' + rate.fac + '%)', sub: '급여비용 × ' + rate.fac + '%, 10원 미만 버림', amt: burden, cls: burden ? '' : 'zero' },
    { k: 'head', label: '공단 지원이 없는 항목', sub: '시설마다 달라요 · 시설에 확인해서 직접 넣어 주세요' },
    { label: '식재료비 ' + won(num(f.meal)) + ' × 3끼 × ' + days + '일', amt: mealCost },
    { label: '간식비 ' + won(num(f.snack)) + ' × ' + days + '일', amt: snackCost, cls: snackCost ? '' : 'zero' }
  ];
  if (roomCost) rows.push({ label: ROOM_NAMES[f.room] + ' 추가 ' + won(num(f.roomExtra)) + ' × ' + days + '일', amt: roomCost });
  if (beauty) rows.push({ label: '이·미용비 (한 달)', amt: beauty });
  var total = burden + nonCov + other;
  rows.push({ k: 'total', label: '이번 달 내실 금액', amt: total });
  return {
    mode: 2, G: base, L: 0, rate: rate, burden: burden, excess: 0, nonCov: nonCov, other: other,
    total: total, rows: rows, days: days, empty: false,
    desc: typeName + ' ' + ROOM_NAMES[f.room] + ' ' + days + '일',
    short: ROOM_NAMES[f.room] + ', ' + days + '일',
    parts: '(급여 본인부담 ' + won(burden) + ' + 식비·간식비 ' + won(nonCov) + (other ? ' + 방 추가·이미용비 ' + won(other) : '') + ')'
  };
}

function calc(S, mode) { return mode === 0 ? calcDay(S) : mode === 1 ? calcVisit(S) : calcFac(S); }

/* ---------- 2027년 의결 수가 미리보기 (고시 공포 전) ----------
   2026년 10월 장기요양위원회에서 의결된 2027년 수가예요. 보건복지부 고시가 나오기 전이라 달라질 수 있어요.
   자료가 있는 조건(주야간보호 8~10시간, 방문요양 3시간·4시간, 요양원)만 비교하고, 그 밖의 조건은 비교하지 않아요. */
function makeData2027() {
  var d = copy(DATA);
  var lim = { '1': 2891400, '2': 2682300, '3': 1586300, '4': 1462000, '5': 1254900, 'c': 700200 };
  var day8 = { '1': 72190, '2': 66870, '3': 61750, '4': 60060, '5': 58350, 'c': 58350 };
  d.grades.forEach(function (g) { g.limit = lim[g.key]; g.day[2] = day8[g.key]; });
  d.visit[180] = 59190; d.visit[240] = 72740;
  d.facility.home = { '1': 96380, '2': 89410, '3': 84440 };
  return d;
}
function supports2027(S, mode) {
  if (mode === 0) {
    var d = S.day;
    return d.band === 2 && (d.satBand === 'same' || Number(d.satBand) === 2) && (!d.withVisit || [180, 240].indexOf(d.visit.minutes) >= 0);
  }
  if (mode === 1) return [180, 240].indexOf(S.visit.minutes) >= 0;
  return S.fac.type === 'home';
}
function calc2027(S, mode) {
  if (!supports2027(S, mode)) return null;
  var saved = DATA, R;
  DATA = makeData2027();
  try { R = calc(S, mode); } finally { DATA = saved; }
  return R.unavailable ? null : R;
}

/* ==CALC-END== */

/* =========================================================
   화면 부분
   ========================================================= */
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function getP(o, p) { return p.split('.').reduce(function (a, k) { return a[k]; }, o); }
function setP(o, p, v) { var ks = p.split('.'), last = ks.pop(); ks.reduce(function (a, k) { return a[k]; }, o)[last] = v; }

/* ★ 마케팅지니 블로그 주소가 정해지면 아래 따옴표 안에 넣으세요. 비어 있으면 [블로그 글 보러 가기] 버튼이 안 보여요. */
var BLOG_URL = '';

var state = defaultState();
autoVisit(state);
var V = {};
var els = {};
var lockScroll = false, scrollTimer = 0, toastTimer = 0;

/* ---------- 목록(라디오) 만들기 ---------- */
function buildRadios(el, name, items) {
  el.innerHTML = items.map(function (it) {
    return '<label class="chk row"><input type="radio" name="' + name + '" value="' + it.v + '" data-path="' + name + '">' +
      '<span class="bx"></span><span class="lbl">' + it.label + '<span class="tag" hidden>한도 안 최대</span></span><span class="px"></span></label>';
  }).join('');
}
function buildLists() {
  buildRadios($('#bandList'), 'day.band', DATA.bands.map(function (b, i) { return { v: i, label: b }; }));
  buildRadios($('#satList'), 'day.satBand', [{ v: 'same', label: '평일과 같게' }, { v: 0, label: DATA.bands[0] }, { v: 1, label: DATA.bands[1] }, { v: 2, label: DATA.bands[2] }]);
  var mins = Object.keys(DATA.visit).map(Number).sort(function (a, b) { return a - b; });
  buildRadios($('#minList'), 'visit.minutes', mins.map(function (m) { return { v: m, label: minLabel(m) + ' (' + m + '분)' }; }));
  $('#dvMin').innerHTML = mins.map(function (m) { return '<option value="' + m + '">' + minLabel(m) + ' (' + m + '분)</option>'; }).join('');
}

/* ---------- 입력 → 상태 ---------- */
function cast(el) {
  var v = el.value;
  if (el.dataset.t === 's') return v;
  return /^\d+$/.test(v) ? Number(v) : v;
}
function applySet(path, val) {
  var prevGrade = state.grade;
  setP(state, path, val);
  if (path === 'visit.perWeek') state.visit.days = weekDays(val);
  if (path === 'day.visit.perWeek') state.day.visit.days = weekDays(val);
  if (path === 'grade') {
    autoVisit(state);
  } else if (path === 'visit.days' || path === 'visit.perWeek' || path === 'visit.hol' || path === 'visit.billing.wk' || path === 'visit.billing.sun' || path === 'visit.billing.hol') {
    if (state.visit.auto) autoVisit(state);
  } else if (path === 'visit.minutes') {
    state.visit.auto = false;
  } else if (path === 'day.billing.on' && val) {
    var c = dayCounts({ billing: { on: false }, days: state.day.days, hol: state.day.hol });
    state.day.billing.wk = c.wk; state.day.billing.sat = c.sat; state.day.billing.sun = c.hol;
    var vc = visitCounts({ billing: { on: false }, days: state.day.visit.days, hol: 0 });
    state.day.visit.billing.wk = vc.wk + vc.sat; state.day.visit.billing.sun = vc.sun; state.day.visit.billing.hol = vc.hol;
  } else if (path === 'visit.billing.on' && val) {
    var vc2 = visitCounts({ billing: { on: false }, days: state.visit.days, hol: state.visit.hol });
    state.visit.billing.wk = vc2.wk + vc2.sat; state.visit.billing.sun = vc2.sun; state.visit.billing.hol = vc2.hol;
    if (state.visit.auto) autoVisit(state);
  }
  if (path === 'visit.billing.on' && !val && state.visit.auto) autoVisit(state);
  if (!visitAllowed(state.grade, state.day.visit.minutes)) state.day.visit.minutes = 180;
  if (!visitAllowed(state.grade, state.visit.minutes)) autoVisit(state);
  update();
}

function bindInputs() {
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.matches || !el.matches('[data-path]') || el.classList.contains('num')) return;
    if (el.type === 'radio') { if (el.checked) applySet(el.dataset.path, cast(el)); }
    else if (el.type === 'checkbox') applySet(el.dataset.path, el.checked);
    else if (el.tagName === 'SELECT') applySet(el.dataset.path, cast(el));
  });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.matches || !el.matches('input.num')) return;
    var raw = el.value.replace(/\D/g, '').slice(0, 9);
    var v = raw === '' ? 0 : Number(raw);
    var mx = el.dataset.max ? Number(el.dataset.max) : Infinity;
    if (v > mx) { v = mx; raw = String(v); }
    el.value = raw;
    applySet(el.dataset.path, v);
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el.matches && el.matches('input.num')) {
      if (el.value === '0') el.value = '';
      setTimeout(function () { try { el.select(); } catch (x) {} }, 0);
    }
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (!el.matches || !el.matches('input.num')) return;
    var v = num(el.value.replace(/\D/g, ''));
    var mn = el.dataset.min ? Number(el.dataset.min) : 0;
    var mx = el.dataset.max ? Number(el.dataset.max) : Infinity;
    v = Math.max(mn, Math.min(mx, v));
    el.value = el.hasAttribute('data-money') ? fmt(v) : String(v);
    applySet(el.dataset.path, v);
  });
  // 달력 칸 요일
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.cal button') : null;
    if (b) {
      var path = b.parentNode.dataset.days, d = Number(b.dataset.d);
      var cur = getP(state, path).slice();
      var i = cur.indexOf(d);
      if (i >= 0) cur.splice(i, 1); else cur.push(d);
      cur.sort(function (a, b2) { return a - b2; });
      applySet(path, cur);
      return;
    }
    var p = e.target.closest ? e.target.closest('[data-preset]') : null;
    if (p) {
      var parts = p.dataset.preset.split(':');
      applySet(parts[0], parts[1].split(',').map(Number));
      return;
    }
    var cr = e.target.closest ? e.target.closest('.cmp-row') : null;
    if (cr) { setMode(Number(cr.dataset.mode), { scrollPage: true, jump: true }); }
  });
}

/* ---------- 탭·캐러셀 ---------- */
function setMode(i, opt) {
  opt = opt || {};
  if (i >= 1 && state.grade === 'c') {
    state.grade = i === 1 ? '4' : '3';
    autoVisit(state);
    toast('인지지원등급은 ' + MODE_NAMES[i] + '을 이용할 수 없어서 ' + gradeOf(state.grade).name + '으로 바꿨어요.');
  }
  var changed = state.mode !== i;
  state.mode = i;
  if (opt.scrollPage !== false && opt.scrollPage !== undefined) scrollToPage(i);
  if (opt.scrollPage === true) scrollToPage(i);
  if (changed) redrawCircle();
  update({ anim: changed });
  if (opt.jump) { var pn = $('#pages'); if (pn && pn.getBoundingClientRect().top < 0) pn.scrollIntoView({ block: 'start' }); }
}
function scrollToPage(i) {
  var pages = $('#pages');
  lockScroll = true;
  pages.scrollTo({ left: i * pages.clientWidth, behavior: REDUCE ? 'auto' : 'smooth' });
  setTimeout(function () { lockScroll = false; }, REDUCE ? 50 : 650);
}
function bindTabs() {
  $$('.tab').forEach(function (t, i) {
    t.addEventListener('click', function () { setMode(i, { scrollPage: true }); });
    t.addEventListener('keydown', function (e) {
      var n = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : -1;
      if (n >= 0) { e.preventDefault(); setMode(n, { scrollPage: true }); $('#tab' + n).focus(); }
    });
  });
  var pages = $('#pages');
  pages.addEventListener('scroll', function () {
    if (lockScroll) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      var idx = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
      if (idx !== state.mode && idx >= 0 && idx <= 2) setMode(idx, {});
    }, 90);
  }, { passive: true });
  window.addEventListener('resize', function () {
    pages.scrollLeft = state.mode * pages.clientWidth;
    fitPages();
  });
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(fitPages);
    $$('.pg').forEach(function (p) { ro.observe(p); });
  }
}
function fitPages() {
  var pg = $('#pn' + state.mode);
  if (pg && pg.offsetHeight > 0) $('#pages').style.height = pg.offsetHeight + 'px';
}

/* ---------- 화면 갱신 ---------- */
function view() {
  var g = gradeOf(state.grade);
  return Object.assign({}, state, {
    x: {
      cog: g.key === 'c', visitOk: g.key !== 'c',
      dayVisitOn: state.day.withVisit && g.key !== 'c',
      billVisit: state.day.billing.on && state.day.withVisit && g.key !== 'c',
      roomExtra: state.fac.room !== 'multi',
      noDay: state.day.days.length === 0,
      noVDay: state.visit.days.length === 0
    }
  });
}
function syncInputs() {
  V = view();
  $$('[data-path]').forEach(function (el) {
    var v = getP(state, el.dataset.path);
    if (el.type === 'radio') el.checked = String(v) === el.value;
    else if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT') el.value = String(v);
    else if (el.classList.contains('num') && document.activeElement !== el) el.value = el.hasAttribute('data-money') ? fmt(v) : String(v);
  });
  $$('.cal').forEach(function (c) {
    var days = getP(state, c.dataset.days);
    $$('button', c).forEach(function (b) { b.setAttribute('aria-pressed', days.indexOf(Number(b.dataset.d)) >= 0 ? 'true' : 'false'); });
  });
  $$('[data-if]').forEach(function (el) {
    var ex = el.dataset['if'], neg = ex.charAt(0) === '!';
    var val = !!getP(V, neg ? ex.slice(1) : ex);
    el.hidden = neg ? val : !val;
  });
}
function updateDyn() {
  var g = gradeOf(state.grade), mode = state.mode;
  // 탭·시트
  var bd = $('.binder'); if (bd) bd.dataset.mode = String(mode);
  $$('.tab').forEach(function (t, i) { t.setAttribute('aria-selected', i === mode ? 'true' : 'false'); t.tabIndex = i === mode ? 0 : -1; });
  $$('.pg').forEach(function (p, i) {
    p.classList.toggle('cur', i === mode);
    p.setAttribute('aria-hidden', i === mode ? 'false' : 'true');
    try { p.inert = i !== mode; } catch (e) {}
  });
  // 등급: 인지지원은 방문요양·요양원에서 막기, ◆ 안내
  $$('#gradePick .chk').forEach(function (lb) {
    var key = lb.dataset.g, input = $('input', lb), mark = $('.mark', lb);
    var block = key === 'c' && mode >= 1;
    input.disabled = block; lb.classList.toggle('dis', block);
    var main = mode === 2 ? ['1', '2', '3'] : ['3', '4', '5', 'c'];
    mark.hidden = main.indexOf(key) < 0;
  });
  $('#gradeCap').textContent = (mode === 2 ? '◆ 표시는 요양원에 주로 입소하는 등급이에요.' : '◆ 표시는 주야간보호센터를 주로 이용하는 등급이에요.') +
    (mode >= 1 ? ' 인지지원등급은 ' + MODE_NAMES[mode] + '를 이용할 수 없어요.' : '');
  // 주야간 시간 가격
  $$('#bandList .chk').forEach(function (lb, i) { $('.px', lb).textContent = won(g.day[i]) + '/일'; });
  $$('#satList .chk').forEach(function (lb) {
    var v = $('input', lb).value;
    $('.px', lb).textContent = v === 'same' ? '' : won(g.day[Number(v)]) + '/일';
  });
  // 방문요양 시간: 한도 안 최대 / 한도 초과 흐리게
  var maxM = visitMaxMinutes(state), L = g.limit;
  $$('#minList .chk').forEach(function (lb) {
    var m = Number($('input', lb).value);
    var ok = visitAllowed(state.grade, m), inp = $('input', lb);
    inp.disabled = !ok; lb.classList.toggle('dis', !ok);
    var v = copy(state.visit); v.minutes = m;
    var over = ok && visitCalc(state.grade, v).G > L;
    lb.classList.toggle('over', over);
    $('.px', lb).textContent = ok ? '1회 ' + won(DATA.visit[m]) : '1·2등급만';
    $('.tag', lb).hidden = !(ok && m === maxM && !over);
  });
  $$('#dvMin option').forEach(function (o) { o.disabled = !visitAllowed(state.grade, Number(o.value)); });
  // 요양원 안내
  var fn = '1·2등급은 바로 입소할 수 있어요. 3~5등급은 등급판정위원회가 시설급여를 인정한 경우에 입소할 수 있어요. 인지지원등급은 입소할 수 없어요.';
  if (g.key === '1' || g.key === '2') fn = g.name + '은 요양원에 바로 입소할 수 있어요.';
  else if (g.key !== 'c') fn = g.name + '은 등급판정위원회가 시설급여를 인정한 경우에 요양원에 입소할 수 있어요. (3~5등급 같은 비용으로 계산해요)';
  $('#facNote').textContent = fn;
}

/* 지금 고른 조건을 칩(알약 모양 글자 상자)으로 나눠 보여 줘요 */
function condChips(R, g) {
  var s = state, c = ['<span class="chip g">' + g.name + '</span>', '<span class="chip">' + (R.rate.label === '일반' ? '감경 없음' : R.rate.label) + '</span>'];
  var add = function (t) { c.push('<span class="chip">' + t + '</span>'); };
  if (s.mode === 0) {
    var d = s.day;
    add('주야간보호'); add(labelDays(d.days) + ' · ' + DATA.bands[d.band]); add('한 달 ' + (d.billing.on ? '' : '약 ') + R.days + '일');
    add(d.meal === 'both' ? '점심·저녁·간식' : '점심·간식');
    if (R.vis) add('+ 방문요양 ' + weekLabel(d.visit) + ' · ' + minLabel(d.visit.minutes));
  } else if (s.mode === 1) {
    var v = s.visit;
    add('방문요양'); add(weekLabel(v)); add('한 번에 ' + minLabel(v.minutes)); add('한 달 ' + (v.billing.on ? '' : '약 ') + R.days + '회');
  } else {
    var f = s.fac;
    add(f.type === 'home' ? '요양원' : '노인요양공동생활가정'); add(ROOM_NAMES[f.room]); add('한 달 ' + R.days + '일');
  }
  return c.join('');
}

var shownTotal = 0, rollRaf = 0;
function roll(to) {
  cancelAnimationFrame(rollRaf);
  var el = $('#totalNum'), from = shownTotal;
  if (REDUCE || from === to) { shownTotal = to; el.textContent = fmt(to); return; }
  var t0 = performance.now(), dur = 1300;   // 숫자가 올라가는 시간 (천천히 올라가다 끝에서 멈춰요)
  var step = function (t) {
    var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
    shownTotal = Math.round(from + (to - from) * e);
    el.textContent = fmt(shownTotal);
    if (k < 1) rollRaf = requestAnimationFrame(step); else { shownTotal = to; el.textContent = fmt(to); }
  };
  rollRaf = requestAnimationFrame(step);
}
var lastTotal = null;
// 홈 화면을 열 때마다 0원에서부터 다시 올라가며 보여 줘요
document.addEventListener('ltc:view', function (e) {
  if (REDUCE || lastTotal === null || !e.detail || e.detail.view !== 'home') return;
  shownTotal = 0; $('#totalNum').textContent = fmt(0); roll(lastTotal);
  var box = $('#amountBox'); box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
});
function renderTotal(R) {
  var g = gradeOf(state.grade);
  var total = R.unavailable ? 0 : R.total;
  if (lastTotal !== null && lastTotal !== total && !REDUCE) {
    var box = $('#amountBox'); box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
  }
  lastTotal = total;
  roll(total);
  $('#srTotal').textContent = '이번 달 내실 금액 ' + won(total);
  $('#stickyAmt').textContent = won(total);
  $('#condLine').innerHTML = R.unavailable ? R.unavailable : (R.empty ? '요일을 골라 주세요.' : condChips(R, g));
  // 쉬운 말 한 줄: 하루(한 번)에 평균 얼마인지
  var avg = $('#avgLine');
  if (!R.unavailable && !R.empty && R.days > 0) {
    avg.hidden = false;
    avg.innerHTML = (R.mode === 0 ? '하루 이용에' : R.mode === 1 ? '한 번 방문에' : '하루에') + ' 평균 <strong>약 ' + won(Math.round(R.total / R.days / 100) * 100) + '</strong> 정도예요.';
  } else avg.hidden = true;
  $('#nocovLine').hidden = !!R.unavailable || R.mode === 1;
  var lim = $('#limitBox');
  if (R.unavailable || R.mode === 2) { lim.hidden = true; return; }
  lim.hidden = false;
  var pct = Math.round(R.G / R.L * 100);
  $('#limText').innerHTML = '<em>' + pct + '%</em><small>' + fmt(R.G) + ' / ' + fmt(R.L) + '원</small>';
  $('#limBar').style.width = Math.min(100, R.G / R.L * 100) + '%';
  lim.classList.toggle('over', R.excess > 0);
  $('#limNote').textContent = R.excess > 0 ? '한도를 넘었어요. 넘은 부분 ' + won(R.excess) + '은 전액 본인이 내요.' : '한도까지 ' + won(R.L - R.G) + ' 남았어요.' + (R.boost ? ' (15일 이상 이용 증액 ' + won(R.boost) + ' 포함)' : '');
}
function renderLedger(R, anim) {
  var box = $('#ledgerBox');
  box.className = 'ledger' + (anim && !REDUCE ? ' anim' : '');
  var warn = $('#warnBox');
  if (R.unavailable) {
    box.innerHTML = '<p class="empty">' + R.unavailable + '.</p>'; warn.hidden = true; return;
  }
  box.innerHTML = R.rows.map(function (r, i) {
    if (r.k === 'head') return '<div class="lhead" style="--i:' + i + '"><b>' + r.label + '</b><small>' + r.sub + '</small></div>';
    return '<div class="lrow ' + (r.k || '') + ' ' + (r.cls || '') + '" style="--i:' + i + '"><span class="lb">' + r.label +
      (r.sub ? '<small>' + r.sub + '</small>' : '') + '</span><span class="dots"></span><span class="am">' + won(r.amt) + '</span></div>';
  }).join('');
  if (R.excess > 0) { warn.hidden = false; warn.textContent = '월 한도액을 ' + won(R.excess) + ' 넘었어요. 넘은 부분은 전액 본인이 내야 해서, 이용 시간이나 횟수를 줄이면 부담이 크게 줄어요.'; }
  else warn.hidden = true;
}
function renderCompare() {
  var rs = [0, 1, 2].map(function (m) { return calc(state, m); });
  var max = Math.max.apply(null, rs.map(function (r) { return r.unavailable ? 0 : r.total; }).concat([1]));
  $$('#cmpList .cmp-row').forEach(function (row, m) {
    var r = rs[m];
    row.classList.toggle('on', m === state.mode);
    $('small', row).textContent = (m === 2 ? '시설급여' : '재가급여') + (r.unavailable ? '' : ' · ' + r.short);
    var b = $('b', row), gone = $('.gone', row);
    if (r.unavailable) {
      b.hidden = true;
      if (!gone) { gone = document.createElement('span'); gone.className = 'gone'; row.insertBefore(gone, $('.gauge', row)); }
      gone.textContent = r.unavailable;
      $('.gauge', row).style.width = '0%';
    } else {
      b.hidden = false; b.textContent = won(r.total);
      if (gone) gone.remove();
      $('.gauge', row).style.width = Math.round(r.total / max * 100) + '%';
    }
  });
  var mc = $('#mealCmp');
  if (state.mode === 0 && !rs[0].unavailable && !rs[0].empty) {
    var a = copy(state); a.day.meal = 'lunch'; var b2 = copy(state); b2.day.meal = 'both';
    var ra = calcDay(a), rb = calcDay(b2);
    mc.hidden = false;
    mc.innerHTML = '<h3>주야간보호, 식사에 따라 달라져요</h3>' +
      '<div class="lrow' + (state.day.meal === 'lunch' ? ' sum' : '') + '"><span class="lb">점심만</span><span class="dots"></span><span class="am">' + won(ra.total) + '</span></div>' +
      '<div class="lrow' + (state.day.meal === 'both' ? ' sum' : '') + '"><span class="lb">점심과 저녁</span><span class="dots"></span><span class="am">' + won(rb.total) + '</span></div>';
    mc._a = ra.total; mc._b = rb.total;
  } else mc.hidden = true;
}

/* ---------- 요양원 등급별 비용 표 (하루 수가와 본인부담) ---------- */
function renderFacTable() {
  var t = $('#facTbl');
  if (!t) return;
  var f = state.fac, rate = rateOf(state.reduce), days = Math.max(28, Math.min(31, num(f.days)));
  var curKey = gradeOf(state.grade).fac;
  var rows = [['1', '1등급'], ['2', '2등급'], ['3', '3~5등급']];
  t.innerHTML = '<thead><tr><th scope="col" class="corner"><span class="sr">등급</span></th><th scope="col" class="m2">하루 수가</th><th scope="col" class="m2">' + days + '일 본인부담 (' + rate.fac + '%)</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var daily = DATA.facility[f.type][r[0]], burden = Math.floor(daily * days * rate.fac / 1000) * 10;
      var cur = curKey === r[0] ? ' class="cur"' : '';
      return '<tr><th scope="row">' + r[1] + '</th><td' + cur + '>' + won(daily) + '</td><td' + cur + '>' + won(burden) + '</td></tr>';
    }).join('') + '</tbody>';
}

/* ---------- 2027년 의결 수가 미리보기 (내정보 화면) ---------- */
var P27 = {
  visit: [[60, 25320, 26280], [90, 34120, 35420], [120, 43430, 45080]],
  bath: [['차량 이용 (차량 내 목욕)', 88990, 92140], ['차량 이용 (가정 내 목욕)', 80230, 83070], ['차량 미이용', 50100, 51870]],
  short: [['1등급', 74060, 76700], ['2등급', 68580, 71030], ['3등급', 63350, 65610], ['4등급', 61680, 63880], ['5등급', 60000, 62140]],
  day68: [['1등급', 8706], ['2등급', 8064], ['3등급', 7445], ['4등급', 7190], ['5등급·인지지원', 6935]]
};
function pct1(a, b) { return (b >= a ? '+' : '−') + (Math.abs(b / a - 1) * 100).toFixed(1) + '%'; }
function renderPreview2027() {
  var box = $('#p27Cmp');
  if (!box) return;
  var g = gradeOf(state.grade), mode = state.mode, d27 = makeData2027();
  var g27 = d27.grades.filter(function (x) { return x.key === g.key; })[0];
  var R26 = calc(state, mode), R27 = calc2027(state, mode), h;
  if (R26.unavailable) h = '<p class="p27-msg">' + R26.unavailable + '.</p>';
  else if (!R27) h = '<p class="p27-msg">이 조건은 2027년 자료가 아직 없어서 비교하지 못해요. (주야간보호 8~10시간, 방문요양 3시간·4시간, 요양원만 비교해요.)</p>';
  else {
    var diff = R27.total - R26.total;
    h = '<p class="p27-cond">' + g.name + ' · ' + MODE_NAMES[mode] + ' · 한 달에 내실 금액</p>' +
      '<div class="p27-row"><span>2026년 (지금 적용)</span><b>' + won(R26.total) + '</b></div>' +
      '<div class="p27-row new"><span>2027년 (의결안)</span><b>' + won(R27.total) + '</b></div>' +
      '<p class="p27-diff">한 달에 <strong>' + (diff >= 0 ? '+' : '−') + won(Math.abs(diff)) + '</strong> ' + (diff >= 0 ? '늘어나요' : '줄어들어요') + '.</p>';
  }
  box.innerHTML = h;

  var rows = [['재가 월 한도액', g.limit, g27.limit], ['주야간보호 1일 (8~10시간)', g.day[2], g27.day[2]]];
  if (g.key !== 'c') {
    rows.push(['방문요양 3시간 (1회)', DATA.visit[180], d27.visit[180]]);
    if (visitAllowed(g.key, 240)) rows.push(['방문요양 4시간 (1회)', DATA.visit[240], d27.visit[240]]);
    rows.push(['3시간 방문요양 월 최대 횟수', Math.floor(g.limit / DATA.visit[180]), Math.floor(g27.limit / d27.visit[180]), '회']);
  }
  if (g.fac) rows.push(['요양원 1일', DATA.facility.home[g.fac], d27.facility.home[g.fac]]);
  $('#p27Tbl').innerHTML = '<thead><tr><th scope="col" class="corner"><span class="sr">항목</span></th><th scope="col" class="y26">2026년</th><th scope="col" class="y27">2027년 의결</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var unit = r[3] || '원', f = function (n) { return unit === '원' ? won(n) : n + unit; };
      return '<tr><th scope="row">' + r[0] + '</th><td>' + f(r[1]) + '</td><td class="new">' + f(r[2]) + (unit === '원' ? '<small>' + pct1(r[1], r[2]) + '</small>' : '') + '</td></tr>';
    }).join('') + '</tbody>';

  $('#p27More').innerHTML =
    '<p><b>보험료율</b> 0.9448% → <b>0.9994%</b> (세대당 월평균 19,029원 → 20,129원, 1,100원 증가)</p>' +
    '<p><b>방문요양 1회</b> ' + P27.visit.map(function (v) { return v[0] + '분 ' + won(v[1]) + ' → ' + won(v[2]); }).join(' · ') + '</p>' +
    '<p><b>방문목욕</b></p><ul>' + P27.bath.map(function (b) { return '<li>' + b[0] + ': ' + won(b[1]) + ' → ' + won(b[2]) + '</li>'; }).join('') + '</ul>' +
    '<p><b>단기보호 1일</b></p><ul>' + P27.short.map(function (s) { return '<li>' + s[0] + ': ' + won(s[1]) + ' → ' + won(s[2]) + '</li>'; }).join('') + '</ul>' +
    '<p><b>주야간보호 6~8시간, 하루 본인부담 15% (2027 의결)</b></p><ul>' + P27.day68.map(function (s) { return '<li>' + s[0] + ': ' + won(s[1]) + '</li>'; }).join('') + '</ul>' +
    '<p class="hint">식사비 같은 비급여는 위 금액에 들어 있지 않아요. 감경 대상(40%·60%)의 2027년 금액은 발표 자료에 없어서, 이 계산기가 같은 비율로 계산한 값이에요. 2027년 수가는 보건복지부 고시로 공포돼야 최종 적용돼요. (2026년 11월 16일 현재 고시와 행정예고는 확인되지 않았어요.)</p>';
}

/* 한 달 N회까지 가능할 때, 주 몇 회까지인지 (한 달 횟수 = 주 횟수 × 4.35 반올림) */
function weekHint(maxN) {
  for (var k = 7; k >= 1; k--) if (monthCount(k) <= maxN) return '(주 ' + k + '회 정도)';
  return '';
}

/* ---------- 주야간보호 + 방문요양: 남는 한도와 합산 안내 ---------- */
function renderRemain(R) {
  var box = $('#remainBox');
  if (!box) return;
  var g = gradeOf(state.grade);
  if (R.mode !== 0 || R.unavailable || g.key === 'c' || R.empty) { box.hidden = true; return; }
  box.hidden = false;
  var m = state.day.visit.minutes, unit = DATA.visit[visitAllowed(state.grade, m) ? m : 180];
  var rem = R.L - R.dayG, h;
  if (rem <= 0) h = '<p>주야간보호만으로 월 한도액을 다 썼어요. 방문요양을 더 쓰면 그 금액은 <b>전액 본인</b>이 내요.</p>';
  else h = '<p>주야간보호를 이용하고 <b>남는 한도 ' + won(rem) + '</b>으로 방문요양 ' + minLabel(m) + '(1회 ' + won(unit) + ')을 <b>한 달 약 ' + Math.floor(rem / unit) + '회</b>' + weekHint(Math.floor(rem / unit)) + '까지 더 이용할 수 있어요.</p>';
  if (R.vis) {
    h += '<div class="remain-sum"><div><span>주야간보호</span><b>' + won(R.dayG) + '</b></div>' +
      '<div><span>+ 방문요양 ' + R.vis.count + '회</span><b>' + won(R.vis.G) + '</b></div>' +
      '<div class="tot"><span>= 급여비용 합계</span><b>' + won(R.G) + '</b></div></div>' +
      '<p>한도 ' + fmt(R.L) + '원 중 <b>' + Math.round(R.G / R.L * 100) + '%</b>를 써요. ' +
      (R.excess > 0 ? '<b class="bad">한도를 ' + won(R.excess) + ' 넘었어요.</b> 넘은 부분은 전액 본인이 내요.' : '한도까지 ' + won(R.L - R.G) + ' 남아요.') + '</p>' +
      '<p>식비·간식비까지 합쳐서 이번 달 내실 금액은 <b>' + won(R.total) + '</b>이에요.</p>';
  }
  box.innerHTML = h;
}

/* ---------- 한눈에 보는 계산 항목 (세 가지를 한 표로) ---------- */
function renderSummary() {
  var t = $('#sumTbl');
  if (!t) return;
  var g = gradeOf(state.grade), rate = rateOf(state.reduce), S = DATA.surcharge, cog = g.key === 'c';
  var rs = [0, 1, 2].map(function (m) { return calc(state, m); });
  var names = ['주야간보호', '방문요양', '요양원'];
  var rows = [
    ['본인부담률', [rate.home + '%', rate.home + '%', rate.fac + '%']],
    ['월 한도액', [fmt(g.limit), cog ? '이용 불가' : fmt(g.limit), '없음']],
    ['한도액 증액', [DATA.limitBoost.pct[g.key] ? '15일↑ +' + DATA.limitBoost.pct[g.key] + '%' : '해당 없음', '해당 없음', '해당 없음']],
    ['한도 초과분', ['전액 본인', '전액 본인', '해당 없음']],
    ['일·공휴일 가산', ['+' + S.dayHoliday + '%', '+' + S.visitSun + '~' + S.visitHoliday + '%', '없음']],
    { group: '공단 지원이 없는 항목 · 센터마다 달라요' },
    ['식비', ['본인 부담', '없음', '본인 부담']],
    ['간식비', ['본인 부담', '없음', '본인 부담']],
    ['1·2인실 추가', ['없음', '없음', '방에 따라']],
    ['이·미용비', ['없음', '없음', '본인 부담']],
    { total: ['이번 달 예상', rs.map(function (r) { return r.unavailable ? '이용 불가' : fmt(r.total); })] }
  ];
  var cur = state.mode;
  var html = '<thead><tr class="kinds"><td></td><th scope="colgroup" colspan="2" class="kd0">재가급여 · 집에서 이용</th><th scope="col" class="kd1">시설급여</th></tr>' +
    '<tr><th scope="col" class="corner"><span class="sr">항목</span></th>' +
    names.map(function (n, i) { return '<th scope="col" class="m' + i + (i === cur ? ' cur' : '') + '">' + n + '</th>'; }).join('') + '</tr></thead><tbody>';
  rows.forEach(function (r) {
    if (r.group) { html += '<tr class="grp"><th colspan="4" scope="colgroup">' + r.group + '</th></tr>'; return; }
    var isTot = !!r.total, label = isTot ? r.total[0] : r[0], cells = isTot ? r.total[1] : r[1];
    html += '<tr' + (isTot ? ' class="tot"' : '') + '><th scope="row">' + label + '</th>' + cells.map(function (c, i) {
      var cls = (i === cur ? 'cur ' : '') + (/^(없음|해당 없음|이용 불가)$/.test(c) ? 'no' : '');
      return '<td class="' + cls.trim() + '">' + c + '</td>';
    }).join('') + '</tr>';
  });
  t.innerHTML = html + '</tbody>';
}

function update(opt) {
  opt = opt || {};
  syncInputs();
  updateDyn();
  var R = calc(state, state.mode);
  renderTotal(R);
  renderLedger(R, opt.anim);
  renderRemain(R);
  renderCompare();
  renderSummary();
  renderFacTable();
  renderPreview2027();
  renderMe();
  document.dispatchEvent(new CustomEvent('ltc:update', { detail: { R: R, mode: state.mode } }));
  fitPages();
}

/* ---------- 합계 둘레 동그라미 다시 그리기 ---------- */
function redrawCircle() {
  var s = $('#scribble');
  s.classList.remove('draw'); void s.getBBox; void s.offsetWidth;
  if (REDUCE) { s.classList.add('draw'); return; }
  requestAnimationFrame(function () { s.classList.add('draw'); });
}

/* ---------- 토스트 ---------- */
function toast(msg) {
  var t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
}

/* ---------- 카톡 보내기(글 복사) ---------- */
function kakaoText() {
  var R = calc(state, state.mode), g = gradeOf(state.grade);
  var lines = ['[부모님 장기요양 한 달 예상 비용]', g.name + ', ' + R.rate.label, R.desc, '예상 금액: ' + won(R.total), R.parts];
  if (state.mode === 0 && !R.empty) {
    var a = copy(state); a.day.meal = 'lunch'; var b = copy(state); b.day.meal = 'both';
    lines.push('점심만 ' + won(calcDay(a).total) + ', 점심과 저녁 ' + won(calcDay(b).total));
  }
  if (state.mode !== 1) lines.push('※ 식비·간식비 등 공단 지원이 없는 항목은 센터마다 달라요.');
  lines.push('※ ' + DATA.year + '년 국민건강보험공단 수가로 계산한 예상액이에요.');
  return lines.join('\n');
}
function copyText(t) {
  return new Promise(function (resolve) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
      document.body.appendChild(ta); ta.select();
      try { ta.setSelectionRange(0, t.length); } catch (e) {}
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); resolve(ok);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { resolve(true); }, fallback);
    else fallback();
  });
}
function sendKakao() {
  var t = kakaoText();
  copyText(t).then(function (ok) {
    var box = $('#copyBox');
    if (ok) { box.hidden = true; toast('결과 글을 복사했어요. 카카오톡에 붙여 넣어 보내세요.'); }
    else { box.hidden = false; $('#copyTa').value = t; $('#copyTa').focus(); $('#copyTa').select(); toast('자동 복사가 안 돼요. 아래 글을 길게 눌러 복사해 주세요.'); }
  });
}
function resetAll() {
  var fresh = defaultState();
  Object.keys(fresh).forEach(function (k) { state[k] = fresh[k]; });
  autoVisit(state);
  $$('details.more').forEach(function (d) { d.open = false; });
  $('#copyBox').hidden = true;
  scrollToPage(0); redrawCircle(); update({ anim: true });
  window.scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' });
  toast('처음부터 다시 시작해요.');
}

/* ---------- 하단 메뉴: 홈 · 비용계산 · 내정보 ---------- */
var VIEWS = ['home', 'calc', 'me'];
function syncSticky() {
  var bar = $('#stickyBar'), show = document.body.dataset.view === 'calc' && !WZ.open;
  bar.classList.toggle('show', show);
  bar.setAttribute('aria-hidden', show ? 'false' : 'true');
  $('#stickyKakao').tabIndex = show ? 0 : -1;
}
function renderMe() {
  if (!$('#meGrade')) return;
  var g = gradeOf(state.grade), R = calc(state, state.mode);
  $('#meGrade').textContent = g.name;
  $('#meReduce').textContent = rateOf(state.reduce).label;
  $('#mePlace').textContent = MODE_NAMES[state.mode] + (state.mode === 2 ? ' (시설급여)' : ' (재가급여)');
  $('#meDesc').textContent = R.unavailable ? R.unavailable : R.desc;
  $('#meTotal').textContent = won(R.unavailable ? 0 : R.total);
}
function showView(v, opt) {
  opt = opt || {};
  if (VIEWS.indexOf(v) < 0) v = 'home';
  document.body.dataset.view = v;
  $$('.bnav a').forEach(function (a) {
    var on = a.dataset.go === v;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (v === 'calc') { var pg = $('#pages'); pg.scrollLeft = state.mode * pg.clientWidth; fitPages(); }
  if (v === 'me') renderMe();
  syncSticky();
  document.dispatchEvent(new CustomEvent('ltc:view', { detail: { view: v } }));
  if (!opt.keepScroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (opt.hash !== false && location.hash !== '#' + v) { try { history.replaceState(null, '', '#' + v); } catch (e) {} }
  var t = $('#view-' + v + ' .vbar-t') || $('#view-' + v + ' h1');
  if (t && !opt.keepScroll) { try { t.focus({ preventScroll: true }); } catch (e) {} }
}
function gotoTarget(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var vw = el.closest('.view'), v = vw ? vw.dataset.view : null;
  var switched = !!(v && document.body.dataset.view !== v);
  if (switched) showView(v, { keepScroll: true });
  requestAnimationFrame(function () { el.scrollIntoView({ block: 'start', behavior: switched ? 'instant' : 'smooth' }); });
}
function routeFromHash() {
  var h = decodeURIComponent((location.hash || '').slice(1));
  if (VIEWS.indexOf(h) >= 0) { showView(h, { hash: false }); return; }
  if (/^qa-\d+$/.test(h)) { showView('home', { keepScroll: true, hash: false }); qaOpenHash(); return; }
  if (h && document.getElementById(h)) { gotoTarget(h); return; }
  showView('home', { hash: false });
}
function initRouter() {
  document.addEventListener('click', function (e) {
    var g = e.target.closest ? e.target.closest('[data-go]') : null;
    if (g) { e.preventDefault(); showView(g.dataset.go); return; }
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (id === 'top') return;
    if (document.getElementById(id)) { e.preventDefault(); gotoTarget(id); }
  });
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();
}

/* =========================================================
   질문에 하나씩 답하며 계산하기 (질문당 10초)
   ========================================================= */
var WZ = { open: false };
var WZ_MS = 10000;
var DAYSETS = [
  { v: '1,2,3,4,5', label: '평일 매일 (월~금)' },
  { v: '1,3,5', label: '월·수·금' },
  { v: '1,2,3,4,5,6', label: '월~토' }
];
function wzSteps(place) {
  var s = [
    { key: 'place', kicker: '돌봄 장소', title: '어디에서 돌봄을 받으실 계획인가요?',
      opts: function () { return [{ v: 0, label: '주야간보호센터', sub: '낮 동안 다니는 곳' }, { v: 1, label: '방문요양', sub: '요양보호사가 집으로 와요' }, { v: 2, label: '요양원', sub: '들어가서 지내는 곳' }]; },
      def: function () { return 0; }, apply: function (d, v) { d.mode = v; } },
    { key: 'grade', kicker: '등급', title: '장기요양 등급은 몇 등급인가요?',
      opts: function (d) { return DATA.grades.map(function (g) { return { v: g.key, label: g.name, disabled: g.key === 'c' && d.mode !== 0, sub: g.key === 'c' && d.mode !== 0 ? (d.mode === 1 ? '방문요양은 이용할 수 없어요' : '요양원은 입소할 수 없어요') : '' }; }); },
      def: function (d) { return d.mode === 2 ? '3' : '4'; }, apply: function (d, v) { d.grade = v; } },
    { key: 'reduce', kicker: '본인부담 감경', title: '본인부담 감경을 받으시나요?',
      opts: function () { return Object.keys(DATA.rates).map(function (k) { return { v: k, label: DATA.rates[k].label, sub: k === 'general' ? '잘 모르시면 이걸 고르세요' : '' }; }); },
      def: function () { return 'general'; }, apply: function (d, v) { d.reduce = v; } }
  ];
  if (place === 0) {
    s.push({ key: 'days', kicker: '주야간보호', title: '일주일에 어느 요일에 다니세요?',
      opts: function () { return DAYSETS; }, def: function () { return DAYSETS[2].v; },
      apply: function (d, v) { d.day.days = v.split(',').map(Number); } });
    s.push({ key: 'band', kicker: '주야간보호', title: '하루에 몇 시간 계세요?',
      opts: function (d) { var g = gradeOf(d.grade); return DATA.bands.map(function (b, i) { return { v: i, label: b, sub: '하루 ' + won(g.day[i]) }; }); },
      def: function () { return 2; }, apply: function (d, v) { d.day.band = v; } });
    s.push({ key: 'meal', kicker: '주야간보호', title: '식사는 어떻게 하세요?',
      opts: function () { return [{ v: 'lunch', label: '점심만', sub: '식비는 공단 지원이 없어요 · 센터마다 달라요' }, { v: 'both', label: '점심과 저녁', sub: '식비는 공단 지원이 없어요 · 센터마다 달라요' }]; },
      def: function () { return 'both'; }, apply: function (d, v) { d.day.meal = v; } });
  } else if (place === 1) {
    s.push({ key: 'vdays', kicker: '방문요양', title: '일주일에 몇 번 오시나요?',
      opts: function () { return [1, 2, 3, 4, 5, 6, 7].map(function (n) { return { v: n, label: '주 ' + n + '회', sub: n === 5 ? '평일 매일' : (n === 7 ? '매일' : '') }; }); },
      def: function () { return 5; },
      apply: function (d, v) { d.visit.perWeek = v; d.visit.days = weekDays(v); } });
    s.push({ key: 'vmin', kicker: '방문요양', title: '한 번에 몇 시간 오시나요?',
      opts: function (d) {
        var L = gradeOf(d.grade).limit, mx = visitMaxMinutes(d);
        return Object.keys(DATA.visit).map(Number).sort(function (a, b) { return a - b; }).map(function (m) {
          var v = copy(d.visit); v.minutes = m;
          var ok = visitAllowed(d.grade, m);
          var over = ok && visitCalc(d.grade, v).G > L;
          return { v: m, label: minLabel(m) + ' (' + m + '분)', disabled: !ok, sub: !ok ? '1·2등급만 이용할 수 있어요' : ((m === mx && !over) ? '한도 안 최대' : (over ? '한도를 넘어요' : '')), over: over };
        });
      },
      def: function (d) { return visitMaxMinutes(d); },
      apply: function (d, v, auto) { d.visit.minutes = v; d.visit.auto = !!auto; } });
  } else {
    s.push({ key: 'room', kicker: '요양원', title: '어떤 방을 쓰실 예정인가요?',
      opts: function () { return [{ v: 'multi', label: '다인실' }, { v: 'double', label: '2인실', sub: '하루 추가 금액은 나중에 넣어요' }, { v: 'single', label: '1인실', sub: '하루 추가 금액은 나중에 넣어요' }]; },
      def: function () { return 'multi'; }, apply: function (d, v) { d.fac.room = v; } });
  }
  return s;
}

function wzStart() {
  WZ.open = true; WZ.draft = copy(state); WZ.autos = []; WZ.idx = 0;
  WZ.steps = wzSteps(0); WZ.done = false;
  $('#wz').hidden = false; document.body.style.overflow = 'hidden';
  $('#stickyBar').classList.remove('show');
  wzShow();
  WZ.last = 0; cancelAnimationFrame(WZ.raf); WZ.raf = requestAnimationFrame(wzTick);
}
function wzClose() {
  WZ.open = false; cancelAnimationFrame(WZ.raf);
  $('#wz').hidden = true; document.body.style.overflow = '';
  $('#quickBtn').focus({ preventScroll: true });
  syncSticky();
}
function wzShow() {
  var st = WZ.steps[WZ.idx], d = WZ.draft;
  var opts = st.opts(d), def = st.def(d);
  WZ.remain = WZ_MS; WZ.curOpts = opts; WZ.curDef = def;
  $('#wzBot').hidden = false;
  $('#wzCount').textContent = (WZ.idx + 1) + ' / ' + WZ.steps.length;
  $('#wzProg').style.width = (WZ.idx / WZ.steps.length * 100) + '%';
  $('#wzKicker').textContent = st.kicker;
  $('#wzTitle').textContent = st.title;
  var defOpt = opts.filter(function (o) { return o.v === def; })[0];
  WZ.defLabel = defOpt ? defOpt.label : '';
  $('#wzOpts').innerHTML = opts.map(function (o, i) {
    return '<button type="button" class="wz-opt' + (o.v === def ? ' def' : '') + (o.over ? ' over' : '') + '" data-i="' + i + '" style="--i:' + i + '"' + (o.disabled ? ' disabled' : '') + '>' +
      '<span>' + o.label + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</span>' + (o.v === def ? '<span class="dtag">기본값</span>' : '') + '</button>';
  }).join('');
  var q = $('#wzQ'); q.classList.remove('wz-q'); void q.offsetWidth; q.classList.add('wz-q');
  $('#wzTimerBox').classList.remove('warn');
  $('#wzTimer').style.transform = 'scaleX(1)';
  wzSecText();
  $('#wzBody').scrollTop = 0;
  try { $('#wzTitle').focus({ preventScroll: true }); } catch (e) {}
}
function wzSecText() {
  var s = Math.max(0, Math.ceil(WZ.remain / 1000));
  $('#wzSec').textContent = s + '초 남았어요 · 못 고르면 \'' + WZ.defLabel + '\'(으)로 넘어가요';
}
function wzTick(ts) {
  if (!WZ.open) return;
  if (!WZ.done && !document.hidden) {
    if (!WZ.last) WZ.last = ts;
    var dt = Math.min(ts - WZ.last, 100);
    WZ.last = ts;
    WZ.remain -= dt;
    $('#wzTimer').style.transform = 'scaleX(' + Math.max(0, WZ.remain / WZ_MS) + ')';
    $('#wzTimerBox').classList.toggle('warn', WZ.remain <= 3000);
    wzSecText();
    if (WZ.remain <= 0) { wzPick(WZ.curDef, true); }
  } else WZ.last = 0;
  WZ.raf = requestAnimationFrame(wzTick);
}
function wzPick(v, auto) {
  var st = WZ.steps[WZ.idx];
  var opt = WZ.curOpts.filter(function (o) { return o.v === v; })[0];
  st.apply(WZ.draft, v, auto);
  if (auto) WZ.autos.push({ kicker: st.kicker, title: st.title, label: opt ? opt.label : String(v) });
  if (st.key === 'place') {
    WZ.steps = wzSteps(v);
  }
  WZ.idx++;
  WZ.last = 0;
  if (WZ.idx >= WZ.steps.length) wzFinish(); else wzShow();
}
function wzSkipAll() {
  while (WZ.idx < WZ.steps.length) {
    var st = WZ.steps[WZ.idx], d = WZ.draft;
    var opts = st.opts(d), v = st.def(d);
    WZ.curOpts = opts;
    var opt = opts.filter(function (o) { return o.v === v; })[0];
    st.apply(d, v, true);
    WZ.autos.push({ kicker: st.kicker, title: st.title, label: opt ? opt.label : String(v) });
    if (st.key === 'place') WZ.steps = wzSteps(v);
    WZ.idx++;
  }
  wzFinish();
}
function wzFinish() {
  WZ.done = true;
  Object.keys(WZ.draft).forEach(function (k) { state[k] = WZ.draft[k]; });
  if (state.mode === 1 && state.visit.auto) autoVisit(state);
  var R = calc(state, state.mode);
  $('#wzCount').textContent = '끝!';
  $('#wzProg').style.width = '100%';
  $('#wzBot').hidden = true;
  var list = WZ.autos.length
    ? '<p><b>10초가 지나 자동으로 고른 항목</b></p><ul>' + WZ.autos.map(function (a) { return '<li>' + a.kicker + ': <b>' + a.label + '</b></li>'; }).join('') + '</ul><p class="hint">틀린 항목은 처음 화면에서 바로 고칠 수 있어요.</p>'
    : '<p>모든 항목을 직접 골라 주셨어요.</p>';
  $('#wzQ').className = 'wz-q wz-done';
  $('#wzQ').innerHTML = '<p class="wz-kicker">이번 달 내실 금액 (예상)</p><div class="big">' + won(R.total) + '</div><p class="hint">' +
    gradeOf(state.grade).name + ' · ' + R.rate.label + ' · ' + R.desc + '</p>' + list +
    '<div class="btns"><button type="button" class="btn primary" id="wzSee">결과 자세히 보기</button><button type="button" class="btn" id="wzAgain">다시 해 보기</button></div>';
  var sameTab = true;
  $('#wzSee').addEventListener('click', function () {
    wzClose();
    scrollToPage(state.mode); redrawCircle(); update({ anim: true });
    showView('calc', { keepScroll: true });
    requestAnimationFrame(function () { var l = $('#ledger'); if (l) l.scrollIntoView({ block: 'start', behavior: 'instant' }); });
  });
  $('#wzAgain').addEventListener('click', function () { wzStart(); });
  void sameTab;
  try { $('#wzSee').focus({ preventScroll: true }); } catch (e) {}
}
function bindWizard() {
  $('#quickBtn').addEventListener('click', wzStart);
  $('#wzQuit').addEventListener('click', wzClose);
  $('#wzSkip').addEventListener('click', wzSkipAll);
  $('#wzOpts').addEventListener('click', function (e) {
    var b = e.target.closest('.wz-opt'); if (!b || b.disabled) return;
    wzPick(WZ.curOpts[Number(b.dataset.i)].v, false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && WZ.open) wzClose(); });
}

/* =========================================================
   배경음악 (외부 음원 없이 Web Audio로 직접 연주, 기본 꺼짐)
   ========================================================= */
var Music = (function () {
  var ctx = null, master = null, on = false, timer = 0, step = 0, nextT = 0;
  var EIGHTH = 0.62;
  var CHORDS = [[48, 55, 60, 64, 71], [45, 52, 57, 60, 67], [41, 48, 53, 57, 64], [43, 50, 55, 59, 62]];
  var MELODY = [76, 0, 74, 0, 72, 0, 74, 0, 79, 0, 76, 0, 72, 0, 71, 0, 69, 0, 72, 0, 76, 0, 74, 0, 67, 0, 71, 0, 74, 0, 72, 0];
  var ARP = [0, 1, 2, 3, 2, 1, 4, 1];
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function note(m, t, dur, vol) {
    var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
    o1.type = 'triangle'; o2.type = 'sine';
    o1.frequency.value = hz(m); o2.frequency.value = hz(m) * 2;
    g2.gain.value = 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  function playStep(s, t) {
    var bar = Math.floor(s / 8) % CHORDS.length, ch = CHORDS[bar], i = s % 8;
    note(ch[ARP[i]], t, 2.4, i === 0 ? 0.2 : 0.12);
    var mel = MELODY[s % MELODY.length];
    if (mel) note(mel, t, 2.2, 0.1);
  }
  function sched() {
    while (nextT < ctx.currentTime + 1.6) { playStep(step, nextT); nextT += EIGHTH; step++; }
    timer = setTimeout(sched, 300);
  }
  function start() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { toast('이 휴대폰에서는 음악을 켤 수 없어요.'); return false; }
    if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); }
    ctx.resume(); step = 0; nextT = ctx.currentTime + 0.15; on = true; sched(); return true;
  }
  function stop() { on = false; clearTimeout(timer); if (ctx) ctx.suspend(); }
  function pauseHidden() { if (on && ctx) { clearTimeout(timer); ctx.suspend(); } }
  function resumeVisible() { if (on && ctx) { ctx.resume(); nextT = ctx.currentTime + 0.15; clearTimeout(timer); sched(); } }
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseHidden(); else resumeVisible(); });
  window.addEventListener('pagehide', pauseHidden);
  return { toggle: function () { if (on) stop(); else if (!start()) return false; return on; }, isOn: function () { return on; } };
})();
function bindMusic() {
  var btn = $('#musicBtn'), sw = $('#musicSwitch');
  function toggle() {
    var on = Music.toggle();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = on ? '배경음악 끄기' : '배경음악 켜기';
    btn.setAttribute('aria-label', label); btn.title = label;
    if (sw) sw.setAttribute('aria-checked', on ? 'true' : 'false');
    toast(on ? '배경음악을 켰어요.' : '배경음악을 껐어요.');
  }
  btn.addEventListener('click', toggle);
  if (sw) sw.addEventListener('click', toggle);
}

/* =========================================================
   자주 묻는 질문 (분류 칩 + 검색 + 한 번에 하나만 펼치기)
   숫자는 위 DATA에서 가져오므로 매년 DATA만 바꾸면 같이 바뀝니다.
   ========================================================= */
var QA_TAG = { start: '신청·등급', cost: '비용·감경', use: '이용 방법' };
var QA_WORDS = ['신청', '등급', '한도', '식비', '감경', '공휴일', '요양원'];
var QA_CATS = [{ k: 'all', t: '전체' }, { k: 'start', t: '신청·등급' }, { k: 'cost', t: '비용·감경' }, { k: 'use', t: '이용 방법' }];
function qaData() {
  var R = DATA.rates, S = DATA.surcharge;
  var limits = DATA.grades.map(function (g) { return g.name + ' ' + won(g.limit); }).join(' · ');
  var g4 = gradeOf('4');
  return [
    { cat: 'start', q: '장기요양보험은 누가 받을 수 있나요?', kw: '대상 자격 65세 노인성질병 치매 뇌혈관 누가 조건',
      a: ['<p>만 65세 이상 어르신, 또는 65세 미만이어도 <b>치매·뇌혈관질환 같은 노인성 질병</b>이 있어서 혼자 일상생활을 하기 어려운 분이 받을 수 있어요. (노인장기요양보험법)</p>',
          '<p>어떤 병이 노인성 질병에 들어가는지는 법으로 정해져 있어요. 내 경우가 해당되는지는 공단에 물어보는 게 가장 정확해요.</p>'],
      go: { href: '#h-info', label: '등급 고르러 가기' } },
    { cat: 'start', q: '어떻게 신청하고, 얼마나 걸리나요?', kw: '신청 방법 절차 기간 방문조사 인정서 대리 온라인 전화 1577',
      a: ['<p><b>① 신청</b> 국민건강보험공단 지사 방문·우편·팩스, 인터넷(<a href="https://www.longtermcare.or.kr/npbs/indexr.jsp" target="_blank" rel="noopener">노인장기요양보험 공식 홈페이지</a>), 전화(1577-1000)로 신청해요. 가족이 대신 신청할 수도 있어요.</p>',
          '<p><b>② 방문조사</b> 공단 직원이 집(또는 계신 곳)에 와서 심신 상태를 살펴봐요.</p>',
          '<p><b>③ 등급 판정</b> 의사소견서 등과 함께 등급판정위원회가 등급을 정해요.</p>',
          '<p><b>④ 결과 받기</b> 우편으로 장기요양인정서를 받아요. 보통 한 달 안팎 걸리고, 서류를 더 내야 하면 늘어날 수 있어요.</p>'],
      go: null },
    { cat: 'start', q: '등급은 어떻게 정해지고, 어떤 차이가 있나요?', kw: '등급 1등급 5등급 인지지원 점수 한도 차이 판정',
      a: ['<p>심신 상태를 점수로 매겨서 <b>1~5등급과 인지지원등급</b>으로 나눠요. 1등급이 도움이 가장 많이 필요한 상태이고, 인지지원등급은 경증 치매 어르신이에요.</p>',
          '<p>등급마다 집에서 쓰는 서비스(주야간보호·방문요양)의 <b>한 달 한도액</b>이 달라요.</p>',
          '<p class="hint">' + limits + '</p>'],
      go: { href: '#h-info', label: '내 등급으로 계산하기' } },
    { cat: 'start', q: '등급을 못 받았거나, 결과가 마음에 들지 않으면요?', kw: '이의신청 심사청구 90일 갱신 유효기간 등급변경 불복 탈락',
      a: ['<p>결과를 안 날부터 <b>90일 이내</b>에 공단에 이의신청(심사청구)을 할 수 있어요.</p>',
          '<p>몸 상태가 크게 달라졌다면 인정 기간 중에도 등급 변경을 신청할 수 있어요. 등급에는 유효기간이 있어서, 끝나기 전에 갱신 신청을 해야 해요. 기간은 장기요양인정서에 적혀 있어요.</p>'],
      go: null },
    { cat: 'cost', q: '본인부담은 얼마인가요?', kw: '본인부담 15% 20% 퍼센트 자부담 얼마 비율 재가 시설',
      a: ['<p>비용의 일부만 내고 나머지는 공단이 부담해요.</p>',
          '<ul><li>집에서 쓰는 서비스(주야간보호·방문요양): <b>' + R.general.home + '%</b></li>',
          '<li>요양원 같은 시설: <b>' + R.general.fac + '%</b></li></ul>',
          '<p>소득이 낮은 분은 감경을 받을 수 있어요(아래 질문 참고). 식비 같은 별도 비용은 따로예요.</p>'],
      go: { href: '#totalCard', label: '내 금액 계산해 보기' } },
    { cat: 'cost', q: '월 한도액을 넘으면 어떻게 되나요?', kw: '한도 초과 한도액 넘으면 전액 월한도 초과분 증액 15일 추가산정',
      a: ['<p>집에서 쓰는 서비스는 등급별로 한 달에 공단이 부담해 주는 <b>한도액</b>이 있어요. 한도를 넘게 이용한 만큼은 ' + R.general.home + '%가 아니라 <b>전액 본인</b>이 내요.</p>',
          '<p>예를 들어 ' + g4.name + '은 한도액이 ' + won(g4.limit) + '이에요. 계산기의 한도 막대가 빨갛게 바뀌면 한도를 넘은 거예요.</p>',
          '<p><b>주야간보호를 월 15일(하루 8시간 이상) 이상 이용하면</b> 월 한도액이 1·2등급은 10%, 3~5등급은 20% 범위에서 늘어나요. 계산기는 이 증액을 반영해요. (비용계산 → 주야간보호 → 자세히 입력하기에서 끌 수 있어요.)</p>',
          '<p class="hint">가족 요양보호사에게 방문요양을 받는 달은 증액이 안 되는 등 조건이 있고, 비율은 고시 개정에 따라 달라질 수 있어요. 인지지원등급은 확인하지 못해 증액을 계산하지 않아요. 꼭 공단(1577-1000)에 확인해 주세요.</p>',
          '<p>요양원은 한 달 한도액이 아니라 하루 비용을 기준으로 계산해요.</p>'],
      go: { href: '#limitBox', label: '한도 막대 보러 가기' } },
    { cat: 'cost', q: '식비·간식비도 장기요양 비용에 들어가나요?', kw: '식비 간식비 식재료비 비급여 1인실 2인실 상급침실 이미용 별도',
      a: ['<p>아니요. <b>식재료비, 간식비, 1·2인실 추가 금액, 이·미용비</b>는 장기요양 급여가 아니라서 <b>전액 본인</b>이 내요.</p>',
          '<p><b>공단 지원이 없는 항목이라 센터·시설마다 금액이 달라요.</b> 계산기에는 점심·저녁 한 끼 ' + won(DATA.defaults.meal) + ', 간식 ' + won(DATA.defaults.snack) + '을 예시로 넣어 뒀으니, 이용하실 곳에 물어보고 고쳐 넣어 주세요.</p>'],
      go: { href: '#h-place', label: '식사 입력하러 가기' } },
    { cat: 'cost', q: '본인부담 감경은 누가 받나요?', kw: '감경 40% 60% 면제 의료급여 기초수급 건강보험료 저소득 환급 신청',
      a: ['<ul><li><b>감경 40%</b>: 본인부담이 집 ' + R.r40.home + '% · 요양원 ' + R.r40.fac + '%로 줄어요.</li>',
          '<li><b>감경 60%</b>: 집 ' + R.r60.home + '% · 요양원 ' + R.r60.fac + '%로 줄어요.</li>',
          '<li><b>의료급여 수급권자</b>: 본인부담이 없어요.</li></ul>',
          '<p>건강보험료 순위가 낮은 쪽(25% 이하는 60%, 25% 초과~50% 이하는 40%)이 대상이에요. 공단이 직접 적용해 주고, 보험료가 달라졌다면 관할 운영센터에 감경을 신청할 수 있어요. 인정되면 돌려받아요.</p>',
          '<p>감경은 <b>급여 본인부담에만</b> 적용돼요. 식재료비·간식비·방 추가 금액 같은 비급여 항목에는 감경이 없어요.</p>',
          '<p class="hint">대상 여부는 사람마다 달라서 공단(1577-1000)에 확인해 주세요. 잘 모르시면 계산기에서는 \'일반\'으로 두세요.</p>'],
      go: { href: '#h-info', label: '감경 고르러 가기' } },
    { cat: 'use', q: '주야간보호, 방문요양, 요양원은 어떻게 다른가요?', kw: '주간보호 데이케어 방문요양 요양원 시설 입소 차이 비교 입소기준 요양보호사 재가급여 시설급여',
      a: ['<p><b>재가급여</b>는 집에서 지내면서 받는 서비스이고, <b>시설급여</b>는 시설에 입소해서 받는 서비스예요.</p>',
          '<ul><li><b>주야간보호</b> (재가급여): 낮 동안 센터에 다니며 돌봄·식사·프로그램을 받고 저녁에는 집에 돌아와요.</li>',
          '<li><b>방문요양</b> (재가급여): 요양보호사가 집으로 와서 도와줘요.</li>',
          '<li><b>요양원</b> (시설급여): 시설에 들어가서 지내요.</li></ul>',
          '<p>재가급여는 <b>월 한도액</b> 안에서 이용하고 본인부담이 ' + R.general.home + '%예요. 시설급여는 월 한도액 없이 <b>하루 비용</b>으로 계산하고 본인부담이 ' + R.general.fac + '%예요.</p>',
          '<p><b>요양원 입소</b>는 1·2등급은 바로, 3~5등급은 등급판정위원회가 시설급여를 인정한 경우에 할 수 있어요.</p>',
          '<p class="hint">이 계산기는 인지지원등급의 방문요양·요양원은 계산하지 않아요. 이용할 수 있는지는 공단에 확인해 주세요.</p>'],
      go: { href: '#h-cmp', label: '세 가지 비용 비교 보기' } },
    { cat: 'use', q: '일요일·공휴일에 이용하면 비용이 더 드나요?', kw: '일요일 공휴일 가산 30% 50% 추가 요금 유급휴일 근로자의 날',
      a: ['<ul><li><b>주야간보호</b>: 일요일·공휴일은 하루 급여비용에 <b>' + S.dayHoliday + '%</b>가 더 붙어요.</li>',
          '<li><b>방문요양</b>: 일요일 <b>' + S.visitSun + '%</b>, 공휴일 <b>' + S.visitHoliday + '%</b>(근로기준법상 유급휴일·근로자의 날)가 더 붙어요. 일요일과 공휴일이 겹치면 더 높은 ' + S.visitHoliday + '%만 붙어요.</li></ul>',
          '<p>가산이 붙은 금액 전체가 <b>월 한도액에서 차감</b>돼요. 그래서 휴일 이용이 잦으면 본인부담이 늘고, 한 달에 이용할 수 있는 횟수도 줄 수 있어요.</p>',
          '<p class="hint">방문요양 가산 비율은 청구서나 공단(1577-1000)에서 한 번 더 확인해 주세요.</p>'],
      go: { href: '#h-place', label: '공휴일 날수 입력하러 가기' } },
    { cat: 'cost', q: '2027년 수가는 얼마나 달라지나요?', kw: '2027 내년 수가 인상 보험료율 의결 고시 한도액',
      a: ['<p>2026년 10월 장기요양위원회에서 <b>2027년 수가가 의결</b>됐어요. 재가 월 한도액은 1·2등급이 약 15%, 3~5등급이 약 4% 오르고, 장기요양보험료율은 0.9448%에서 <b>0.9994%</b>로 올라요.</p>',
          '<p>1·2등급은 한도액이 많이 올라서, 3시간 방문요양을 한 달에 받을 수 있는 횟수가 1등급 44회 → 48회, 2등급 40회 → 45회로 늘어나요.</p>',
          '<p class="hint">보건복지부 고시로 공포되기 전이라 달라질 수 있어요. 이 계산기의 기본 계산은 2026년 고시 기준이고, 내정보 화면에서 2027년 의결안으로 비교해 볼 수 있어요.</p>'],
      go: { href: '#y2027', label: '2027년 미리보기 보기' } }
  ];
}

var QA = { items: [], cat: 'all', q: '' };
function qaNorm(s) { return String(s).toLowerCase().replace(/\s+/g, ''); }
function qaEsc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function qaMark(root, tokens) {
  if (!tokens.length) return;
  var re = new RegExp('(' + tokens.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi');
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(function (node) {
    if (!re.test(node.nodeValue)) { re.lastIndex = 0; return; }
    re.lastIndex = 0;
    var span = document.createElement('span');
    span.innerHTML = qaEsc(node.nodeValue).replace(new RegExp('(' + tokens.map(function (t) { return qaEsc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi'), '<mark>$1</mark>');
    node.parentNode.replaceChild(span, node);
  });
}
function qaBuild() {
  var data = qaData(), list = $('#qaList');
  QA.items = data.map(function (d, i) {
    var el = document.createElement('details');
    el.className = 'qa-item'; el.id = 'qa-' + (i + 1); el.dataset.cat = d.cat;
    el.innerHTML = '<summary><span class="qa-main"><span class="qa-tag">' + QA_TAG[d.cat] + '</span><span class="qa-q">' + d.q + '</span></span></summary><div class="qa-a">' + d.a.join('') +
      (d.go ? '<a class="qa-go" href="' + d.go.href + '">' + d.go.label + '<svg class="ic" aria-hidden="true"><use href="#i-right"/></svg></a>' : '') + '</div>';
    el.addEventListener('toggle', function () {
      if (el.open) QA.items.forEach(function (o) { if (o.el !== el && o.el.open) o.el.open = false; });
    });
    list.appendChild(el);
    return { el: el, cat: d.cat, text: qaNorm(d.q + ' ' + d.a.join(' ').replace(/<[^>]+>/g, ' ') + ' ' + d.kw),
      qHtml: el.querySelector('.qa-q').innerHTML, aHtml: el.querySelector('.qa-a').innerHTML };
  });
  $('#qaCats').innerHTML = QA_CATS.map(function (c) {
    var n = c.k === 'all' ? QA.items.length : QA.items.filter(function (it) { return it.cat === c.k; }).length;
    return '<button type="button" class="qa-cat" data-k="' + c.k + '" aria-pressed="' + (c.k === 'all') + '">' + c.t + ' <small>' + n + '</small></button>';
  }).join('');
}
function qaFilter() {
  var tokens = QA.q.split(/\s+/).filter(Boolean), shown = 0, last = null;
  QA.items.forEach(function (it) {
    var okCat = QA.cat === 'all' || it.cat === QA.cat;
    var okQ = tokens.every(function (t) { return it.text.indexOf(qaNorm(t)) >= 0; });
    var ok = okCat && okQ;
    it.el.hidden = !ok;
    var qEl = it.el.querySelector('.qa-q'), aEl = it.el.querySelector('.qa-a');
    qEl.innerHTML = it.qHtml; aEl.innerHTML = it.aHtml;
    if (ok) { shown++; last = it; if (tokens.length) { qaMark(qEl, tokens); qaMark(aEl, tokens); } }
    else if (it.el.open) it.el.open = false;
  });
  if (tokens.length && shown === 1 && last) last.el.open = true;
  $('#qaEmpty').hidden = shown > 0;
  $('#qaCount').textContent = tokens.length || QA.cat !== 'all' ? QA.items.length + '개 중 ' + shown + '개를 찾았어요.' : '';
  $('#qaClear').hidden = !QA.q;
  $$('#qaQuick .kw').forEach(function (b) { b.classList.toggle('on', b.dataset.w === QA.q); });
  $$('.qa-cat').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.k === QA.cat ? 'true' : 'false'); });
}
function qaOpenHash() {
  var m = /^#qa-(\d+)$/.exec(location.hash);
  if (!m) return;
  var it = QA.items[Number(m[1]) - 1];
  if (!it) return;
  QA.cat = 'all'; QA.q = ''; $('#qaSearch').value = ''; qaFilter();
  it.el.open = true; it.el.scrollIntoView({ block: 'start' });
}
function initQA() {
  qaBuild(); qaFilter();
  $('#qaQuick').innerHTML = QA_WORDS.map(function (w) { return '<button type="button" class="kw" data-w="' + w + '">' + w + '</button>'; }).join('');
  $('#qaQuick').addEventListener('click', function (e) {
    var b = e.target.closest('.kw'); if (!b) return;
    QA.q = QA.q === b.dataset.w ? '' : b.dataset.w; $('#qaSearch').value = QA.q; qaFilter();
  });
  $('#qaSearch').addEventListener('input', function (e) { QA.q = e.target.value; qaFilter(); });
  $('#qaClear').addEventListener('click', function () { QA.q = ''; $('#qaSearch').value = ''; qaFilter(); $('#qaSearch').focus(); });
  $('#qaReset').addEventListener('click', function () { QA.q = ''; QA.cat = 'all'; $('#qaSearch').value = ''; qaFilter(); });
  $('#qaCats').addEventListener('click', function (e) {
    var b = e.target.closest('.qa-cat'); if (!b) return;
    QA.cat = b.dataset.k; qaFilter();
  });
}

/* =========================================================
   홈 화면 앱(PWA): 서비스 워커 등록 + 설치 안내
   ========================================================= */
function initPWA() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (standalone) return;                                   // 이미 앱으로 열었으면 안내 안 함
  var box = $('#installBox'), btn = $('#installBtn'), hint = $('#installHint');
  var ua = navigator.userAgent || '';
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    box.hidden = false; btn.hidden = false;
  });
  btn.addEventListener('click', function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function () { deferred = null; btn.hidden = true; box.hidden = true; });
  });
  window.addEventListener('appinstalled', function () { box.hidden = true; toast('홈 화면에 추가했어요.'); });
  if (/KAKAOTALK/i.test(ua)) {
    box.hidden = false; hint.hidden = false;
    hint.textContent = '카카오톡 안에서는 홈 화면 추가가 안 돼요. 크롬이나 사파리로 다시 열어 주세요.';
  } else if (/iPad|iPhone|iPod/.test(ua)) {
    box.hidden = false; hint.hidden = false;
    hint.textContent = '아이폰은 사파리 아래의 공유 버튼을 누르고 \'홈 화면에 추가\'를 고르면 앱처럼 쓸 수 있어요.';
  }
}

/* ---------- 시작 ---------- */
function init() {
  if (BLOG_URL) { var bb = $('#blogBtn'); bb.href = BLOG_URL; bb.hidden = false; }
  initQA();
  initPWA();
  buildLists();
  bindInputs(); bindTabs(); bindWizard(); bindMusic();
  $('#kakaoBtn').addEventListener('click', sendKakao);
  $('#stickyKakao').addEventListener('click', sendKakao);
  $('#resetBtn').addEventListener('click', resetAll);
  var rb2 = $('#resetBtn2'); if (rb2) rb2.addEventListener('click', resetAll);
  update({ anim: false });
  redrawCircle();
  initRouter();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPages);
  window.addEventListener('load', fitPages);
}
init();
window.LTC = { DATA: DATA, state: state, calc: calc, defaultState: defaultState, autoVisit: autoVisit };
})();
