import { parseMessage, parseShortAnswer, INTERESTS } from './parser.js';
import { buildPlan, swapItem, KIND_RU, SLOT_RU, distM, DEFAULT_INTERESTS } from './planner.js';
import { loadRates, convert, fmt, CITY_PRICES } from './prices.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SUPPORTED = { tokyo: { name: 'Токио', en: 'Tokyo', center: [35.6895, 139.73] } };

// ---------------- категории: эмодзи и цвет ----------------
const GROUP_COLOR = { food: '#ff8a3d', cafe: '#f5b941', bar: '#b77cff', night: '#f472b6', culture: '#5b9dff', sight: '#2fcf8f', shop: '#22c7e0', stay: '#8b6cff' };
const KIND_EMOJI = {
  restaurant: '🍜', fast_food: '🍙', food_court: '🍱', izakaya: '🏮', cafe: '☕', kissaten: '☕', bakery: '🥐', confectionery: '🍡', ice_cream: '🍦',
  bar: '🍸', pub: '🍶', jazz_bar: '🎷', standing_bar: '🍶', brewery: '🍺', nightclub: '🪩', sento: '♨️', museum: '🏛️', gallery: '🎨', arts_centre: '🎨',
  theatre: '🎭', cinema: '🎬', viewpoint: '🌆', artwork: '🗿', shrine: '⛩️', temple: '🛕', garden: '🌸', park: '🌳', attraction: '📍', historic: '🏯',
  vintage: '👕', records: '💿', used_books: '📚', books: '📚', antiques: '🏺', otaku: '🎮', coffee: '🫘', tea: '🍵',
  hostel: '🛏️', capsule: '🛏️', guest_house: '🏠', apartment: '🏢', hotel: '🏨', hotel_mid: '🏨',
};
const CUISINE_EMOJI = [['рамен', '🍜'], ['суши', '🍣'], ['якитори', '🍢'], ['удон', '🍜'], ['соба', '🍜'], ['карри', '🍛'], ['тонкацу', '🍖'], ['якинику', '🥩'],
  ['пицца', '🍕'], ['бургеры', '🍔'], ['окономияки', '🥞'], ['гёдза', '🥟'], ['темпура', '🍤'], ['морепродукты', '🦐'], ['итальянская', '🍝'], ['китайская', '🥡'], ['корейская', '🥘'], ['индийская', '🍛']];
const emo = p => { if (p.g === 'food' && p.cu) for (const [c, e] of CUISINE_EMOJI) if (p.cu.includes(c)) return e; return KIND_EMOJI[p.k] || '📍'; };
const color = p => GROUP_COLOR[p.g] || '#888';
const tileBg = p => `background:${color(p)}26;color:${color(p)}`;

// ---------------- состояние ----------------
// S.plans — по плану на каждого участника (если «каждый своё»), иначе один общий; S.plan — тот, что сейчас открыт
const blank = () => ({ trip: {}, expecting: null, plan: null, plans: [], who: 0, msgs: [], seed: 1, day: 0 });
let S = JSON.parse(localStorage.getItem('state') || 'null') || blank();
S.day ||= 0;
if (!S.plans) S.plans = S.plan ? [S.plan] : [];
S.who = Math.min(S.who || 0, Math.max(0, S.plans.length - 1));
S.plan = S.plans[S.who] || null;
const save = () => localStorage.setItem('state', JSON.stringify({ ...S, plan: undefined }));
const cityCache = {};
async function loadCity(id) {
  if (!cityCache[id]) cityCache[id] = await (await fetch(`data/${id}.json`)).json();
  return cityCache[id];
}
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
const daysTxt = n => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const pplTxt = n => `${n} ${plural(n, 'человек', 'человека', 'человек')}`;

// ---------------- группа ----------------
const BMODE_RU = { each: 'у каждого свой бюджет', mine: 'считаю только мой', shared: 'общий бюджет на всех' };
function groupOf(tr) {
  const N = tr.people || 1;
  tr.members ||= [];
  while (tr.members.length < N) tr.members.push({ name: tr.members.length ? `Друг ${tr.members.length}` : 'Я', budget: null, interests: null });
  tr.members.length = N;
  return { N, mode: N > 1 ? (tr.budgetMode || 'each') : 'mine', separate: N > 1 && tr.placesMode === 'separate' };
}
const otherIds = () => S.plans.filter(p => p !== S.plan).flatMap(p => p.days.flatMap(d => d.items.map(x => x.p?.i))).filter(Boolean);
const stayLine = (st, cur, N = 1) => {
  const pp = st.pp ?? st.price;
  if (N <= 1) return `${esc(st.label)} · ≈ ${fmt(pp, cur)}/ночь`;
  const unit = st.cap > 1 ? `${st.units} ${st.kind === 'apartment' ? plural(st.units, 'квартира', 'квартиры', 'квартир') : plural(st.units, 'номер', 'номера', 'номеров')} до ${st.cap} чел.` : `${N} ${plural(N, 'кровать', 'кровати', 'кроватей')}`;
  return `${esc(st.label)} · ${unit} · ≈ ${fmt(pp, cur)}/ночь с человека`;
};

// ---------------- вкладки ----------------
let currentTab = 'chat';
function showTab(t) {
  currentTab = t;
  document.querySelectorAll('.tab').forEach(e => e.classList.toggle('active', e.id === 'tab-' + t));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  if (t === 'plan') renderPlan();
  if (t === 'map') openMap();
}
document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---------------- нижний лист ----------------
function openSheet(html, bind) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.add('on'); $('#sheetBack').classList.add('on'); document.body.classList.add('sheet-open');
  $('#sheet').scrollTop = 0;
  bind?.($('#sheetBody'));
}
function closeSheet() { $('#sheet').classList.remove('on'); $('#sheetBack').classList.remove('on'); document.body.classList.remove('sheet-open'); }
$('#sheetBack').onclick = closeSheet;
// свайп вниз закрывает
{ let y0 = null; const sh = $('#sheet');
  sh.addEventListener('touchstart', e => { y0 = sh.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; sh.style.transform = ''; if (dy > 90) closeSheet(); y0 = null; }); }

const appleMaps = p => `https://maps.apple.com/?q=${encodeURIComponent(p.o || p.n)}&ll=${p.la},${p.lo}`;
const gMaps = p => `https://www.google.com/maps/search/?api=1&query=${p.la},${p.lo}`;

