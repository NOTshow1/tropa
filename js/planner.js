// Планировщик без ИИ: делит дневной бюджет, выбирает районы под интересы,
// раскладывает реальные места из OSM по слотам дня.
import { CITY_PRICES, fmt } from './prices.js';

export const distM = (a, b, c, d) => {
  const x = (d - b) * Math.cos((a + c) / 2 * Math.PI / 180), y = c - a;
  return Math.sqrt(x * x + y * y) * 111320;
};

// какие виды мест подходят под интерес
const INTEREST_KINDS = {
  food: ['restaurant', 'fast_food', 'food_court', 'izakaya'],
  coffee: ['cafe', 'kissaten', 'bakery', 'confectionery', 'coffee'],
  bars: ['bar', 'pub', 'jazz_bar', 'standing_bar', 'brewery', 'izakaya'],
  night: ['nightclub', 'bar', 'jazz_bar'],
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
  hostel: 'хостел', capsule: 'капсульный отель', guest_house: 'гестхаус', apartment: 'апартаменты', hotel: 'отель', hotel_mid: 'отель',
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
function stayKind(prices, budgetDay, style) {
  const share = style === 'cheap' ? 0.33 : style === 'comfort' ? 0.5 : 0.42;
  const kinds = Object.entries(prices.stay).sort((a, b) => a[1].price - b[1].price);
  let pick = kinds[0];
  for (const k of kinds) if (k[1].price <= budgetDay * share) pick = k;
  return { kind: pick[0], ...pick[1] };
}

const TIERS = ['cheap', 'mid', 'nice'];

function mealPlan(prices, money, ctx) {
  // начинаем с самого дешевого, улучшаем по приоритету пока помещается
  const m = { breakfast: 'cheap', lunch: 'cheap', dinner: 'cheap', bar: false };
  const cost = () => prices.meal.breakfast[m.breakfast] + prices.meal.lunch[m.lunch] + prices.meal.dinner[m.dinner] + (m.bar ? prices.bar : 0);
  const wantsBar = !ctx.noAlcohol && (ctx.interests.includes('bars') || ctx.interests.includes('night'));
  const steps = [
    () => { m.dinner = 'mid'; },
    () => { if (wantsBar) m.bar = true; },
    () => { m.lunch = 'mid'; },
    () => { m.breakfast = 'mid'; },
    () => { m.dinner = 'nice'; },
    () => { if (!ctx.noAlcohol) m.bar = true; },
    () => { m.lunch = 'nice'; },
  ];
  for (const st of steps) {
    const saved = { ...m }; st();
    if (cost() > money) Object.assign(m, saved);
  }
  return { ...m, cost: cost() };
}

// ---------- выбор конкретных мест ----------
function pick(city, ctx, { d, groups, kinds, notKinds, tier, exclude, near, maxDist = 1800, preferFamous = false, allowChain = false, rand, payMax = Infinity }) {
  const dd = city.districts[d];
  const ref = near || dd.c;
  let best = null, bestScore = -1e9;
  for (const p of city.places) {
    if (exclude.has(p.i)) continue;
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

const SLOT_RU = { breakfast: 'Завтрак', morning: 'Утро', lunch: 'Обед', afternoon: 'День', afternoon2: 'День', dinner: 'Ужин', evening: 'Вечер' };
const TIER_RU = { cheap: 'эконом', mid: 'средний', nice: 'получше' };

export function buildPlan(city, trip, seed = 1) {
  const prices = CITY_PRICES[city.id];
  const rand = rng(seed);
  const interests = trip.interests?.length ? trip.interests : DEFAULT_INTERESTS;
  const ctx = { interests, kinds: kindsFor(interests), weird: interests.includes('weird'), noAlcohol: trip.noAlcohol, cuisine: trip.cuisine };
  const B = trip.budgetLocal; // в день, местная валюта
  const warnings = [];

  // 1. жильё
  let stay = null, stayCost = 0;
  if (trip.lodging === 'need') {
    stay = stayKind(prices, B, trip.style);
    stayCost = stay.price;
  }
  const transport = prices.transportDay;
  let money = B - stayCost - transport;

  // 2. деньги на активности: ~30% остатка, остальное на еду
  const minMeals = prices.meal.breakfast.cheap + prices.meal.lunch.cheap + prices.meal.dinner.cheap;
  const minDay = stayCost + transport + minMeals;
  if (B < minDay) warnings.push(`Минимум на день в этом городе${stay ? ' с хостелом' : ''} — примерно ${fmt(minDay, prices.currency)}. Ниже — самый экономный вариант, он выйдет чуть дороже бюджета.`);
  const actBudget = Math.max(0, Math.min((money - minMeals) * 0.35, 6000));
  const meals = mealPlan(prices, Math.max(minMeals, money - actBudget), ctx);

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
  const exclude = new Set();
  let stayOptions = [];
  if (stay) {
    const cx = dayDistricts.reduce((a, i) => a + city.districts[i].c[0], 0) / dayDistricts.length;
    const cy = dayDistricts.reduce((a, i) => a + city.districts[i].c[1], 0) / dayDistricts.length;
    const order = Object.keys(prices.stay);
    const okKinds = order.slice(0, order.indexOf(stay.kind) + 1).reverse();
    stayOptions = city.places.filter(p => p.g === 'stay' && okKinds.includes(p.k))
      .map(p => ({ p, sc: p.s + (p.k === stay.kind ? 1 : 0) + (p.w ? 0.5 : 0) - distM(cx, cy, p.la, p.lo) / 2500 + (p.c ? 2.5 : 0) + rand() * 0.5 }))
      .sort((a, b) => b.sc - a.sc).slice(0, 4).map(x => x.p);
  }

  // 5. дни
  const days = dayDistricts.map((d, di) => {
    const items = [];
    ctx.dayCu = new Set();
    const add = (slot, p, cost, note) => { if (p) { exclude.add(p.i); if (p.cu) p.cu.split(', ').forEach(c => ctx.dayCu.add(c)); } items.push({ slot, p, cost, note }); };
    let actLeft = actBudget;
    const dd = city.districts[d];

    // завтрак
    const b = mealSlot(city, ctx, d, 'breakfast', meals.breakfast, exclude, null, rand);
    add('breakfast', meals.breakfast === 'cheap' && !b ? null : b, prices.meal.breakfast[meals.breakfast],
      meals.breakfast === 'cheap' ? 'или онигири и кофе в конбини' : null);

    // утро: главная точка района (можно известная)
    const actKinds = [...ctx.kinds].filter(k => !['restaurant', 'fast_food', 'food_court', 'izakaya', 'bar', 'pub', 'jazz_bar', 'standing_bar', 'brewery', 'nightclub', 'cafe', 'kissaten', 'bakery', 'confectionery', 'coffee'].includes(k));
    const morning = pick(city, ctx, { d, groups: ['sight', 'culture'], notKinds: ['sento', 'nightclub', 'cinema', 'theatre'], exclude, preferFamous: true, rand, payMax: actLeft });
    if (morning) { actLeft -= morning.p || 0; add('morning', morning, morning.p || 0); }

    const near1 = morning ? [morning.la, morning.lo] : null;
    const lunch = mealSlot(city, ctx, d, 'lunch', meals.lunch, exclude, near1, rand);
    add('lunch', lunch, prices.meal.lunch[lunch?.t || meals.lunch]);

    // день: 2 активности под интересы (нишевые)
    let last = lunch ? [lunch.la, lunch.lo] : near1;
    for (const slot of ['afternoon', 'afternoon2']) {
      const a = (actKinds.length && pick(city, ctx, { d, groups: [...ACTIVITY_GROUPS], kinds: actKinds, notKinds: ['sento'], exclude, near: last, rand, payMax: actLeft, maxDist: 2000 }))
        || pick(city, ctx, { d, groups: [...ACTIVITY_GROUPS], notKinds: ['sento'], exclude, near: last, rand, payMax: actLeft });
      if (a) { actLeft -= a.p || 0; add(slot, a, a.p || 0); last = [a.la, a.lo]; }
    }

    // ужин
    const dinner = mealSlot(city, ctx, d, 'dinner', meals.dinner, exclude, last, rand);
    add('dinner', dinner, prices.meal.dinner[dinner?.t || meals.dinner]);
    last = dinner ? [dinner.la, dinner.lo] : last;

    // вечер
    if (meals.bar) {
      const bar = pick(city, ctx, { d, groups: ['bar'], kinds: ['bar', 'jazz_bar', 'standing_bar', 'brewery'], exclude, near: last, rand })
        || pick(city, ctx, { d, groups: ['bar'], exclude, near: last, rand, maxDist: 2500 });
      add('evening', bar, prices.bar);
    } else {
      const ev = pick(city, ctx, { d, groups: ['sight'], kinds: ['sento', 'viewpoint'], exclude, near: last, rand, payMax: Math.max(actLeft, 600), maxDist: 2500 });
      if (ev) add('evening', ev, ev.p || 0, ev.k === 'viewpoint' ? 'вечерний вид на город' : 'японская баня — 550 ¥ и полотенце на месте');
    }

    const spent = items.reduce((a, x) => a + (x.cost || 0), 0) + transport + stayCost;
    return { d, district: dd.name, items, transport, stayCost, total: spent };
  });

  const avg = days.reduce((a, x) => a + x.total, 0) / days.length;
  if (stay && stay.price > B * 0.6) warnings.push('Даже самое дешёвое жильё съедает больше половины бюджета.');
  return {
    city: city.id, currency: prices.currency, budgetDay: B, stay, stayOptions, days, meals, warnings,
    avgDay: avg, interests, seed, cuisine: trip.cuisine,
    tiers: { breakfast: TIER_RU[meals.breakfast], lunch: TIER_RU[meals.lunch], dinner: TIER_RU[meals.dinner] },
  };
}

// замена одного пункта плана: mode = 'other' | 'cheaper' | 'pricier'
export function swapItem(city, plan, di, ii, mode, seed) {
  const prices = CITY_PRICES[city.id];
  const rand = rng(seed);
  const day = plan.days[di]; const it = day.items[ii];
  const interests = plan.interests;
  // при 'дешевле/дороже' любимая кухня не должна обходить ценовой уровень
  const ctx = { interests, kinds: kindsFor(interests), weird: interests.includes('weird'), cuisine: mode === 'other' ? plan.cuisine : null };
  const exclude = new Set(plan.days.flatMap(d => d.items.map(x => x.p?.i)).filter(Boolean));
  (it.tried ||= []).forEach(i => exclude.add(i));
  const near = it.p ? [it.p.la, it.p.lo] : null;
  let np = null, cost = it.cost;
  const meal = ['breakfast', 'lunch', 'dinner'].includes(it.slot);
  if (meal) {
    let tier = it.tier || it.p?.t || plan.meals[it.slot];
    const ti = TIERS.indexOf(tier);
    if (mode === 'cheaper' && ti > 0) tier = TIERS[ti - 1];
    if (mode === 'pricier' && ti < 2) tier = TIERS[ti + 1];
    np = mealSlot(city, ctx, day.d, it.slot, tier, exclude, near, rand);
    if (np) { it.tier = np.t || tier; cost = prices.meal[it.slot][np.t || tier]; }
  } else {
    const groups = it.slot === 'evening' && it.p?.g === 'bar' ? ['bar'] : it.p ? [it.p.g] : ['sight'];
    let payMax = Infinity;
    if (mode === 'cheaper') payMax = Math.max(0, (it.cost || 0) - 1);
    np = pick(city, ctx, { d: day.d, groups, exclude, near, rand, payMax, maxDist: 2200 });
    if (mode === 'pricier' && np && (np.p || 0) <= (it.cost || 0)) {
      const alt = pick(city, ctx, { d: day.d, groups: ['culture', 'sight'], exclude, near, rand, maxDist: 2500, preferFamous: true });
      if (alt && (alt.p || 0) > (it.cost || 0)) np = alt;
    }
    if (np) cost = it.slot === 'evening' && np.g === 'bar' ? prices.bar : (np.p || 0);
  }
  if (!np) return false;
  if (it.p) it.tried.push(it.p.i);
  it.p = np; it.cost = cost; it.note = null;
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
