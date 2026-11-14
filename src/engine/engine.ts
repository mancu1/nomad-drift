import type { Country, Regime } from '../../data/schema';
import { haversine, pointOnArc, type LatLon } from '../geo';
import { weightedPick } from './random';

export interface Settings {
  /** Базовый радиус шага, км. */
  R: number;
  /** Смещение центра окружности: C лежит в k·R от current. 0…1. */
  k: number;
  /** Сила тяги к цели. */
  beta: number;
  /** Потолок радиуса при авторасширении, км. */
  Rmax: number;
  autoExpand: boolean;
  regimes: Regime[];
  /** Минимальный срок пребывания, дней; 0 — любой. */
  minDays: number;
  blacklist: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  R: 2500,
  k: 0.5,
  beta: 2,
  Rmax: 6000,
  autoExpand: true,
  regimes: ['free', 'voa'],
  minDays: 0,
  blacklist: [],
};

export const EXPAND_FACTOR = 1.25;
export const MIN_CANDIDATES = 3;
/** Половина окружности Земли: при таком R в круг попадает любая точка. */
const WHOLE_EARTH_KM = 20100;

export function passesFilters(c: Country, s: Settings): boolean {
  if (c.home) return false;
  if (s.blacklist.includes(c.iso2)) return false;
  if (!s.regimes.includes(c.visa.regime)) return false;
  if (s.minDays > 0 && (c.visa.days === null || c.visa.days < s.minDays)) return false;
  return true;
}

/** Предвычисленный контекст для пары (цель, настройки). Неизменяем. */
export interface Engine {
  countries: Country[];
  settings: Settings;
  target: string;
  index: Map<string, number>;
  targetIdx: number;
  /** Узел может быть шагом маршрута: прошёл фильтры либо является целью. */
  eligible: boolean[];
  /** Расстояние от хаба до хаба цели. */
  distToTarget: number[];
  /** Наибольший радиус, доступный шагу: R_max либо R без авторасширения. */
  maxR: number;
  /** Обратные рёбра графа шагов при maxR: revAdj[b] = все a, из которых шаг в b возможен. */
  revAdj: number[][];
}

/** Центр окружности шага: k·r по дуге к цели, но не дальше самой цели. */
export function stepCenter(from: LatLon, target: LatLon, k: number, r: number): LatLon {
  const d = haversine(from, target);
  return pointOnArc(from, target, Math.min(k * r, d));
}

function neighbours(e: Engine, a: number, r: number): number[] {
  const hubs = e.countries;
  const c = stepCenter(hubs[a].hub, hubs[e.targetIdx].hub, e.settings.k, r);
  const out: number[] = [];
  for (let b = 0; b < hubs.length; b++) {
    if (b !== a && haversine(c, hubs[b].hub) <= r) out.push(b);
  }
  return out;
}

export function createEngine(countries: Country[], target: string, settings: Settings): Engine {
  const index = new Map(countries.map((c, i) => [c.iso2, i]));
  const targetIdx = index.get(target);
  if (targetIdx === undefined) throw new Error(`Неизвестная цель: ${target}`);
  const tHub = countries[targetIdx].hub;
  const e: Engine = {
    countries,
    settings,
    target,
    index,
    targetIdx,
    eligible: countries.map((c, i) => i === targetIdx || passesFilters(c, settings)),
    distToTarget: countries.map((c) => haversine(c.hub, tHub)),
    maxR: settings.autoExpand ? Math.max(settings.R, settings.Rmax) : settings.R,
    revAdj: countries.map(() => []),
  };
  for (let a = 0; a < countries.length; a++) {
    for (const b of neighbours(e, a, e.maxR)) e.revAdj[b].push(a);
  }
  return e;
}

function idx(e: Engine, iso: string): number {
  const i = e.index.get(iso);
  if (i === undefined) throw new Error(`Неизвестная страна: ${iso}`);
  return i;
}