// ---------- фото ----------
// Бесплатно и легально: фото из статьи Википедии (если у места в OSM есть статья). Для остальных — обложка + кнопка в Google Maps.
const photoCache = {};
async function wikiPhotos(wp) {
  if (photoCache[wp]) return photoCache[wp];
  const i = wp.indexOf(':'); const lang = wp.slice(0, i), title = wp.slice(i + 1);
  const out = [];
  try {
    const sum = await (await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)).json().catch(() => ({}));
    const lead = decodeURIComponent((sum.originalimage?.source || '').split('/').pop() || '').replace(/_/g, ' ');
    const api = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&titles=${encodeURIComponent(title)}&generator=images&gimlimit=30&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=640`;
    const j = await (await fetch(api)).json();
    for (const pg of Object.values(j.query?.pages || {})) {
      const ii = pg.imageinfo?.[0];
      if (!ii || ii.mime !== 'image/jpeg' || ii.width < 400 || /logo|map|plan|icon|flag|location|locator/i.test(pg.title)) continue;
      const item = { src: ii.thumburl, page: ii.descriptionurl };
      if (lead && pg.title.replace(/^[^:]+:/, '') === lead) out.unshift(item); else out.push(item);
    }
    out.splice(8);
  } catch { /* офлайн */ }
  return (photoCache[wp] = out);
}
const gPhotos = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.o || p.n) + ' ' + (p.ad || '東京'))}`;
function coverHtml(p) {
  const c = p.mi ? '#e0a400' : color(p);
  return `<div class="cover" style="background:radial-gradient(120% 120% at 15% 0%,${c}66,transparent 60%),radial-gradient(100% 100% at 100% 100%,${c}33,transparent 60%),var(--s2)">
    <span class="cover-e">${p.mi ? starIcon(p.mi, true) : emo(p)}</span>
    <a class="cover-btn" href="${gPhotos(p)}" target="_blank">📷 Фото посетителей в Google Maps</a></div>`;
}
async function fillPhotos(p, el) {
  const box = el.querySelector('.photos'); if (!box) return;
  if (!p.wp) { box.innerHTML = coverHtml(p); return; }
  box.innerHTML = '<div class="gallery"><div class="ph skel"></div><div class="ph skel"></div></div>';
  const list = await wikiPhotos(p.wp);
  if (!el.isConnected || el.querySelector('.photos') !== box) return;
  if (!list.length) { box.innerHTML = coverHtml(p); return; }
  box.innerHTML = `<div class="gallery">${list.map(x => `<a class="ph" href="${esc(x.page || '#')}" target="_blank"><img src="${esc(x.src)}" loading="lazy" alt="" onerror="this.parentNode.remove()"></a>`).join('')}</div>
    <div class="ph-credit">Фото: Wikipedia / Wikimedia Commons · <a href="${gPhotos(p)}" target="_blank">ещё в Google Maps ↗</a></div>`;
}

function starIcon(mi, big) {
  if (mi === 'bib') return `<span class="bibface${big ? ' big' : ''}">Bib</span>`;
  return `<span class="mstar s${mi}${big ? ' big' : ''}"><i></i><b>${mi}</b></span>`;
}
const MI_TXT = { 3: 'Три звезды Michelin — стоит отдельной поездки', 2: 'Две звезды Michelin — стоит крюка', 1: 'Одна звезда Michelin — высокая кухня', bib: 'Bib Gourmand — по версии Мишлен: отлично и недорого' };

function placeSheet(p, { cost, cur = 'JPY', onSwap, distance } = {}) {
  const uc = S.plan?.userCur || S.trip.budget?.currency;
  const price = cost ?? p.p;
  const priceTxt = price ? `≈ ${fmt(price, cur)}${p.mi ? ' на человека' : ''}${uc && uc !== cur ? ' · ' + fmt(convert(price, cur, uc), uc) : ''}${p.pl ? ` <span class="muted">(${'¥'.repeat(p.pl)})</span>` : ''}`
    : (p.g === 'sight' || p.g === 'shop' || p.g === 'culture' ? 'бесплатно' : null);
  const why = p.mi ? null : p.f ? 'Известное место — классика района' : p.s >= 1.5 ? 'Нишевое: не сеть, местный вайб' : null;
  const badge = p.mi ? `<span class="badge gold">${p.mi === 'bib' ? 'Bib Gourmand' : '★'.repeat(p.mi) + ' Michelin'}</span>`
    : p.f ? '<span class="badge famous">классика</span>' : p.s >= 1.5 ? '<span class="badge niche">нишевое</span>' : '';
  const html = `
    <div class="photos"></div>
    <div class="sh-head"><div class="tile" style="${p.mi ? 'background:#e0a40026' : tileBg(p)}">${p.mi ? starIcon(p.mi) : emo(p)}</div>
      <div><h3>${esc(p.n)}${badge}</h3>${p.o ? `<div class="orig">${esc(p.o)}</div>` : ''}</div></div>
    <div class="facts">
      ${p.mi ? `<div><span>⭐</span><span>${MI_TXT[p.mi]}</span></div>` : ''}
      <div><span>🏷️</span><span>${esc(p.mi ? 'ресторан' : (KIND_RU[p.k] || p.k))}${p.cu ? ' · ' + esc(p.cu) : ''}</span></div>
      ${priceTxt ? `<div><span>💴</span><span>${priceTxt}</span></div>` : ''}
      ${p.h ? `<div><span>🕒</span><span>${esc(p.h)}</span></div>` : ''}
      ${p.ad ? `<div><span>📍</span><span>${esc(p.ad)}</span></div>` : ''}
      ${distance != null ? `<div><span>🚶</span><span>${Math.max(1, Math.round(distance / 80))} мин пешком · ${distance < 1000 ? Math.round(distance) + ' м' : (distance / 1000).toFixed(1) + ' км'}</span></div>` : ''}
      ${p.mi && p.mi !== 'bib' ? '<div><span>📞</span><span class="muted">В звёздные рестораны почти всегда нужна бронь заранее</span></div>' : ''}
      ${why ? `<div><span>✨</span><span class="muted">${why}</span></div>` : ''}
    </div>
    <div class="actions">
      <a class="act primary" href="${appleMaps(p)}" target="_blank"><span class="ic">🧭</span>Маршрут</a>
      <a class="act" href="${gPhotos(p)}" target="_blank"><span class="ic">🗺️</span>Google</a>
      ${p.mu ? `<a class="act" href="${esc(p.mu)}" target="_blank"><span class="ic">⭐</span>Гид Michelin</a>`
             : `<a class="act ${p.w ? '' : 'off'}" href="${esc(p.w || '#')}" target="_blank"><span class="ic">🌐</span>Сайт</a>`}
    </div>
    ${onSwap ? `<div class="swap-h">Заменить в плане</div><div class="seg"><button data-m="other">↻ Другое</button><button data-m="cheaper">↓ Дешевле</button><button data-m="pricier">↑ Дороже</button></div>` : ''}`;
  openSheet(html, el => { el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => onSwap(b.dataset.m, b)); fillPhotos(p, el); });
}

