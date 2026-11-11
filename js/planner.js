// Планировщик без ИИ: делит дневной бюджет, выбирает районы под интересы,
// раскладывает реальные места из OSM по слотам дня.
import { CITY_PRICES, fmt } from './prices.js';
import { PREMIUM, PREMIUM_BAR, LUX_HOTEL } from './premium.js';

export const distM = (a, b, c, d) => {
  const x = (d - b) * Math.cos((a + c) / 2 * Math.PI / 180), y = c - a;
  return Math.sqrt(x * x + y * y) * 111320;
};

// какие виды мест подходят под интерес
const INTEREST_KINDS = {
  food: ['restaurant', 'fast_food', 'food_court', 'izakaya'],
  coffee: ['cafe', 'kissaten', 'bakery', 'confectionery', 'coffee'],
  bars: ['bar', 'pub', 'jazz_bar', 'standing_bar', 'brewery', 'izakaya'],
  night: ['nightclub', 'bar', 'jazz_bar', 'viewpoint'],
  photo: ['viewpoint', 'shrine', 'temple', 'garden', 'artwork', 'attraction', 'historic'],
  art: ['gallery', 'arts_centre', 'artwork'],
  museums: ['museum', 'historic'],
  anime: ['otaku'],
  nature: ['park', 'garden'],
  temples: ['shrine', 'temple'],
  vintage: ['vintage', 'records', 'used_books', 'antiques'],
  views: ['viewpoint'],
  onsen: ['sento'],
  shopping: ['vintage', 'records', 'otaku', 'books', 'tea'],
  weird: [],
};
const ACTIVITY_GROUPS = new Set(['culture', 'sight', 'shop']);
export const DEFAULT_INTERESTS = ['food', 'weird', 'temples', 'views', 'nature'];

export const KIND_RU = {
  premium: 'премиум-опыт', hostel: 'хостел', capsule: 'капсульный отель', guest_house: 'гестхаус', apartment: 'апартаменты', hotel: 'отель', hotel_mid: 'отель',
  cafe: 'кафе', kissaten: 'кисатэн — старое японское кафе', bakery: 'пекарня', confectionery: 'кондитерская', ice_cream: 'мороженое',
  restaurant: 'ресторан', fast_food: 'быстрая еда', food_court: 'фудкорт', izakaya: 'идзакая', bar: 'бар', pub: 'паб',
  jazz_bar: 'джаз-бар', standing_bar: 'бар стоя (тачиноми)', brewery: 'пивоварня', nightclub: 'клуб', sento: 'сэнто — городская баня',
  museum: 'музей', gallery: 'галерея', arts_centre: 'арт-центр', theatre: 'театр', cinema: 'кино', viewpoint: 'смотровая',
  artwork: 'арт-объект', shrine: 'синтоистское святилище', temple: 'буддийский храм', garden: 'сад', park: 'парк',
  attraction: 'достопримечательность', historic: 'историческое место', vintage: 'секонд/винтаж', records: 'пластинки',
  used_books: 'букинист', books: 'книжный', antiques: 'антиквар', otaku: 'аниме/игры/коллекционное', coffee: 'кофейная лавка', tea: 'чайная лавка',
};

// ---------- случайность с зерном (чтобы "другой вариант" был воспроизводимым) ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

function kindsFor(interests) {
  const set = new Set(); for (const i of interests) for (const k of INTEREST_KINDS[i] || []) set.add(k); return set;
}

function placeInterestBoost(p, ctx) {
  let b = 0;
  if (ctx.kinds.has(p.k)) b += 1.5;
  if (ctx.weird) b += Math.max(0, p.s) * 0.6;
  if (ctx.cuisine && p.cu && ctx.cuisine.some(c => p.cu.includes(c))) b += 2.5;
  if (ctx.dayCu && p.cu && p.cu.split(', ').some(c => c !== 'японская' && ctx.dayCu.has(c))) b -= 4;
  return b;
}