function blockedMask(e: Engine, current: string, visited: Iterable<string>): boolean[] {
  const blocked = e.countries.map(() => false);
  for (const v of visited) {
    const i = e.index.get(v);
    if (i !== undefined) blocked[i] = true;
  }
  blocked[idx(e, current)] = true;
  blocked[e.targetIdx] = false;
  return blocked;
}

/**
 * Откуда цель достижима при maxR, если идти только по разрешённым и
 * ещё не посещённым странам (обратный BFS от цели).
 */
function canReachTarget(e: Engine, blocked: boolean[]): boolean[] {
  const ok = e.countries.map(() => false);
  ok[e.targetIdx] = true;
  const queue = [e.targetIdx];
  while (queue.length) {
    const b = queue.pop()!;
    for (const a of e.revAdj[b]) {
      if (ok[a] || blocked[a] || !e.eligible[a]) continue;
      ok[a] = true;
      queue.push(a);
    }
  }
  return ok;
}

/** Страны-тупики: прошли фильтры и не посещены, но цель из них недостижима. */
export function deadEnds(e: Engine, current: string, visited: Iterable<string>): string[] {
  const blocked = blockedMask(e, current, visited);
  const ok = canReachTarget(e, blocked);
  return e.countries
    .filter((_, i) => e.eligible[i] && !blocked[i] && !ok[i])
    .map((c) => c.iso2);
}

export interface Candidate {
  iso2: string;
  /** Длина перелёта current → кандидат, км. */
  flightKm: number;
  /** На сколько км кандидат ближе к цели, чем current (может быть < 0). */
  gainKm: number;
  weight: number;
  /** Вероятность выпадения, 0…1. */
  prob: number;
  isTarget: boolean;
}

export interface StepResult {
  status: 'ok' | 'dead' | 'finished';
  /** Радиус, на котором остановился поиск. */
  radius: number;
  expanded: boolean;
  center: LatLon;
  candidates: Candidate[];
  targetAvailable: boolean;
}

/** Шаги a–d и f: кандидаты и их веса для текущей позиции. */
export function step(e: Engine, current: string, visited: Iterable<string>): StepResult {
  const s = e.settings;
  const cur = idx(e, current);
  const curHub = e.countries[cur].hub;
  const tHub = e.countries[e.targetIdx].hub;
  if (cur === e.targetIdx) {
    return { status: 'finished', radius: s.R, expanded: false, center: curHub, candidates: [], targetAvailable: false };
  }
  const blocked = blockedMask(e, current, visited);
  const ok = canReachTarget(e, blocked);

  let r = s.R;
  let found: number[] = [];
  for (;;) {
    found = neighbours(e, cur, r).filter((b) => e.eligible[b] && !blocked[b] && ok[b]);
    if (found.length >= MIN_CANDIDATES || r >= e.maxR) break;
    r = Math.min(r * EXPAND_FACTOR, e.maxR);
  }

  const dCur = e.distToTarget[cur];
  const raw = found.map((b) => {
    const gainKm = dCur - e.distToTarget[b];
    return { b, gainKm, weight: Math.exp(s.beta * (gainKm / r)) };
  });
  const total = raw.reduce((sum, c) => sum + c.weight, 0);
  const candidates: Candidate[] = raw
    .map(({ b, gainKm, weight }) => ({
      iso2: e.countries[b].iso2,
      flightKm: haversine(curHub, e.countries[b].hub),
      gainKm,
      weight,
      prob: weight / total,
      isTarget: b === e.targetIdx,
    }))
    .sort((x, y) => y.weight - x.weight);

  return {
    status: candidates.length ? 'ok' : 'dead',
    radius: r,
    expanded: r > s.R,
    center: stepCenter(curHub, tHub, s.k, r),
    candidates,
    targetAvailable: candidates.some((c) => c.isTarget),
  };
}

/** Шаг e: взвешенный случайный выбор среди кандидатов. */
export function pick(result: StepResult, rng: () => number): Candidate | null {
  const i = weightedPick(result.candidates.map((c) => c.weight), rng());
  return i < 0 ? null : result.candidates[i];
}