// ---------------- кольцо ----------------
function ring(frac, size, label, sub) {
  const r = size / 2 - 6, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
  const col = frac > 1.001 ? '#f87171' : 'url(#rg)';
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a3d"/><stop offset="1" stop-color="#ff3d7f"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="9"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c * f} ${c}"/></svg>
    <div class="val"><div>${label}<small>${sub}</small></div></div></div>`;
}

// ---------------- чат ----------------
const SUGG = [
  ['🗼', 'Я один в Токио на 4 дня, 150$ в день, жилья нет. Люблю рамен, странные бары и винтаж', 'классическая поездка'],
  ['🎮', 'Едем в Токио вчетвером на 3 дня, у каждого 10 000 ¥ в день, жилья нет, все вместе. Аниме, ретро-игры и бани', 'компания друзей'],
  ['👥', 'Группа 12 человек, Токио на неделю, общий бюджет 15 000$, нужно жильё. Каждый ходит куда хочет', 'большая группа, разные маршруты'],
];
function drawWelcome() {
  const box = $('#messages');
  box.innerHTML = `<div class="welcome"><h1>Куда<br>едем?</h1>
    <p>Скажи своими словами, где ты, на сколько дней и сколько готов тратить — я соберу план с жильём, едой и нишевыми местами.</p>
    <div class="sugg">${SUGG.map((s, i) => `<button data-i="${i}"><span class="e">${s[0]}</span><span class="t">${esc(s[1])}<small>${s[2]}</small></span></button>`).join('')}</div></div>`;
  box.querySelectorAll('.sugg button').forEach(b => b.onclick = () => handleUser(SUGG[+b.dataset.i][1]));
}
function addMsg(who, html, opts = {}) {
  const m = { who, html, ...opts };
  if (!S.msgs.length) $('#messages').innerHTML = '';
  S.msgs.push(m); if (S.msgs.length > 80) S.msgs.splice(0, S.msgs.length - 80);
  drawMsg(m); save();
}
function drawMsg(m) {
  const el = document.createElement('div');
  el.className = m.card ? 'plan-card' : 'msg ' + m.who;
  el.innerHTML = m.html;
  el.querySelector('.cta')?.addEventListener('click', () => showTab('plan'));
  el.querySelector('.grp-cta')?.addEventListener('click', openGroupSheet);
  $('#messages').appendChild(el);
  requestAnimationFrame(() => { $('#messages').scrollTop = 1e9; });
}
function setChips(list) {
  const c = $('#chips'); c.innerHTML = '';
  for (const t of list) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = t; b.onclick = () => t.startsWith('👥') ? openGroupSheet() : handleUser(t); c.appendChild(b); }
}
const AFTER_PLAN = ['👥 Группа и бюджет', 'Другой вариант', 'Дешевле', 'Больше необычного', 'Добавь бары', 'Аниме и игры', 'Храмы и сады', 'Красивые виды', 'Без алкоголя', 'Добавь день'];
const interestsText = list => list.map(i => INTERESTS[i]?.label).filter(Boolean).join(', ');

async function handleUser(text) {
  text = text.trim(); if (!text) return;
  addMsg('me', esc(text));
  $('#input').value = ''; autoGrow();
  const t = text.toLowerCase();

  if (/рядом|поблизости|вокруг меня|что тут|near me|карт/.test(t) && !/дн|бюдж|\$|¥|руб/.test(t)) {
    addMsg('bot', 'Открываю карту — там всё вокруг тебя, сначала нишевое.'); showTab('map'); locateMe(); return;
  }
  if (S.plan) {
    if (/друг(ой|ие) вариант|ещ[её] вариант|перегенер|не нравится|по-другому/.test(t)) { S.seed++; return makePlan('Вот другой вариант — те же правила, другие места.'); }
    if (/дешевле|экономн|сэконом|поменьше трат/.test(t)) { S.trip.budgetFactor = (S.trip.budgetFactor || 1) * 0.85; S.seed++; return makePlan('Ужал план примерно на 15%.'); }
    if (/дороже|кайфан|не экономь|пошикар/.test(t)) { S.trip.budgetFactor = Math.min(1, (S.trip.budgetFactor || 1) / 0.85); S.trip.style = 'comfort'; S.seed++; return makePlan('Сделал план пощедрее, но в рамках бюджета.'); }
    if (/это (всего|на вс)|на всю поездку|за всю поездку/.test(t) && !/\d/.test(t)) { S.trip.budget.per = 'total'; return makePlan('Понял, это бюджет на всю поездку — поделил по дням.'); }
    if (/это (в|на) день/.test(t) && !/\d/.test(t)) { S.trip.budget.per = 'day'; return makePlan('Ок, бюджет на день.'); }
    if (/(добав|ещ[её])\s*(один )?день/.test(t) && !/\d/.test(t)) { S.trip.days = Math.min(21, (S.trip.days || 1) + 1); return makePlan('Добавил день.'); }
  }

  let p = parseMessage(text);
  if (S.expecting && !(S.expecting in p)) Object.assign(p, parseShortAnswer(text, S.expecting));
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
  if (p.budget) { tr.budget = p.budget; tr.budgetFactor = 1; tr.budgetGuessed = false; }
  if (p.lodging) tr.lodging = p.lodging;
  if (p.cuisine) tr.cuisine = [...new Set([...(tr.cuisine || []), ...p.cuisine])];
  if (p.style) tr.style = p.style;
  if (p.noAlcohol) tr.noAlcohol = true;
  if (p.people) tr.people = p.people;
  if (p.budgetMode) tr.budgetMode = p.budgetMode;
  if (p.placesMode) tr.placesMode = p.placesMode;  if (p.interests) tr.interests = /только/.test(t) || !tr.interests ? p.interests : [...new Set([...tr.interests, ...p.interests])];
  if (p.useGeo && !tr.city) await tryGeoCity();
  save();
  await nextStep(p);
}

async function tryGeoCity() {
  const pos = await getPos().catch(() => null);
  if (!pos) return false;
  for (const [id, c] of Object.entries(SUPPORTED)) if (distM(pos[0], pos[1], c.center[0], c.center[1]) < 40000) { S.trip.city = id; S.trip.here = pos; return true; }
  return false;
}

async function nextStep(p = {}) {
  const tr = S.trip;
  if (!tr.city) {
    S.expecting = 'city';
    if (!(await tryGeoCity())) { addMsg('bot', 'В каком ты городе? Подробная база пока есть для <b>Токио</b>.'); setChips(['Токио']); save(); return; }
    addMsg('bot', 'Вижу по геолокации, что ты в Токио 👌');
  }
  if (!tr.days) { S.expecting = 'days'; addMsg('bot', 'На сколько дней?'); setChips(['1 день', '2 дня', '3 дня', '4 дня', '5 дней', 'Неделя']); save(); return; }
  if (!tr.people) { S.expecting = 'people'; addMsg('bot', 'Сколько вас едет?'); setChips(['Я один', 'Вдвоём', 'Втроём', '4 человека', '6 человек', 'Группа 10 человек', 'Группа 20 человек']); save(); return; }
  const N = tr.people;
  if (N > 1 && !tr.budgetMode) {
    S.expecting = 'budgetMode';
    addMsg('bot', `Вас ${N}. Как считаем деньги?\n• <b>у каждого свой</b> — каждый тратит своё, суммы можно задать разные\n• <b>только мой</b> — считаю твои траты, жильё делим на всех\n• <b>общий</b> — одна сумма на всю компанию`);
    setChips(['У каждого свой бюджет', 'Только мой', 'Общий бюджет на всех']); save(); return;
  }
  if (!tr.budget) {
    S.expecting = 'budget';
    const who = N > 1 ? { each: ' на одного человека', mine: ' твой', shared: ' на всю группу' }[tr.budgetMode] : '';
    addMsg('bot', `Какой бюджет${who}? Можно на день или на всю поездку — в долларах, рублях или йенах.`);
    setChips(N > 1 && tr.budgetMode === 'shared' ? [`$${100 * N * 3} всего`, `$${150 * N} в день`, `${(10000 * N).toLocaleString('ru-RU')} ¥ в день`, `${(80000 * N).toLocaleString('ru-RU')} ₽ всего`]
      : ['$80 в день', '$150 в день', '15 000 ¥ в день', '$1000 на всю поездку', '100 000 ₽ всего']);
    save(); return;
  }
  if (!tr.lodging) { S.expecting = 'lodging'; addMsg('bot', N > 1 ? 'Жильё уже есть или подобрать? Подберу общее — так дешевле, чем каждому отдельно.' : 'Жильё уже есть или подобрать?'); setChips(['Жилья нет — подбери', 'Жильё уже есть']); save(); return; }
  if (N > 1 && !tr.placesMode) {
    S.expecting = 'placesMode';
    addMsg('bot', 'Ходите везде вместе или каждый по своим интересам?\n• <b>вместе</b> — один маршрут и одни места на всех\n• <b>каждый своё</b> — у каждого свой план, места не повторяются, жильё общее');
    setChips(['Все вместе, одни места', 'Каждый своё — разные места']); save(); return;
  }
  S.expecting = null;
  const notes = [];
  const b = tr.budget;
  if (!b.currency) {
    b.currency = b.amount >= 3000 ? (b.amount >= 20000 && b.amount < 60000 ? 'RUB' : 'JPY') : 'USD';
    notes.push(`Валюту не указал — считаю, что это ${b.currency === 'USD' ? 'доллары' : b.currency === 'RUB' ? 'рубли' : 'йены'}.`);
  }
  if (!b.per) {
    // подозрительно большой "дневной" бюджет при многодневной поездке — скорее всего это на всю поездку
    const usd = convert(b.amount / (N > 1 && tr.budgetMode === 'shared' ? N : 1), b.currency, 'USD');
    if (tr.days > 1 && usd > 600) { b.per = 'total'; notes.push(`Считаю, что ${fmt(b.amount, b.currency)} — на всю поездку. Если это на день — напиши «это на день».`); }
    else { b.per = 'day'; if (tr.days > 1) notes.push('Считаю бюджет на день. Если это на всю поездку — напиши «это всего».'); }
  }
  await makePlan(notes.join('\n'));
}

async function makePlan(prefix = '') {
  const tr = S.trip;
  const city = await loadCity(tr.city);
  const cur = CITY_PRICES[tr.city].currency;
  const uc = tr.budget.currency;
  const { N, mode, separate } = groupOf(tr);
  const toLocal = a => convert(tr.budget.per === 'total' ? a / tr.days : a, uc, cur) * (tr.budgetFactor || 1);
  // дневной бюджет на каждого человека
  const ppB = tr.members.map(m => mode === 'shared' ? toLocal(tr.budget.amount) / N : mode === 'each' ? toLocal(m.budget || tr.budget.amount) : toLocal(tr.budget.amount));
  const minB = Math.min(...ppB);
  const notes = prefix ? [prefix] : [];
  let plans;
  if (!separate) {
    plans = [buildPlan(city, { ...tr, people: N, budgetLocal: minB }, S.seed)];
    if (mode === 'each' && Math.max(...ppB) > minB * 1.05) {
      const poor = tr.members[ppB.indexOf(minB)].name;
      notes.push(`Вы ходите вместе, поэтому план под самый скромный бюджет — ${poor}: ${fmt(minB, cur)} в день. У остальных останется запас.`);
    }
    if (mode === 'mine' && N > 1) notes.push(`Считаю только твои траты. Жильё общее — его цена делится на ${N}.`);
  } else {
    // у каждого свой план; места не повторяются (общий exclude), жильё одно на всех — по самому скромному бюджету
    const exclude = new Set();
    plans = [];
    tr.members.forEach((m, i) => {
      const pl = buildPlan(city, { ...tr, interests: m.interests?.length ? m.interests : tr.interests, people: N, separate: true, budgetLocal: ppB[i], stayBudget: minB, exclude, stayFrom: plans[0] || null }, S.seed + i * 7919);
      pl.who = m.name; plans.push(pl);
    });
    if (!tr.members.some(m => m.interests?.length)) notes.push('Маршруты у всех разные, но интересы пока общие. Задать каждому свои — в «👥 Группа и бюджет».');
  }
  plans.forEach(p => { p.userCur = uc; p.group = { N, mode, separate }; });
  S.plans = plans; S.who = 0; S.plan = plans[0];
  S.day = 0;
  const pl = S.plan;
  const u = v => uc !== cur ? ` <span class="muted">· ${fmt(convert(v, cur, uc), uc)}</span>` : '';
  const totalTxt = tr.budget.per === 'total' ? `всего ${fmt(tr.budget.amount, uc)} → ` : '';
  const avgAll = plans.reduce((a, p) => a + p.avgDay, 0) / plans.length, budAll = plans.reduce((a, p) => a + p.budgetDay, 0) / plans.length;
  const ppl = N > 1 ? ' на человека' : '';
  const rows = [];
  if (N > 1) rows.push(['Группа', `${pplTxt(N)} · ${BMODE_RU[mode]} · ${separate ? 'каждый своё' : 'все вместе'}`]);
  if (pl.stay) rows.push(['Жильё', stayLine(pl.stay, cur, N)]);
  rows.push(['Еда', `завтрак — ${pl.tiers.breakfast}, обед — ${pl.tiers.lunch}, ужин — ${pl.tiers.dinner}${pl.meals.bar ? ', вечером бар' : ''}`]);
  if (separate) {
    const shown = plans.slice(0, 6);
    shown.forEach(p => rows.push([esc(p.who), `${esc(interestsText(p.interests))} <span class="muted">· ≈ ${fmt(p.avgDay, cur)}/день</span>`]));
    if (plans.length > shown.length) rows.push(['', `<span class="muted">и ещё ${plans.length - shown.length} — во вкладке «План»</span>`]);
  } else {
    rows.push(['Районы', pl.days.map(d => esc(d.district)).filter((x, i, a) => a.indexOf(x) === i).join(' · ')]);
    rows.push(['Интересы', esc(interestsText(pl.interests)) + (tr.interests ? '' : ' <span class="muted">(по умолчанию)</span>')]);
  }
  const groupTotal = N > 1 && mode !== 'mine' ? `<div class="sub">на всех за поездку ≈ <b style="color:var(--text)">${fmt(plans.reduce((a, p) => a + p.avgDay, 0) * (separate ? 1 : N) * tr.days, cur)}</b>${u(plans.reduce((a, p) => a + p.avgDay, 0) * (separate ? 1 : N) * tr.days)}</div>` : '';
  const budTxt = N === 1 ? `${totalTxt}${fmt(budAll, cur)}${u(budAll)} в день`
    : mode === 'shared' ? `общий ${fmt(tr.budget.amount, uc)}${tr.budget.per === 'total' ? ' на поездку' : ' в день'} → ${fmt(budAll, cur)}${u(budAll)} в день на человека`
    : mode === 'mine' ? `твой бюджет ${fmt(budAll, cur)}${u(budAll)} в день`
    : `${separate ? 'в среднем ' : ''}${fmt(budAll, cur)}${u(budAll)} в день на человека`;
  let html = `<div class="pc-top">${ring(avgAll / budAll, 74, Math.round(avgAll / budAll * 100) + '%', 'бюджета')}
    <div><h3>${SUPPORTED[tr.city].name} · ${daysTxt(tr.days)}${N > 1 ? ' · 👥 ' + N : ''}</h3><div class="sub">${budTxt}</div>
    <div class="sub">план ≈ <b style="color:var(--text)">${fmt(avgAll, cur)}</b>${u(avgAll)} в день${ppl}</div>${groupTotal}</div></div>
    <div class="kv">${rows.map(r => `<span>${r[0]}</span><span>${r[1]}</span>`).join('')}</div>`;
  if (notes.length) html += `<div class="note">${esc(notes.join('\n'))}</div>`;
  if (pl.warnings.length) html += `<div class="note warn">⚠️ ${pl.warnings.map(esc).join('\n⚠️ ')}</div>`;
  if (!tr.interests && !separate) html += `<div class="note">Скажи, что любишь — «аниме и бани», «только кофе и виды» — и я пересоберу.</div>`;
  html += `<button class="cta">Открыть план по дням →</button>`;
  if (N > 1) html += `<button class="grp-cta">👥 ${separate || mode === 'each' ? 'Настроить каждого' : 'Группа и бюджет'}</button>`;
  addMsg('bot', html, { card: true });
  setChips(AFTER_PLAN);
  save();
  if (currentTab === 'plan') renderPlan();
}

// ---------------- план ----------------
const SLOT_TIME = { breakfast: '09:00', morning: '10:30', lunch: '13:00', afternoon: '14:30', afternoon2: '16:30', dinner: '19:00', evening: '21:00' };
let dayMap = null;

function bookingLinks(cityEn, days, N = 1, rooms = 1) {
  const ymd = d => d.toISOString().slice(0, 10);
  const ci = new Date(), co = new Date(Date.now() + Math.max(1, days - 1) * 864e5);
  return [
    ['Booking', `https://www.booking.com/searchresults.html?ss=${cityEn}&checkin=${ymd(ci)}&checkout=${ymd(co)}&group_adults=${N}&no_rooms=${rooms}&order=price`],
    ['Hostelworld', `https://www.hostelworld.com/st/hostels/asia/japan/${cityEn.toLowerCase()}/`],
    ['Airbnb', `https://www.airbnb.com/s/${cityEn}/homes?checkin=${ymd(ci)}&checkout=${ymd(co)}&adults=${Math.min(N, 16)}`],
  ];
}

