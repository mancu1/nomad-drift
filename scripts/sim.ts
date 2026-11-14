/** npm run sim [-- старт цель прогонов seed] — отчёт симуляции в консоль. */
import { readFileSync } from 'node:fs';
import type { Country } from '../data/schema';
import { DEFAULT_SETTINGS, createEngine, criticalRadius, formatReport, simulate } from '../src/engine';
import { atlanticCrossings } from '../src/engine/atlantic';

const countries: Country[] = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url), 'utf8'));
const name = (iso: string) => countries.find((c) => c.iso2 === iso)?.name_ru ?? iso;
const [start = 'TR', target = 'UY', runsArg = '1000', seedArg = '20261114'] = process.argv.slice(2);
const runs = Number(runsArg);
const seed = Number(seedArg);
const settings = DEFAULT_SETTINGS;

console.log(`Настройки: R=${settings.R} км, k=${settings.k}, β=${settings.beta}, R_max=${settings.Rmax} км, режимы: ${settings.regimes.join(', ')}, seed=${seed}\n`);

const crit = criticalRadius(createEngine(countries, target, settings), start, [start]);
if (crit) {
  console.log(`Цель достижима при R ≥ ${crit.radius} км`);
  console.log(`  путь: ${crit.path.map(name).join(' → ')}`);
  console.log(`  узкое место: ${name(crit.bottleneck.from)} → ${name(crit.bottleneck.to)}, ${Math.round(crit.bottleneck.km)} км\n`);
}

const title = `${name(start)} → ${name(target)}, ${runs} прогонов`;
console.log(formatReport(`${title} (чистый случайный выбор)`, simulate(countries, { start, target, settings, runs, seed }), name));
console.log();
console.log(formatReport(`${title} (финиш, как только цель доступна)`, simulate(countries, { start, target, settings, runs, seed, finishWhenAvailable: true }), name));

const xs = atlanticCrossings(countries, target, settings, settings.Rmax);
console.log(`\n=== Атлантика при R_max = ${settings.Rmax} км ===`);
console.log(`  Возможных пересечений: ${xs.length}`);
for (const x of xs.slice(0, 5)) console.log(`    ${name(x.from)} → ${name(x.to)}, ${Math.round(x.km)} км`);
