'use client';

/**
 * Haul Routing — dynamic risk-aware routing, explainable risk, and the
 * production consequences of the route that gets chosen.
 *
 * Laid out in the order a mine manager actually reasons:
 *   where am I hauling -> which line is safest -> why -> what does it cost me
 *   in tonnes -> what should I change.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, PageHeader, Pill } from '@/components/mobile/ui';
import { useMineId } from '@/lib/useMineId';
import { resolveMapStyle } from '@/lib/mapConfig';
import { getTheme } from '@/lib/theme';
import {
  LAYERS,
  riskColour,
  useRouting,
  useSuggestedPoints,
  type CompareResponse,
  type HeatmapResponse,
  type OptimizeResponse,
  type ProductionResponse,
  type RoutePayload,
} from '@/lib/routing';

const VEHICLES = [
  { key: 'haul_truck', label: 'Haul truck' },
  { key: 'articulated_dumper', label: 'Articulated dumper' },
  { key: 'water_tanker', label: 'Water tanker' },
  { key: 'light_vehicle', label: 'Light vehicle' },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink2">{title}</h2>
        {hint && <span className="text-[10px] text-ink3 shrink-0 text-right">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="p-3 rounded-xl bg-panel2 border border-line">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">{label}</div>
      <div className="text-lg font-bold mt-0.5 tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink3 mt-0.5">{sub}</div>}
    </div>
  );
}

function Slider({
  id, label, value, min, max, step, unit, onChange,
}: {
  id: string; label: string; value: number; min: number; max: number; step: number;
  unit?: string; onChange: (v: number) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink3">{label}</span>
        <span className="text-[11px] font-bold text-ink tabular-nums">
          {value}{unit ?? ''}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent h-1.5"
      />
    </label>
  );
}

/** Risk decomposition as a stacked proportional bar plus a ranked list. */
function RiskBreakdown({ route }: { route: RoutePayload }) {
  const factors = Object.values(route.risk_breakdown).sort((a, b) => b.points - a.points);
  const total = factors.reduce((s, f) => s + f.points, 0);

  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-panel3 mb-3">
        {factors.map((f) => (
          <div
            key={f.factor}
            style={{
              width: `${f.share_pct}%`,
              background: riskColour(Math.min(100, f.intensity * 100)),
            }}
            title={`${f.label}: ${f.share_pct.toFixed(0)}%`}
          />
        ))}
      </div>
      <ul>
        {factors.map((f) => (
          <li key={f.factor} className="flex items-center gap-3 py-1.5 border-b border-line/40 last:border-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: riskColour(Math.min(100, f.intensity * 100)) }}
            />
            <span className="text-[11px] text-ink flex-1 min-w-0 truncate">{f.label}</span>
            <span className="text-[11px] text-ink3 tabular-nums w-14 text-right">
              {f.points.toFixed(1)} pt
            </span>
            <span className="text-[11px] font-bold text-ink2 tabular-nums w-11 text-right">
              {f.share_pct.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-ink3 mt-2">
        Contributions sum to the {total.toFixed(1)}/100 risk score — these are the terms the
        router minimised, not a post-hoc attribution.
      </p>
    </div>
  );
}

export default function RoutingPage() {
  const mineId = useMineId();
  const { points, loading: pointsLoading } = useSuggestedPoints(mineId);
  const { optimize, compare, production, simulateWhatIf, heatmap, pending, error } = useRouting();

  // Conditions
  const [rainfall, setRainfall] = useState(0);
  const [roadCondition, setRoadCondition] = useState(0.8);
  const [trafficLevel, setTrafficLevel] = useState(0.25);
  const [vehicle, setVehicle] = useState('haul_truck');
  const [useStockpile, setUseStockpile] = useState(true);

  // Results
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  const [prod, setProd] = useState<ProductionResponse | null>(null);
  const [heat, setHeat] = useState<HeatmapResponse | null>(null);
  const [layer, setLayer] = useState('overall');
  const [showHeat, setShowHeat] = useState(true);
  const [selectedRoute, setSelectedRoute] = useState(0);

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const mapReady = useRef(false);
  const markersRef = useRef<any[]>([]);

  // What-if
  const [trucks, setTrucks] = useState(14);
  const [availability, setAvailability] = useState(78);
  const [whatIf, setWhatIf] = useState<Record<string, any> | null>(null);

  const centre = useMemo(
    () =>
      points
        ? {
            longitude: (points.bounds.lon_min + points.bounds.lon_max) / 2,
            latitude: (points.bounds.lat_min + points.bounds.lat_max) / 2,
          }
        : { longitude: 79.09, latitude: 21.15 },
    [points]
  );

  const conditions = useMemo(
    () => ({ rainfall, road_condition: roadCondition, traffic_level: trafficLevel }),
    [rainfall, roadCondition, trafficLevel]
  );

  const planRoute = useCallback(async () => {
    if (!points) return;
    const body = {
      mine_id: mineId,
      start: points.points.extraction,
      waypoints: useStockpile ? [points.points.stockpile] : [],
      destination: points.points.dispatch,
      vehicle_type: vehicle,
      conditions,
      alternatives: 2,
    };
    const res = await optimize(body);
    setResult(res);
    setSelectedRoute(0);

    if (res) {
      const p = await production({
        mine_id: mineId,
        route_time_min: res.route.estimated_time_min,
        route_distance_km: res.route.distance_km,
        route_risk_score: res.route.risk_score,
        inputs: { trucks_available: trucks, equipment_availability: availability / 100 },
      });
      setProd(p);
    }
  }, [points, mineId, useStockpile, vehicle, conditions, optimize, production, trucks, availability]);

  // Plan once the suggested points arrive, so the page opens with a real route
  // rather than an empty map waiting for a click.
  useEffect(() => {
    if (points && !result) void planRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  useEffect(() => {
    if (!showHeat) return;
    void heatmap({
      mine_id: mineId,
      layer,
      vehicle_type: vehicle,
      rainfall,
      road_condition: roadCondition,
      traffic_level: trafficLevel,
      resolution: 40,
    }).then(setHeat);
  }, [mineId, layer, vehicle, rainfall, roadCondition, trafficLevel, showHeat, heatmap]);

  const runComparison = useCallback(async () => {
    if (!points) return;
    const res = await compare({
      mine_id: mineId,
      start: points.points.extraction,
      waypoints: useStockpile ? [points.points.stockpile] : [],
      destination: points.points.dispatch,
      vehicle_type: vehicle,
      before: { rainfall: 0, road_condition: 0.8, traffic_level: 0.25 },
      after: { rainfall: 150, road_condition: 0.3, traffic_level: 0.6 },
    });
    setComparison(res);
  }, [points, mineId, useStockpile, vehicle, compare]);

  const runWhatIf = useCallback(async () => {
    if (!result) return;
    const res = await simulateWhatIf({
      mine_id: mineId,
      route_time_min: result.route.estimated_time_min,
      route_distance_km: result.route.distance_km,
      route_risk_score: result.route.risk_score,
      inputs: {},
      changes: { trucks_available: trucks, equipment_availability: availability / 100 },
    });
    setWhatIf(res);
  }, [result, mineId, trucks, availability, simulateWhatIf]);

  const routes: RoutePayload[] = useMemo(
    () => (result ? [result.route, ...result.alternative_routes] : []),
    [result]
  );
  const active = routes[selectedRoute] ?? null;

  // --- map lifecycle ---------------------------------------------------
  // Imperative maplibre, matching the exploration page. react-map-gl is not a
  // dependency of this project, and adding one for a single view is not worth
  // the install.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const ml = await import('maplibre-gl');
      const maplibregl = (ml as any).default ?? ml;
      if (cancelled || !mapContainer.current) return;

      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: resolveMapStyle(getTheme()),
        center: [centre.longitude, centre.latitude],
        zoom: 12.2,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      mapRef.current = map;

      map.on('style.load', () => {
        if (cancelled) return;
        const empty = { type: 'FeatureCollection', features: [] };

        map.addSource('risk-heat', { type: 'geojson', data: empty });
        map.addLayer({
          id: 'risk-heat-layer',
          type: 'circle',
          source: 'risk-heat',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 14],
            'circle-opacity': 0.42,
            'circle-color': [
              'interpolate', ['linear'], ['get', 'risk'],
              0, '#22c55e', 20, '#84cc16', 40, '#f59e0b', 60, '#f97316', 80, '#ef4444',
            ],
          },
        });
        // Blocked cells sit on top: an operator needs to see where the router
        // refused to go, not only where it went.
        map.addLayer({
          id: 'risk-blocked-layer',
          type: 'circle',
          source: 'risk-heat',
          filter: ['==', ['get', 'blocked'], 1],
          paint: { 'circle-radius': 3.5, 'circle-color': '#111827', 'circle-opacity': 0.7 },
        });

        map.addSource('routes', { type: 'geojson', data: empty });
        map.addLayer({
          id: 'routes-alt',
          type: 'line',
          source: 'routes',
          filter: ['==', ['get', 'active'], 0],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#94a3b8',
            'line-width': 2.5,
            'line-dasharray': [2, 2],
            'line-opacity': 0.8,
          },
        });
        map.addLayer({
          id: 'routes-active',
          type: 'line',
          source: 'routes',
          filter: ['==', ['get', 'active'], 1],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#f59e0b', 'line-width': 5, 'line-opacity': 0.95 },
        });

        mapReady.current = true;
        map.fire('crucible.ready');
      });
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove?.());
      markersRef.current = [];
      mapRef.current?.remove?.();
      mapRef.current = null;
      mapReady.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heatmap data. Guarded on mapReady because the sources only exist after
  // style.load, and a setData before that throws.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource?.('risk-heat');
      if (!src) return;
      src.setData(
        showHeat && heat
          ? {
              type: 'FeatureCollection',
              features: heat.cells.map((c) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
                properties: { risk: c.risk, blocked: c.blocked ? 1 : 0 },
              })),
            }
          : { type: 'FeatureCollection', features: [] }
      );
    };
    if (mapReady.current) apply();
    else map.once('crucible.ready', apply);
  }, [heat, showHeat]);

  // Route lines and the three haulage markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource?.('routes');
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: routes.map((r, i) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: r.path.map((pt) => [pt.lon, pt.lat]) },
          properties: { idx: i, active: i === selectedRoute ? 1 : 0 },
        })),
      });

      if (points && markersRef.current.length === 0) {
        void (async () => {
          const ml = await import('maplibre-gl');
          const maplibregl = (ml as any).default ?? ml;
          Object.entries(points.points).forEach(([name, pt]) => {
            const el = document.createElement('div');
            el.style.cssText = 'display:flex;flex-direction:column;align-items:center';
            const tag = document.createElement('span');
            tag.textContent = name;
            tag.style.cssText =
              'font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;' +
              'padding:2px 6px;border-radius:4px;background:#0f172a;color:#f8fafc;border:1px solid #334155';
            const dot = document.createElement('span');
            dot.style.cssText =
              'width:10px;height:10px;border-radius:50%;background:#f59e0b;border:2px solid #fff;' +
              'margin-top:2px;box-shadow:0 1px 4px rgba(0,0,0,.4)';
            el.append(tag, dot);
            markersRef.current.push(
              new maplibregl.Marker({ element: el, anchor: 'bottom' })
                .setLngLat([pt.lon, pt.lat])
                .addTo(map)
            );
          });
        })();
      }
    };
    if (mapReady.current) apply();
    else map.once('crucible.ready', apply);
  }, [routes, selectedRoute, points]);





  return (
    <main className="flex-1 bg-page min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      <PageHeader
        kicker="Haulage"
        title="Route & production optimiser"
        subtitle={`${mineId} — where to haul, which line is safest, and what it costs in tonnes`}
        right={
          <div className="flex items-center gap-2 bg-panel2 px-3 py-1.5 rounded-full border border-line">
            <span className={`w-2 h-2 rounded-full ${pending ? 'bg-warn animate-pulse' : 'bg-ok'}`} />
            <span className="text-[10px] font-bold text-ink2 uppercase tracking-wider">
              {pending ? 'Computing…' : 'Ready'}
            </span>
          </div>
        }
      />

      {error && (
        <div className="mb-5 text-xs text-warnt bg-warn/10 border border-warn/30 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Conditions ──────────────────────────────────────────────── */}
      <Section title="Conditions" hint="Change these and re-plan — the route responds">
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-end">
            <Slider id="rt-rain" label="Rainfall" value={rainfall} min={0} max={250} step={5} unit=" mm" onChange={setRainfall} />
            <Slider id="rt-road" label="Road condition" value={Math.round(roadCondition * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => setRoadCondition(v / 100)} />
            <Slider id="rt-traffic" label="Traffic" value={Math.round(trafficLevel * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => setTrafficLevel(v / 100)} />
            <div className="flex flex-col gap-2">
              <label htmlFor="rt-vehicle" className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink3">Vehicle</span>
                <select
                  id="rt-vehicle"
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value)}
                  className="mt-1 w-full bg-panel2 border border-line rounded-xl px-3 py-2 text-xs text-ink"
                >
                  {VEHICLES.map((v) => (
                    <option key={v.key} value={v.key}>{v.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-line">
            <button
              onClick={() => void planRoute()}
              disabled={pending || !points}
              className="px-5 py-2 rounded-xl bg-btn text-btnt text-xs font-bold shadow-md hover:bg-btn/90 active:scale-95 transition-all disabled:opacity-40"
            >
              {pending ? 'Planning…' : 'Plan route'}
            </button>
            <button
              onClick={() => void runComparison()}
              disabled={pending || !points}
              className="px-4 py-2 rounded-xl bg-panel3 text-ink text-xs font-semibold border border-line hover:bg-panel4 active:scale-95 transition-all disabled:opacity-40"
            >
              Simulate storm re-route
            </button>
            <label className="flex items-center gap-2 text-[11px] text-ink2 cursor-pointer">
              <input id="rt-stockpile" type="checkbox" checked={useStockpile} onChange={(e) => setUseStockpile(e.target.checked)} className="accent-accent" />
              Route via stockpile (P1 → P2 → P3)
            </label>
            {pointsLoading && <span className="text-[11px] text-ink3">Locating haulage points…</span>}
          </div>
        </Card>
      </Section>

      {/* ── Map ─────────────────────────────────────────────────────── */}
      <Section
        title="Risk map"
        hint={heat ? `${heat.label} · ${heat.cell_size_km} km cells` : undefined}
      >
        <Card className="!p-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
            {LAYERS.map((l) => (
              <Pill key={l.key} active={layer === l.key} onClick={() => setLayer(l.key)}>
                {l.label}
              </Pill>
            ))}
            <label className="flex items-center gap-2 text-[11px] text-ink2 ml-auto cursor-pointer">
              <input id="rt-showheat" type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} className="accent-accent" />
              Heatmap
            </label>
          </div>

          <div ref={mapContainer} style={{ height: 460 }} className="w-full" />
        </Card>
      </Section>

      {/* ── Routes + explanation ────────────────────────────────────── */}
      {result && active && (
        <Section title="Recommended route" hint="Dashed lines are alternatives — click to inspect">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="flex flex-col gap-4">
              <Card>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
                  <Stat label="Distance" value={`${active.distance_km.toFixed(2)} km`} />
                  <Stat label="Travel time" value={`${active.estimated_time_min.toFixed(0)} min`} />
                  <Stat label="Risk" value={`${active.risk_score.toFixed(0)}/100`} sub={active.risk_band} tone={riskColour(active.risk_score)} />
                  <Stat label="Safety" value={`${active.safety_score.toFixed(0)}/100`} />
                </div>

                <div className="flex flex-wrap gap-2">
                  {routes.map((r, i) => (
                    <Pill key={i} active={selectedRoute === i} onClick={() => setSelectedRoute(i)}>
                      {i === 0 ? 'Recommended' : `Alt ${i}`} · {r.distance_km.toFixed(1)} km · {r.risk_score.toFixed(0)}
                    </Pill>
                  ))}
                </div>
              </Card>

              <Card>
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink2 mb-3">Why this route</h3>
                <p className="text-xs text-ink leading-relaxed mb-4">{result.explanation.summary}</p>
                <div className="space-y-2">
                  {result.explanation.advisories.map((a, i) => (
                    <div
                      key={i}
                      className={`text-[11px] leading-snug px-3 py-2 rounded-lg border ${
                        a.severity === 'high'
                          ? 'bg-bad/10 border-bad/25 text-ink'
                          : a.severity === 'medium'
                            ? 'bg-warn/10 border-warn/25 text-ink'
                            : 'bg-panel2 border-line text-ink2'
                      }`}
                    >
                      {a.message}
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card>
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink2 mb-3">Risk breakdown</h3>
              <RiskBreakdown route={active} />
            </Card>
          </div>
        </Section>
      )}

      {/* ── Storm comparison ────────────────────────────────────────── */}
      {comparison && (
        <Section title="Dynamic re-routing" hint="Same endpoints, same weights — only the weather differs">
          <Card>
            <p className="text-xs text-ink leading-relaxed mb-4">{comparison.narrative}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Stat
                label="Dry conditions"
                value={`${comparison.before.route.risk_score.toFixed(0)}/100`}
                sub={`${comparison.before.route.distance_km.toFixed(2)} km · ${comparison.before.route.estimated_time_min.toFixed(0)} min`}
                tone={riskColour(comparison.before.route.risk_score)}
              />
              {comparison.original_route_under_new_conditions && (
                <Stat
                  label="Same line, in the storm"
                  value={`${comparison.original_route_under_new_conditions.risk_score.toFixed(0)}/100`}
                  sub="what the original route becomes"
                  tone={riskColour(comparison.original_route_under_new_conditions.risk_score)}
                />
              )}
              <Stat
                label="Re-planned route"
                value={`${comparison.after.route.risk_score.toFixed(0)}/100`}
                sub={`${comparison.after.route.distance_km.toFixed(2)} km · ${comparison.after.route.estimated_time_min.toFixed(0)} min`}
                tone={riskColour(comparison.after.route.risk_score)}
              />
            </div>
            <p className="text-[10px] text-ink3 mt-3">
              {comparison.route_changed
                ? `Route changed — ${(100 - comparison.path_overlap_pct).toFixed(0)}% of the path is different.`
                : 'Route unchanged — no alternative scores better under the new conditions.'}
            </p>
          </Card>
        </Section>
      )}

      {/* ── Production ──────────────────────────────────────────────── */}
      {prod && (
        <Section title="Production impact" hint={`Binding constraint: ${prod.forecast.binding_constraint}`}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
                <Stat label="Daily" value={`${prod.forecast.daily_t.toLocaleString(undefined, { maximumFractionDigits: 0 })} t`} />
                <Stat label="Weekly" value={`${prod.forecast.weekly_t.toLocaleString(undefined, { maximumFractionDigits: 0 })} t`} />
                <Stat label="Monthly" value={`${prod.forecast.monthly_t.toLocaleString(undefined, { maximumFractionDigits: 0 })} t`} />
                <Stat
                  label={prod.forecast.status === 'deficit' ? 'Shortfall' : 'Variance'}
                  value={`${Math.abs(prod.forecast.variance_t).toLocaleString(undefined, { maximumFractionDigits: 0 })} t`}
                  sub={`${prod.forecast.variance_pct.toFixed(1)}% vs target`}
                  tone={prod.forecast.status === 'deficit' ? '#f97316' : '#22c55e'}
                />
              </div>

              <div className="text-[11px] text-ink2 space-y-1">
                {Object.entries(prod.forecast.capacities_tpd).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 border-b border-line/40 last:border-0">
                    <span className="capitalize">
                      {k}
                      {k === prod.forecast.binding_constraint && (
                        <span className="ml-2 text-[9px] font-bold uppercase text-warnt">binding</span>
                      )}
                    </span>
                    <span className="tabular-nums font-semibold text-ink">{v.toLocaleString()} t/day</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-ink3 mt-3">
                Cycle {prod.forecast.cycle.total_minutes?.toFixed(0)} min ·{' '}
                {prod.forecast.cycle.trips_per_truck_per_day?.toFixed(1)} trips/truck/day ·{' '}
                {prod.forecast.cycle.risk_delay_minutes?.toFixed(1)} min lost to route risk
              </p>
            </Card>

            <Card>
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink2 mb-3">
                {prod.root_cause.contributors.length ? 'Root cause' : 'Status'}
              </h3>
              {prod.root_cause.contributors.length === 0 ? (
                <p className="text-xs text-ink2">{prod.root_cause.note}</p>
              ) : (
                <>
                  <ul className="mb-3">
                    {prod.root_cause.contributors.map((c) => (
                      <li key={c.cause} className="py-1.5 border-b border-line/40 last:border-0">
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-ink flex-1 truncate">{c.label}</span>
                          <span className="text-[11px] text-ink3 tabular-nums">
                            {c.recoverable_t.toLocaleString()} t
                          </span>
                          <span className="text-[11px] font-bold text-ink2 tabular-nums w-11 text-right">
                            {c.contribution_pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-panel3 mt-1 overflow-hidden">
                          <div className="h-full bg-accent" style={{ width: `${c.contribution_pct}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-ink3">{prod.root_cause.method}</p>
                </>
              )}
            </Card>
          </div>

          {prod.recommended_actions.length > 0 && (
            <Card className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink2 mb-3">
                Recommended actions
              </h3>
              <ol className="space-y-2.5">
                {prod.recommended_actions.map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded h-fit shrink-0 mt-0.5 ${
                        a.priority === 'high'
                          ? 'bg-bad/15 text-bad'
                          : a.priority === 'medium'
                            ? 'bg-warn/15 text-warn'
                            : 'bg-panel3 text-ink3'
                      }`}
                    >
                      {a.priority}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink">{a.action}</p>
                      <p className="text-[11px] text-ink2 mt-0.5 leading-snug">{a.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </Section>
      )}

      {/* ── What-if ─────────────────────────────────────────────────── */}
      {result && (
        <Section title="What-if" hint="Change the fleet and see the tonnes move">
          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 items-end">
              <Slider id="wi-trucks" label="Trucks" value={trucks} min={4} max={40} step={1} onChange={setTrucks} />
              <Slider id="wi-avail" label="Equipment availability" value={availability} min={40} max={98} step={1} unit="%" onChange={setAvailability} />
              <button
                onClick={() => void runWhatIf()}
                className="h-[38px] px-5 rounded-xl bg-btn text-btnt text-xs font-bold shadow-md hover:bg-btn/90 active:scale-95 transition-all"
              >
                Run simulation
              </button>
            </div>

            {whatIf && (
              <div className="mt-5 pt-4 border-t border-line grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Stat
                  label="Baseline"
                  value={`${Number(whatIf.baseline.monthly_t).toLocaleString(undefined, { maximumFractionDigits: 0 })} t`}
                  sub={`binding: ${whatIf.baseline.binding_constraint}`}
                />
                <Stat
                  label="Scenario"
                  value={`${Number(whatIf.scenario.monthly_t).toLocaleString(undefined, { maximumFractionDigits: 0 })} t`}
                  sub={`binding: ${whatIf.scenario.binding_constraint}`}
                />
                <Stat
                  label="Change"
                  value={`${whatIf.delta.monthly_t > 0 ? '+' : ''}${Number(whatIf.delta.monthly_t).toLocaleString(undefined, { maximumFractionDigits: 0 })} t`}
                  sub={
                    whatIf.delta.closes_shortfall
                      ? 'closes the shortfall'
                      : `${whatIf.delta.monthly_pct > 0 ? '+' : ''}${whatIf.delta.monthly_pct}%`
                  }
                  tone={whatIf.delta.monthly_t > 0 ? '#22c55e' : '#f97316'}
                />
              </div>
            )}
          </Card>
        </Section>
      )}
    </main>
  );
}
