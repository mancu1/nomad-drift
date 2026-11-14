import { geoCircle, geoNaturalEarth1, geoPath } from 'd3-geo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import numeric from '../../data/iso-numeric.json';
import type { StepResult } from '../engine';
import { EARTH_RADIUS_KM } from '../geo';
import { BY_ISO } from './labels';

const W = 960;
const H = 500;
const MAX_ZOOM = 14;

const projection = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], { type: 'Sphere' });
const path = geoPath(projection);

const NUM = numeric as Record<string, string>;
const topo = world as unknown as Topology;
const SHAPES = (feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection).features.map((f) => ({
  iso: NUM[String(f.id).padStart(3, '0')] as string | undefined,
  d: path(f) ?? '',
}));
const SPHERE = path({ type: 'Sphere' }) ?? '';

interface View {
  k: number;
  x: number;
  y: number;
}
const WORLD: View = { k: 1, x: 0, y: 0 };

function clampView(v: View): View {
  const k = Math.min(MAX_ZOOM, Math.max(1, v.k));
  return { k, x: Math.min(0, Math.max(W - W * k, v.x)), y: Math.min(0, Math.max(H - H * k, v.y)) };
}

function fitPoints(points: [number, number][]): View {
  if (!points.length) return WORLD;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min(MAX_ZOOM, 0.82 / Math.max((x1 - x0) / W, (y1 - y0) / H, 0.02));
  return clampView({ k, x: W / 2 - (k * (x0 + x1)) / 2, y: H / 2 - (k * (y0 + y1)) / 2 });
}

const xy = (iso: string): [number, number] | null => {
  const c = BY_ISO.get(iso);
  return c ? projection([c.hub.lon, c.hub.lat]) : null;
};

interface Props {
  route: string[];
  target: string;
  result: StepResult;
  eligible: Set<string>;
  deadEnds: Set<string>;
  /** Страна, подсвеченная анимацией или выбранная. */
  highlight: string | null;
  onPick?: (iso: string) => void;
}

