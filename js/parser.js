// Разбор свободного текста ("я в Токио на 4 дня, 150$ в день, жилья нет") в параметры поездки.
// Без ИИ: ключевые слова + регулярки. Возвращает только то, что удалось понять.
// ВАЖНО: в JS \w и \b понимают только латиницу, поэтому для слов используем L = [a-zа-я] (текст уже в нижнем регистре, ё -> е).

export const CITY_ALIASES = {
  tokyo: ['токио', 'tokyo', '東京', 'токийск'],
  spb: ['питер', 'спб', 'санкт-петербург', 'петербург', 'saint petersburg', 'st petersburg', 'spb'],
};

const NUM_WORDS = {
  'один': 1, 'одну': 1, 'одна': 1, 'два': 2, 'две': 2, 'пару': 2, 'три': 3, 'четыре': 4, 'пять': 5,
  'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
};
const NUMW = Object.keys(NUM_WORDS).join('|');
const L = '[a-zа-я]';
const re = (src, f = '') => new RegExp(src.replace(/\\L/g, L), f);

const CURRENCIES = [
  ['USD', re('^(\\$|usd|долл\\L*|бакс\\L*|dollars?|dol)$')],
  ['EUR', re('^(€|eur|евро|euros?)$')],
  ['JPY', re('^(¥|￥|jpy|йен\\L*|иен\\L*|yen|円)$')],
  ['RUB', re('^(₽|rub|руб\\L*|р|р\\.)$')],
];

// интерес -> ключевые основы слов
export const INTERESTS = {
  food:     { label: 'еда', words: ['еда', 'еду', 'поесть', 'пожрать', 'вкусн', 'рамен', 'суши', 'гастро', 'стритфуд', 'уличн', 'кухн', 'food', 'eat'] },
  coffee:   { label: 'кофейни', words: ['кофе', 'кофейн', 'coffee', 'кафе', 'завтрак'] },
  bars:     { label: 'бары', words: ['бар', 'пив', 'выпить', 'крафт', 'идзакая', 'изакая', 'алко', 'сакэ', 'саке', 'коктейл', 'bar', 'beer', 'drink'] },
  night:    { label: 'ночная жизнь', words: ['клуб', 'ночн', 'тусов', 'вечеринк', 'party', 'club', 'nightlife'] },
  art:      { label: 'искусство', words: ['искусств', 'галере', 'арт', 'выставк', 'art', 'gallery', 'дизайн'] },
  museums:  { label: 'музеи', words: ['музе', 'museum', 'истори', 'history'] },
  anime:    { label: 'аниме и игры', words: ['аниме', 'манга', 'гик', 'отаку', 'игр', 'anime', 'manga', 'game', 'косплей'] },
  nature:   { label: 'природа', words: ['природ', 'парк', 'сад', 'зелен', 'погулять', 'гулять', 'прогул', 'nature', 'park', 'walk'] },
  temples:  { label: 'храмы', words: ['храм', 'святилищ', 'синто', 'будд', 'temple', 'shrine', 'духовн'] },
  vintage:  { label: 'винтаж', words: ['винтаж', 'секонд', 'пластинк', 'винил', 'книжн', 'букин', 'антиквар', 'барахолк', 'vintage', 'thrift', 'record'] },
  views:    { label: 'виды', words: ['виды', 'вид на', 'видами', 'панорам', 'смотров', 'крыш', 'закат', 'view', 'rooftop'] },
  weird:    { label: 'необычное', words: ['странн', 'необычн', 'нишев', 'андеграунд', 'андерграунд', 'неизвест', 'не туристич', 'не попс', 'атмосферн', 'аутентичн', 'местн', 'weird', 'hidden', 'local', 'секретн', 'скрыт'] },
  onsen:    { label: 'бани и онсэны', words: ['онсэн', 'онсен', 'баня', 'бани', 'сэнто', 'сенто', 'onsen', 'sento', 'спа'] },
  shopping: { label: 'шопинг', words: ['шопинг', 'магазин', 'купить', 'сувенир', 'shopping', 'shop'] },
};

