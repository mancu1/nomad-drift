import { describe, expect, it } from 'vitest';
import data from '../data/countries.json';
import type { Country } from '../data/schema';
import { validateCountries } from '../data/schema';
import {
  DEFAULT_SETTINGS, createEngine, criticalRadius, deadEnds, diagnose, mulberry32, pick, step,
} from '../src/engine';
import { haversine } from '../src/geo';

const countries = data as Country[];
const by = new Map(countries.map((c) => [c.iso2, c]));

describe('данные', () => {
  it('проходят валидацию схемы', () => expect(validateCountries(countries)).toEqual([]));
});

describe('шаг', () => {
  const e = createEngine(countries, 'UY', DEFAULT_SETTINGS);
  const res = step(e, 'TR', ['TR']);

  it('находит не меньше трёх кандидатов', () => {
    expect(res.status).toBe('ok');
    expect(res.candidates.length).toBeGreaterThanOrEqual(3);
  });
  it('кандидаты проходят фильтры и лежат в окружности', () => {
    for (const c of res.candidates) {
      const k = by.get(c.iso2)!;
      expect(['free', 'voa']).toContain(k.visa.regime);
      expect(haversine(res.center, k.hub)).toBeLessThanOrEqual(res.radius + 1e-6);
      expect(c.iso2).not.toBe('TR');
    }
  });
  it('вероятности в сумме дают 1, вес = exp(β·progress)', () => {
    expect(res.candidates.reduce((s, c) => s + c.prob, 0)).toBeCloseTo(1, 9);
    for (const c of res.candidates) {
      expect(c.weight).toBeCloseTo(Math.exp(DEFAULT_SETTINGS.beta * (c.gainKm / res.radius)), 9);
    }
  });
  it('центр окружности в k·R от текущей точки', () => {
    expect(haversine(by.get('TR')!.hub, res.center)).toBeCloseTo(DEFAULT_SETTINGS.k * res.radius, 3);
  });
  it('посещённые и чёрный список исключаются', () => {
    const first = res.candidates[0].iso2;
    const second = res.candidates[1].iso2;
    const r2 = step(e, 'TR', ['TR', first]);
    expect(r2.candidates.map((c) => c.iso2)).not.toContain(first);
    const e2 = createEngine(countries, 'UY', { ...DEFAULT_SETTINGS, blacklist: [second] });
    expect(step(e2, 'TR', ['TR']).candidates.map((c) => c.iso2)).not.toContain(second);
  });
  it('min_days отсекает короткие и неизвестные сроки', () => {
    const e2 = createEngine(countries, 'UY', { ...DEFAULT_SETTINGS, minDays: 60 });
    for (const c of step(e2, 'TR', ['TR']).candidates) {
      if (c.isTarget) continue;
      expect(by.get(c.iso2)!.visa.days).toBeGreaterThanOrEqual(60);
    }
  });
  it('один seed — один выбор', () => {
    expect(pick(res, mulberry32(123))!.iso2).toBe(pick(res, mulberry32(123))!.iso2);
  });
  it('радиус расширяется шагами ×1.25 и не выше R_max', () => {
    const s = { ...DEFAULT_SETTINGS, R: 300, Rmax: 6000 };
    const r = step(createEngine(countries, 'UY', s), 'TR', ['TR']);
    expect(r.expanded).toBe(true);
    expect(r.radius).toBeLessThanOrEqual(6000);
    expect(Math.log(r.radius / 300) / Math.log(1.25)).toBeCloseTo(Math.round(Math.log(r.radius / 300) / Math.log(1.25)), 6);
  });
  it('без авторасширения радиус не меняется; пусто — тупик с подсказками', () => {
    const s = { ...DEFAULT_SETTINGS, R: 300, autoExpand: false };
    const r = step(createEngine(countries, 'UY', s), 'TR', ['TR']);
    expect(r.radius).toBe(300);
    expect(r.status).toBe('dead');
    const hints = diagnose(countries, 'UY', s, 'TR', ['TR']).map((h) => h.kind);
    expect(hints).toContain('autoExpand');
  });
  it('цель в окружности — «финиш доступен»; в цели — finished', () => {
    const r = step(e, 'AR', ['AR']);
    expect(r.targetAvailable).toBe(true);
    expect(step(e, 'UY', ['UY']).status).toBe('finished');
  });
});

describe('достижимость', () => {
  const e = createEngine(countries, 'UY', DEFAULT_SETTINGS);
  const crit = criticalRadius(e, 'TR', ['TR'])!;

  it('критический радиус: при нём путь есть, чуть ниже — нет', () => {
    expect(crit.path[0]).toBe('TR');
    expect(crit.path.at(-1)).toBe('UY');
    expect(crit.radius).toBeLessThanOrEqual(DEFAULT_SETTINGS.Rmax);
    const at = (R: number) => {
      const s = { ...DEFAULT_SETTINGS, R, autoExpand: false };
      const en = createEngine(countries, 'UY', s);
      return step(en, 'TR', ['TR']).status;
    };
    expect(at(crit.radius + 1)).toBe('ok');
    expect(at(crit.radius - 5)).toBe('dead');
    console.log(`Критический радиус TR→UY: ${crit.radius} км; путь ${crit.path.join(' → ')}; узкое место ${crit.bottleneck.from} → ${crit.bottleneck.to}, ${Math.round(crit.bottleneck.km)} км`);
  });
  it('узкое место — перелёт из найденного пути', () => {
    const i = crit.path.indexOf(crit.bottleneck.from);
    expect(crit.path[i + 1]).toBe(crit.bottleneck.to);
  });
  it('кандидаты никогда не являются тупиками', () => {
    const dead = new Set(deadEnds(e, 'TR', ['TR']));
    for (const c of step(e, 'TR', ['TR']).candidates) expect(dead.has(c.iso2)).toBe(false);
  });
  it('при малом R_max появляются тупики, а кандидаты их обходят', () => {
    const s = { ...DEFAULT_SETTINGS, R: 1500, Rmax: 2500 };
    const en = createEngine(countries, 'UY', s);
    const dead = deadEnds(en, 'TR', ['TR']);
    expect(dead.length).toBeGreaterThan(0);
    for (const c of step(en, 'TR', ['TR']).candidates) expect(dead).not.toContain(c.iso2);
  });
});
