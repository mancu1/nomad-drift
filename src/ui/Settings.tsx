import { useRef, useState } from 'react';
import type { Regime } from '../../data/schema';
import type { Reachability, Settings } from '../engine';
import { sanitize, type AppState } from '../state/store';
import { COUNTRIES, KNOWN, REGIME_LABEL, flag, km, nameOf } from './labels';

interface Props {
  state: AppState;
  maxR: number;
  crit: Reachability | null;
  eligibleCount: number;
  deadEnds: string[];
  onSettings: (patch: Partial<Settings>) => void;
  onTarget: (iso: string) => void;
  onCurrent: (iso: string) => void;
  onReset: () => void;
  onImport: (s: AppState) => void;
  onClose: () => void;
}

const SORTED = [...COUNTRIES].sort((a, b) => a.name_ru.localeCompare(b.name_ru, 'ru'));
const UNVERIFIED = COUNTRIES.filter((c) => !c.home && !c.visa.verified_at).length;
const TOGGLEABLE: Regime[] = ['free', 'voa', 'evisa'];
const MIN_DAYS = [0, 14, 30, 60, 90];

function CountrySelect({ value, onChange, placeholder }: { value: string; onChange: (iso: string) => void; placeholder?: string }) {
  return (
    <select value={value} onChange={(e) => e.target.value && onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {SORTED.map((c) => (
        <option key={c.iso2} value={c.iso2}>
          {c.name_ru}
        </option>
      ))}
    </select>
  );
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>
        {p.label}
        <b>
          {p.value.toLocaleString('ru-RU')}
          {p.unit ? ` ${p.unit}` : ''}
        </b>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

export function SettingsPanel({ state, maxR, crit, eligibleCount, deadEnds, onSettings, onTarget, onCurrent, onReset, onImport, onClose }: Props) {
  const s = state.settings;
  const current = state.route[state.route.length - 1];
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nomad-drift-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = sanitize(JSON.parse(await file.text()), KNOWN);
      if (!next) throw new Error('bad');
      setImportError('');
      onImport(next);
    } catch {
      setImportError('Не удалось прочитать файл: это не экспорт Nomad Drift.');
    }
  };

  const toggleRegime = (r: Regime) =>
    onSettings({ regimes: s.regimes.includes(r) ? s.regimes.filter((x) => x !== r) : [...s.regimes, r] });

  const reachable = current === state.target || (crit !== null && crit.radius <= maxR);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Настройки" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Настройки</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        </header>

        <div className="sheet-body">
          <h3>Маршрут</h3>
          <label className="field">
            <span>Цель</span>
            <CountrySelect value={state.target} onChange={onTarget} />
          </label>
          <label className="field">
            <span>Я сейчас в</span>
            <CountrySelect value={current} onChange={onCurrent} />
          </label>

          <div className={reachable ? 'reach' : 'reach is-bad'}>
            {current === state.target ? (
              <p>Вы уже в целевой стране.</p>
            ) : crit ? (
              <>
                <p>
                  <b>Цель достижима при R ≥ {km(crit.radius)}</b>
                  {reachable ? '' : ` — сейчас шаг ограничен ${km(maxR)}, маршрута нет.`}
                </p>
                <p>
                  Узкое место: {nameOf(crit.bottleneck.from)} → {nameOf(crit.bottleneck.to)}, перелёт {km(crit.bottleneck.km)}.
                </p>
                <p className="muted">Путь: {crit.path.map(nameOf).join(' → ')}</p>
              </>
            ) : (
              <p>Цель недостижима при этих фильтрах.</p>
            )}
            <p className="muted">
              Стран проходит фильтры: {eligibleCount}. Тупиков: {deadEnds.length}
              {deadEnds.length > 0 && deadEnds.length <= 12 ? ` (${deadEnds.map(nameOf).join(', ')})` : ''}.
            </p>
          </div>

          <h3>Шаг</h3>
          <Slider label="Радиус R" value={s.R} min={500} max={6000} step={100} unit="км" onChange={(R) => onSettings({ R, Rmax: Math.max(R, s.Rmax) })} />
          <Slider label="Смещение k" value={s.k} min={0} max={1} step={0.05} onChange={(k) => onSettings({ k })} />
          <Slider label="Тяга к цели β" value={s.beta} min={0} max={5} step={0.1} onChange={(beta) => onSettings({ beta })} />
          <label className="check">
            <input type="checkbox" checked={s.autoExpand} onChange={(e) => onSettings({ autoExpand: e.target.checked })} />
            <span>Авторасширение радиуса, если кандидатов меньше трёх</span>
          </label>
          <Slider label="Потолок R_max" value={s.Rmax} min={1000} max={12000} step={250} unit="км" onChange={(Rmax) => onSettings({ Rmax, R: Math.min(s.R, Rmax) })} />

          <h3>Визовые режимы</h3>
          {TOGGLEABLE.map((r) => (
            <label className="check" key={r}>
              <input type="checkbox" checked={s.regimes.includes(r)} onChange={() => toggleRegime(r)} />
              <span>{REGIME_LABEL[r]}</span>
            </label>
          ))}
          <label className="field">
            <span>Минимальный срок пребывания</span>
            <select value={s.minDays} onChange={(e) => onSettings({ minDays: Number(e.target.value) })}>
              {MIN_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'любой' : `${d} дней`}
                </option>
              ))}
            </select>
          </label>
          {UNVERIFIED > 0 && (
            <p className="warn">⚠ У {UNVERIFIED} стран режим не удалось подтвердить официальным источником — они помечены в карточках.</p>
          )}

          <h3>Чёрный список</h3>
          <label className="field">
            <span>Не предлагать</span>
            <CountrySelect value="" placeholder="Добавить страну…" onChange={(iso) => !s.blacklist.includes(iso) && onSettings({ blacklist: [...s.blacklist, iso] })} />
          </label>
          {s.blacklist.length > 0 && (
            <div className="chips">
              {s.blacklist.map((iso) => (
                <button type="button" key={iso} className="chip" onClick={() => onSettings({ blacklist: s.blacklist.filter((x) => x !== iso) })} aria-label={`Убрать ${nameOf(iso)}`}>
                  {flag(iso)} {nameOf(iso)} ✕
                </button>
              ))}
            </div>
          )}

          <h3>Данные</h3>
          <div className="row">
            <button type="button" className="btn" onClick={exportJson}>Экспорт JSON</button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Импорт JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {importError && <p className="warn">{importError}</p>}
          <button type="button" className="btn btn-danger" onClick={() => window.confirm('Сбросить пройденный маршрут?') && onReset()}>
            Сбросить маршрут
          </button>
          <p className="muted small">Seed маршрута: {state.seed}, вращений: {state.spin}. Состояние хранится только в этом браузере.</p>
        </div>
      </section>
    </div>
  );
}
