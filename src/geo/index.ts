/** Сферическая геометрия. Все расстояния — в километрах, углы — в градусах. */

export interface LatLon {
  lat: number;
  lon: number;
}

export const EARTH_RADIUS_KM = 6371.0088;

const RAD = Math.PI / 180;

/** Расстояние по дуге большого круга. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Начальный азимут a→b, 0…360 (0 — север, 90 — восток). */
export function bearing(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const dλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

function normLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Точка на расстоянии distKm от a по азимуту bearingDeg. */
export function destination(a: LatLon, bearingDeg: number, distKm: number): LatLon {
  const δ = distKm / EARTH_RADIUS_KM;
  const θ = bearingDeg * RAD;
  const φ1 = a.lat * RAD;
  const λ1 = a.lon * RAD;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * sinφ2);
  return { lat: φ2 / RAD, lon: normLon(λ2 / RAD) };
}

/**
 * Точка на дуге большого круга a→b на расстоянии distKm от a.
 * distKm больше d(a,b) продолжает дугу за b. Для совпадающих или
 * антиподных точек дуга не определена — возвращается a.
 */
export function pointOnArc(a: LatLon, b: LatLon, distKm: number): LatLon {
  const d = haversine(a, b);
  const δ = d / EARTH_RADIUS_KM;
  const sinδ = Math.sin(δ);
  if (d < 1e-9 || Math.abs(sinδ) < 1e-12) return { ...a };
  const f = distKm / d;
  const A = Math.sin((1 - f) * δ) / sinδ;
  const B = Math.sin(f * δ) / sinδ;
  const φ1 = a.lat * RAD, λ1 = a.lon * RAD, φ2 = b.lat * RAD, λ2 = b.lon * RAD;
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD };
}