// ---------- выбор районов ----------
function rankDistricts(city, ctx) {
  const sc = city.districts.map(() => 0);
  for (const p of city.places) {
    if (p.c) continue;
    if (ctx.kinds.has(p.k) || (ctx.weird && p.s >= 1.5)) sc[p.d] += 1 + Math.max(0, p.s);
    else if (ACTIVITY_GROUPS.has(p.g)) sc[p.d] += 0.15;
  }
  // нормируем на площадь района, чтобы большие не выигрывали всегда
  return city.districts.map((d, i) => ({ i, score: sc[i] / Math.pow(d.r / 1000, 1.2) })).sort((a, b) => b.score - a.score);
}

// ---------- бюджет ----------
// сколько человек помещается в один номер/кровать — в компании жильё делится
const STAY_CAP = { hostel: 1, capsule: 1, guest_house: 2, apartment: 4, hotel: 2, hotel_mid: 2, hotel_lux: 2 };
export function stayCostFor(kind, price, people = 1) {
  const cap = STAY_CAP[kind] || 1, units = Math.ceil(people / cap);
  return { units, cap, pp: price * units / people };
}
function stayKind(prices, budgetDay, style, people = 1) {
  const share = style === 'cheap' ? 0.33 : style === 'comfort' ? 0.5 : 0.42;
  // от простого к лучшему; берём самое хорошее, что влезает по цене на человека
  const kinds = Object.entries(prices.stay).sort((a, b) => a[1].price - b[1].price)
    .map(([k, v]) => ({ kind: k, ...v, ...stayCostFor(k, v.price, people) }));
  let pick = kinds.reduce((a, b) => b.pp < a.pp ? b : a);
  for (const k of kinds) if (k.pp <= budgetDay * share && k.price >= pick.price) pick = k;
  return pick;
}

const TIERS = ['cheap', 'mid', 'nice', 'lux', 'top'];

// Раскладка дня по «лестнице»: от самого дешёвого улучшаем по приоритету, пока помещается в деньги.
// Верх лестницы — для больших бюджетов: Мишлен, бары мирового уровня, премиум-развлечения, такси, клуб.
function mealPlan(prices, money, ctx) {
  const m = { breakfast: 'cheap', lunch: 'cheap', dinner: 'cheap', bar: false, exp: 0, club: false, taxi: false };
  const barCost = () => m.bar === 'premium' ? prices.barPremium : m.bar ? prices.bar : 0;
  const cost = () => prices.meal.breakfast[m.breakfast] + prices.meal.lunch[m.lunch] + prices.meal.dinner[m.dinner] + barCost()
    + m.exp * prices.premiumAvg + clubCost(prices, m.club, ctx.crowd) + (m.taxi ? (m.taxi === 'driver' ? prices.driverDay : prices.taxiDay) - prices.transportDay : 0);
  const drinks = !ctx.noAlcohol;
  const wantsBar = drinks && (ctx.interests.includes('bars') || ctx.interests.includes('night'));
  const wantsNight = drinks && ctx.interests.includes('night');
  const steps = [
    () => { m.dinner = 'mid'; },
    () => { if (wantsBar) m.bar = true; },
    () => { m.lunch = 'mid'; },
    () => { m.breakfast = 'mid'; },
    () => { m.dinner = 'nice'; },
    () => { if (drinks) m.bar = true; },
    () => { m.lunch = 'nice'; },
    // ---- люкс ----
    () => { m.dinner = 'lux'; },                    // ужин в ресторане со звездой Мишлен
    () => { if (drinks) m.bar = 'premium'; },      // коктейли в баре из мировых рейтингов
    () => { m.exp = 1; },                           // премиум-развлечение каждый день
    () => { m.lunch = 'lux'; },                     // ланч в звёздном ресторане
    () => { m.taxi = true; },                       // такси вместо метро
    () => { m.breakfast = 'lux'; },                 // завтрак в люкс-отеле
    () => { m.dinner = 'top'; },                    // 2–3 звезды
    () => { if (wantsNight || (drinks && ctx.interests.includes('bars'))) m.club = true; },
    () => { m.exp = 2; },
    () => { if (drinks && !m.club) m.club = true; },
    () => { m.taxi = 'driver'; },                   // машина с водителем на весь день
    () => { if (m.club) m.club = 'vip'; },          // VIP-стол с шампанским
    () => { m.exp = 3; },
  ];
  for (const st of steps) {
    const saved = { ...m }; st();
    if (cost() > money) Object.assign(m, saved);
  }
  return { ...m, cost: cost() };
}