function renderPlan() {
  const box = $('#plan'), pl = S.plan;
  if (!pl) { box.innerHTML = `<div class="empty"><div class="big">🧭</div>Плана пока нет.<br>Расскажи в чате, куда едешь и сколько готов тратить.</div>`; return; }
  const tr = S.trip, cur = pl.currency, uc = pl.userCur;
  const u = v => uc !== cur ? ` · ${fmt(convert(v, cur, uc), uc)}` : '';
  const left = pl.budgetDay - pl.avgDay;
  const G = pl.group || { N: 1, mode: 'mine', separate: false };
  const N = G.N, pp = N > 1 ? ' на человека' : '';
  // переключатель участников, если у каждого свой план
  let h = S.plans.length > 1 ? `<div class="people-bar chips">${S.plans.map((p, i) => `<button class="daypill ${i === S.who ? 'on' : ''}" data-who="${i}"><b>${esc(p.who)}</b><span>≈ ${fmt(p.avgDay, cur)}/день</span></button>`).join('')}</div>` : '';
  const eyebrow = N === 1 ? 'Твоя поездка' : G.separate ? `План: ${esc(pl.who)} · из ${N}` : `Поездка на ${pplTxt(N)}`;
  const groupSum = N > 1 && G.mode !== 'mine' ? (G.separate ? S.plans.reduce((a, p) => a + p.avgDay, 0) : pl.avgDay * N) * tr.days : 0;
  h += `<div class="hero"><div class="eyebrow">${eyebrow}</div><h2>${SUPPORTED[pl.city].name}, ${daysTxt(tr.days)}</h2>
    <div class="row">${ring(pl.avgDay / pl.budgetDay, 96, fmt(pl.avgDay, cur), 'в день' + (N > 1 ? '/чел' : ''))}
      <div class="nums"><span>Бюджет${pp} <b>${fmt(pl.budgetDay, cur)}</b>${u(pl.budgetDay)}</span>
      <span>${left >= 0 ? `Запас <b class="ok">${fmt(left, cur)}</b>${u(left)}` : `Перебор <b class="bad">${fmt(-left, cur)}</b>`}</span>
      <span>За поездку${pp} ≈ <b>${fmt(pl.avgDay * tr.days, cur)}</b>${u(pl.avgDay * tr.days)}</span>
      ${groupSum ? `<span>На всех ≈ <b>${fmt(groupSum, cur)}</b>${u(groupSum)}</span>` : ''}</div></div>
    <div class="tags">${pl.interests.map(i => `<span class="tag">${esc(INTERESTS[i]?.label || i)}</span>`).join('')}</div>
    <button class="grp-btn" id="grpBtn">👥 ${N > 1 ? `${pplTxt(N)} · ${BMODE_RU[G.mode]} · ${G.separate ? 'каждый своё' : 'все вместе'}` : 'Еду один — добавить людей'}<span>изменить</span></button>
    ${pl.warnings.map(w => `<div class="alert">⚠️ ${esc(w)}</div>`).join('')}</div>`;

  if (pl.stay) {
    h += `<div class="sec-title"><h3>Жильё${N > 1 ? ' на всех' : ''}</h3><span>${stayLine(pl.stay, cur, N)}</span></div><div class="hscroll">`;
    pl.stayOptions.forEach((p, i) => {
      h += `<button class="stay" data-stay="${i}"><div class="top-row"><div class="tile" style="${tileBg(p)}">${emo(p)}</div><span class="badge niche" style="${p.s >= 1.5 ? '' : 'display:none'}">нишевое</span></div>
        <div class="nm">${esc(p.n)}</div><div class="meta">${esc(KIND_RU[p.k])} · ${esc(cityDistrictName(p))}</div>
        <div class="book-links"><a class="mini" href="https://www.booking.com/searchresults.html?ss=${encodeURIComponent((p.o || p.n) + ' Tokyo')}" target="_blank" onclick="event.stopPropagation()">Цены на Booking</a></div></button>`;
    });
    h += `</div><div class="book-links">${bookingLinks(SUPPORTED[pl.city].en, tr.days, N, pl.stay.cap > 1 ? pl.stay.units : 1).map(([n, l]) => `<a class="mini" href="${l}" target="_blank">${n} ↗</a>`).join('')}</div>`;
  }

  h += `<div class="daybar"><div class="chips">${pl.days.map((d, i) => `<button class="daypill ${i === S.day ? 'on' : ''}" data-day="${i}"><b>День ${i + 1}</b><span>${esc(d.district.split(' и ')[0])}</span></button>`).join('')}</div></div>`;

  const d = pl.days[S.day] || pl.days[0];
  h += `<div class="day-h"><h3>${esc(d.district)}</h3><span>≈ ${fmt(d.total, cur)}${u(d.total)}</span></div><div class="daymap" id="dayMap"></div><div class="timeline">`;
  let n = 0;
  d.items.forEach((it, ii) => {
    const p = it.p;
    if (p) n++;
    const pr = it.cost ? `≈ ${fmt(it.cost, cur)}${uc !== cur ? `<small>${fmt(convert(it.cost, cur, uc), uc)}</small>` : ''}` : 'free';
    h += `<div class="tl-item"><div class="tl-time">${SLOT_TIME[it.slot]}</div>
      <button class="tl-card" data-item="${ii}">
        ${p ? `<div class="tile" style="${tileBg(p)}">${emo(p)}<span class="n">${n}</span></div>` : `<div class="tile" style="background:var(--s3)">🏪</div>`}
        <div class="tl-main"><div class="tl-slot">${SLOT_RU[it.slot]}</div>
          <div class="tl-name">${p ? esc(p.n) : 'Конбини по пути'}${p?.f ? '<span class="badge famous">классика</span>' : p && p.s >= 1.5 ? '<span class="badge niche">нишевое</span>' : ''}</div>
          <div class="tl-sub">${p ? esc(KIND_RU[p.k] || p.k) + (p.cu ? ' · ' + esc(p.cu) : '') : 'онигири, кофе, сэндвич'}${it.note && p ? ' · ' + esc(it.note) : ''}</div></div>
        <div class="price ${it.cost ? '' : 'free'}">${it.cost ? pr : 'free'}</div>
      </button></div>`;
  });
  const over = d.total > pl.budgetDay;
  h += `</div><div class="day-sum">
    <div class="line"><span>Места и еда</span><span>${fmt(d.total - d.transport - d.stayCost, cur)}</span></div>
    <div class="line"><span>Транспорт (метро)</span><span>${fmt(d.transport, cur)}</span></div>
    ${d.stayCost ? `<div class="line"><span>Жильё${N > 1 ? ' (доля)' : ''}</span><span>${fmt(d.stayCost, cur)}</span></div>` : ''}
    <div class="line total"><span>Итого за день${pp}</span><span class="${over ? 'bad' : ''}">${fmt(d.total, cur)}${u(d.total)}</span></div>
    ${N > 1 && !G.separate && G.mode !== 'mine' ? `<div class="line"><span>На всю компанию</span><span>${fmt(d.total * N, cur)}${u(d.total * N)}</span></div>` : ''}
    <div class="bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, d.total / pl.budgetDay * 100)}%"></i></div></div>
    <div class="foot-note">Цены — средние оценки (≈). Места — OpenStreetMap, перед походом проверь часы работы.</div>`;
  const y = box.scrollTop;
  box.innerHTML = h;
  box.scrollTop = y;

  box.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { S.day = +b.dataset.day; save(); renderPlan(); });
  box.querySelectorAll('[data-who]').forEach(b => b.onclick = () => { S.who = +b.dataset.who; S.plan = S.plans[S.who]; save(); renderPlan(); });
  $('#grpBtn').onclick = openGroupSheet;
  box.querySelectorAll('[data-stay]').forEach(b => b.onclick = () => placeSheet(pl.stayOptions[+b.dataset.stay], { cost: pl.stay.pp ?? pl.stay.price, cur }));
  box.querySelectorAll('[data-item]').forEach(b => b.onclick = () => {
    const ii = +b.dataset.item, it = d.items[ii];
    if (!it.p) return;
    const onSwap = async (mode, btn) => {
      const city = await loadCity(pl.city);
      S.seed++;
      if (!swapItem(city, pl, S.day, ii, mode, S.seed, G.separate ? otherIds() : [])) { btn.textContent = 'нет вариантов'; return; }
      save(); renderPlan();
      const ni = S.plan.days[S.day].items[ii];
      placeSheet(ni.p, { cost: ni.cost, cur, onSwap });
    };
    placeSheet(it.p, { cost: it.cost, cur, onSwap });
  });
  drawDayMap(d);
  // миниатюры: у мест со статьёй в Википедии вместо эмодзи — настоящее фото
  box.querySelectorAll('[data-item]').forEach(async b => {
    const p = d.items[+b.dataset.item].p;
    if (!p?.wp) return;
    const ph = await wikiPhotos(p.wp);
    const tile = b.querySelector('.tile');
    if (ph[0] && tile && b.isConnected) { tile.classList.add('has-img'); tile.style.backgroundImage = `url("${ph[0].src}")`; }
  });
}
function cityDistrictName(p) { return cityCache[S.plan.city]?.districts[p.d]?.name || ''; }

