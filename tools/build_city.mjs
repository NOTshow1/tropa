// Usage: node tools/build_city.mjs <cityId>
// tools/raw/<city>_*.json (OSM) -> data/<city>.json (компактная база мест для приложения)
import fs from 'node:fs';
const cities = JSON.parse(fs.readFileSync(new URL('./cities.json', import.meta.url)));
const cityId = process.argv[2]; const city = cities[cityId];
const rawDir = new URL('./raw/', import.meta.url);

const CHAINS = /starbucks|スターバックス|doutor|ドトール|tully|タリーズ|mcdonald|マクドナルド|matsuya|松屋|yoshinoya|吉野家|sukiya|すき家|saizeriya|サイゼリヤ|kfc|ケンタッキー|komeda|コメダ|excelsior|エクセルシオール|pronto|プロント|mos ?burger|モスバーガー|lotteria|ロッテリア|burger king|subway|サブウェイ|gusto|ガスト|jonathan|ジョナサン|denny|デニーズ|coco ?ichi|ココイチ|ＣｏＣｏ壱番屋|ichiran|一蘭|ippudo|一風堂|hidakaya|日高屋|fujisoba|富士そば|nakau|なか卯|tenya|てんや|toyoko inn|東横イン|apa hotel|アパホテル|dormy|super hotel|スーパーホテル|veloce|ベローチェ|caffe ?ciao|カフェ・ド・クリエ|cafe de crie|segafredo|blue bottle|ブルーボトル|% arabica|bills|shake shack|krispy|mister donut|ミスタードーナツ|beck'?s|ベックス|st\.? ?marc|サンマルク|renoir|ルノアール|kura sushi|くら寿司|sushiro|スシロー|hama ?sushi|はま寿司|kappa|かっぱ寿司|torikizoku|鳥貴族|watami|和民|uotami|魚民|shirokiya|白木屋|hub|ハブ|gong ?cha|ゴンチャ|book ?off|ブックオフ|2nd street|セカンドストリート|hard ?off|ハードオフ|off ?house|オフハウス|kaitori|買取|リサイクル|recycle|treasure factory|トレジャーファクトリー|daikokuya|大黒屋|komehyo|コメ兵|brand off|ブランドオフ/i;

const LOVE = /love|ラブ|レジャー|ホテル.*(バリ|アイネ)|hotel (balian|aine|bali an)/i;
const CHEAP_CUISINE = /ramen|noodle|soba|udon|gyudon|beef_bowl|curry|donburi|fast|burger|onigiri|gyoza|takoyaki|bento|tachigui|tendon|katsudon|kebab|sandwich|bakery|crepe|dumpling/;
const NICE_CUISINE = /kaiseki|french|steak|yakiniku|wagyu|kappo|fine|fugu|tempura|teppanyaki|sukiyaki|shabu|unagi|omakase/;
const MID_CUISINE = /izakaya|yakitori|okonomiyaki|monjayaki|sushi|tonkatsu|italian|pizza|chinese|korean|thai|indian|vietnamese|nepal|spanish|seafood|oden|kushikatsu|japanese|western|yoshoku|regional/;

const CUISINE_RU = {
  ramen: 'рамен', noodle: 'лапша', soba: 'соба', udon: 'удон', sushi: 'суши', izakaya: 'идзакая', yakitori: 'якитори',
  okonomiyaki: 'окономияки', monjayaki: 'мондзяяки', tonkatsu: 'тонкацу', curry: 'японское карри', gyudon: 'гюдон',
  beef_bowl: 'гюдон', yakiniku: 'якинику', tempura: 'темпура', unagi: 'угорь', kaiseki: 'кайсэки', italian: 'итальянская',
  pizza: 'пицца', chinese: 'китайская', korean: 'корейская', thai: 'тайская', indian: 'индийская', nepalese: 'непальская',
  vietnamese: 'вьетнамская', french: 'французская', burger: 'бургеры', coffee_shop: 'кофейня', japanese: 'японская',
  seafood: 'морепродукты', oden: 'одэн', kushikatsu: 'кусикацу', gyoza: 'гёдза', takoyaki: 'такояки', dumpling: 'пельмени',
  shabu_shabu: 'сябу-сябу', sukiyaki: 'сукияки', steak: 'стейки', spanish: 'испанская', mexican: 'мексиканская',
  american: 'американская', bakery: 'пекарня', cake: 'десерты', sandwich: 'сэндвичи', western: 'ёсёку', donburi: 'донбури',
  soba_noodle: 'соба', udon_noodle: 'удон', fish: 'рыба', tea: 'чай', crepe: 'крепы', ice_cream: 'мороженое', bar: 'бар',
};

