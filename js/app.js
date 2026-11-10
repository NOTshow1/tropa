import { parseMessage, parseShortAnswer, INTERESTS } from './parser.js';
import { buildPlan, swapItem, nearby, KIND_RU, SLOT_RU, distM, DEFAULT_INTERESTS } from './planner.js';
import { loadRates, convert, fmt, CITY_PRICES } from './prices.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SUPPORTED = { tokyo: { name: 'Токио', en: 'Tokyo', center: [35.6895, 139.73] } };

// ---------------- состояние ----------------
const blank = () => ({ trip: {}, expecting: null, plan: null, msgs: [], seed: 1 });
let S = JSON.parse(localStorage.getItem('state') || 'null') || blank();
const save = () => localStorage.setItem('state', JSON.stringify(S));
const cityCache = {};
async function loadCity(id) {
  if (!cityCache[id]) cityCache[id] = await (await fetch(`data/${id}.json`)).json();
  return cityCache[id];
}

// ---------------- вкладки ----------------
let currentTab = 'chat';
function showTab(t) {
  currentTab = t;
  document.querySelectorAll('.tab').forEach(e => e.classList.toggle('active', e.id === 'tab-' + t));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  if (t === 'near') openNear();
  if (t === 'plan') renderPlan();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---------------- чат ----------------
function addMsg(who, html, opts = {}) {
  const m = { who, html, ...opts };
  S.msgs.push(m); if (S.msgs.length > 80) S.msgs.splice(0, S.msgs.length - 80);
  drawMsg(m); save();
}
function drawMsg(m) {
  const el = document.createElement('div');
  el.className = 'msg ' + m.who;
  el.innerHTML = m.html;
  if (m.planBtn) {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Открыть план по дням';
    b.onclick = () => showTab('plan'); el.appendChild(b);
  }
  $('#messages').appendChild(el);
  $('#messages').scrollTop = 1e9;
}
function setChips(list) {
  const c = $('#chips'); c.innerHTML = '';
  for (const t of list) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = t;
    b.onclick = () => handleUser(t); c.appendChild(b);
  }
}

const EXAMPLE = 'Я в Токио на 4 дня, 150$ в день, жилья нет. Люблю рамен, странные бары и винтаж';
function greet() {
  addMsg('bot', 'Привет! Расскажи своими словами: <b>где ты</b>, <b>на сколько дней</b>, <b>какой бюджет</b> и <b>есть ли жильё</b>. Можно добавить, что любишь.\n\nНапример: «' + EXAMPLE + '»');
  setChips([EXAMPLE, 'Я в Токио, есть 10 000 ¥ на день', 'Что интересного рядом?']);
}

function interestsText(list) { return list.map(i => INTERESTS[i]?.label).filter(Boolean).join(', '); }

