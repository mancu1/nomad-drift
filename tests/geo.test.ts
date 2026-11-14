import { describe, expect, it } from 'vitest';
import { bearing, destination, haversine, pointOnArc } from '../src/geo';
import { mulberry32, weightedPick } from '../src/engine/random';

const IST = { lat: 41.2753, lon: 28.7519 };
const MVD = { lat: -34.8384, lon: -56.0308 };
const LHR = { lat: 51.4706, lon: -0.461941 };
const JFK = { lat: 40.6398, lon: -73.7789 };

describe('haversine', () => {
  it('ноль для совпадающих точек', () => expect(haversine(IST, IST)).toBe(0));
  it('симметрична', () => expect(haversine(IST, MVD)).toBeCloseTo(haversine(MVD, IST), 9));
  it('LHR–JFK ≈ 5540 км', () => {
    expect(haversine(LHR, JFK)).toBeGreaterThan(5500);
    expect(haversine(LHR, JFK)).toBeLessThan(5580);
  });
  it('четверть экватора', () =>
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo((Math.PI / 2) * 6371.0088, 6));
  it('через антимеридиан', () =>
    expect(haversine({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })).toBeCloseTo(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 2 }), 6));
  it('полюс–полюс — половина окружности', () =>
    expect(haversine({ lat: 90, lon: 0 }, { lat: -90, lon: 50 })).toBeCloseTo(Math.PI * 6371.0088, 6));
});

describe('bearing', () => {
  const o = { lat: 0, lon: 0 };
  it('север', () => expect(bearing(o, { lat: 10, lon: 0 })).toBeCloseTo(0, 9));
  it('восток', () => expect(bearing(o, { lat: 0, lon: 10 })).toBeCloseTo(90, 9));
  it('юг', () => expect(bearing(o, { lat: -10, lon: 0 })).toBeCloseTo(180, 9));
  it('запад', () => expect(bearing(o, { lat: 0, lon: -10 })).toBeCloseTo(270, 9));
  it('LHR→JFK ≈ 288°', () => {
    expect(bearing(LHR, JFK)).toBeGreaterThan(286);
    expect(bearing(LHR, JFK)).toBeLessThan(290);
  });
  it('согласован с destination', () => {
    const p = destination(IST, 213, 1800);
    expect(bearing(IST, p)).toBeCloseTo(213, 6);
    expect(haversine(IST, p)).toBeCloseTo(1800, 6);
  });
});

describe('pointOnArc', () => {
  const d = haversine(IST, MVD);
  it('0 км — начало', () => expect(haversine(pointOnArc(IST, MVD, 0), IST)).toBeLessThan(1e-6));
  it('полная длина — конец', () => expect(haversine(pointOnArc(IST, MVD, d), MVD)).toBeLessThan(1e-6));
  it('точка лежит на дуге на заданном расстоянии', () => {
    const p = pointOnArc(IST, MVD, 1250);
    expect(haversine(IST, p)).toBeCloseTo(1250, 6);
    expect(haversine(p, MVD)).toBeCloseTo(d - 1250, 6);
  });
  it('совпадает с destination по начальному азимуту', () => {
    const p = pointOnArc(IST, MVD, 3000);
    expect(haversine(p, destination(IST, bearing(IST, MVD), 3000))).toBeLessThan(1e-6);
  });
  it('середина равноудалена', () => {
    const m = pointOnArc(LHR, JFK, haversine(LHR, JFK) / 2);
    expect(haversine(LHR, m)).toBeCloseTo(haversine(m, JFK), 6);
  });
  it('совпадающие точки не дают NaN', () => expect(pointOnArc(IST, IST, 500)).toEqual(IST));
});

describe('weightedPick', () => {
  it('границы интервалов', () => {
    const w = [1, 3, 6];
    expect(weightedPick(w, 0)).toBe(0);
    expect(weightedPick(w, 0.0999)).toBe(0);
    expect(weightedPick(w, 0.1001)).toBe(1);
    expect(weightedPick(w, 0.3999)).toBe(1);
    expect(weightedPick(w, 0.4001)).toBe(2);
    expect(weightedPick(w, 0.999999)).toBe(2);
  });
  it('нулевые веса не выбираются', () => {
    for (let u = 0; u < 1; u += 0.01) expect(weightedPick([0, 5, 0], u)).toBe(1);
  });
  it('пустой список и нулевая сумма → -1', () => {
    expect(weightedPick([], 0.5)).toBe(-1);
    expect(weightedPick([0, 0], 0.5)).toBe(-1);
  });
  it('частоты сходятся к весам', () => {
    const w = [1, 2, 7];
    const n = [0, 0, 0];
    const rng = mulberry32(42);
    for (let i = 0; i < 100_000; i++) n[weightedPick(w, rng())]++;
    expect(n[0] / 1e5).toBeCloseTo(0.1, 2);
    expect(n[1] / 1e5).toBeCloseTo(0.2, 2);
    expect(n[2] / 1e5).toBeCloseTo(0.7, 2);
  });
  it('ГПСЧ детерминирован по seed', () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});