const files = fs.readdirSync(rawDir).filter(f => f.startsWith(cityId + '_'));
const dIndex = Object.fromEntries(city.districts.map((d, i) => [d.id, i]));
const dist = (a, b, c, d) => { const x = (d - b) * Math.cos((a + c) / 2 * Math.PI / 180), y = c - a; return Math.sqrt(x * x + y * y) * 111320; };

const byId = new Map();
for (const f of files) {
  const did = f.slice(cityId.length + 1, -5);
  const j = JSON.parse(fs.readFileSync(new URL(f, rawDir)));
  for (const e of j.elements) {
    const key = e.type[0] + e.id;
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null || !e.tags) continue;
    const d0 = city.districts[dIndex[did]];
    const dd = dist(lat, lon, d0.c[0], d0.c[1]);
    const prev = byId.get(key);
    if (!prev || dd < prev.dd) byId.set(key, { e, lat, lon, d: dIndex[did], dd });
  }
}

function classify(t) {
  const name = t.name || '';
  const a = t.amenity, tr = t.tourism, sh = t.shop, le = t.leisure, hi = t.historic, cr = t.craft;
  if (tr === 'hotel' || tr === 'motel') {
    if (LOVE.test(name) || t.love_hotel || t.hotel === 'love') return null;
    if (/capsule|カプセル/i.test(name) || t.capsule === 'yes') return ['stay', 'capsule'];
    return ['stay', (+t.stars >= 4) ? 'hotel_mid' : 'hotel'];
  }
  if (tr === 'hostel') return ['stay', /capsule|カプセル/i.test(name) ? 'capsule' : 'hostel'];
  if (tr === 'guest_house') return ['stay', 'guest_house'];
  if (tr === 'apartment') return ['stay', 'apartment'];
  if (a === 'cafe') {
    if (/喫茶|純喫茶|kissa/i.test(name)) return ['cafe', 'kissaten'];
    return ['cafe', 'cafe'];
  }
  if (sh === 'bakery' || sh === 'confectionery') return ['cafe', sh];
  if (a === 'ice_cream') return ['cafe', 'ice_cream'];
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') {
    if ((t.cuisine || '').includes('izakaya') || /居酒屋/.test(name)) return ['bar', 'izakaya'];
    return ['food', a];
  }
  if (a === 'bar') return ['bar', /jazz|ジャズ/i.test(name) || /jazz/.test(t.music || '') ? 'jazz_bar' : /立ち飲み|立呑|tachinomi/i.test(name) ? 'standing_bar' : 'bar'];
  if (a === 'pub') return ['bar', /居酒屋/.test(name) ? 'izakaya' : 'pub'];
  if (a === 'biergarten' || cr) return ['bar', 'brewery'];
  if (a === 'nightclub') return ['night', 'nightclub'];
  if (a === 'public_bath') return ['sight', 'sento'];
  if (tr === 'museum') return ['culture', 'museum'];
  if (tr === 'gallery' || sh === 'art') return ['culture', 'gallery'];
  if (a === 'arts_centre') return ['culture', 'arts_centre'];
  if (a === 'theatre') return ['culture', 'theatre'];
  if (a === 'cinema') return ['culture', 'cinema'];
  if (tr === 'viewpoint') return name ? ['sight', 'viewpoint'] : null;
  if (tr === 'artwork') return name ? ['sight', 'artwork'] : null;
  if (a === 'place_of_worship') {
    if (t.religion === 'shinto') return ['sight', 'shrine'];
    if (t.religion === 'buddhist') return ['sight', 'temple'];
    return null;
  }
  if (le === 'garden') return name ? ['sight', 'garden'] : null;
  if (le === 'park') return name ? ['sight', 'park'] : null;
  if (tr === 'attraction') return name ? ['sight', 'attraction'] : null;
  if (hi) {
    if (!name || /memorial|boundary_stone|milestone|wayside|tomb|grave|stone/.test(hi)) return null;
    return ['sight', 'historic'];
  }
  if (sh === 'second_hand') return ['shop', 'vintage'];
  if (sh === 'music') return ['shop', 'records'];
  if (sh === 'books') return ['shop', /古書|古本|antiquarian/i.test(name) || t.second_hand === 'only' ? 'used_books' : 'books'];
  if (sh === 'antiques') return ['shop', 'antiques'];
  if (sh === 'anime' || sh === 'collector' || sh === 'games' || sh === 'video_games') return ['shop', 'otaku'];
  if (sh === 'coffee' || sh === 'tea') return ['shop', sh];
  return null;
}

const P = {
  hostel: 4500, capsule: 5000, guest_house: 8000, apartment: 11000, hotel: 13000, hotel_mid: 22000,
  museum: 1200, cinema: 2000, theatre: 4000, garden: 300, sento: 550, nightclub: 3000, attraction: 800,
};