async function handleUser(text) {
  text = text.trim(); if (!text) return;
  addMsg('me', esc(text));
  $('#input').value = ''; autoGrow();
  const t = text.toLowerCase();

  if (/рядом|поблизости|вокруг меня|что тут|near me/.test(t) && !/дн|бюдж|\$|¥|руб/.test(t)) {
    addMsg('bot', 'Открываю места рядом с тобой — только не самые попсовые.');
    showTab('near'); return;
  }

  // команды после готового плана
  if (S.plan) {
    if (/друг(ой|ие) вариант|ещ[её] вариант|перегенер|не нравится|по-другому/.test(t)) { S.seed++; return makePlan('Вот другой вариант — те же правила, другие места.'); }
    if (/дешевле|экономн|сэконом|поменьше трат/.test(t)) { S.trip.budgetFactor = (S.trip.budgetFactor || 1) * 0.85; S.seed++; return makePlan('Ужал план примерно на 15%.'); }
    if (/дороже|кайфан|не экономь|пошикар/.test(t)) { S.trip.budgetFactor = Math.min(1, (S.trip.budgetFactor || 1) / 0.85); S.trip.style = 'comfort'; S.seed++; return makePlan('Сделал план пощедрее, но в рамках бюджета.'); }
    if (/это (всего|на вс)|на всю поездку|за всю поездку/.test(t) && !/\d/.test(t)) { S.trip.budget.per = 'total'; return makePlan('Понял, это бюджет на всю поездку — поделил по дням.'); }
    if (/это (в|на) день/.test(t) && !/\d/.test(t)) { S.trip.budget.per = 'day'; return makePlan('Ок, бюджет на день.'); }
    if (/(добав|ещ[её])\s*(один )?день/.test(t) && !/\d/.test(t)) { S.trip.days = Math.min(21, (S.trip.days || 1) + 1); return makePlan('Добавил день.'); }
  }

  // разбор
  let p = parseMessage(text);
  if (S.expecting && !Object.keys(p).some(k => k === S.expecting)) Object.assign(p, parseShortAnswer(text, S.expecting));
  const tr = S.trip;
  if (p.city) {
    if (!SUPPORTED[p.city]) {
      addMsg('bot', 'Этот город я пока не знаю подробно 🙏 Сейчас база собрана для <b>Токио</b>, Питер — следующий. Давай пока Токио?');
      setChips(['Да, Токио']); S.expecting = 'city'; save(); return;
    }
    tr.city = p.city;
  }
  if (S.expecting === 'city' && /^да/.test(t)) tr.city = 'tokyo';
  if (p.days) tr.days = p.days;
  if (p.budget) { tr.budget = p.budget; tr.budgetFactor = 1; }
  if (p.lodging) tr.lodging = p.lodging;
  if (p.cuisine) tr.cuisine = [...new Set([...(tr.cuisine || []), ...p.cuisine])];
  if (p.style) tr.style = p.style;
  if (p.noAlcohol) tr.noAlcohol = true;
  if (p.interests) {
    tr.interests = /только/.test(t) || !tr.interests ? p.interests : [...new Set([...tr.interests, ...p.interests])];
  }
  if (p.useGeo && !tr.city) await tryGeoCity();
  save();
  await nextStep(p);
}

async function tryGeoCity() {
  const pos = await getPos().catch(() => null);
  if (!pos) return false;
  for (const [id, c] of Object.entries(SUPPORTED)) {
    if (distM(pos[0], pos[1], c.center[0], c.center[1]) < 40000) { S.trip.city = id; S.trip.here = pos; return true; }
  }
  return false;
}

async function nextStep(p = {}) {
  const tr = S.trip;
  if (!tr.city) {
    S.expecting = 'city';
    const got = await tryGeoCity();
    if (!got) {
      addMsg('bot', 'В каком ты городе? Подробная база пока есть для <b>Токио</b>.');
      setChips(['Токио']); save(); return;
    }
    addMsg('bot', 'Вижу по геолокации, что ты в Токио 👌');
  }
  if (!tr.days) {
    S.expecting = 'days';
    addMsg('bot', 'На сколько дней?'); setChips(['1 день', '2 дня', '3 дня', '4 дня', 'Неделя']); save(); return;
  }
  if (!tr.budget) {
    S.expecting = 'budget';
    addMsg('bot', 'Какой бюджет на день? Можно в долларах, рублях или йенах.');
    setChips(['$50 в день', '$100 в день', '$150 в день', '15 000 ¥ в день', '10 000 ₽ в день']); save(); return;
  }
  if (!tr.lodging) {
    S.expecting = 'lodging';
    addMsg('bot', 'Жильё уже есть или подобрать?'); setChips(['Жилья нет — подбери', 'Жильё уже есть']); save(); return;
  }
  S.expecting = null;
  // понятные допущения
  const notes = [];
  const b = tr.budget;
  if (!b.currency) {
    b.currency = b.amount >= 3000 ? (b.amount >= 20000 && b.amount < 60000 ? 'RUB' : 'JPY') : 'USD';
    notes.push(`Валюту не указал — считаю, что это ${b.currency === 'USD' ? 'доллары' : b.currency === 'RUB' ? 'рубли' : 'йены'}.`);
  }
  if (!b.per) { b.per = 'day'; if (tr.days > 1 && !p.budget?.per) notes.push('Считаю бюджет на день. Если это на всю поездку — напиши «это всего».'); }
  if (/это всего|на всю поездку/.test(S.msgs.at(-1)?.html || '')) b.per = 'total';
  await makePlan(notes.join('\n'));
}

