import type { Country } from '../../data/schema';
import { haversine } from '../geo';
import { passesFilters, stepCenter, type Settings } from './engine';

/** Страны Америки (для проверки пересечения Атлантики). */
export const AMERICAS = new Set(
  ('US CA MX BZ CR SV GT HN NI PA AG BS BB CU DM DO GD HT JM KN LC VC TT ' +
    'AR BO BR CL CO EC GY PY PE SR UY VE').split(' '),
);
/** Тихоокеанские страны: перелёт оттуда в Америку — не Атлантика. */
const PACIFIC = new Set('AU NZ FJ KI MH FM NR PW PG WS SB TO TV VU CK NU JP KR KP TW PH'.split(' '));

export interface Crossing {
  from: string;
  to: string;
  km: number;
}

/**
 * Все шаги Старый Свет → Америка, возможные при радиусе r на пути к target,
 * от самого короткого перелёта к самому длинному.
 */
export function atlanticCrossings(countries: Country[], target: string, s: Settings, r: number): Crossing[] {
  const t = countries.find((c) => c.iso2 === target)!;
  const ok = countries.filter((c) => c.iso2 === target || passesFilters(c, s));
  const out: Crossing[] = [];
  for (const a of ok) {
    if (AMERICAS.has(a.iso2) || PACIFIC.has(a.iso2)) continue;
    const c = stepCenter(a.hub, t.hub, s.k, r);
    for (const b of ok) {
      if (AMERICAS.has(b.iso2) && haversine(c, b.hub) <= r) {
        out.push({ from: a.iso2, to: b.iso2, km: haversine(a.hub, b.hub) });
      }
    }
  }
  return out.sort((x, y) => x.km - y.km);
}
