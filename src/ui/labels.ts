import type { Country, Regime } from '../../data/schema';
import raw from '../../data/countries.json';

export const COUNTRIES = raw as Country[];
export const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso2, c]));
export const KNOWN = new Set(COUNTRIES.map((c) => c.iso2));

export const REGIME_LABEL: Record<Regime, string> = {
  free: 'Без визы',
  voa: 'Виза по прилёту',
  evisa: 'Электронная виза',
  required: 'Нужна виза',
};

export const nameOf = (iso: string) => BY_ISO.get(iso)?.name_ru ?? iso;

/** Эмодзи-флаг из ISO-кода (для Косово у части систем флага нет — будут буквы). */
export const flag = (iso: string) =>
  String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

export const km = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} км`;

export function daysLabel(c: Country): string {
  if (c.visa.regime === 'required') return '';
  return c.visa.days === null ? 'срок не указан' : `до ${c.visa.days} дн.`;
}

export function dateRu(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Ссылки на поиск билетов между хабами; дата вылета — через две недели. */
export function ticketLinks(from: Country, to: Country): { aviasales: string; google: string } {
  const d = new Date(Date.now() + 14 * 864e5);
  const ddmm = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0');
  return {
    aviasales: `https://www.aviasales.ru/search/${from.hub.iata}${ddmm}${to.hub.iata}1`,
    google: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from.hub.iata} to ${to.hub.iata}`)}`,
  };
}
