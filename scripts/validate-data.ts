/** Проверка схемы и отчёт: сколько стран в каждом режиме и сколько непроверенных. */
import { readFileSync } from 'node:fs';
import { REGIMES, validateCountries, type Country } from '../data/schema';

const countries: Country[] = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url), 'utf8'));
const errors = validateCountries(countries);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const list = countries.filter((c) => !c.home);
const LABEL = { free: 'Без визы', voa: 'Виза по прилёту', evisa: 'Электронная виза', required: 'Нужна виза' };
console.log(`Стран и территорий: ${list.length} (+ Россия как страна паспорта)\n`);
console.log('Режим              всего  проверено  не подтверждено');
for (const r of REGIMES) {
  const xs = list.filter((c) => c.visa.regime === r);
  const un = xs.filter((c) => !c.visa.verified_at).length;
  console.log(`${LABEL[r].padEnd(18)} ${String(xs.length).padStart(5)}  ${String(xs.length - un).padStart(9)}  ${String(un).padStart(15)}`);
}
const unverified = list.filter((c) => !c.visa.verified_at);
console.log(`${'Итого'.padEnd(18)} ${String(list.length).padStart(5)}  ${String(list.length - unverified.length).padStart(9)}  ${String(unverified.length).padStart(15)}`);
console.log(`\nБез срока пребывания (days = null) среди невизовых: ${list.filter((c) => c.visa.regime !== 'required' && c.visa.days === null).map((c) => c.iso2).join(' ') || '—'}`);
console.log(`\nНе подтверждено (${unverified.length}):`);
for (const c of unverified) console.log(`  ${c.iso2} ${c.name_ru} — ${c.visa.regime}${c.visa.note ? ' — ' + c.visa.note : ''}`);