function clubCost(prices, club, crowd) {
  return !club ? 0 : club === 'vip' ? prices.club.vip : crowd >= 3 ? prices.club.table : prices.club.solo;
}

// ---------- Мишлен ----------
// цена ужина по звёздам (данные гида дают только уровень ¥–¥¥¥¥, реальный чек у 2–3★ выше)
export function michelinCost(p, slot) {
  const base = p.mi === 3 ? Math.max(p.p * 1.5, 70000) : p.mi === 2 ? Math.max(p.p * 1.2, 50000) : Math.max(p.p || 0, 20000);
  return slot === 'lunch' ? Math.round(Math.max(8000, base * 0.4) / 500) * 500 : Math.round(base / 1000) * 1000;
}
function michelinPick(city, ctx, { stars, exclude, near, d, rand }) {
  const ref = near || city.districts[d].c;
  let best = null, bs = -1e9;
  for (const p of city.michelin || []) {
    if (exclude.has(p.i) || !stars.includes(p.mi)) continue;
    const m = distM(ref[0], ref[1], p.la, p.lo);
    // ради звёздного ресторана можно и проехать, но ближе — лучше
    let s = -m / 2000 + rand() * 1.2 + stars.indexOf(p.mi) * -0.3;
    if (ctx.cuisine && p.cu && ctx.cuisine.some(c => p.cu.includes(c))) s += 2.5;
    if (ctx.dayCu && p.cu && ctx.dayCu.has(p.cu)) s -= 3;
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}
export function mealCost(prices, slot, tier, p) {
  if (p?.mi && p.mi !== 'bib') return michelinCost(p, slot);
  if (tier === 'lux' || tier === 'top') return slot === 'breakfast' ? prices.meal.breakfast.lux : prices.meal[slot].nice; // звёзд не нашлось — обычный хороший
  return prices.meal[slot][p?.t || tier];
}

// ---------- выбор конкретных мест ----------
function pick(city, ctx, { d, groups, kinds, notKinds, tier, exclude, near, maxDist = 1800, preferFamous = false, allowChain = false, rand, payMax = Infinity, test = null }) {
  const dd = city.districts[d];
  const ref = near || dd.c;
  let best = null, bestScore = -1e9;
  if (tier === 'lux' || tier === 'top') tier = 'nice';
  for (const p of city.places) {
    if (exclude.has(p.i)) continue;
    if (test && !test(p)) continue;
    if (groups && !groups.includes(p.g)) continue;
    if (kinds && !kinds.includes(p.k)) continue;
    if (notKinds && notKinds.includes(p.k)) continue;
    if (p.c && !allowChain) continue;
    if (tier && p.t && p.t !== tier) {
      const fav = ctx.cuisine && p.cu && ctx.cuisine.some(c => p.cu.includes(c));
      if (!(fav && TIERS.indexOf(p.t) <= TIERS.indexOf(tier))) continue;
    }
    if ((p.p || 0) > payMax) continue;
    const m = distM(ref[0], ref[1], p.la, p.lo);
    if (m > maxDist) continue;
    let s = p.s + placeInterestBoost(p, ctx) - m / 1500 + rand() * 0.8;
    if (preferFamous && p.f) s += 2.5;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

function mealSlot(city, ctx, d, slot, tier, exclude, near, rand) {
  let p;
  if ((tier === 'lux' || tier === 'top') && slot !== 'breakfast') {
    p = michelinPick(city, ctx, { stars: slot === 'lunch' ? [1, 2] : tier === 'top' ? [3, 2] : [1], exclude, near, d, rand });
    if (p) return p;
  }
  if (slot === 'breakfast' && tier === 'lux') {
    // завтрак/брэнч в ресторане люкс-отеля
    p = pick(city, ctx, { d, groups: ['stay'], test: x => LUX_HOTEL.test(x.n), exclude, near, rand, maxDist: 6000, allowChain: true });
    if (p) return p;
  }
  if (slot === 'breakfast') {
    p = pick(city, ctx, { d, groups: ['cafe'], kinds: tier === 'cheap' ? ['bakery', 'cafe', 'kissaten'] : ['cafe', 'kissaten', 'bakery'], exclude, near, rand });
  } else if (slot === 'dinner' && tier === 'mid' && (ctx.interests.includes('bars') || ctx.weird)) {
    p = pick(city, ctx, { d, groups: ['bar'], kinds: ['izakaya'], exclude, near, rand }) ||
        pick(city, ctx, { d, groups: ['food'], tier, exclude, near, rand });
  } else {
    p = pick(city, ctx, { d, groups: ['food', 'bar'], kinds: ['restaurant', 'fast_food', 'food_court', 'izakaya'], tier, exclude, near, rand })
      || pick(city, ctx, { d, groups: ['food'], exclude, near, rand, maxDist: 2500 });
  }
  return p;
}

const SLOT_RU = { breakfast: 'Завтрак', morning: 'Утро', lunch: 'Обед', afternoon: 'День', afternoon2: 'День', dinner: 'Ужин', evening: 'Вечер', night: 'Ночь' };
const TIER_RU = { cheap: 'эконом', mid: 'средний', nice: 'получше', lux: 'Мишлен ★', top: 'Мишлен ★★–★★★' };

// премиум-развлечение на день: под интересы, без повторов, в свободный слот
function premiumPick(city, ctx, { exclude, usedSlots, rand, near }) {
  let best = null, bs = -1e9;
  for (const x of PREMIUM[city.id] || []) {
    if (exclude.has(x.i) || usedSlots.has(x.sl) || (x.alc && ctx.noAlcohol)) continue;
    let s = x.int.filter(i => ctx.interests.includes(i)).length * 1.5 + rand() * 1.5;
    if (near) s -= distM(near[0], near[1], x.la, x.lo) / 8000;
    if (s > bs) { bs = s; best = x; }
  }
  return best && { ...best, g: 'premium', k: 'premium', s: 1 };
}

export function buildPlan(city, trip, seed = 1) {
  const prices = CITY_PRICES[city.id];
  const rand = rng(seed);
  const interests = trip.interests?.length ? trip.interests : DEFAULT_INTERESTS;
  const ctx = { interests, kinds: kindsFor(interests), weird: interests.includes('weird'), noAlcohol: trip.noAlcohol, cuisine: trip.cuisine };
  const B = trip.budgetLocal; // в день на человека, местная валюта
  const N = trip.people || 1;
  ctx.people = N;
  const crowd = trip.separate ? 1 : N; // раздельно — по барам ходят не всей толпой
  ctx.crowd = crowd;
  const warnings = [], tips = [];

  // 1. жильё (в компании — общее, цена делится на всех)
  let stay = null, stayCost = 0;
  if (trip.lodging === 'need') {
    stay = trip.stayFrom ? trip.stayFrom.stay : stayKind(prices, trip.stayBudget ?? B, trip.style, N);
    stayCost = stay.pp ?? stay.price;
  }
  const transport = prices.transportDay;
  let money = B - stayCost - transport;

  // 2. деньги на активности: ~30% остатка, остальное на еду
  const minMeals = prices.meal.breakfast.cheap + prices.meal.lunch.cheap + prices.meal.dinner.cheap;
  const minDay = stayCost + transport + minMeals;
  if (B < minDay) warnings.push(`Минимум на день в этом городе${stay ? ' с хостелом' : ''} — примерно ${fmt(minDay, prices.currency)}. Ниже — самый экономный вариант, он выйдет чуть дороже бюджета.`);
  const actBudget = Math.max(0, Math.min((money - minMeals) * 0.35, 6000));
  const meals = mealPlan(prices, Math.max(minMeals, money - actBudget), ctx);
  const dayTransport = meals.taxi === 'driver' ? prices.driverDay : meals.taxi ? prices.taxiDay : transport;

  // 3. районы по дням
  const ranked = rankDistricts(city, ctx);
  const dayDistricts = [];
  for (let i = 0; i < trip.days; i++) dayDistricts.push(ranked[i % ranked.length].i);
  // первый день — ближайший к пользователю район, если он в городе
  if (trip.here) {
    let bi = 0, bm = 1e12;
    city.districts.forEach((d, i) => { const m = distM(trip.here[0], trip.here[1], d.c[0], d.c[1]); if (m < bm) { bm = m; bi = i; } });
    if (bm < 4000) { const j = dayDistricts.indexOf(bi); if (j > 0) [dayDistricts[0], dayDistricts[j]] = [dayDistricts[j], dayDistricts[0]]; else if (j < 0) dayDistricts[0] = bi; }
  }

  // 4. конкретное жильё — в районе, ближайшем к "центру масс" всех дней
  const exclude = trip.exclude || new Set(); // общий набор — чтобы у разных людей не повторялись места
  let stayOptions = [];
  if (trip.stayFrom) stayOptions = trip.stayFrom.stayOptions;
  else if (stay) {
    const cx = dayDistricts.reduce((a, i) => a + city.districts[i].c[0], 0) / dayDistricts.length;
    const cy = dayDistricts.reduce((a, i) => a + city.districts[i].c[1], 0) / dayDistricts.length;
    const order = Object.keys(prices.stay);
    const okKinds = order.slice(0, order.indexOf(stay.kind) + 1).reverse();
    const lux = stay.kind === 'hotel_lux';
    stayOptions = city.places.filter(p => p.g === 'stay' && (lux ? LUX_HOTEL.test(p.n) : okKinds.includes(p.k) && !LUX_HOTEL.test(p.n)))
      .map(p => ({ p, sc: p.s + (p.k === stay.kind ? 1 : 0) + (p.w ? 0.5 : 0) - distM(cx, cy, p.la, p.lo) / 2500 + (p.c ? 2.5 : 0) + rand() * 0.5 }))
      .sort((a, b) => b.sc - a.sc).slice(0, 4).map(x => x.p);
  }

  // 5. дни
  const days = dayDistricts.map((d, di) => {
    const items = [];
    ctx.dayCu = new Set();
    const add = (slot, p, cost, note, tier) => { if (p) { exclude.add(p.i); if (p.cu) p.cu.split(', ').forEach(c => ctx.dayCu.add(c)); } items.push({ slot, p, cost, note, ...(tier ? { tier } : {}) }); };
    let actLeft = actBudget;
    const dd = city.districts[d];

    // завтрак
    const b = mealSlot(city, ctx, d, 'breakfast', meals.breakfast, exclude, null, rand);
    add('breakfast', meals.breakfast === 'cheap' && !b ? null : b, mealCost(prices, 'breakfast', meals.breakfast, b),
      meals.breakfast === 'cheap' ? 'или онигири и кофе в конбини' : b?.g === 'stay' ? 'завтрак в ресторане отеля' : null, meals.breakfast);

    // утро: главная точка района (можно известная)
    const actKinds = [...ctx.kinds].filter(k => !['restaurant', 'fast_food', 'food_court', 'izakaya', 'bar', 'pub', 'jazz_bar', 'standing_bar', 'brewery', 'nightclub', 'cafe', 'kissaten', 'bakery', 'confectionery', 'coffee'].includes(k));
    const morning = pick(city, ctx, { d, groups: ['sight', 'culture'], notKinds: ['sento', 'nightclub', 'cinema', 'theatre'], exclude, preferFamous: true, rand, payMax: actLeft });
    if (morning) { actLeft -= morning.p || 0; add('morning', morning, morning.p || 0); }

    const near1 = morning ? [morning.la, morning.lo] : null;
    const lunch = mealSlot(city, ctx, d, 'lunch', meals.lunch, exclude, near1, rand);
    add('lunch', lunch, mealCost(prices, 'lunch', meals.lunch, lunch), lunch?.mi ? 'ланч-сет — дешевле ужина, бронь заранее' : null, meals.lunch);

    // день: 2 активности под интересы (нишевые)
    let last = lunch ? [lunch.la, lunch.lo] : near1;
    for (const slot of ['afternoon', 'afternoon2']) {
      const a = (actKinds.length && pick(city, ctx, { d, groups: [...ACTIVITY_GROUPS], kinds: actKinds, notKinds: ['sento'], exclude, near: last, rand, payMax: actLeft, maxDist: 2000 }))
        || pick(city, ctx, { d, groups: [...ACTIVITY_GROUPS], notKinds: ['sento'], exclude, near: last, rand, payMax: actLeft });
      if (a) { actLeft -= a.p || 0; add(slot, a, a.p || 0); last = [a.la, a.lo]; }
    }

    // ужин
    const dinner = mealSlot(city, ctx, d, 'dinner', meals.dinner, exclude, last, rand);
    add('dinner', dinner, mealCost(prices, 'dinner', meals.dinner, dinner), dinner?.mi ? 'бронь за 2–4 недели, часто через консьержа' : null, meals.dinner);
    last = dinner ? [dinner.la, dinner.lo] : last;

    // вечер
    const premBar = meals.bar === 'premium' && pick(city, ctx, { d, groups: ['bar'], test: x => PREMIUM_BAR.test(x.n + ' ' + (x.o || '')), exclude, near: last, rand, maxDist: 8000, allowChain: true });
    if (premBar) add('evening', premBar, prices.barPremium, 'коктейли мирового уровня, 3–4 напитка');
    else if (meals.bar) {
      // большой компанией в крошечный джаз-бар или тачиноми не влезть
      const barKinds = crowd >= 5 ? ['bar', 'pub', 'brewery'] : ['bar', 'jazz_bar', 'standing_bar', 'brewery'];
      const bar = pick(city, ctx, { d, groups: ['bar'], kinds: barKinds, exclude, near: last, rand })
        || pick(city, ctx, { d, groups: ['bar'], exclude, near: last, rand, maxDist: 2500 });
      add('evening', bar, prices.bar);
    } else {
      const ev = pick(city, ctx, { d, groups: ['sight'], kinds: ['sento', 'viewpoint'], exclude, near: last, rand, payMax: Math.max(actLeft, 600), maxDist: 2500 });
      if (ev) add('evening', ev, ev.p || 0, ev.k === 'viewpoint' ? 'вечерний вид на город' : 'японская баня — 550 ¥ и полотенце на месте');
    }

    // премиум-развлечения: встают на место обычного пункта своего слота
    const usedSlots = new Set();
    for (let k = 0; k < meals.exp; k++) {
      const x = premiumPick(city, ctx, { exclude, usedSlots, rand, near: [dd.c[0], dd.c[1]] });
      if (!x) break;
      usedSlots.add(x.sl);
      exclude.add(x.i);
      const slot = x.sl === 'afternoon' ? 'afternoon2' : x.sl;
      const item = { slot, p: x, cost: x.p, note: x.ad };
      const j = items.findIndex(it => it.slot === slot);
      if (j >= 0) items[j] = item; else items.push(item);
    }
    // клуб — после вечера, если ночь ещё свободна
    if (meals.club && !usedSlots.has('night')) {
      const club = pick(city, ctx, { d, groups: ['night'], kinds: ['nightclub'], exclude, near: last, rand, maxDist: 6000, allowChain: true });
      if (club) add('night', club, clubCost(prices, meals.club, crowd),
        meals.club === 'vip' ? 'VIP-стол с шампанским — бронь через промоутера или консьержа' : crowd >= 3 ? 'стол с бутылкой — цена с человека' : 'вход и пара коктейлей');
    }
    const ORDER = ['breakfast', 'morning', 'lunch', 'afternoon', 'afternoon2', 'dinner', 'evening', 'night'];
    items.sort((a, b) => ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot));

    const spent = items.reduce((a, x) => a + (x.cost || 0), 0) + dayTransport + stayCost;
    return { d, district: dd.name, items, transport: dayTransport, taxi: meals.taxi, stayCost, total: spent };
  });

  const avg = days.reduce((a, x) => a + x.total, 0) / days.length;
  if (stay && stayCost > B * 0.6) warnings.push('Даже самое дешёвое жильё съедает больше половины бюджета.');
  if (crowd >= 10) warnings.push(`Вас ${N}: в идзакаи и бары на 10–20 мест такой толпой не попасть — столы бронируйте заранее, а ужинать удобнее разбившись на компании по 4–6 человек.`);
  else if (crowd >= 5) warnings.push('Компания большая — на ужин лучше бронировать стол заранее, маленькие места часто на 8–10 человек всего.');
  if (meals.dinner === 'lux' || meals.dinner === 'top') tips.push('Звёздные рестораны и премиум-развлечения бронируют заранее — за 2–4 недели, проще всего через консьержа отеля или сервисы вроде Omakase / TableCheck.');
  const free = B - avg;
  if (free > Math.max(B * 0.25, 15000)) tips.push(`Сверху остаётся ≈ ${fmt(free, prices.currency)} в день — на шопинг в Гиндзе и Омотэсандо, спонтанные бары или ещё одно развлечение.`);
  return {
    city: city.id, currency: prices.currency, budgetDay: B, people: N, stay, stayOptions, days, meals, warnings, tips,
    avgDay: avg, interests, seed, cuisine: trip.cuisine, noAlcohol: !!trip.noAlcohol,
    tiers: { breakfast: meals.breakfast === 'lux' ? 'в люкс-отеле' : TIER_RU[meals.breakfast], lunch: TIER_RU[meals.lunch], dinner: TIER_RU[meals.dinner] },
  };
}

// замена одного пункта плана: mode = 'other' | 'cheaper' | 'pricier'
export function swapItem(city, plan, di, ii, mode, seed, otherIds = []) {
  const prices = CITY_PRICES[city.id];
  const rand = rng(seed);
  const day = plan.days[di]; const it = day.items[ii];
  const interests = plan.interests;
  // при 'дешевле/дороже' любимая кухня не должна обходить ценовой уровень
  const ctx = { interests, kinds: kindsFor(interests), weird: interests.includes('weird'), cuisine: mode === 'other' ? plan.cuisine : null };
  const exclude = new Set(plan.days.flatMap(d => d.items.map(x => x.p?.i)).filter(Boolean));
  (it.tried ||= []).forEach(i => exclude.add(i));
  otherIds.forEach(i => exclude.add(i)); // места других участников
  const near = it.p ? [it.p.la, it.p.lo] : null;
  let np = null, cost = it.cost;
  const meal = ['breakfast', 'lunch', 'dinner'].includes(it.slot);
  let note = null;
  if (it.p?.g === 'premium') {
    // другое премиум-развлечение того же времени суток
    const sl = it.p.sl;
    const list = (PREMIUM[city.id] || []).filter(x => x.sl === sl && !exclude.has(x.i) && x.i !== it.p.i && !(x.alc && plan.noAlcohol)
      && (mode !== 'cheaper' || x.p < it.cost) && (mode !== 'pricier' || x.p > it.cost));
    const x = list.sort((a, b) => (b.int.filter(i => interests.includes(i)).length + rand()) - (a.int.filter(i => interests.includes(i)).length + rand()))[0];
    if (x) { np = { ...x, g: 'premium', k: 'premium', s: 1 }; cost = x.p; note = x.ad; }
  } else if (meal) {
    let tier = it.tier || (it.p?.mi && it.p.mi !== 'bib' ? (it.p.mi >= 2 ? 'top' : 'lux') : it.p?.t) || plan.meals[it.slot];
    const ti = TIERS.indexOf(tier);
    const maxT = it.slot === 'dinner' ? 4 : 3;
    if (mode === 'cheaper' && ti > 0) tier = TIERS[ti - 1];
    if (mode === 'pricier' && ti < maxT) tier = TIERS[ti + 1];
    np = mealSlot(city, ctx, day.d, it.slot, tier, exclude, near, rand);
    if (np) { it.tier = np.t && !np.mi ? np.t : tier; cost = mealCost(prices, it.slot, tier, np); note = np.mi && np.mi !== 'bib' ? 'бронь заранее' : np.g === 'stay' ? 'завтрак в ресторане отеля' : null; }
  } else {
    const premBar = it.p?.g === 'bar' && it.cost >= prices.barPremium;
    const groups = it.slot === 'evening' && it.p?.g === 'bar' ? ['bar'] : it.p ? [it.p.g] : ['sight'];
    let payMax = Infinity;
    if (mode === 'cheaper') payMax = Math.max(0, (it.cost || 0) - 1);
    if (premBar && mode !== 'cheaper') np = pick(city, ctx, { d: day.d, groups, exclude, near, rand, maxDist: 8000, allowChain: true, test: x => PREMIUM_BAR.test(x.n + ' ' + (x.o || '')) });
    else np = pick(city, ctx, { d: day.d, groups, exclude, near, rand, payMax, maxDist: it.slot === 'night' ? 6000 : 2200 });
    if (mode === 'pricier' && np && (np.p || 0) <= (it.cost || 0) && !premBar && it.slot !== 'night') {
      const alt = pick(city, ctx, { d: day.d, groups: ['culture', 'sight'], exclude, near, rand, maxDist: 2500, preferFamous: true });
      if (alt && (alt.p || 0) > (it.cost || 0)) np = alt;
    }
    if (np) cost = it.slot === 'night' ? it.cost : it.slot === 'evening' && np.g === 'bar' ? (premBar && mode !== 'cheaper' ? prices.barPremium : prices.bar) : (np.p || 0);
  }
  if (!np) return false;
  if (it.p) it.tried.push(it.p.i);
  it.p = np; it.cost = cost; it.note = note;
  day.total = day.items.reduce((a, x) => a + (x.cost || 0), 0) + day.transport + day.stayCost;
  plan.avgDay = plan.days.reduce((a, x) => a + x.total, 0) / plan.days.length;
  return true;
}

export function nearby(city, pos, { radius = 1500, groups = null, interests = [] } = {}) {
  const ctx = { kinds: kindsFor(interests), weird: true };
  return city.places
    .filter(p => !p.c && p.g !== 'stay' && (!groups || groups.includes(p.g)))
    .map(p => ({ p, m: distM(pos[0], pos[1], p.la, p.lo) }))
    .filter(x => x.m <= radius)
    .map(x => ({ ...x, sc: x.p.s + (ctx.kinds.has(x.p.k) ? 1 : 0) - x.m / 1000 }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 60);
}

export { SLOT_RU };
