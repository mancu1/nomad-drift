import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createEngine, criticalRadius, deadEnds as findDeadEnds, diagnose, mulberry32, pick, randomSeed, spinSeed, step,
  type Candidate, type Hint, type Settings,
} from './engine';
import { haversine } from './geo';
import { loadState, saveState, type AppState } from './state/store';
import { MapView } from './ui/MapView';
import { SettingsPanel } from './ui/Settings';
import { BY_ISO, COUNTRIES, KNOWN, REGIME_LABEL, dateRu, daysLabel, flag, km, nameOf, ticketLinks } from './ui/labels';

type Phase = { kind: 'idle' } | { kind: 'spinning'; on: string } | { kind: 'done'; chosen: Candidate };

const HINT_TEXT: Record<Hint['kind'], (h: Hint) => string> = {
  autoExpand: () => 'Включить авторасширение радиуса',
  voa: () => 'Разрешить визу по прилёту',
  evisa: () => 'Разрешить электронные визы',
  minDays: () => 'Снять минимальный срок пребывания',
  blacklist: () => 'Очистить чёрный список',
  rmax: (h) => `Поднять потолок радиуса до ${km(h.value ?? 0)}`,
  visited: () => 'Начать маршрут заново с этой страны',
};

function flights(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'перелёт' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'перелёта' : 'перелётов';
  return `${n} ${word}`;
}

