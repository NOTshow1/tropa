// Средние цены по городу (в местной валюте). Это оценки, в интерфейсе показываются как "≈".
// Источник: типичные цены 2025–2026 (хостелы, ланч-сеты, проезд). Править здесь.

export const CITY_PRICES = {
  tokyo: {
    currency: 'JPY',
    transportDay: 900,          // метро + пара поездок (Tokyo Subway 24h ≈ 800)
    stay: {                     // за ночь
      hostel:      { price: 4500,  label: 'кровать в хостеле' },
      capsule:     { price: 5000,  label: 'капсульный отель' },
      guest_house: { price: 8000,  label: 'гестхаус, своя комната' },
      apartment:   { price: 11000, label: 'апартаменты' },
      hotel:       { price: 13000, label: 'бизнес-отель' },
      hotel_mid:   { price: 22000, label: 'хороший отель' },
      hotel_lux:   { price: 110000, label: 'люкс-отель 5★' },
    },
    meal: {
      // lux / top — уровень Мишлен (точная цена берётся у конкретного ресторана, здесь — оценка для раскладки бюджета)
      breakfast: { cheap: 600,  mid: 1100, nice: 1800, lux: 6000 },                 // конбини / кафе / брантч / завтрак в люкс-отеле
      lunch:     { cheap: 1000, mid: 1600, nice: 3000, lux: 12000, top: 12000 },    // … / ланч в звёздном ресторане
      dinner:    { cheap: 1300, mid: 3500, nice: 7000, lux: 30000, top: 65000 },    // … / 1★ / 2–3★
    },
    bar: 2500,           // вечер в баре (2–3 напитка + закуска)
    barPremium: 9000,    // бар из мировых рейтингов / бар люкс-отеля, 3–4 коктейля
    club: { solo: 12000, table: 35000, vip: 70000 }, // клуб: вход и напитки / доля стола в компании / VIP-стол с шампанским
    premiumAvg: 30000,   // средняя цена премиум-развлечения — для раскладки бюджета
    taxiDay: 12000,      // такси весь день вместо метро
    driverDay: 75000,    // машина с водителем (Alphard и т.п.) на 8–10 часов
    coffee: 600,
    ticket: { museum: 1200, gallery: 0, cinema: 2000, theatre: 4000, viewpoint: 0, attraction: 800,
              park: 0, garden: 300, temple: 0, sento: 550, shop: 0, artwork: 0, historic: 0, nightclub: 3000 },
    // известные платные места: имя (en/ja часть) -> цена
    known: [
      [/shibuya sky|渋谷スカイ/i, 2500], [/tokyo skytree|東京スカイツリー/i, 2400], [/tokyo tower|東京タワー/i, 1500],
      [/teamlab|チームラボ/i, 4000], [/shinjuku gyoen|新宿御苑/i, 500], [/ghibli|ジブリ/i, 1000],
      [/metropolitan government|都庁/i, 0], [/mori art|森美術館/i, 2000], [/national museum|国立博物館/i, 1000],
      [/hamarikyu|浜離宮/i, 300], [/rikugien|六義園/i, 300], [/koishikawa|小石川後楽園/i, 300],
    ],
  },
};

// Резервные курсы (сколько единиц валюты за 1 USD). Перезаписываются свежими при наличии сети.
export const FALLBACK_RATES = { USD: 1, JPY: 150, EUR: 0.88, RUB: 82 };
let RATES = { ...FALLBACK_RATES };
let ratesDate = null;

export async function loadRates() {
  try {
    const cached = JSON.parse(localStorage.getItem('rates') || 'null');
    if (cached && Date.now() - cached.t < 12 * 3600e3) { RATES = cached.r; ratesDate = cached.d; return; }
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    if (j.result === 'success') {
      RATES = { USD: 1, JPY: j.rates.JPY, EUR: j.rates.EUR, RUB: j.rates.RUB };
      ratesDate = j.time_last_update_utc;
      localStorage.setItem('rates', JSON.stringify({ t: Date.now(), r: RATES, d: ratesDate }));
    }
  } catch { /* офлайн — остаются резервные */ }
}

export const convert = (amount, from, to) => from === to ? amount : amount / RATES[from] * RATES[to];
export const ratesInfo = () => ({ rates: RATES, date: ratesDate });

const SYMBOL = { USD: '$', JPY: '¥', EUR: '€', RUB: '₽' };
export function fmt(amount, cur) {
  const v = cur === 'USD' || cur === 'EUR' ? Math.round(amount) : Math.round(amount / 10) * 10;
  const s = v.toLocaleString('ru-RU');
  return cur === 'USD' ? '$' + s : s + ' ' + SYMBOL[cur];
}
