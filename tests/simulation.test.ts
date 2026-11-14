import { describe, expect, it } from 'vitest';
import data from '../data/countries.json';
import type { Country } from '../data/schema';
import { DEFAULT_SETTINGS, formatReport, simulate } from '../src/engine';
import { atlanticCrossings } from '../src/engine/atlantic';

const countries = data as Country[];
const name = (iso: string) => countries.find((c) => c.iso2 === iso)?.name_ru ?? iso;

describe('симуляция Турция → Уругвай, дефолтные настройки', () => {
  it('1000 прогонов: до цели доходит ≥ 95 %', () => {
    const report = simulate(countries, { start: 'TR', target: 'UY', settings: DEFAULT_SETTINGS, runs: 1000, seed: 20261114 });
    console.log(formatReport('Турция → Уругвай, 1000 прогонов', report, name));
    expect(report.share).toBeGreaterThanOrEqual(0.95);
    expect(report.medianSteps).not.toBeNull();
  });
});

describe('Атлантика', () => {
  it('пересечение существует при дефолтном R_max', () => {
    const xs = atlanticCrossings(countries, 'UY', DEFAULT_SETTINGS, DEFAULT_SETTINGS.Rmax);
    expect(xs.length).toBeGreaterThan(0);
    const { from, to, km } = xs[0];
    console.log(`Пересечений Атлантики при R_max = ${DEFAULT_SETTINGS.Rmax} км: ${xs.length}. Кратчайшее: ${name(from)} → ${name(to)}, ${Math.round(km)} км`);
    expect(km).toBeLessThan(DEFAULT_SETTINGS.Rmax * (1 + DEFAULT_SETTINGS.k));
  });
});