async function makePlan(prefix = '') {
  const tr = S.trip;
  const city = await loadCity(tr.city);
  const cur = CITY_PRICES[tr.city].currency;
  const perDay = tr.budget.per === 'total' ? tr.budget.amount / tr.days : tr.budget.amount;
  const local = convert(perDay, tr.budget.currency, cur) * (tr.budgetFactor || 1);
  S.plan = buildPlan(city, { ...tr, budgetLocal: local }, S.seed);
  S.plan.userCur = tr.budget.currency;
  const pl = S.plan;
  const u = v => tr.budget.currency !== cur ? ` <span class="muted">(${fmt(convert(v, cur, tr.budget.currency), tr.budget.currency)})</span>` : '';
  const lines = [];
  if (prefix) lines.push(prefix + '\n');
  lines.push(`<b>${SUPPORTED[tr.city].name}, ${tr.days} ${plural(tr.days, 'день', 'дня', 'дней')}</b> · бюджет ${fmt(local, cur)}${u(local)} в день`);
  const rows = [];
  if (pl.stay) rows.push(['Жильё', `${pl.stay.label} ≈ ${fmt(pl.stay.price, cur)}/ночь`]);
  rows.push(['Еда', `завтрак — ${pl.tiers.breakfast}, обед — ${pl.tiers.lunch}, ужин — ${pl.tiers.dinner}${pl.meals.bar ? ', вечером бар' : ''}`]);
  rows.push(['Районы', pl.days.map((d, i) => `${i + 1}) ${d.district}`).join(', ')]);
  rows.push(['В среднем', `≈ ${fmt(pl.avgDay, cur)}${u(pl.avgDay)} в день`]);
  let html = lines.join('\n') + '<div class="plan-mini">' + rows.map(r => `<div class="row"><span class="muted">${r[0]}</span><span>${r[1]}</span></div>`).join('') + '</div>';
  if (pl.warnings.length) html += '\n⚠️ ' + pl.warnings.join('\n⚠️ ');
  if (!tr.interests) html += '\n\nМожешь сказать, что любишь — например «аниме и бани» или «только кофе и виды», — и я пересоберу.';
  addMsg('bot', html, { planBtn: true });
  setChips(['Другой вариант', 'Дешевле', 'Больше необычного', 'Добавь бары', 'Аниме и игры', 'Храмы и сады', 'Без алкоголя', 'Добавь день']);
  save();
  if (currentTab === 'plan') renderPlan();
}
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };

// ---------------- ссылки ----------------
const appleMaps = p => `https://maps.apple.com/?q=${encodeURIComponent(p.o || p.n)}&ll=${p.la},${p.lo}`;
const gMaps = p => `https://www.google.com/maps/search/?api=1&query=${p.la},${p.lo}`;
const ymd = d => d.toISOString().slice(0, 10);
function bookingLinks(cityEn, days, q) {
  const ci = new Date(), co = new Date(Date.now() + Math.max(1, days - 1) * 864e5);
  const ss = encodeURIComponent(q || cityEn);
  return [
    ['Booking', `https://www.booking.com/searchresults.html?ss=${ss}&checkin=${ymd(ci)}&checkout=${ymd(co)}&group_adults=1&no_rooms=1&order=price`],
    ['Hostelworld', `https://www.hostelworld.com/st/hostels/asia/japan/${cityEn.toLowerCase()}/`],
    ['Airbnb', `https://www.airbnb.com/s/${encodeURIComponent(cityEn)}/homes?checkin=${ymd(ci)}&checkout=${ymd(co)}&adults=1`],
  ];
}

