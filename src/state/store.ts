import { DEFAULT_SETTINGS, randomSeed, type Settings } from '../engine';
import { REGIMES } from '../../data/schema';

export interface AppState {
  version: 1;
  target: string;
  /** Пройденный маршрут; последний элемент — текущая страна. */
  route: string[];
  settings: Settings;
  /** Seed маршрута и номер следующего вращения — вместе воспроизводят выпадения. */
  seed: number;
  spin: number;
}

export const STORAGE_KEY = 'nomad-drift:v1';

export function initialState(): AppState {
  return { version: 1, target: 'UY', route: ['RU'], settings: { ...DEFAULT_SETTINGS }, seed: randomSeed(), spin: 0 };
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Приводит произвольный JSON к корректному состоянию; null — если это не оно. */
export function sanitize(raw: unknown, known: Set<string>): AppState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<AppState>;
  if (typeof r.target !== 'string' || !known.has(r.target)) return null;
  if (!Array.isArray(r.route)) return null;
  const route = r.route.filter((x): x is string => typeof x === 'string' && known.has(x));
  if (!route.length) return null;
  const s = (r.settings ?? {}) as Partial<Settings>;
  const d = DEFAULT_SETTINGS;
  const R = num(s.R, 300, 8000, d.R);
  return {
    version: 1,
    target: r.target,
    route,
    settings: {
      R,
      k: num(s.k, 0, 1, d.k),
      beta: num(s.beta, 0, 6, d.beta),
      Rmax: Math.max(R, num(s.Rmax, 300, 12000, d.Rmax)),
      autoExpand: typeof s.autoExpand === 'boolean' ? s.autoExpand : d.autoExpand,
      regimes: Array.isArray(s.regimes) ? REGIMES.filter((x) => s.regimes!.includes(x)) : d.regimes,
      minDays: num(s.minDays, 0, 365, d.minDays),
      blacklist: Array.isArray(s.blacklist) ? s.blacklist.filter((x) => typeof x === 'string' && known.has(x)) : [],
    },
    seed: num(r.seed, 0, 4294967295, randomSeed()) >>> 0,
    spin: Math.floor(num(r.spin, 0, 1e9, 0)),
  };
}

export function loadState(known: Set<string>): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw), known) ?? initialState();
  } catch {
    /* хранилище недоступно или повреждено — начинаем заново */
  }
  return initialState();
}

export function saveState(s: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* приватный режим: работаем без сохранения */
  }
}
