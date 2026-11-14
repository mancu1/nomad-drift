import type { Country } from '../../data/schema';
import { createEngine, pick, step, type Settings } from './engine';
import { mulberry32, spinSeed } from './random';

export interface SimOptions {
  start: string;
  target: string;
  settings: Settings;
  runs: number;
  seed: number;
  maxSteps?: number;
  /** Сразу лететь в цель, как только она попала в кандидаты. */
  finishWhenAvailable?: boolean;
}

export interface SimReport {
  runs: number;
  arrived: number;
  share: number;
  medianSteps: number | null;
  minSteps: number | null;
  maxSteps: number | null;
  medianKm: number | null;
  /** Страны, где маршрут оборвался: [iso2, число прогонов]. */
  deadEnds: [string, number][];
  /** Страны, из которых приходилось расширять радиус: [iso2, число шагов]. */
  expansions: [string, number][];
  /** Самые частые промежуточные страны: [iso2, число прогонов]. */
  popular: [string, number][];
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const top = (m: Map<string, number>, n = 10): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export function simulate(countries: Country[], o: SimOptions): SimReport {
  const engine = createEngine(countries, o.target, o.settings);
  const maxSteps = o.maxSteps ?? 200;
  const steps: number[] = [];
  const kms: number[] = [];
  const dead = new Map<string, number>();
  const expansions = new Map<string, number>();
  const popular = new Map<string, number>();

  for (let run = 0; run < o.runs; run++) {
    const rng = mulberry32(spinSeed(o.seed, run));
    let current = o.start;
    const visited = [current];
    let km = 0;
    let arrived = false;
    for (let n = 0; n < maxSteps; n++) {
      const res = step(engine, current, visited);
      if (res.status === 'finished') {
        arrived = true;
        break;
      }
      if (res.status === 'dead') break;
      if (res.expanded) bump(expansions, current);
      const finish = o.finishWhenAvailable ? res.candidates.find((c) => c.isTarget) : undefined;
      const chosen = finish ?? pick(res, rng)!;
      km += chosen.flightKm;
      current = chosen.iso2;
      visited.push(current);
      if (current !== o.target) bump(popular, current);
    }
    if (current === o.target) arrived = true;
    if (arrived) {
      steps.push(visited.length - 1);
      kms.push(km);
    } else bump(dead, current);
  }

  return {
    runs: o.runs,
    arrived: steps.length,
    share: steps.length / o.runs,
    medianSteps: median(steps),
    minSteps: steps.length ? Math.min(...steps) : null,
    maxSteps: steps.length ? Math.max(...steps) : null,
    medianKm: median(kms),
    deadEnds: top(dead),
    expansions: top(expansions),
    popular: top(popular),
  };
}

export function formatReport(title: string, r: SimReport, name: (iso: string) => string): string {
  const list = (xs: [string, number][], unit: string) =>
    xs.length ? xs.map(([iso, n]) => `    ${name(iso)} (${iso}) — ${n} ${unit}`).join('\n') : '    —';
  return [
    `=== ${title} ===`,
    `  Прогонов: ${r.runs}`,
    `  Дошли до цели: ${r.arrived} (${(r.share * 100).toFixed(1)} %)`,
    `  Шагов: медиана ${r.medianSteps ?? '—'}, мин ${r.minSteps ?? '—'}, макс ${r.maxSteps ?? '—'}`,
    `  Длина маршрута, медиана: ${r.medianKm === null ? '—' : Math.round(r.medianKm) + ' км'}`,
    `  Топ тупиков:`,
    list(r.deadEnds, 'прогонов'),
    `  Где чаще всего расширялся радиус:`,
    list(r.expansions, 'шагов'),
    `  Самые частые страны маршрута:`,
    list(r.popular, 'прогонов'),
  ].join('\n');
}