// ---------------- план ----------------
const maps = {};
function placeHtml(p, extra = '') {
  if (!p) return '<div class="pname muted">на твой выбор по пути</div>';
  const kind = KIND_RU[p.k] || p.k;
  const badge = p.f ? '<span class="badge famous">классика</span>' : p.s >= 1.5 ? '<span class="badge niche">нишевое</span>' : '';
  return `<div class="pname"><a href="${appleMaps(p)}" target="_blank">${esc(p.n)}</a>${badge}</div>
    ${p.o ? `<div class="porig">${esc(p.o)}</div>` : ''}
    <div class="pkind">${esc(kind)}${p.cu ? ' · ' + esc(p.cu) : ''}${p.h ? ' · <span title="часы работы">🕒 ' + esc(p.h.length > 30 ? p.h.slice(0, 30) + '…' : p.h) + '</span>' : ''}</div>${extra}`;
}

function renderPlan() {
  const box = $('#plan');
  const pl = S.plan;
  if (!pl) { box.innerHTML = '<div class="empty">Плана пока нет. Расскажи в чате, куда едешь и сколько готов тратить.</div>'; return; }
  const tr = S.trip, cur = pl.currency, uc = pl.userCur;
  const u = v => uc !== cur ? ` · ${fmt(convert(v, cur, uc), uc)}` : '';
  const pct = Math.min(100, pl.avgDay / pl.budgetDay * 100);
  let h = `<div class="summary"><h2>${SUPPORTED[pl.city].name} · ${tr.days} ${plural(tr.days, 'день', 'дня', 'дней')}</h2>
    <div class="muted">В среднем ≈ <b>${fmt(pl.avgDay, cur)}</b>${u(pl.avgDay)} из ${fmt(pl.budgetDay, cur)}${u(pl.budgetDay)} в день</div>
    <div class="meter ${pl.avgDay > pl.budgetDay ? 'over' : ''}"><i style="width:${pct}%"></i></div>
    ${pl.budgetDay - pl.avgDay > 500 ? `<div class="split"><span class="ok">Запас ≈ ${fmt(pl.budgetDay - pl.avgDay, cur)}${u(pl.budgetDay - pl.avgDay)} в день — на сувениры, такси и спонтанное</span></div>` : ''}
    <div class="split"><span>Интересы: ${esc(interestsText(pl.interests))}${tr.interests ? '' : ' (по умолчанию)'}</span></div>
    <div class="split" style="margin-top:4px"><span>Цены — средние оценки, «≈». Места из OpenStreetMap.</span></div></div>`;
  for (const w of pl.warnings) h += `<div class="warn">⚠️ ${esc(w)}</div>`;

  if (pl.stay) {
    const en = SUPPORTED[pl.city].en;
    h += `<div class="card"><h3>🛏 Жильё <small>${esc(pl.stay.label)} ≈ ${fmt(pl.stay.price, cur)}${u(pl.stay.price)}/ночь</small></h3>`;
    for (const p of pl.stayOptions) {
      h += `<div class="stay-opt">${placeHtml(p)}<div class="acts">
        <a href="https://www.booking.com/searchresults.html?ss=${encodeURIComponent((p.o || p.n) + ' ' + en)}" target="_blank">Цены на Booking</a>
        <a href="${gMaps(p)}" target="_blank">Google Maps</a>${p.w ? `<a href="${esc(p.w)}" target="_blank">Сайт</a>` : ''}</div></div>`;
    }
    h += `<div class="links"><span class="muted" style="width:100%;font-size:13px">Или поиск по городу с датами:</span>${bookingLinks(en, tr.days).map(([n, l]) => `<a href="${l}" target="_blank">${n}</a>`).join('')}</div></div>`;
  }

  pl.days.forEach((d, di) => {
    const over = d.total > pl.budgetDay;
    h += `<div class="card"><h3 class="day-head" data-day="${di}">День ${di + 1} · ${esc(d.district)} <small class="${over ? 'bad' : 'ok'}">≈ ${fmt(d.total, cur)}</small></h3>
      <div class="day-body ${di === 0 ? '' : 'collapsed'}" id="day-${di}"><div class="day-map" id="map-${di}"></div>`;
    let n = 0;
    d.items.forEach((it, ii) => {
      if (it.p) n++;
      const actions = `<div class="acts">
        <button data-swap="${di},${ii},other">↻ другое</button>
        ${['breakfast', 'lunch', 'dinner'].includes(it.slot) || it.cost > 0 ? `<button data-swap="${di},${ii},cheaper">дешевле</button>` : ''}
        <button data-swap="${di},${ii},pricier">дороже</button>
        ${it.p ? `<a href="${gMaps(it.p)}" target="_blank">Google</a>` : ''}${it.p?.w ? `<a href="${esc(it.p.w)}" target="_blank">Сайт</a>` : ''}</div>`;
      h += `<div class="item"><div class="slot">${it.p ? `<span class="num">${n}</span><br>` : ''}${SLOT_RU[it.slot]}</div>
        <div>${placeHtml(it.p, it.note ? `<div class="pnote">${esc(it.note)}</div>` : '')}</div>
        <div class="cost">${it.cost ? '≈ ' + fmt(it.cost, cur) : 'бесплатно'}${it.cost && uc !== cur ? `<small>${fmt(convert(it.cost, cur, uc), uc)}</small>` : ''}</div>${actions}</div>`;
    });
    h += `<div class="day-total"><span class="muted">Транспорт ≈ ${fmt(d.transport, cur)}${d.stayCost ? ` · жильё ≈ ${fmt(d.stayCost, cur)}` : ''}</span><b class="${over ? 'bad' : 'ok'}">${fmt(d.total, cur)}${u(d.total)}</b></div></div></div>`;
  });
  box.innerHTML = h;

  box.querySelectorAll('.day-head').forEach(e => e.onclick = () => {
    const b = $('#day-' + e.dataset.day); b.classList.toggle('collapsed');
    if (!b.classList.contains('collapsed')) drawDayMap(+e.dataset.day);
  });
  box.querySelectorAll('[data-swap]').forEach(b => b.onclick = async () => {
    const [di, ii, mode] = b.dataset.swap.split(',');
    const city = await loadCity(pl.city);
    S.seed++;
    const ok = swapItem(city, pl, +di, +ii, mode, S.seed);
    if (!ok) { b.textContent = 'нет вариантов'; return; }
    save(); const y = box.scrollTop; renderPlan(); box.scrollTop = y;
    $('#day-' + di).classList.remove('collapsed'); drawDayMap(+di);
  });
  pl.days.forEach((_, di) => { if (!$('#day-' + di).classList.contains('collapsed')) drawDayMap(di); });
}

