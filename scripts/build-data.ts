/**
 * Собирает data/countries.json из региональных файлов data/raw/*.json
 * (результат веб-исследования) и открытой базы аэропортов OurAirports.
 *
 *   npm run data:build -- [путь к airports.csv]
 *
 * Без аргумента airports.csv скачивается с ourairports.com.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { validateCountries, type Country, type Regime } from '../data/schema';

const require = createRequire(import.meta.url);
const iso = require('i18n-iso-countries');
iso.registerLocale(require('i18n-iso-countries/langs/ru.json'));

interface RawRecord {
  iso2: string;
  hub: { city_ru: string; iata: string };
  visa: { regime: Regime; days: number | null; source_url: string | null; verified_at: string | null; note_ru?: string };
}

const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') (out.push(cur), (cur = ''));
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function loadAirports(path?: string): Promise<Map<string, { lat: number; lon: number; country: string }>> {
  const text = path ? readFileSync(path, 'utf8') : await (await fetch(AIRPORTS_URL)).text();
  const lines = text.split('\n');
  const head = parseCsvLine(lines[0]);
  const col = (n: string) => head.indexOf(n);
  const [iLat, iLon, iIata, iCountry, iType] = [col('latitude_deg'), col('longitude_deg'), col('iata_code'), col('iso_country'), col('type')];
  const map = new Map<string, { lat: number; lon: number; country: string }>();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const f = parseCsvLine(line);
    if (!f[iIata] || f[iType] === 'closed') continue;
    map.set(f[iIata], { lat: +(+f[iLat]).toFixed(4), lon: +(+f[iLon]).toFixed(4), country: f[iCountry] });
  }
  return map;
}

/** Короткие названия вместо официальных из ISO 3166. */
const NAME_OVERRIDES: Record<string, string> = {
  XK: 'Косово', TW: 'Тайвань', KP: 'Северная Корея', KR: 'Южная Корея', MD: 'Молдавия', PS: 'Палестина',
  SY: 'Сирия', LA: 'Лаос', BN: 'Бруней', FM: 'Микронезия', TZ: 'Танзания', VE: 'Венесуэла', BO: 'Боливия',
  IR: 'Иран', VN: 'Вьетнам', CD: 'ДР Конго', CG: 'Республика Конго', VA: 'Ватикан', MK: 'Северная Македония',
  SZ: 'Эсватини', CV: 'Кабо-Верде', TL: 'Восточный Тимор', GB: 'Великобритания', US: 'США', AE: 'ОАЭ',
  CZ: 'Чехия', RU: 'Россия', CI: 'Кот-д’Ивуар', MM: 'Мьянма', HK: 'Гонконг', MO: 'Макао', BY: 'Беларусь',
  KG: 'Киргизия', ST: 'Сан-Томе и Принсипи', KN: 'Сент-Китс и Невис', VC: 'Сент-Винсент и Гренадины',
  AG: 'Антигуа и Барбуда', TT: 'Тринидад и Тобаго', BA: 'Босния и Герцеговина', CF: 'ЦАР', DO: 'Доминикана',
};

/** Ручные правки поверх исследования — каждая с объяснением в note. */
const OVERRIDES: Record<string, (r: RawRecord) => void> = {
  AD: (r) => {
    r.visa.regime = 'required';
    r.visa.days = null;
    r.visa.note_ru =
      'Формально безвиз до 90 дней (соглашение 2019 г.), но аэропорта нет: въезд только через Испанию или Францию, нужна шенгенская виза. В приложении считается визовой.';
  },
  PS: (r) => {
    // Режим выведен из правил Израиля, прямого подтверждения нет.
    r.visa.verified_at = null;
  },
};

const HOME: RawRecord = {
  iso2: 'RU',
  hub: { city_ru: 'Москва', iata: 'SVO' },
  visa: { regime: 'free', days: null, source_url: null, verified_at: null, note_ru: 'Страна паспорта.' },
};

const airports = await loadAirports(process.argv[2]);
const rawDir = new URL('../data/raw/', import.meta.url);
const raw: RawRecord[] = [HOME];
for (const f of readdirSync(rawDir).filter((f) => f.endsWith('.json')).sort()) {
  raw.push(...(JSON.parse(readFileSync(new URL(f, rawDir), 'utf8')) as RawRecord[]));
}

const problems: string[] = [];
const countries: Country[] = raw.map((r) => {
  OVERRIDES[r.iso2]?.(r);
  const ap = airports.get(r.hub.iata);
  if (!ap) problems.push(`${r.iso2}: аэропорт ${r.hub.iata} не найден в OurAirports`);
  else if (ap.country !== r.iso2) console.warn(`  примечание: хаб ${r.iso2} (${r.hub.iata}) находится в ${ap.country}`);
  const name = NAME_OVERRIDES[r.iso2] ?? iso.getName(r.iso2, 'ru');
  if (!name) problems.push(`${r.iso2}: нет русского названия`);
  const days = r.visa.regime === 'required' ? null : r.visa.days;
  const c: Country = {
    iso2: r.iso2,
    name_ru: name,
    hub: { city: r.hub.city_ru, iata: r.hub.iata, lat: ap?.lat ?? 0, lon: ap?.lon ?? 0 },
    visa: {
      regime: r.visa.regime,
      days,
      source_url: r.visa.source_url || null,
      verified_at: r.visa.source_url ? r.visa.verified_at : null,
      ...(r.visa.note_ru ? { note: r.visa.note_ru } : {}),
    },
  };
  if (r.iso2 === 'RU') c.home = true;
  return c;
});
countries.sort((a, b) => a.name_ru.localeCompare(b.name_ru, 'ru'));

problems.push(...validateCountries(countries));
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
writeFileSync(new URL('../data/countries.json', import.meta.url), JSON.stringify(countries, null, 1) + '\n');

// ISO numeric → iso2 для раскраски карты (world-atlas использует числовые коды).
const numeric: Record<string, string> = {};
for (const c of countries) {
  const n = iso.alpha2ToNumeric(c.iso2);
  if (n) numeric[n] = c.iso2;
}
writeFileSync(new URL('../data/iso-numeric.json', import.meta.url), JSON.stringify(numeric) + '\n');
console.log(`countries.json: ${countries.length} стран`);