const lower = s => s.toLowerCase().replace(/ё/g, 'е');
const parseNumber = raw => parseFloat(raw.replace(/\s/g, '').replace(',', '.'));

function findCity(t) {
  for (const [id, al] of Object.entries(CITY_ALIASES)) if (al.some(a => t.includes(a))) return id;
  return null;
}

const DAYW = '(дн|день|дня|дней|сут|ноч|days?|nights?)';
function findDays(t) {
  let m = t.match(re('(\\d{1,2})\\s*(-?х\\s*)?' + DAYW));
  // "150$ в день" / "на день" — это бюджет, не длительность: число перед "день" должно быть без валюты
  if (m && !re('(\\$|¥|€|₽|долл|йен|руб|евро)\\s*$').test(t.slice(0, m.index + m[1].length + 2))) {
    const n = +m[1]; return /ноч|night/.test(m[3]) ? n + 1 : n;
  }
  m = t.match(re('(?:^|\\s)(' + NUMW + ')\\s+' + DAYW));
  if (m) { const n = NUM_WORDS[m[1]]; return /ноч|night/.test(m[2]) ? n + 1 : n; }
  m = t.match(re('(\\d+|две|три|пару)\\s+недел'));
  if (m) return (NUM_WORDS[m[1]] || +m[1]) * 7;
  if (/недел|a week/.test(t)) return 7;
  if (/выходн/.test(t)) return 2;
  if (/на (один|1) день|только сегодня|на сегодня/.test(t)) return 1;
  return null;
}

function findBudget(t) {
  // "150$", "$150", "150 долларов", "15к йен", "20 тыс руб", "15000 ¥"
  const cur = '(\\$|€|¥|￥|₽|円|usd|eur|jpy|rub|долл\\L*|бакс\\L*|евро|йен\\L*|иен\\L*|руб\\L*|р\\.?(?=\\s|$|,)|yen|dollars?)';
  const num = '(\\d[\\d\\s]*(?:[.,]\\d+)?)\\s*(к|k|тыс\\.?|тысяч\\L*)?';
  let m = t.match(re(num + '\\s*' + cur));
  let amount, currency, mult = 1;
  if (m) { amount = parseNumber(m[1]); if (m[2]) mult = 1000; currency = m[3]; }
  else {
    m = t.match(re(cur + '\\s*' + num));
    if (m) { currency = m[1]; amount = parseNumber(m[2]); if (m[3]) mult = 1000; }
  }
  if (!m) {
    m = t.match(re('(бюджет|лимит|budget|могу тратить|денег)\\D{0,15}(\\d[\\d\\s]*)\\s*(к|k|тыс)?'));
    if (!m) return null;
    amount = parseNumber(m[2]); if (m[3]) mult = 1000; currency = null;
  }
  amount *= mult;
  let code = null;
  if (currency) for (const [c, r] of CURRENCIES) if (r.test(currency.trim())) { code = c; break; }
  const i = t.indexOf(m[0]);
  const around = t.slice(Math.max(0, i - 25), i) + ' ' + t.slice(i + m[0].length, i + m[0].length + 25);
  let per = null;
  if (/(в|на|\/)\s*(день|сутки)|per day|a day|\/day|ежеднев/.test(around)) per = 'day';
  else if (/всего|на вс[юеё]|на поездку|total|в сумме|общий|итого/.test(around)) per = 'total';
  return { amount, currency: code, per };
}

