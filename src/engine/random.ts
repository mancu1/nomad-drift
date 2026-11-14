/** Детерминированный ГПСЧ mulberry32: () => [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed для n-го вращения: один сохранённый seed воспроизводит всю серию. */
export function spinSeed(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

/**
 * Взвешенный выбор: индекс элемента для u ∈ [0, 1).
 * Нулевые и отрицательные веса не выбираются; -1, если выбирать не из чего.
 */
export function weightedPick(weights: number[], u: number): number {
  let total = 0;
  for (const w of weights) if (w > 0) total += w;
  if (!(total > 0)) return -1;
  let x = u * total;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    if (!(weights[i] > 0)) continue;
    last = i;
    x -= weights[i];
    if (x < 0) return i;
  }
  return last;
}