function pinIcon(text, cls = '') { return L.divIcon({ className: '', html: `<div class="pin ${cls}">${text}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }); }
function baseMap(el, center, zoom = 15) {
  const m = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  return m;
}
function drawDayMap(di) {
  if (typeof L === 'undefined') return;
  const el = $('#map-' + di); if (!el) return;
  if (maps['d' + di]) { maps['d' + di].remove(); }
  const d = S.plan.days[di];
  const pts = d.items.filter(x => x.p).map(x => [x.p.la, x.p.lo]);
  if (!pts.length) return;
  const m = baseMap(el, pts[0]);
  pts.forEach((pt, i) => L.marker(pt, { icon: pinIcon(i + 1) }).addTo(m));
  L.polyline(pts, { color: '#ff6b4a', weight: 3, opacity: .7, dashArray: '6 6' }).addTo(m);
  if (S.plan.stayOptions?.[0]) { const s = S.plan.stayOptions[0]; L.marker([s.la, s.lo], { icon: pinIcon('⌂', 'stay') }).addTo(m); }
  m.fitBounds(pts, { padding: [24, 24] });
  maps['d' + di] = m;
}

// ---------------- рядом ----------------
function getPos() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no geo'));
    const t = setTimeout(() => rej(new Error('geo timeout')), 12000); // если диалог разрешения висит
    const ok = res, bad = rej; res = v => { clearTimeout(t); ok(v); }; rej = e => { clearTimeout(t); bad(e); };
    navigator.geolocation.getCurrentPosition(p => res([p.coords.latitude, p.coords.longitude]), rej, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}
const NEAR_FILTERS = [
  ['Всё', null], ['Еда', ['food']], ['Кофе', ['cafe']], ['Бары', ['bar', 'night']], ['Смотреть', ['sight', 'culture']], ['Магазины', ['shop']],
];
let nearFilter = 0, nearPos = null, nearMap = null;
async function openNear() {
  const st = $('#nearStatus');
  const fl = $('#nearFilters');
  fl.innerHTML = NEAR_FILTERS.map((f, i) => `<button class="chip ${i === nearFilter ? 'on' : ''}" data-f="${i}">${f[0]}</button>`).join('');
  fl.querySelectorAll('button').forEach(b => b.onclick = () => { nearFilter = +b.dataset.f; openNear(); });
  const cityId = S.trip.city || 'tokyo';
  const city = await loadCity(cityId);
  if (!nearPos) {
    st.textContent = 'Ищу, где ты…';
    try { nearPos = await getPos(); } catch { nearPos = null; }
  }
  let pos = nearPos, note = '';
  if (!pos || distM(pos[0], pos[1], city.center[0], city.center[1]) > 40000) {
    pos = city.districts[0].c;
    note = !nearPos ? 'Геолокация недоступна — показываю от Синдзюку.' : 'Ты не в Токио — показываю как будто ты у станции Синдзюку.';
  }
  const list = nearby(city, pos, { radius: 1500, groups: NEAR_FILTERS[nearFilter][1], interests: S.trip.interests || DEFAULT_INTERESTS });
  st.innerHTML = (note ? esc(note) + '<br>' : '') + `<b>${list.length}</b> мест в 15–20 минутах пешком, сначала нишевые`;
  const cur = CITY_PRICES[cityId].currency;
  $('#nearList').innerHTML = list.map(({ p, m }) => `<div class="item"><div>${placeHtml(p)}</div>
    <div class="cost">${Math.round(m / 80)} мин<small>${m < 1000 ? Math.round(m) + ' м' : (m / 1000).toFixed(1) + ' км'}</small>${p.p ? `<small>≈ ${fmt(p.p, cur)}</small>` : ''}</div>
    <div class="acts"><a href="${appleMaps(p)}" target="_blank">Маршрут</a><a href="${gMaps(p)}" target="_blank">Google</a>${p.w ? `<a href="${esc(p.w)}" target="_blank">Сайт</a>` : ''}</div></div>`).join('')
    || '<div class="empty">Рядом ничего не нашлось</div>';
  if (typeof L !== 'undefined') {
    if (nearMap) nearMap.remove();
    nearMap = baseMap($('#nearMap'), pos, 15);
    L.marker(pos, { icon: pinIcon('•', 'me') }).addTo(nearMap);
    list.slice(0, 30).forEach(({ p }, i) => L.marker([p.la, p.lo], { icon: pinIcon(i + 1) }).addTo(nearMap).bindPopup(esc(p.n)));
  }
}

// ---------------- ввод ----------------
const input = $('#input');
function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; }
input.addEventListener('input', autoGrow);
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleUser(input.value); } });
$('#composer').onsubmit = e => { e.preventDefault(); handleUser(input.value); };

// голосовой ввод (Safari iOS 14.5+). Если нет — кнопка скрывается, остаётся диктовка клавиатуры.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('#micBtn').style.display = 'none';
else {
  let rec = null;
  $('#micBtn').onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = false;
    $('#micBtn').classList.add('rec');
    rec.onresult = e => { input.value = [...e.results].map(r => r[0].transcript).join(' '); autoGrow(); };
    rec.onend = () => { $('#micBtn').classList.remove('rec'); rec = null; if (input.value.trim()) handleUser(input.value); };
    rec.onerror = () => { $('#micBtn').classList.remove('rec'); rec = null; };
    rec.start();
  };
}

$('#resetBtn').onclick = () => { S = blank(); save(); $('#messages').innerHTML = ''; renderPlan(); greet(); showTab('chat'); };

// ---------------- старт ----------------
loadRates();
if (S.msgs.length) { S.msgs.forEach(drawMsg); if (S.plan) setChips(['Другой вариант', 'Дешевле', 'Больше необычного', 'Добавь бары', 'Добавь день']); }
else greet();
$('#cityTag').textContent = '· Токио';
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