const STAY = '(жиль[a-zа-я]*|жилья|отел[a-zа-я]*|хостел[a-zа-я]*|ночлег[a-zа-я]*|гостиниц[a-zа-я]*)';
function findLodging(t) {
  if (re(STAY + '\\s*(нет|не\\s*(взял|брал|забронир|нашел|нашла|искал))').test(t) ||
      re('(нет|без)\\s+' + STAY).test(t) ||
      /негде\s+(жить|спать|ночевать)|где (жить|спать|ночевать) не знаю|не знаю,? где (жить|спать|ночевать)/.test(t) ||
      re('(нужн\\L*|ищу|найди|подбери|подобрать|надо)\\s+(и\\s+)?' + STAY).test(t) ||
      /no (hotel|place to stay|accommodation)|need (a )?(hotel|place)/.test(t)) return 'need';
  if (re(STAY + '\\s*(уже\\s*)?(есть|оплачен|забронир|снял|сняли)').test(t) ||
      re('есть\\s+(где жить|' + STAY + ')').test(t) ||
      /живу у|остановил[a-zа-я]* (у|в)|уже\s+(заселил|живу)|have (a )?(hotel|place)/.test(t)) return 'have';
  return null;
}

function findInterests(t) {
  const found = [];
  for (const [id, { words }] of Object.entries(INTERESTS)) if (words.some(w => t.includes(w))) found.push(id);
  return found;
}

function findStyle(t) {
  if (/дешев|эконом|бюджетн|сэконом|cheap/.test(t)) return 'cheap';
  if (/комфорт|не экономить|кайфануть|шикан|роскош|люкс|luxury/.test(t)) return 'comfort';
  return null;
}

// конкретные кухни -> как они подписаны в базе (CUISINE_RU в build_city)
const CUISINES = [['рамен', 'рамен'], ['суши', 'суши'], ['якитори', 'якитори'], ['удон', 'удон'], ['соба', 'соба'], ['тонкацу', 'тонкацу'],
  ['окономияки', 'окономияки'], ['карри', 'карри'], ['темпур', 'темпура'], ['угор', 'угорь'], ['гедза', 'гёдза'], ['гёдза', 'гёдза'],
  ['якинику', 'якинику'], ['гюдон', 'гюдон'], ['морепродукт', 'морепродукты'], ['пицц', 'пицца'], ['ramen', 'рамен'], ['sushi', 'суши']];

/** Главная функция: текст -> частичные параметры */
export function parseMessage(text) {
  const t = ' ' + lower(text) + ' ';
  const res = {};
  const city = findCity(t); if (city) res.city = city;
  const days = findDays(t); if (days) res.days = Math.min(days, 21);
  const budget = findBudget(t); if (budget) res.budget = budget;
  const lodging = findLodging(t); if (lodging) res.lodging = lodging;
  const interests = findInterests(t); if (interests.length) res.interests = interests;
  const cu = [...new Set(CUISINES.filter(([w]) => t.includes(w)).map(x => x[1]))]; if (cu.length) res.cuisine = cu;
  const style = findStyle(t); if (style) res.style = style;
  if (/(без|не надо|не нужн[a-zа-я]*)\s+(бар|алко|пить)|не пью/.test(t)) { res.noAlcohol = true; if (res.interests) { res.interests = res.interests.filter(i => i !== 'bars'); if (!res.interests.length) delete res.interests; } }
  if (/(я|мы)\s+(здесь|тут)|по геолокац|где я/.test(t) && !city) res.useGeo = true;
  return res;
}

/** Ответы на уточняющий вопрос: "4", "да", "нет" */
export function parseShortAnswer(text, expecting) {
  const t = lower(text.trim());
  if (expecting === 'days') { const n = parseInt(t); if (n > 0) return { days: Math.min(n, 21) }; if (NUM_WORDS[t]) return { days: NUM_WORDS[t] }; }
  if (expecting === 'budget') { const n = parseNumber(t.replace(/[^\d.,\s]/g, '').trim() || 'x'); if (n > 0) return { budget: { amount: n, currency: null, per: null } }; }
  if (expecting === 'lodging') {
    if (/^(нет|не|неа|no|нету|надо|нужно|ищу|подбери)/.test(t)) return { lodging: 'need' };
    if (/^(да|есть|yes|ага|уже)/.test(t)) return { lodging: 'have' };
  }
  return {};
}
