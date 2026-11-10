// Usage: node tools/fetch_city.mjs <cityId>
// Downloads named POIs from OpenStreetMap (Overpass) per district -> tools/raw/<city>_<district>.json
import fs from 'node:fs';
const cities = JSON.parse(fs.readFileSync(new URL('./cities.json', import.meta.url)));
const cityId = process.argv[2]; const city = cities[cityId];
fs.mkdirSync(new URL('./raw/', import.meta.url), { recursive: true });
const query = (lat, lon, rad) => { const A = `(around:${rad},${lat},${lon})`; return `[out:json][timeout:180];
(
 nwr["amenity"~"^(cafe|restaurant|fast_food|bar|pub|biergarten|ice_cream|nightclub|arts_centre|theatre|cinema|food_court|public_bath)$"]["name"]${A};
 nwr["shop"~"^(bakery|second_hand|books|music|antiques|art|coffee|tea|confectionery|anime|games|collector|video_games)$"]["name"]${A};
 nwr["tourism"~"^(museum|gallery|artwork|viewpoint|attraction|hostel|guest_house|hotel|apartment|motel)$"]${A};
 nwr["leisure"~"^(park|garden)$"]["name"]${A};
 nwr["amenity"="place_of_worship"]["name"]${A};
 nwr["historic"]["name"]${A};
 nwr["craft"~"^(brewery|winery|distillery|sake_brewery)$"]["name"]${A};
);
out center tags;`; };
async function overpass(q) {
  let wait = 15000;
  for (let i = 0; i < 7; i++) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TravelBudgetPrototype/0.1' }
    });
    const txt = await r.text();
    if (r.ok) return txt;
    console.error('  try', i + 1, r.status, '- retry in', wait / 1000, 's');
    await new Promise(res => setTimeout(res, wait)); wait = Math.min(wait * 2, 120000);
  }
  throw new Error('overpass failed');
}
for (const d of city.districts) {
  const out = new URL(`./raw/${cityId}_${d.id}.json`, import.meta.url);
  if (fs.existsSync(out)) { console.log(d.id, 'cached'); continue; }
  const t = Date.now();
  const txt = await overpass(query(d.c[0], d.c[1], d.r));
  fs.writeFileSync(out, txt);
  console.log(d.id, JSON.parse(txt).elements.length, 'el', ((Date.now() - t) / 1000).toFixed(0) + 's');
}