export function MapView({ route, target, result, eligible, deadEnds, highlight, onPick }: Props) {
  const current = route[route.length - 1];
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(WORLD);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const visited = useMemo(() => new Set(route), [route]);

  const focusPoints = useMemo(() => {
    const pts = [current, ...result.candidates.map((c) => c.iso2)].map(xy).filter((p): p is [number, number] => !!p);
    return pts;
  }, [current, result]);

  // При смене позиции или набора кандидатов — показать шаг целиком.
  useEffect(() => setView(fitPoints(focusPoints)), [focusPoints]);

  const toSvg = (clientX: number, clientY: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    return [(clientX - r.left - (r.width - W * s) / 2) / s, (clientY - r.top - (r.height - H * s) / 2) / s];
  };

  const zoomAt = (px: number, py: number, factor: number) =>
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(1, v.k * factor));
      const f = k / v.k;
      return clampView({ k, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
    });

  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = toSvg(e.clientX, e.clientY);
      zoomAt(px, py, Math.exp(-e.deltaY * 0.0018));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const all = pointers.current;
    if (all.size === 1) {
      const [ax, ay] = toSvg(prev.x, prev.y);
      const [bx, by] = toSvg(e.clientX, e.clientY);
      setView((v) => clampView({ ...v, x: v.x + bx - ax, y: v.y + by - ay }));
    } else if (all.size === 2) {
      const other = [...all.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const [px, py] = toSvg((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      if (before > 0) zoomAt(px, py, after / before);
    }
    all.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent) => pointers.current.delete(e.pointerId);

  const circleD = useMemo(() => {
    if (result.status === 'finished') return '';
    const c = geoCircle()
      .center([result.center.lon, result.center.lat])
      .radius((result.radius / EARTH_RADIUS_KM) * (180 / Math.PI))
      .precision(2)();
    return path(c) ?? '';
  }, [result]);

  const line = (isos: string[]) =>
    path({
      type: 'LineString',
      coordinates: isos.map((i) => BY_ISO.get(i)!).map((c) => [c.hub.lon, c.hub.lat]),
    }) ?? '';

  const routeD = useMemo(() => (route.length > 1 ? line(route) : ''), [route]);
  const toTargetD = useMemo(() => (current !== target ? line([current, target]) : ''), [current, target]);

  const maxProb = Math.max(...result.candidates.map((c) => c.prob), 1e-9);
  const u = 1 / view.k; // размер «экранного пикселя» в координатах карты
  const pCur = xy(current);
  const pTarget = xy(target);

  return (
    <div className="map">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label="Карта маршрута"
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <path d={SPHERE} className="sphere" />
          {SHAPES.map((s, i) => {
            const cls = !s.iso
              ? 'land'
              : s.iso === target
                ? 'land is-target'
                : visited.has(s.iso)
                  ? 'land is-visited'
                  : deadEnds.has(s.iso)
                    ? 'land is-dead'
                    : eligible.has(s.iso)
                      ? 'land is-open'
                      : 'land';
            return <path key={i} d={s.d} className={cls} />;
          })}
          {circleD && <path d={circleD} className="step-circle" />}
          {toTargetD && <path d={toTargetD} className="to-target" />}
          {routeD && <path d={routeD} className="route" />}
          {route.slice(0, -1).map((iso, i) => {
            const p = xy(iso);
            return p && <circle key={`${iso}-${i}`} cx={p[0]} cy={p[1]} r={2.5 * u} className="route-dot" />;
          })}
          {result.candidates.map((c) => {
            const p = xy(c.iso2);
            if (!p) return null;
            const rel = c.prob / maxProb;
            const on = highlight === c.iso2;
            return (
              <g key={c.iso2} className={on ? 'cand is-on' : 'cand'} onClick={() => onPick?.(c.iso2)}>
                <circle cx={p[0]} cy={p[1]} r={(on ? 11 : 4 + 4 * rel) * u} opacity={on ? 1 : 0.25 + 0.75 * rel} className="cand-dot" />
                {on && <circle cx={p[0]} cy={p[1]} r={17 * u} className="cand-ring" strokeWidth={2 * u} />}
                <text x={p[0]} y={p[1] - (on ? 15 : 10) * u} fontSize={(on ? 13 : 10) * u} opacity={on ? 1 : 0.45 + 0.55 * rel}>
                  {c.iso2}
                </text>
              </g>
            );
          })}
          {pTarget && (
            <g className="target-mark">
              <circle cx={pTarget[0]} cy={pTarget[1]} r={9 * u} strokeWidth={2 * u} />
              <circle cx={pTarget[0]} cy={pTarget[1]} r={3 * u} className="target-core" />
            </g>
          )}
          {pCur && (
            <g className="current-mark">
              <circle cx={pCur[0]} cy={pCur[1]} r={12 * u} className="current-halo" />
              <circle cx={pCur[0]} cy={pCur[1]} r={5.5 * u} strokeWidth={2 * u} />
            </g>
          )}
        </g>
      </svg>
      <div className="map-tools">
        <button type="button" onClick={() => setView(fitPoints(focusPoints))} aria-label="Показать текущий шаг" title="Текущий шаг">◎</button>
        <button type="button" onClick={() => setView(WORLD)} aria-label="Показать весь мир" title="Весь мир">🌍</button>
        <button type="button" onClick={() => zoomAt(W / 2, H / 2, 1.6)} aria-label="Приблизить">+</button>
        <button type="button" onClick={() => zoomAt(W / 2, H / 2, 1 / 1.6)} aria-label="Отдалить">−</button>
      </div>
      <div className="legend">
        <span><i className="lg lg-cur" />вы здесь</span>
        <span><i className="lg lg-target" />цель</span>
        <span><i className="lg lg-cand" />кандидаты</span>
        <span><i className="lg lg-open" />доступно</span>
        <span><i className="lg lg-dead" />тупик</span>
      </div>
    </div>
  );
}