function tiles(map) {
  // OSM-тайлы, затемнённые CSS-фильтром (.dark-tiles) — бесплатно и без ключа
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'dark-tiles' }).addTo(map);
}
function pin(p, label, cls = '') {
  return L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 34], html: `<div class="mk ${cls}" style="background:${color(p)}"><span>${label}</span></div>` });
}
function drawDayMap(d) {
  if (typeof L === 'undefined') return;
  if (dayMap) { dayMap.remove(); dayMap = null; }
  const pts = d.items.filter(x => x.p).map(x => x.p);
  if (!pts.length) return;
  dayMap = L.map('dayMap', { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
  tiles(dayMap);
  const ll = pts.map(p => [p.la, p.lo]);
  L.polyline(ll, { color: '#ff5d6e', weight: 3, opacity: .8, dashArray: '2 8', lineCap: 'round' }).addTo(dayMap);
  pts.forEach((p, i) => L.marker([p.la, p.lo], { icon: pin(p, i + 1, 'num') }).addTo(dayMap).on('click', () => document.querySelectorAll('.tl-card')[i]?.click()));
  const st = S.plan.stayOptions?.[0];
  if (st) L.marker([st.la, st.lo], { icon: pin(st, '🏠', 'sm') }).addTo(dayMap);
  dayMap.fitBounds(ll, { padding: [30, 30], maxZoom: 16 });
}

// ---------------- карта ----------------
const MAP_FILTERS = [
  { id: 'all', label: 'Всё' },
  { id: 'michelin', label: '⭐ Мишлен', test: () => false },
  { id: 'food', label: '🍜 Еда', test: p => p.g === 'food' || p.k === 'izakaya' },
  { id: 'cafe', label: '☕ Кофе', test: p => p.g === 'cafe' },
  { id: 'bar', label: '🍸 Бары', test: p => p.g === 'bar' || p.g === 'night' },
  { id: 'temple', label: '⛩️ Храмы', test: p => p.k === 'shrine' || p.k === 'temple' },
  { id: 'green', label: '🌳 Парки', test: p => p.k === 'park' || p.k === 'garden' },
  { id: 'view', label: '🌆 Виды', test: p => p.k === 'viewpoint' },
  { id: 'art', label: '🎨 Искусство', test: p => ['gallery', 'arts_centre', 'artwork'].includes(p.k) },
  { id: 'museum', label: '🏛️ Музеи', test: p => p.k === 'museum' || p.k === 'historic' },
  { id: 'otaku', label: '🎮 Аниме', test: p => p.k === 'otaku' },
  { id: 'vintage', label: '💿 Винтаж', test: p => ['vintage', 'records', 'used_books', 'antiques'].includes(p.k) },
  { id: 'sento', label: '♨️ Бани', test: p => p.k === 'sento' },
  { id: 'stay', label: '🛏️ Жильё', test: p => p.g === 'stay' },
];
const MF = { cat: 'all', niche: false, free: false, q: '' };
let bigMap = null, mapLayer = null, meMarker = null, myPos = null, mapPlaces = [];

let michelin = null;
async function loadMichelin(id) { if (!michelin) michelin = await fetch('data/' + id + '_michelin.json').then(r => r.json()).catch(() => ({ places: [] })); return michelin; }
async function openMap() {
  const city = await loadCity(S.trip.city || 'tokyo');
  await loadMichelin(city.id);
  renderMapFilters();
  if (!bigMap) {
    bigMap = L.map('bigMap', { zoomControl: false, attributionControl: true }).setView([35.6938, 139.7034], 15);
    tiles(bigMap);
    mapLayer = L.layerGroup().addTo(bigMap);
    bigMap.on('moveend', () => refreshMap(city));
  }
  setTimeout(() => { bigMap.invalidateSize(); refreshMap(city); }, 60);
}
function renderMapFilters() {
  const el = $('#mapFilters');
  el.innerHTML = `<button class="chip ${MF.niche ? 'on' : ''}" data-t="niche">✨ Нишевое</button><button class="chip ${MF.free ? 'on' : ''}" data-t="free">🆓 Бесплатно</button>` +
    MAP_FILTERS.map(f => `<button class="chip ${MF.cat === f.id ? 'on' : ''}" data-c="${f.id}">${f.label}</button>`).join('');
  el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { MF.cat = b.dataset.c; renderMapFilters(); refreshMap(cityCache[S.trip.city || 'tokyo']); });
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { MF[b.dataset.t] = !MF[b.dataset.t]; renderMapFilters(); refreshMap(cityCache[S.trip.city || 'tokyo']); });
}
let qTimer = null;
$('#mapSearch').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { MF.q = e.target.value.trim().toLowerCase(); refreshMap(cityCache[S.trip.city || 'tokyo'], true); }, 250); });

