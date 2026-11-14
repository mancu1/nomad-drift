export type Regime = 'free' | 'voa' | 'evisa' | 'required';

export const REGIMES: Regime[] = ['free', 'voa', 'evisa', 'required'];

export interface Hub {
  city: string;
  /** IATA-код аэропорта (для ссылок на поиск билетов). */
  iata: string;
  lat: number;
  lon: number;
}

export interface Visa {
  regime: Regime;
  /** Максимальный срок пребывания за один въезд, дней. */
  days: number | null;
  source_url: string | null;
  /** ISO-дата проверки; null — подтвердить не удалось. */
  verified_at: string | null;
  note?: string;
}

export interface Country {
  iso2: string;
  name_ru: string;
  hub: Hub;
  visa: Visa;
  /** true — страна паспорта (РФ): визовый режим неприменим. */
  home?: boolean;
}

export function validateCountries(data: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(data)) return ['корень не массив'];
  const seen = new Set<string>();
  for (const raw of data as Country[]) {
    const id = raw?.iso2 ?? '??';
    const err = (m: string) => errors.push(`${id}: ${m}`);
    if (!/^[A-Z]{2}$/.test(raw.iso2 ?? '')) err('некорректный iso2');
    if (seen.has(raw.iso2)) err('дубликат');
    seen.add(raw.iso2);
    if (!raw.name_ru) err('нет name_ru');
    const h = raw.hub;
    if (!h || !h.city || !/^[A-Z]{3}$/.test(h.iata ?? '')) err('некорректный hub');
    else if (!(Math.abs(h.lat) <= 90) || !(Math.abs(h.lon) <= 180)) err('координаты вне диапазона');
    const v = raw.visa;
    if (!v || !REGIMES.includes(v.regime)) err('некорректный regime');
    else {
      if (v.days !== null && !(Number.isFinite(v.days) && v.days > 0)) err('некорректный days');
      if (v.verified_at !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v.verified_at)) err('некорректный verified_at');
      if (v.verified_at !== null && !raw.home && !/^https?:\/\//.test(v.source_url ?? '')) err('verified без source_url');
    }
  }
  return errors;
}