export function App() {
  const [state, setState] = useState<AppState>(() => loadState(KNOWN));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [showSettings, setShowSettings] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => saveState(state), [state]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const { route, target, settings } = state;
  const current = route[route.length - 1];
  const start = route[0];

  const engine = useMemo(() => createEngine(COUNTRIES, target, settings), [target, settings]);
  const result = useMemo(() => step(engine, current, route), [engine, current, route]);
  const crit = useMemo(() => criticalRadius(engine, current, route), [engine, current, route]);
  const dead = useMemo(() => findDeadEnds(engine, current, route), [engine, current, route]);
  const eligible = useMemo(
    () => new Set(COUNTRIES.filter((_, i) => engine.eligible[i]).map((c) => c.iso2)),
    [engine],
  );
  const hints = useMemo(
    () => (result.status === 'dead' ? diagnose(COUNTRIES, target, settings, current, route) : []),
    [result, target, settings, current, route],
  );

  // Любое изменение позиции или фильтров отменяет незафиксированное выпадение.
  useEffect(() => {
    window.clearTimeout(timer.current);
    setPhase({ kind: 'idle' });
  }, [result]);

  const cur = BY_ISO.get(current)!;
  const tgt = BY_ISO.get(target)!;
  const distLeft = haversine(cur.hub, tgt.hub);
  const distTotal = haversine(BY_ISO.get(start)!.hub, tgt.hub);
  const progress = current === target ? 100 : distTotal > 0 ? Math.max(0, Math.min(100, (1 - distLeft / distTotal) * 100)) : 0;

  const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }));
  const patchSettings = (patch: Partial<Settings>) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  const reveal = (chosen: Candidate) => {
    window.clearTimeout(timer.current);
    const pool = result.candidates;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || pool.length === 1) return setPhase({ kind: 'done', chosen });
    const ticks = 16;
    let i = 0;
    const tick = () => {
      if (i >= ticks) return setPhase({ kind: 'done', chosen });
      let on = pool[Math.floor(Math.random() * pool.length)].iso2;
      if (i === ticks - 1 && on === chosen.iso2) on = pool[(pool.indexOf(chosen) + 1) % pool.length].iso2;
      setPhase({ kind: 'spinning', on });
      i++;
      timer.current = window.setTimeout(tick, 55 + i * i * 1.6);
    };
    tick();
  };

  const spin = () => {
    const chosen = pick(result, mulberry32(spinSeed(state.seed, state.spin)));
    if (!chosen) return;
    update({ spin: state.spin + 1 });
    // Счётчик вращений меняет state, но не result — анимация не сбрасывается.
    reveal(chosen);
  };

  const choose = (iso: string) => {
    const c = result.candidates.find((x) => x.iso2 === iso);
    if (c && phase.kind !== 'spinning') setPhase({ kind: 'done', chosen: c });
  };

  const go = (iso: string) => update({ route: [...route, iso] });
  const resetRoute = (from = start) => update({ route: [from], seed: randomSeed(), spin: 0 });

  const applyHint = (h: Hint) => {
    if (h.kind === 'autoExpand') patchSettings({ autoExpand: true });
    else if (h.kind === 'voa' || h.kind === 'evisa') patchSettings({ regimes: [...settings.regimes, h.kind] });
    else if (h.kind === 'minDays') patchSettings({ minDays: 0 });
    else if (h.kind === 'blacklist') patchSettings({ blacklist: [] });
    else if (h.kind === 'rmax') patchSettings({ Rmax: Math.max(settings.Rmax, h.value ?? 0), autoExpand: true });
    else resetRoute(current);
  };

  const highlight = phase.kind === 'spinning' ? phase.on : phase.kind === 'done' ? phase.chosen.iso2 : null;
  const chosen = phase.kind === 'done' ? phase.chosen : null;
  const chosenCountry = chosen ? BY_ISO.get(chosen.iso2)! : null;
  const targetCand = result.candidates.find((c) => c.isTarget);

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1>
            <span aria-hidden="true">🧭</span> Nomad Drift
          </h1>
          <button type="button" className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Настройки">⚙</button>
        </div>
        <div className="trip">
          <span>{flag(current)} {cur.name_ru}</span>
          <span className="trip-arrow">→</span>
          <span>{flag(target)} {tgt.name_ru}</span>
          <span className="trip-left">{current === target ? 'на месте' : `осталось ${km(distLeft)}`}</span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Путь до цели">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
          <span>{Math.round(progress)} % пути</span>
        </div>
      </header>

      <MapView route={route} target={target} result={result} eligible={eligible} deadEnds={new Set(dead)} highlight={highlight} onPick={choose} />

      <main className="panel">
        {result.status === 'finished' && (
          <section className="card card-finish">
            <h2>🏁 Цель достигнута: {tgt.name_ru}!</h2>
            <p>{flights(route.length - 1)}: {route.map(nameOf).join(' → ')}.</p>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => setShowSettings(true)}>Выбрать новую цель</button>
              <button type="button" className="btn" onClick={() => resetRoute(current)}>Новый маршрут отсюда</button>
            </div>
          </section>
        )}

        {result.status === 'dead' && (
          <section className="card card-dead">
            <h2>Тупик</h2>
            <p>
              Отсюда ({cur.name_ru}) нет ни одной страны, которая проходит фильтры и из которой цель ещё достижима
              (радиус до {km(result.radius)}).
            </p>
            {hints.length > 0 ? (
              <>
                <p>Что можно ослабить:</p>
                <div className="hints">
                  {hints.map((h) => (
                    <button type="button" className="btn" key={h.kind} onClick={() => applyHint(h)}>
                      {HINT_TEXT[h.kind](h)}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p>Попробуйте сменить текущую страну или цель в настройках.</p>
            )}
          </section>
        )}

        {result.status === 'ok' && (
          <>
            {result.expanded && (
              <p className="notice">
                ⤢ Радиус расширен до {km(result.radius)} — в базовых {km(settings.R)} нашлось меньше трёх стран.
              </p>
            )}
            {targetCand && !chosen && (
              <p className="notice notice-finish">
                🏁 Финиш доступен: {tgt.name_ru} в зоне шага.{' '}
                <button type="button" className="link" onClick={() => choose(target)}>Лететь сразу</button>
              </p>
            )}

            {chosen && chosenCountry ? (
              <section className={chosen.isTarget ? 'card card-result is-finish' : 'card card-result'}>
                <div className="card-head">
                  <span className="card-flag" aria-hidden="true">{flag(chosen.iso2)}</span>
                  <div>
                    <h2>{chosenCountry.name_ru}{chosen.isTarget ? ' — финиш!' : ''}</h2>
                    <p className="muted">{chosenCountry.hub.city} · {chosenCountry.hub.iata}</p>
                  </div>
                </div>
                <div className="badges">
                  <span className={`badge badge-${chosenCountry.visa.regime}`}>{REGIME_LABEL[chosenCountry.visa.regime]}</span>
                  {daysLabel(chosenCountry) && <span className="badge">{daysLabel(chosenCountry)}</span>}
                </div>
                <dl className="facts">
                  <div><dt>Перелёт</dt><dd>{km(chosen.flightKm)}</dd></div>
                  <div>
                    <dt>{chosen.gainKm >= 0 ? 'Ближе к цели на' : 'Дальше от цели на'}</dt>
                    <dd className={chosen.gainKm >= 0 ? 'good' : 'bad'}>{km(Math.abs(chosen.gainKm))}</dd>
                  </div>
                  <div><dt>Шанс выпадения</dt><dd>{(chosen.prob * 100).toFixed(chosen.prob < 0.1 ? 1 : 0)} %</dd></div>
                </dl>
                {chosenCountry.visa.note && <p className="note">{chosenCountry.visa.note}</p>}
                {chosenCountry.visa.verified_at ? (
                  <p className="source">
                    <a href={chosenCountry.visa.source_url!} target="_blank" rel="noreferrer">Источник визовых данных</a>
                    {' '}· проверено {dateRu(chosenCountry.visa.verified_at)}
                  </p>
                ) : (
                  <p className="warn">
                    ⚠ Режим не подтверждён официальным источником — проверьте перед покупкой билетов.
                    {chosenCountry.visa.source_url && (
                      <> <a href={chosenCountry.visa.source_url} target="_blank" rel="noreferrer">Что удалось найти</a></>
                    )}
                  </p>
                )}
                <p className="tickets">
                  Билеты {cur.hub.iata} → {chosenCountry.hub.iata}:{' '}
                  <a href={ticketLinks(cur, chosenCountry).aviasales} target="_blank" rel="noreferrer">Aviasales</a>
                  {' · '}
                  <a href={ticketLinks(cur, chosenCountry).google} target="_blank" rel="noreferrer">Google Flights</a>
                </p>
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={() => go(chosen.iso2)}>Едем сюда</button>
                  <button type="button" className="btn" onClick={spin}>Перекрутить</button>
                </div>
              </section>
            ) : (
              <button type="button" className="btn btn-primary btn-spin" onClick={spin} disabled={phase.kind === 'spinning'}>
                {phase.kind === 'spinning' ? `${flag(phase.on)} ${nameOf(phase.on)}…` : '🎲 Крутить'}
              </button>
            )}

            <details className="list">
              <summary>Кандидаты: {result.candidates.length}</summary>
              <ul>
                {result.candidates.map((c) => {
                  const k = BY_ISO.get(c.iso2)!;
                  return (
                    <li key={c.iso2}>
                      <button type="button" className={highlight === c.iso2 ? 'cand-row is-on' : 'cand-row'} onClick={() => choose(c.iso2)}>
                        <span>{flag(c.iso2)} {k.name_ru}{!k.visa.verified_at && <span title="Режим не подтверждён"> ⚠</span>}</span>
                        <span className="muted">{km(c.flightKm)}</span>
                        <span className="cand-prob">
                          <i style={{ width: `${Math.max(3, c.prob * 100)}%` }} />
                          <b>{(c.prob * 100).toFixed(c.prob < 0.1 ? 1 : 0)} %</b>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          </>
        )}

        {route.length > 1 && (
          <details className="list">
            <summary>Пройдено: {flights(route.length - 1)}</summary>
            <ol className="history">
              {route.map((iso, i) => (
                <li key={`${iso}-${i}`}>
                  {flag(iso)} {nameOf(iso)}
                  {i > 0 && <span className="muted"> · {km(haversine(BY_ISO.get(route[i - 1])!.hub, BY_ISO.get(iso)!.hub))}</span>}
                </li>
              ))}
            </ol>
            <button type="button" className="link" onClick={() => update({ route: route.slice(0, -1) })}>Отменить последний перелёт</button>
          </details>
        )}
      </main>

      {showSettings && (
        <SettingsPanel
          state={state}
          maxR={engine.maxR}
          crit={crit}
          eligibleCount={eligible.size}
          deadEnds={dead}
          onSettings={patchSettings}
          onTarget={(iso) => update({ target: iso })}
          onCurrent={(iso) => iso !== current && go(iso)}
          onReset={() => resetRoute(current)}
          onImport={(s) => setState(s)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