export interface Reachability {
  /** Минимальный R, при котором существует путь current → target, км. */
  radius: number;
  path: string[];
  /** Перелёт пути, который первым пропадает при уменьшении R. */
  bottleneck: { from: string; to: string; km: number };
}

/**
 * Критический радиус: бинарный поиск по R + BFS. Шаги при радиусе R
 * вложены в шаги при большем R (для k ≤ 1), поэтому достижимость монотонна.
 * Посещённые страны исключаются; фильтры — из настроек движка.
 */
export function criticalRadius(e: Engine, current: string, visited: Iterable<string>): Reachability | null {
  const cur = idx(e, current);
  if (cur === e.targetIdx) return null;
  const blocked = blockedMask(e, current, visited);

  const pathAt = (r: number): number[] | null => {
    const prev = e.countries.map(() => -1);
    const seen = e.countries.map(() => false);
    seen[cur] = true;
    const queue = [cur];
    for (let q = 0; q < queue.length; q++) {
      const a = queue[q];
      for (const b of neighbours(e, a, r)) {
        if (seen[b] || blocked[b] || !e.eligible[b]) continue;
        seen[b] = true;
        prev[b] = a;
        if (b === e.targetIdx) {
          const path = [b];
          while (path[0] !== cur) path.unshift(prev[path[0]]);
          return path;
        }
        queue.push(b);
      }
    }
    return null;
  };

  let lo = 0;
  let hi = WHOLE_EARTH_KM;
  let path = pathAt(hi);
  if (!path) return null;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    const p = pathAt(mid);
    if (p) {
      hi = mid;
      path = p;
    } else lo = mid;
  }

  const hubOf = (i: number) => e.countries[i].hub;
  let worst = { a: path[0], b: path[1], km: -1, breaks: false };
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const km = haversine(hubOf(a), hubOf(b));
    const breaks = !neighbours(e, a, lo).includes(b);
    if ((breaks && !worst.breaks) || (breaks === worst.breaks && km > worst.km)) worst = { a, b, km, breaks };
  }
  return {
    radius: Math.ceil(hi),
    path: path.map((i) => e.countries[i].iso2),
    bottleneck: { from: e.countries[worst.a].iso2, to: e.countries[worst.b].iso2, km: worst.km },
  };
}

export type HintKind = 'evisa' | 'voa' | 'minDays' | 'blacklist' | 'autoExpand' | 'rmax' | 'visited';

export interface Hint {
  kind: HintKind;
  /** Для 'rmax' — радиус, которого хватит, км. */
  value?: number;
}

/** Для экрана «тупик»: какие послабления снова открывают хотя бы один шаг. */
export function diagnose(
  countries: Country[],
  target: string,
  settings: Settings,
  current: string,
  visited: string[],
): Hint[] {
  const works = (s: Settings, v: string[] = visited) =>
    step(createEngine(countries, target, s), current, v).status === 'ok';
  const hints: Hint[] = [];
  const s = settings;
  if (!s.autoExpand && works({ ...s, autoExpand: true })) hints.push({ kind: 'autoExpand' });
  if (!s.regimes.includes('voa') && works({ ...s, regimes: [...s.regimes, 'voa'] })) hints.push({ kind: 'voa' });
  if (!s.regimes.includes('evisa') && works({ ...s, regimes: [...s.regimes, 'evisa'] })) hints.push({ kind: 'evisa' });
  if (s.minDays > 0 && works({ ...s, minDays: 0 })) hints.push({ kind: 'minDays' });
  if (s.blacklist.length && works({ ...s, blacklist: [] })) hints.push({ kind: 'blacklist' });
  const crit = criticalRadius(createEngine(countries, target, s), current, visited);
  if (crit) hints.push({ kind: 'rmax', value: Math.ceil(crit.radius / 100) * 100 });
  if (visited.length > 1 && works(s, [])) hints.push({ kind: 'visited' });
  return hints;
}