function score(t, g, k) {
  let s = 0;
  const chain = !!(t.brand || t['brand:wikidata']) || CHAINS.test(t.name || '') || CHAINS.test(t['name:en'] || '');
  const famous = !chain && !!(t.wikipedia || t.wikidata);
  if (chain) s -= 3;
  if (famous) s -= 0.5;
  if (t.opening_hours) s += 0.4;
  if (t.website || t['contact:website'] || t.url) s += 0.3;
  if (t['name:en']) s += 0.3;
  if (t.cuisine) s += 0.3;
  if (t.description) s += 0.2;
  const bonus = { kissaten: 1.4, jazz_bar: 1.3, standing_bar: 1.2, brewery: 1.3, sento: 1.6, vintage: 1.1, records: 1.3,
    used_books: 1.2, antiques: 0.8, otaku: 0.6, viewpoint: 1.0, gallery: 1.1, arts_centre: 0.9, artwork: 0.4,
    garden: 0.7, museum: famous ? 0 : 0.8, shrine: 0.3, temple: 0.3, izakaya: 0.6, theatre: 0.4, cinema: 0.3 }[k] || 0;
  s += bonus;
  if (/craft|クラフト|ビール|beer|ブルワリー/i.test((t.name || '') + (t.cuisine || '') + (t.drink || ''))) s += 0.8;
  if (/横丁|yokocho|alley|ゴールデン街|golden gai/i.test(t.name || '')) s += 1.2;
  if (/^(ramen|soba|udon|yakitori|okonomiyaki|monjayaki|oden|kushikatsu|tonkatsu|unagi|tempura)/.test(t.cuisine || '') && !chain) s += 0.5;
  return { s: Math.round(s * 10) / 10, chain, famous };
}

function tier(t, g, k) {
  const c = (t.cuisine || '') + ' ' + (t.name || '');
  if (k === 'fast_food' || CHEAP_CUISINE.test(c) || /ラーメン|そば|うどん|丼|カレー|食堂|定食/.test(t.name || '')) return 'cheap';
  if (NICE_CUISINE.test(c) || /割烹|懐石|鮨/.test(t.name || '')) return 'nice';
  return 'mid';
}

function displayName(t) {
  return t['name:ru'] || t['name:en'] || t['name:ja_rm'] || t['name:ja-Latn'] || t.name;
}

function ticket(t, k) {
  if (t.fee === 'no') return 0;
  const ch = (t.charge || '').match(/(\d[\d,]*)\s*(JPY|yen|円)/i);
  if (ch) return +ch[1].replace(/,/g, '');
  return P[k] ?? 0;
}

const out = [];
const stats = {};
for (const { e, lat, lon, d } of byId.values()) {
  const t = e.tags; const cls = classify(t);
  if (!cls) continue;
  const name = displayName(t); if (!name) continue;
  const [g, k] = cls;
  const { s, chain, famous } = score(t, g, k);
  const p = { i: e.type[0] + e.id, n: name, g, k, d, la: +lat.toFixed(5), lo: +lon.toFixed(5), s };
  if (t.name && t.name !== name) p.o = t.name;
  if (chain) p.c = 1;
  if (famous) p.f = 1;
  if (t.cuisine) {
    const cu = t.cuisine.split(';').map(x => x.trim()).filter(Boolean);
    const ru = cu.map(x => CUISINE_RU[x]).filter(Boolean);
    if (ru.length) p.cu = ru.slice(0, 2).join(', ');
  }
  if (g === 'food' || g === 'bar' || g === 'cafe') p.t = g === 'bar' && k !== 'izakaya' ? 'mid' : tier(t, g, k);
  if (g === 'stay') p.p = P[k];
  if (g === 'culture' || g === 'sight' || g === 'night') p.p = ticket(t, k);
  if (t.opening_hours) p.h = t.opening_hours.slice(0, 80);
  const w = t.website || t['contact:website'] || t.url; if (w) p.w = w;
  if (t.wikipedia) p.wp = t.wikipedia;
  if (t.stars) p.st = +t.stars || undefined;
  out.push(p);
  stats[g + '/' + k] = (stats[g + '/' + k] || 0) + 1;
}

const data = {
  id: cityId, name: city.name, country: city.country, currency: city.currency, center: city.center,
  districts: city.districts.map(d => ({ id: d.id, name: d.name, c: d.c, r: d.r })),
  built: new Date().toISOString().slice(0, 10),
  places: out,
};
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const json = JSON.stringify(data);
fs.writeFileSync(new URL(`../data/${cityId}.json`, import.meta.url), json);
console.log(out.length, 'places,', (json.length / 1e6).toFixed(2), 'MB');
console.log(Object.entries(stats).sort((a, b) => b[1] - a[1]).map(x => x.join('=')).join('  '));
const perD = {}; for (const p of out) perD[data.districts[p.d].id] = (perD[data.districts[p.d].id] || 0) + 1; console.log(perD);