function matches(p) {
  const f = MAP_FILTERS.find(x => x.id === MF.cat);
  if (f.test && !f.test(p)) return false;
  if (MF.cat !== 'stay' && p.g === 'stay' && MF.cat === 'all' && !MF.q) return false;
  if (MF.niche && (p.s < 1.5 || p.f)) return false;
  if (MF.free && (p.p || 0) > 0 || MF.free && ['food', 'cafe', 'bar', 'stay', 'night'].includes(p.g)) return false;
  if (p.c && !MF.q) return false;
  if (MF.q) {
    const hay = (p.n + ' ' + (p.o || '') + ' ' + (p.cu || '') + ' ' + (KIND_RU[p.k] || '')).toLowerCase();
    if (!MF.q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
function refreshMap(city, fitToResults = false) {
  if (!bigMap || !city) return;
  const b = bigMap.getBounds();
  const c = bigMap.getCenter();
  let list;
  if (MF.q && fitToResults) {
    list = city.places.filter(matches);
    if (list.length) {
      const inView = list.filter(p => b.contains([p.la, p.lo]));
      if (!inView.length) { bigMap.fitBounds(list.slice(0, 200).map(p => [p.la, p.lo]), { padding: [60, 60], maxZoom: 16 }); return; }
    }
  }
  list = city.places.filter(p => b.contains([p.la, p.lo]) && matches(p));
  const ref = myPos && b.contains(myPos) ? myPos : [c.lat, c.lng];
  list = list.map(p => ({ p, m: distM(ref[0], ref[1], p.la, p.lo) })).sort((x, y) => (y.p.s - y.m / 1500) - (x.p.s - x.m / 1500));
  mapPlaces = list;
  mapLayer.clearLayers();
  const z = bigMap.getZoom();
  list.slice(0, z >= 17 ? 120 : z >= 16 ? 70 : z >= 14 ? 45 : 30).reverse().forEach(({ p, m }, i, arr) => {
    const top = arr.length - i <= 12;
    L.marker([p.la, p.lo], { icon: pin(p, emo(p), top ? (p.s >= 1.5 ? 'hot' : '') : 'sm'), zIndexOffset: top ? 1000 : 0 })
      .addTo(mapLayer).on('click', () => placeSheet(p, { cur: CITY_PRICES[city.id].currency, distance: myPos ? distM(myPos[0], myPos[1], p.la, p.lo) : null }));
  });
  // ⭐ Мишлен: звёзды видны всегда на «Всё/Еда/Бары/Мишлен», Bib Gourmand — на «Мишлен/Еда»
  let mlist = [];
  if (michelin && ['all', 'food', 'bar', 'michelin'].includes(MF.cat) && !MF.free) {
    const showBib = MF.cat === 'michelin' || MF.cat === 'food';
    mlist = michelin.places.filter(m => b.contains([m.la, m.lo]) && (m.mi !== 'bib' || showBib) &&
      (!MF.q || (m.n + ' ' + m.cu + ' мишлен michelin').toLowerCase().includes(MF.q)));
    for (const m of mlist) {
      L.marker([m.la, m.lo], { icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: starIcon(m.mi) }), zIndexOffset: 3000 + (m.mi === 'bib' ? 0 : m.mi * 10) })
        .addTo(mapLayer).on('click', () => placeSheet(m, { cur: CITY_PRICES[city.id].currency, distance: myPos ? distM(myPos[0], myPos[1], m.la, m.lo) : null }));
    }
  }
  if (MF.cat === 'michelin') {
    const rank = x => x.mi === 'bib' ? 0 : x.mi;
    list = mlist.map(p => ({ p, m: distM(ref[0], ref[1], p.la, p.lo) })).sort((x, y) => rank(y.p) - rank(x.p) || x.m - y.m);
    mapPlaces = list;
  }
  $('#mapCount').innerHTML = `${list.length ? list.length + ' ' + plural(list.length, 'место', 'места', 'мест') : 'Ничего не нашлось'} <small>${list.length ? (myPos && b.contains(myPos) ? '· ближе к тебе и нишевее — выше' : '· в этой области') : '· попробуй сдвинуть карту или снять фильтры'}</small>`;
  const cur = CITY_PRICES[city.id].currency;
  $('#mapList').innerHTML = list.slice(0, 80).map(({ p, m }, i) => `<button class="row-item" data-i="${i}"><div class="tile" style="${p.mi ? 'background:#e0a40026' : tileBg(p)}">${p.mi ? starIcon(p.mi) : emo(p)}</div>
    <div class="tl-main"><div class="tl-name">${esc(p.n)}${p.mi ? '<span class="badge gold">' + (p.mi === 'bib' ? 'Bib' : '★'.repeat(p.mi)) + '</span>' : p.f ? '<span class="badge famous">классика</span>' : p.s >= 1.5 ? '<span class="badge niche">нишевое</span>' : ''}</div>
    <div class="tl-sub">${esc(p.mi ? 'ресторан' : (KIND_RU[p.k] || p.k))}${p.cu ? ' · ' + esc(p.cu) : ''}</div></div>
    <div class="price">${myPos && b.contains(myPos) ? Math.max(1, Math.round(m / 80)) + ' мин' : (p.p ? '≈ ' + fmt(p.p, cur) : '')}</div></button>`).join('');
  $('#mapList').querySelectorAll('[data-i]').forEach(el => el.onclick = () => {
    const { p, m } = list[+el.dataset.i];
    bigMap.setView([p.la, p.lo], Math.max(bigMap.getZoom(), 16));
    placeSheet(p, { cur, distance: myPos ? distM(myPos[0], myPos[1], p.la, p.lo) : null });
  });
}
$('#mapPanelHead').onclick = () => { $('#mapPanel').classList.toggle('open'); document.body.classList.toggle('panel-open', $('#mapPanel').classList.contains('open')); };

async function locateMe() {
  try {
    myPos = await getPos();
    const city = cityCache[S.trip.city || 'tokyo'] || await loadCity('tokyo');
    if (distM(myPos[0], myPos[1], city.center[0], city.center[1]) > 40000) {
      myPos = null;
      $('#mapCount').innerHTML = 'Ты сейчас не в Токио <small>· показываю карту города</small>';
      return;
    }
    if (meMarker) meMarker.remove();
    meMarker = L.marker(myPos, { icon: L.divIcon({ className: '', iconSize: [18, 18], html: '<div class="me-dot"></div>' }), zIndexOffset: 2000 }).addTo(bigMap);
    bigMap.setView(myPos, 16);
  } catch { $('#mapCount').innerHTML = 'Геолокация недоступна <small>· разреши доступ в настройках Safari</small>'; }
}
$('#locateBtn').onclick = locateMe;

function getPos() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no geo'));
    const t = setTimeout(() => rej(new Error('geo timeout')), 12000);
    navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); res([p.coords.latitude, p.coords.longitude]); }, e => { clearTimeout(t); rej(e); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

// ---------------- лист «Группа и бюджет» ----------------
// Всё то же, что спрашивает чат, но руками: люди, дни, режим бюджета, вместе/раздельно, бюджет и интересы каждого.
function openGroupSheet() {
  const tr = S.trip;
  const D = {
    people: tr.people || 1, days: tr.days || 3, budgetMode: tr.budgetMode || 'each', placesMode: tr.placesMode || 'together',
    amount: tr.budget?.amount || '', currency: tr.budget?.currency || 'USD', per: tr.budget?.per || 'day', lodging: tr.lodging || 'need',
    interests: [...(tr.interests || [])], members: JSON.parse(JSON.stringify(tr.members || [])), open: -1,
  };
  const syncMembers = () => groupOf(D); // та же нормализация списка, что и в плане
  const seg = (key, opts) => `<div class="seg seg${opts.length}" data-seg="${key}">${opts.map(([v, t, s]) => `<button class="${D[key] === v ? 'on' : ''}" data-v="${v}">${t}${s ? `<small>${s}</small>` : ''}</button>`).join('')}</div>`;
  const ichips = (list, attr) => `<div class="ichips">${Object.entries(INTERESTS).map(([id, x]) => `<button class="chip ${list.includes(id) ? 'on' : ''}" ${attr} data-int="${id}">${esc(x.label)}</button>`).join('')}</div>`;

  const draw = () => {
    syncMembers();
    const N = D.people, sep = N > 1 && D.placesMode === 'separate', each = N > 1 && D.budgetMode === 'each';
    const amtLabel = N === 1 ? 'Бюджет' : { each: 'Бюджет на человека', mine: 'Твой бюджет', shared: 'Общий бюджет на всю группу' }[D.budgetMode];
    let h = `<h3 class="sh-title">👥 Группа и бюджет</h3>
      <div class="fld"><span>Сколько вас</span><div class="stepper"><button data-st="people" data-d="-1">−</button><b>${N}</b><button data-st="people" data-d="1">+</button></div></div>
      <div class="fld"><span>Дней</span><div class="stepper"><button data-st="days" data-d="-1">−</button><b>${D.days}</b><button data-st="days" data-d="1">+</button></div></div>`;
    if (N > 1) h += `<div class="lbl">Как считаем деньги</div>${seg('budgetMode', [['each', 'Каждому свой', 'суммы разные'], ['mine', 'Только мой', 'жильё делим'], ['shared', 'Общий', 'одна сумма']])}`;
    h += `<div class="lbl">${amtLabel}${each ? ' <span class="muted">— по умолчанию, ниже можно поменять каждому</span>' : ''}</div>
      <div class="money"><input id="gAmt" type="number" inputmode="decimal" placeholder="150" value="${esc(D.amount)}">
        <select id="gCur">${['USD', 'JPY', 'RUB', 'EUR'].map(c => `<option ${D.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      ${seg('per', [['day', 'в день'], ['total', 'на всю поездку']])}`;
    if (N > 1) h += `<div class="lbl">Маршрут</div>${seg('placesMode', [['together', 'Все вместе', 'одни места'], ['separate', 'Каждый своё', 'места не повторяются']])}`;
    h += `<div class="lbl">Жильё</div>${seg('lodging', [['need', 'Подобрать', N > 1 ? 'общее на всех' : ''], ['have', 'Уже есть']])}`;
    if (!sep) h += `<div class="lbl">${N > 1 ? 'Интересы для всех' : 'Интересы'} <span class="muted">— пусто = по умолчанию</span></div>${ichips(D.interests, 'data-common')}`;
    if (each || sep) {
      h += `<div class="lbl">Участники</div><div class="members">`;
      D.members.forEach((m, i) => {
        const its = m.interests?.length ? m.interests : null;
        h += `<div class="mem"><div class="mem-row"><span class="mem-n">${i + 1}</span><input class="mem-name" data-mi="${i}" value="${esc(m.name)}" maxlength="16">
          ${each ? `<input class="mem-bud" data-mi="${i}" type="number" inputmode="decimal" placeholder="${esc(D.amount || '—')}" value="${esc(m.budget || '')}"><span class="mem-cur">${D.currency}</span>` : ''}</div>
          ${sep ? `<button class="mem-int" data-open="${i}">${its ? esc(interestsText(its)) : '<span class="muted">интересы: как у всех</span>'} <span class="muted">${D.open === i ? '▴' : '▾'}</span></button>
            ${D.open === i ? ichips(m.interests || [], `data-mem="${i}"`) : ''}` : ''}</div>`;
      });
      h += `</div>`;
      if (sep) h += `<div class="lbl">Общие интересы <span class="muted">— для тех, кому не выбрали</span></div>${ichips(D.interests, 'data-common')}`;
    }
    h += `<div id="gErr" class="g-err"></div><button class="cta" id="gGo">Собрать план</button>`;
    const sh = $('#sheet'), y = sh.scrollTop;
    $('#sheetBody').innerHTML = h;
    sh.scrollTop = y;
    bind($('#sheetBody'));
  };

  const bind = el => {
    el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
      const k = b.dataset.st, lim = k === 'people' ? 30 : 21;
      D[k] = Math.max(1, Math.min(lim, D[k] + +b.dataset.d)); draw();
    });
    el.querySelectorAll('[data-seg] button').forEach(b => b.onclick = () => { D[b.parentNode.dataset.seg] = b.dataset.v; draw(); });
    el.querySelector('#gAmt').oninput = e => { D.amount = e.target.value; el.querySelectorAll('.mem-bud').forEach(x => x.placeholder = D.amount || '—'); };
    el.querySelector('#gCur').onchange = e => { D.currency = e.target.value; el.querySelectorAll('.mem-cur').forEach(x => x.textContent = D.currency); };
    el.querySelectorAll('.mem-name').forEach(x => x.oninput = () => { D.members[+x.dataset.mi].name = x.value.trim() || `Друг ${+x.dataset.mi}`; });
    el.querySelectorAll('.mem-bud').forEach(x => x.oninput = () => { D.members[+x.dataset.mi].budget = parseFloat(x.value) || null; });
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { D.open = D.open === +b.dataset.open ? -1 : +b.dataset.open; draw(); });
    el.querySelectorAll('[data-int]').forEach(b => b.onclick = () => {
      const id = b.dataset.int;
      const list = b.hasAttribute('data-common') ? D.interests : (D.members[+b.dataset.mem].interests ||= []);
      const k = list.indexOf(id); if (k >= 0) list.splice(k, 1); else list.push(id);
      b.classList.toggle('on', k < 0);
      if (b.dataset.mem != null) { const m = D.members[+b.dataset.mem]; b.closest('.mem').querySelector('.mem-int').innerHTML = `${m.interests.length ? esc(interestsText(m.interests)) : '<span class="muted">интересы: как у всех</span>'} <span class="muted">▴</span>`; }
    });
    el.querySelector('#gGo').onclick = async () => {
      const amount = parseFloat(D.amount);
      if (!(amount > 0)) { el.querySelector('#gErr').textContent = 'Впиши сумму бюджета'; el.querySelector('#gAmt').focus(); return; }
      tr.city ||= 'tokyo';
      Object.assign(tr, { people: D.people, days: D.days, budgetMode: D.people > 1 ? D.budgetMode : null, placesMode: D.people > 1 ? D.placesMode : null, lodging: D.lodging, members: D.members });
      if (D.interests.length) tr.interests = D.interests; else delete tr.interests;
      tr.budget = { amount, currency: D.currency, per: D.per };
      tr.budgetFactor = 1;
      S.expecting = null;
      closeSheet();
      await makePlan(D.people > 1 ? `Собрал план на ${pplTxt(D.people)}.` : '');
    };
  };
  openSheet('', () => {});
  draw();
}
$('#grpTop').onclick = openGroupSheet;

// ---------------- ввод ----------------
const input = $('#input');
function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; }
input.addEventListener('input', autoGrow);
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleUser(input.value); } });
$('#composer').onsubmit = e => { e.preventDefault(); handleUser(input.value); };

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

$('#resetBtn').onclick = () => { S = blank(); save(); drawWelcome(); setChips([]); renderPlan(); showTab('chat'); };

// ---------------- старт ----------------
loadRates();
loadCity('tokyo');
if (S.msgs.length) { S.msgs.forEach(drawMsg); if (S.plan) setChips(AFTER_PLAN); }
else drawWelcome();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
