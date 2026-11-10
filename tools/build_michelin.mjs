// Usage: node tools/build_michelin.mjs tokyo
// tools/raw/michelin/michelin.csv (github.com/ngshiheng/michelin-my-maps, MIT) -> data/<city>_michelin.json
// Берём только факты (имя, координаты, награда, кухня, цена, ссылки). Описания гида не копируем.
import fs from 'node:fs';
const city = process.argv[2] || 'tokyo';
const BOX = { tokyo: { loc: /Tokyo/i, lat: [35.45, 35.85], lon: [139.45, 139.95] } }[city];
const csv = fs.readFileSync(new URL('./raw/michelin/michelin.csv', import.meta.url), 'utf8');

// простой CSV-парсер с кавычками и переносами строк
function parse(s) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const [head, ...rows] = parse(csv);
const H = Object.fromEntries(head.map((h, i) => [h, i]));
const AWARD = { '3 Stars': 3, '2 Stars': 2, '1 Star': 1, 'Bib Gourmand': 'bib' };
const CUISINE_RU = { Sushi: 'суши', Japanese: 'японская', French: 'французская', 'Japanese Contemporary': 'современная японская', Tempura: 'темпура',
  Kaiseki: 'кайсэки', Ramen: 'рамен', Soba: 'соба', Udon: 'удон', Yakitori: 'якитори', Italian: 'итальянская', Chinese: 'китайская', 'Cantonese': 'кантонская',
  Innovative: 'авторская', 'French Contemporary': 'современная французская', Teppanyaki: 'теппанъяки', Sukiyaki: 'сукияки', Unagi: 'угорь', Tonkatsu: 'тонкацу',
  'Fugu / Pufferfish': 'фугу', Spanish: 'испанская', Korean: 'корейская', Thai: 'тайская', Indian: 'индийская', Curry: 'карри', 'Oden': 'одэн', Izakaya: 'идзакая',
  'Kushiage': 'кусиагэ', Okonomiyaki: 'окономияки', Shabu: 'сябу-сябу', 'Shabu-shabu': 'сябу-сябу', Gyoza: 'гёдза', 'Taiwanese': 'тайваньская', Szechuan: 'сычуаньская',
  'Steakhouse': 'стейки', 'Meats and Grills': 'мясо и гриль', 'Yakiniku': 'якинику', 'Barbecue': 'барбекю', 'Vegetarian': 'вегетарианская', 'Creative': 'авторская' };
// ценовой уровень ¥..¥¥¥¥ -> примерный чек на человека (ужин)
const PRICE = { 1: 3000, 2: 9000, 3: 25000, 4: 45000 };

const out = [];
for (const r of rows) {
  if (!r[H.Name]) continue;
  const lat = +r[H.Latitude], lon = +r[H.Longitude];
  if (!BOX.loc.test(r[H.Location]) || lat < BOX.lat[0] || lat > BOX.lat[1] || lon < BOX.lon[0] || lon > BOX.lon[1]) continue;
  const a = AWARD[r[H.Award]];
  if (!a) continue;
  const lvl = (r[H.Price] || '').length || null;
  const cu = (r[H.Cuisine] || '').split(',').map(x => x.trim()).filter(Boolean);
  out.push({
    i: 'm' + out.length, n: r[H.Name], la: +lat.toFixed(5), lo: +lon.toFixed(5), mi: a,
    cu: cu.map(c => CUISINE_RU[c] || c.toLowerCase()).slice(0, 2).join(', '),
    pl: lvl, p: lvl ? PRICE[lvl] : null,
    w: r[H.WebsiteUrl] || undefined, mu: r[H.Url] || undefined,
    ad: (r[H.Address] || '').replace(/,?\s*Tokyo.*$/i, '').slice(0, 90),
    g: 'food', k: 'restaurant', s: 2,
  });
}
fs.writeFileSync(new URL(`../data/${city}_michelin.json`, import.meta.url), JSON.stringify({ source: 'MICHELIN Guide via github.com/ngshiheng/michelin-my-maps (MIT)', built: new Date().toISOString().slice(0, 10), places: out }));
const cnt = {}; for (const p of out) cnt[p.mi] = (cnt[p.mi] || 0) + 1;
console.log(out.length, cnt);
console.log(out.filter(p => p.mi === 3).map(p => p.n).join(', '));
