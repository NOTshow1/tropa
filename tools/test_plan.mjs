import fs from 'node:fs';
import { parseMessage } from '../js/parser.js';
import { buildPlan, KIND_RU, SLOT_RU } from '../js/planner.js';
import { convert, fmt } from '../js/prices.js';
const city = JSON.parse(fs.readFileSync(new URL('../data/tokyo.json', import.meta.url)));
const text = process.argv[2] || 'Я в Токио на 3 дня, 150$ в день, жилья нет. Люблю рамен, странные бары и винтаж';
const p = parseMessage(text);
const local = convert(p.budget.amount, p.budget.currency, 'JPY');
const plan = buildPlan(city, { ...p, budgetLocal: local }, 1);
console.log(text, '\nбюджет/день', fmt(local, 'JPY'), '| жильё:', plan.stay?.label, plan.stay?.price, '| еда:', JSON.stringify(plan.tiers), 'бар:', plan.meals.bar);
console.log('варианты жилья:', plan.stayOptions.map(s => `${s.n} [${s.k}] (${city.districts[s.d].name})`).join(' | '));
for (const w of plan.warnings) console.log('WARN', w);
plan.days.forEach((d, i) => {
  console.log(`\nДень ${i + 1} — ${d.district} — итого ${fmt(d.total, 'JPY')}`);
  for (const it of d.items) console.log(`  ${SLOT_RU[it.slot].padEnd(8)} ${it.p ? it.p.n + (it.p.o ? ' / ' + it.p.o : '') + ' — ' + (KIND_RU[it.p.k] || it.p.k) + (it.p.cu ? ', ' + it.p.cu : '') + ` s=${it.p.s}${it.p.f ? ' F' : ''}` : '(нет)'}  ${fmt(it.cost || 0, 'JPY')}${it.note ? '  // ' + it.note : ''}`);
});
