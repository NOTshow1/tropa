// Большие бюджеты: план должен тратить деньги по-настоящему (Мишлен, премиум-развлечения), а не копить запас.
// node tools/test_lux.mjs [usd в день] [need|have] [интересы через запятую]
import fs from 'node:fs';
import { buildPlan, KIND_RU, SLOT_RU } from '../js/planner.js';
import { convert, fmt } from '../js/prices.js';
const city = JSON.parse(fs.readFileSync(new URL('../data/tokyo.json', import.meta.url)));
city.michelin = JSON.parse(fs.readFileSync(new URL('../data/tokyo_michelin.json', import.meta.url))).places;
const usdDay = +(process.argv[2] || 15000 / 7), lodging = process.argv[3] || 'have', interests = (process.argv[4] || 'food,bars,night').split(',');
const B = convert(usdDay, 'USD', 'JPY');
const p = buildPlan(city, { city: 'tokyo', days: 3, lodging, interests, budgetLocal: B }, 1);
console.log(`$${Math.round(usdDay)}/день = ${fmt(B, 'JPY')} | план ${fmt(p.avgDay, 'JPY')} (${Math.round(p.avgDay / B * 100)}%) | жильё: ${p.stay?.label || 'есть'} | лестница:`, JSON.stringify(p.meals));
p.tips.forEach(t => console.log('TIP', t));
p.days.slice(0, 2).forEach((d, i) => {
  console.log(`\nДень ${i + 1} — ${d.district} — ${fmt(d.total, 'JPY')}${d.taxi ? ' (такси)' : ''}`);
  for (const it of d.items) console.log(`  ${SLOT_RU[it.slot].padEnd(8)} ${it.p ? it.p.n + (it.p.mi ? ` [${it.p.mi}★]` : '') + ' — ' + (KIND_RU[it.p.k] || it.p.k) : '(нет)'}  ${fmt(it.cost || 0, 'JPY')}${it.note ? '  // ' + it.note : ''}`);
});
