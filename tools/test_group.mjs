// Проверка групп: жильё в складчину, раздельные маршруты без повторов мест.
import fs from 'node:fs';
import { buildPlan } from '../js/planner.js';
import { fmt } from '../js/prices.js';
const city = JSON.parse(fs.readFileSync(new URL('../data/tokyo.json', import.meta.url)));
const base = { city: 'tokyo', days: 4, lodging: 'need' };
for (const N of [1, 2, 4, 20]) {
  const p = buildPlan(city, { ...base, people: N, budgetLocal: 22000 }, 1);
  console.log(`N=${N}: ${p.stay.label} units=${p.stay.units} cap=${p.stay.cap} pp=${fmt(p.stay.pp, 'JPY')} avg=${fmt(p.avgDay, 'JPY')} warn=${p.warnings.length}`);
}
const t0 = Date.now();
const members = [['Я', ['anime', 'food']], ['Аня', ['temples', 'nature']], ['Макс', ['bars', 'night']]];
const exclude = new Set(); const plans = [];
for (const [i, [name, interests]] of members.entries()) {
  const pl = buildPlan(city, { ...base, interests, people: 3, budgetLocal: [15000, 25000, 20000][i], stayBudget: 15000, exclude, stayFrom: plans[0] || null }, 1 + i * 7919);
  pl.who = name; plans.push(pl);
}
const ids = plans.map(p => p.days.flatMap(d => d.items.map(x => x.p?.i)).filter(Boolean));
const all = ids.flat();
console.log('separate x3: places', all.length, 'unique', new Set(all).size, 'same stay:', plans.every(p => p.stay.kind === plans[0].stay.kind), 'ms', Date.now() - t0);
plans.forEach(p => console.log(' ', p.who, p.interests.join(','), fmt(p.avgDay, 'JPY'), '| день1:', p.days[0].items.map(x => x.p?.n).filter(Boolean).slice(1, 5).join(' / ')));
const t1 = Date.now(); const ex2 = new Set(); const big = [];
for (let i = 0; i < 20; i++) big.push(buildPlan(city, { ...base, days: 7, people: 20, budgetLocal: 20000, exclude: ex2, stayFrom: big[0] || null }, 1 + i * 7919));
const a2 = big.flatMap(p => p.days.flatMap(d => d.items.map(x => x.p?.i))).filter(Boolean);
console.log('separate x20, 7 days: places', a2.length, 'unique', new Set(a2).size, 'empty slots', big.flatMap(p => p.days.flatMap(d => d.items)).filter(x => !x.p).length, 'ms', Date.now() - t1);
