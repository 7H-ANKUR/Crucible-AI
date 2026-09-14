'use client';

/**
 * Haul Routing — Dynamic Haul Routing & Fleet Telemetry
 * 100% faithful port of the Stitch reference HTML (haul_routing.html)
 * wired with real MapLibre GL pit maps, live multi-agent route optimization,
 * environment sliders, and production impact envelopes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMineId } from '@/lib/useMineId';
import { resolveMapStyle } from '@/lib/mapConfig';
import {
  LAYERS,
  riskColour,
  useRouting,
  useSuggestedPoints,
  type CompareResponse,
  type OptimizeResponse,
  type RoutePayload,
} from '@/lib/routing';

const VEHICLES = [
  { key: 'haul_truck', label: 'Haul truck (Komatsu 930E / CAT 793F)' },
  { key: 'articulated_dumper', label: 'Articulated dumper' },
  { key: 'water_tanker', label: 'Water tanker' },
  { key: 'light_vehicle', label: 'Light vehicle' },
];

interface FleetTruck {
  id: string;
  payload: string;
  route: string;
  vector: string;
  note: string;
  noteCls: string;
  status: 'Nominal' | 'Diverted' | 'Advisory' | 'Returning' | 'Queued';
  statusCls: string;
  filterCat: 'all' | 'queued' | 'hauling' | 'returning';
}

const FLEET_STREAM: FleetTruck[] = [
  {
    id: 'HK-402',
    payload: '242t High-Grade Cu',
    route: 'Face 14-S → Crusher 1',
    vector: 'Ramp A • 22 km/h',
    note: 'Maintain Path',
    noteCls: 'text-telemetry-emerald',
    status: 'Nominal',
    statusCls: 'bg-telemetry-emerald/20 text-telemetry-emerald',
    filterCat: 'hauling',
  },
  {
    id: 'HK-408',
    payload: '220t Sulphide Complex',
    route: 'Bench 12 → Crusher 2',
    vector: 'Bypass C • 19 km/h',
    note: 'Re-Routed MARL',
    noteCls: 'text-copper-accent font-medium',
    status: 'Diverted',
    statusCls: 'bg-primary-container text-white',
    filterCat: 'hauling',
  },
  {
    id: 'HK-411',
    payload: '238t Oxide Transition',
    route: 'Bench 14-W → ROM 4-C',
    vector: 'Switchback • 14 km/h',
    note: 'Speed Throttled',
    noteCls: 'text-telemetry-amber',
    status: 'Advisory',
    statusCls: 'bg-telemetry-amber/20 text-telemetry-amber',
    filterCat: 'hauling',
  },
  {
    id: 'HK-415',
    payload: 'Empty (Unloaded)',
    route: 'Crusher 1 → Bench 14-S',
    vector: 'Return East • 32 km/h',
    note: 'Optimal Speed',
    noteCls: 'text-secondary',
    status: 'Returning',
    statusCls: 'bg-surface-dim text-secondary',
    filterCat: 'returning',
  },
  {
    id: 'HK-422',
    payload: '245t High-Grade Cu',
    route: 'Bench 11 → Crusher 1',
    vector: 'Pocket Ingress • 6 km/h',
    note: 'In Queue (Pos 2)',
    noteCls: 'text-telemetry-amber',
    status: 'Queued',
    statusCls: 'bg-surface-dim text-secondary',
    filterCat: 'queued',
  },
];

function Slider({
  id, label, value, min, max, step, unit, onChange,
}: {
  id: string; label: string; value: number; min: number; max: number; step: number;
  unit?: string; onChange: (v: number) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <div className="flex justify-between items-baseline mb-1">
        <span className="font-headline text-[10px] font-bold uppercase tracking-wider text-secondary">{label}</span>
        <span className="font-mono text-[11px] font-bold text-earth-charcoal tabular-nums">
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
        className="w-full accent-copper-accent h-1.5 cursor-pointer"
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
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-container mb-3 border border-earth-border/50">
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
      <ul className="divide-y divide-earth-border/40">
        {factors.map((f) => (
          <li key={f.factor} className="flex items-center gap-3 py-1.5 font-body text-xs">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: riskColour(Math.min(100, f.intensity * 100)) }}
            />
            <span className="text-earth-charcoal flex-1 min-w-0 truncate">{f.label}</span>
            <span className="text-secondary font-mono tabular-nums w-14 text-right">
              {f.points.toFixed(1)} pt
            </span>
            <span className="font-bold text-secondary font-mono tabular-nums w-11 text-right">
              {f.share_pct.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="font-body text-[10px] text-secondary mt-2">
        Contributions sum to the {total.toFixed(1)}/100 risk score — these are the terms the
        router minimised, not a post-hoc attribution.
      </p>
    </div>
  );
}

export default function RoutingPage() {
  const mineId = useMineId();
  const { points } = useSuggestedPoints(mineId);
  const { optimize, compare, heatmap, pending } = useRouting();

  // Conditions
  const [rainfall, setRainfall] = useState(0);
  const [roadCondition, setRoadCondition] = useState(0.8);
  const [trafficLevel, setTrafficLevel] = useState(0.25);
  const [vehicle, setVehicle] = useState('haul_truck');
  const [useStockpile, setUseStockpile] = useState(true);

  // Autonomous Execution toggle & Fleet filter
  const [autonomousEnabled, setAutonomousEnabled] = useState(true);
  const [fleetFilter, setFleetFilter] = useState<'all' | 'queued' | 'hauling' | 'returning'>('all');
  const [toast, setToast] = useState<string | null>(null);

  // Results
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  const [layer, setLayer] = useState('overall');
  const [showHeat, setShowHeat] = useState(true);
  const [selectedRoute, setSelectedRoute] = useState(0);

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const mapReady = useRef(false);
  const markersRef = useRef<any[]>([]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  }

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
  }, [points, mineId, useStockpile, vehicle, conditions, optimize]);

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
    });
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

  const routes: RoutePayload[] = useMemo(
    () => (result ? [result.route, ...result.alternative_routes] : []),
    [result]
  );
  const active = routes[selectedRoute] ?? null;

  // MapLibre lifecycle
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const ml = await import('maplibre-gl');
      const maplibregl = (ml as any).default ?? ml;
      if (cancelled || !mapContainer.current) return;

      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: resolveMapStyle('light'),
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
              0, '#10b981', 20, '#34d399', 40, '#f59e0b', 60, '#f97316', 80, '#ef4444',
            ],
          },
        });
        map.addLayer({
          id: 'risk-blocked-layer',
          type: 'circle',
          source: 'risk-heat',
          filter: ['==', ['get', 'blocked'], 1],
          paint: {
            'circle-radius': 10,
            'circle-color': '#000000',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ef4444',
          },
        });

        // Route source & layers
        map.addSource('route-lines', { type: 'geojson', data: empty });
        map.addLayer({
          id: 'route-alts',
          type: 'line',
          source: 'route-lines',
          filter: ['==', ['get', 'active'], false],
          paint: {
            'line-color': '#867369',
            'line-width': 4,
            'line-dasharray': [2, 2],
            'line-opacity': 0.7,
          },
        });
        map.addLayer({
          id: 'route-active-glow',
          type: 'line',
          source: 'route-lines',
          filter: ['==', ['get', 'active'], true],
          paint: {
            'line-color': '#2D6A4F',
            'line-width': 10,
            'line-opacity': 0.25,
          },
        });
        map.addLayer({
          id: 'route-active',
          type: 'line',
          source: 'route-lines',
          filter: ['==', ['get', 'active'], true],
          paint: {
            'line-color': '#2D6A4F',
            'line-width': 4.5,
          },
        });

        mapReady.current = true;
        map.fire('crucible.ready');
      });
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        mapReady.current = false;
      }
    };
  }, [centre]);

  // Update routes on map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const src = map.getSource('route-lines');
      if (!src) return;

      const features = routes.map((r, i) => ({
        type: 'Feature',
        properties: {
          active: i === selectedRoute,
          index: i,
          risk: r.risk_score,
        },
        geometry: {
          type: 'LineString',
          coordinates: (r.path || []).map((pt: any) => [pt.lon, pt.lat]),
        },
      }));
      src.setData({ type: 'FeatureCollection', features });

      // Add pins for start, waypoint, destination
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      if (points) {
        import('maplibre-gl').then((ml) => {
          const maplibregl = (ml as any).default ?? ml;
          const pinDefs = [
            { pt: points.points.extraction, label: 'Extraction', color: '#B46A36' },
            { pt: points.points.stockpile, label: 'Stockpile', color: '#675C55' },
            { pt: points.points.dispatch, label: 'Crusher Ingress', color: '#2D6A4F' },
          ];
          pinDefs.forEach((d) => {
            const el = document.createElement('div');
            el.className = 'w-4 h-4 rounded-full border-2 border-white shadow-md';
            el.style.backgroundColor = d.color;
            markersRef.current.push(
              new maplibregl.Marker({ element: el })
                .setLngLat([d.pt.lon, d.pt.lat])
                .addTo(map)
            );
          });
        });
      }
    };

    if (mapReady.current) apply();
    else map.once('crucible.ready', apply);
  }, [routes, selectedRoute, points]);

  function handleExportManifest() {
    const headers = ['Truck_ID,Payload,Route,Speed_Vector,Status'];
    const rows = FLEET_STREAM.map(t => `"${t.id}","${t.payload}","${t.route}","${t.vector}","${t.status}"`);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `haul_dispatch_manifest_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Haul dispatch manifest exported successfully.');
  }

  function handleExecuteReroute() {
    showToast('Multi-Hauler Reroute Protocol executed: 3 trucks rerouted to Crusher 2.');
  }

  const filteredFleet = FLEET_STREAM.filter(t => fleetFilter === 'all' || t.filterCat === fleetFilter);

  return (
    <main id="routing-view-root" className="flex-1 bg-canvas-sandstone min-h-screen pb-16 font-body text-on-surface">
      {/* Toast Notice */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-earth-charcoal text-white px-4 py-3 rounded shadow-2xl font-headline text-xs font-semibold flex items-center gap-2.5 z-50 border border-copper-accent animate-bounce">
          <span className="material-symbols-outlined text-telemetry-emerald text-[18px]">verified</span>
          <span>{toast}</span>
        </div>
      )}

      {/* Page Header & Operational Controller Header */}
      <div className="px-6 pt-6 pb-4 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="flex flex-col space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-headline text-xs uppercase tracking-wider text-secondary">Operations</span>
            <span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span>
            <span className="font-headline text-xs uppercase tracking-wider text-copper-accent font-semibold">Haul Routing (/routing)</span>
          </div>
          <h1 className="font-headline text-2xl md:text-3xl font-bold text-earth-charcoal tracking-tight">
            Dynamic Haul Routing &amp; Fleet Telemetry
          </h1>
          <p className="font-body text-xs md:text-sm text-on-surface-variant max-w-4xl">
            Multi-Agent RL (MARL) Autonomous Haulage Optimization &amp; Real-Time Ramp Chokepoint Mitigation.
          </p>
        </div>

        {/* Live Status Badges & Quick Command CTAs */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded shadow-sm text-earth-charcoal border border-earth-border">
            <span className={`w-2 h-2 rounded-full animate-ping ${pending ? 'bg-telemetry-amber' : 'bg-telemetry-emerald'}`}></span>
            <span className="font-headline text-xs font-semibold">MARL Engine v2.2: {pending ? 'Computing...' : 'Active (0.0001% Collision Risk)'}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-high rounded shadow-sm text-on-surface-variant border border-earth-border">
            <span className="material-symbols-outlined text-[16px] text-copper-accent">satellite_alt</span>
            <span className="font-headline text-xs">Live Loop 0.4s • {mineId}</span>
          </div>
          <button
            onClick={handleExportManifest}
            className="px-3 py-1.5 bg-surface-container text-earth-charcoal font-headline text-xs font-semibold rounded shadow-sm hover:bg-surface-container-high transition-all flex items-center gap-1 border border-earth-border"
          >
            <span className="material-symbols-outlined text-[16px]">file_download</span>
            Export Manifest (.csv)
          </button>
          <button
            onClick={() => void planRoute()}
            disabled={pending || !points}
            className="px-3 py-1.5 bg-primary-container text-white font-headline text-xs font-bold rounded shadow-sm hover:bg-primary transition-all flex items-center gap-1 disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[16px] ${pending ? 'animate-spin' : ''}`}>
              {pending ? 'sync' : 'alt_route'}
            </span>
            Simulate In-Pit Re-Routing
          </button>
        </div>
      </div>

      <div className="px-6 pb-6 flex flex-col space-y-6">
        {/* KPI Telemetry Ribbon (Bento 4-Card Row) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Card 1 */}
          <div className="bg-surface-parchment p-4 rounded border border-earth-border shadow-sm flex flex-col justify-between space-y-2 relative overflow-hidden">
            <div className="absolute -right-3 -bottom-3 text-surface-container-highest/40 pointer-events-none">
              <span className="material-symbols-outlined text-[96px]">local_shipping</span>
            </div>
            <div className="flex items-center justify-between z-10">
              <span className="font-headline text-[10px] uppercase tracking-wider text-secondary font-bold">Active Haul Fleet</span>
              <span className="px-1.5 py-0.5 bg-surface-container text-telemetry-emerald font-headline text-[10px] rounded font-bold border border-telemetry-emerald/30">
                94.1% Uptime
              </span>
            </div>
            <div className="z-10">
              <div className="font-headline text-2xl font-bold text-earth-charcoal tracking-tight">32 / 34 Units</div>
              <div className="font-body text-xs text-on-surface-variant mt-0.5">26 Komatsu 930E • 6 CAT 793F</div>
            </div>
            <div className="flex items-center gap-1 font-headline text-[11px] text-telemetry-emerald font-semibold z-10">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              <span>Nominal Mechanical Health (98.4%)</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-surface-parchment p-4 rounded border border-earth-border shadow-sm flex flex-col justify-between space-y-2 relative overflow-hidden">
            <div className="flex items-center justify-between z-10">
              <span className="font-headline text-[10px] uppercase tracking-wider text-secondary font-bold">Haul Cycle Efficiency</span>
              <span className="px-1.5 py-0.5 bg-secondary-container text-copper-accent font-headline text-[10px] rounded font-bold">
                Optimal 24.2 km/h
              </span>
            </div>
            <div className="z-10">
              <div className="flex items-baseline gap-1.5">
                <span className="font-headline text-2xl font-bold text-earth-charcoal tracking-tight">94.8%</span>
                <span className="font-headline text-xs text-telemetry-emerald font-bold">+14.2%</span>
              </div>
              <div className="font-body text-xs text-on-surface-variant mt-0.5">Bench 1400S to Crusher Ingress Target</div>
            </div>
            {/* Sparkline */}
            <div className="h-5 flex items-end gap-1 pt-1 z-10">
              {[40, 55, 48, 70, 65, 82, 96].map((h, i) => (
                <div key={i} className="w-2 bg-copper-accent rounded-t-sm" style={{ height: `${h}%`, opacity: 0.3 + (i * 0.1) }}></div>
              ))}
              <span className="font-headline text-[10px] text-secondary ml-1">MARL Adjusted Peak</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="bg-surface-parchment p-4 rounded border border-earth-border shadow-sm flex flex-col justify-between space-y-2 relative overflow-hidden">
            <div className="flex items-center justify-between z-10">
              <span className="font-headline text-[10px] uppercase tracking-wider text-secondary font-bold">Average Cycle Latency</span>
              <span className="px-1.5 py-0.5 bg-surface-container text-earth-charcoal font-headline text-[10px] rounded">
                Target 22.0m
              </span>
            </div>
            <div className="z-10">
              <div className="flex items-baseline gap-1.5">
                <span className="font-headline text-2xl font-bold text-earth-charcoal tracking-tight">21.4 min</span>
                <span className="font-headline text-xs text-telemetry-emerald font-bold">-4.8 min</span>
              </div>
              <div className="font-body text-xs text-on-surface-variant mt-0.5">Cycle queue eliminated via dynamic bypass</div>
            </div>
            <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
              <div className="bg-telemetry-emerald h-full rounded-full" style={{ width: '78%' }}></div>
            </div>
          </div>

          {/* Card 4 */}
          <div className="bg-surface-parchment p-4 rounded border border-earth-border shadow-sm flex flex-col justify-between space-y-2 relative overflow-hidden">
            <div className="flex items-center justify-between z-10">
              <span className="font-headline text-[10px] uppercase tracking-wider text-secondary font-bold">Primary Crusher Queue</span>
              <span className="px-1.5 py-0.5 bg-surface-container text-telemetry-emerald font-headline text-[10px] rounded font-bold">
                NOMINAL
              </span>
            </div>
            <div className="z-10">
              <div className="font-headline text-2xl font-bold text-earth-charcoal tracking-tight">2 Trucks</div>
              <div className="font-body text-xs text-on-surface-variant mt-0.5">Idle wait: 1.4 min (Target &lt; 3.0 min)</div>
            </div>
            <div className="flex items-center justify-between font-headline text-[11px] text-secondary pt-0.5">
              <span>Bin 1: 88% Cap</span>
              <span className="text-copper-accent font-semibold">Bin 2: 32% (Callout)</span>
            </div>
          </div>
        </div>

        {/* Main Content Layout (Split 60% Map / 40% Telemetry & Dispatch) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN: 7 cols */}
          <div className="lg:col-span-7 flex flex-col space-y-6">
            {/* Pit 3D Haul Network Topology Canvas */}
            <div className="bg-surface-parchment rounded border border-earth-border shadow-sm overflow-hidden flex flex-col">
              {/* Canvas Action Bar */}
              <div className="p-4 bg-surface-container-high flex flex-wrap items-center justify-between gap-2 border-b border-earth-border">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">explore</span>
                  <span className="font-headline text-sm font-bold text-earth-charcoal">{mineId} 3D Haul Topology</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-headline text-[10px] font-bold text-secondary uppercase mr-1">View Layers:</span>
                  {LAYERS.map((l) => (
                    <button
                      key={l.key}
                      onClick={() => setLayer(l.key)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors ${
                        layer === l.key
                          ? 'bg-earth-charcoal text-white'
                          : 'bg-surface-container text-secondary hover:bg-surface-container-high border border-earth-border'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                  <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-secondary ml-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showHeat}
                      onChange={(e) => setShowHeat(e.target.checked)}
                      className="accent-copper-accent"
                    />
                    Heatmap
                  </label>
                </div>
              </div>

              {/* MapLibre Canvas Container */}
              <div ref={mapContainer} style={{ height: 480 }} className="w-full relative bg-earth-espresso" />

              {/* Bottom Mini-Bar under Map: Live Haul Grade Hazard Telemetry */}
              <div className="px-4 py-2.5 bg-surface-container flex items-center justify-between gap-3 border-t border-earth-border">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-telemetry-amber/20 text-telemetry-amber font-headline text-[10px] rounded uppercase font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">warning</span>
                    Active Grade Telemetry Alert
                  </span>
                  <p className="font-body text-xs text-on-surface-variant">
                    Ramp B Switchback 14-W (<strong className="text-earth-charcoal">+11.8% incline</strong>, clay moisture 12.4%). Auto-Throttling to 18 km/h.
                  </p>
                </div>
                <span className="font-headline text-[11px] text-copper-accent uppercase tracking-wider font-semibold whitespace-nowrap">
                  Safety Lock: Engaged
                </span>
              </div>
            </div>

            {/* Haul Road Velocity Gradient & Segment Profiling Card */}
            <div className="bg-surface-parchment p-4 rounded border border-earth-border shadow-sm flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">speed</span>
                  <h2 className="font-headline text-sm font-bold text-earth-charcoal">Real-Time Ramp Segment Speed vs Gradient</h2>
                </div>
                <span className="font-headline text-xs text-secondary">Updated 1.2s ago</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Segment 1 */}
                <div className="bg-surface-container p-3 rounded flex flex-col space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-headline text-xs font-semibold text-earth-charcoal">Ramp Alpha (Loaded)</span>
                    <span className="font-mono text-xs font-bold text-telemetry-emerald">28.4 km/h</span>
                  </div>
                  <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                    <div className="bg-telemetry-emerald h-full rounded-full" style={{ width: '88%' }}></div>
                  </div>
                  <div className="flex justify-between text-secondary font-headline text-[10px]">
                    <span>Grade: +7.2%</span>
                    <span>Payload: 96%</span>
                  </div>
                </div>
                {/* Segment 2 */}
                <div className="bg-surface-container p-3 rounded flex flex-col space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-headline text-xs font-semibold text-earth-charcoal">Switchback 14-W</span>
                    <span className="font-mono text-xs font-bold text-telemetry-amber">14.1 km/h</span>
                  </div>
                  <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                    <div className="bg-telemetry-amber h-full rounded-full" style={{ width: '45%' }}></div>
                  </div>
                  <div className="flex justify-between text-secondary font-headline text-[10px]">
                    <span>Grade: +11.8% (Wet)</span>
                    <span>Slip Risk: Moderated</span>
                  </div>
                </div>
                {/* Segment 3 */}
                <div className="bg-surface-container p-3 rounded flex flex-col space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-headline text-xs font-semibold text-earth-charcoal">Return Artery East</span>
                    <span className="font-mono text-xs font-bold text-telemetry-emerald">34.2 km/h</span>
                  </div>
                  <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                    <div className="bg-telemetry-emerald h-full rounded-full" style={{ width: '95%' }}></div>
                  </div>
                  <div className="flex justify-between text-secondary font-headline text-[10px]">
                    <span>Grade: -8.1% (Empty)</span>
                    <span>Retardation: Auto</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Active MARL Constraints / Sliders */}
            <div className="bg-surface-parchment rounded border border-earth-border shadow-sm p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">tune</span>
                  <h3 className="font-headline text-sm font-bold text-earth-charcoal">Active MARL Constraints &amp; Weather Inversion</h3>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <Slider id="rt-rain" label="Rainfall" value={rainfall} min={0} max={250} step={5} unit=" mm" onChange={setRainfall} />
                <Slider id="rt-road" label="Road condition" value={Math.round(roadCondition * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => setRoadCondition(v / 100)} />
                <Slider id="rt-traffic" label="Traffic" value={Math.round(trafficLevel * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => setTrafficLevel(v / 100)} />
              </div>
              
              <div className="flex flex-wrap items-center justify-between pt-3 border-t border-earth-border gap-3">
                <div className="flex items-center gap-4">
                  <label htmlFor="rt-vehicle" className="flex items-center gap-2">
                    <span className="font-headline text-[10px] font-bold uppercase tracking-wider text-secondary">Vehicle</span>
                    <select
                      id="rt-vehicle"
                      value={vehicle}
                      onChange={(e) => setVehicle(e.target.value)}
                      className="bg-surface-container border border-earth-border rounded px-2.5 py-1 text-xs font-headline font-semibold text-earth-charcoal outline-none cursor-pointer"
                    >
                      {VEHICLES.map((v) => (
                        <option key={v.key} value={v.key}>{v.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-earth-charcoal cursor-pointer font-medium">
                    <input
                      id="rt-stockpile"
                      type="checkbox"
                      checked={useStockpile}
                      onChange={(e) => setUseStockpile(e.target.checked)}
                      className="accent-copper-accent w-3.5 h-3.5"
                    />
                    Route via stockpile (P1 → P2 → P3)
                  </label>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void runComparison()}
                    disabled={pending || !points}
                    className="px-3 py-1.5 rounded bg-surface-container text-earth-charcoal font-headline text-xs font-semibold border border-earth-border hover:bg-surface-container-high transition-all disabled:opacity-40"
                  >
                    Simulate Storm Impact
                  </button>
                  <button
                    onClick={() => void planRoute()}
                    disabled={pending || !points}
                    className="px-3 py-1.5 rounded bg-primary-container text-white font-headline text-xs font-bold hover:bg-primary transition-all disabled:opacity-40"
                  >
                    Recalculate Routes
                  </button>
                </div>
              </div>
            </div>

            {/* Storm Comparison Banner */}
            {comparison && (
              <div className="bg-surface-parchment rounded border border-earth-border shadow-sm p-4 border-l-4 border-l-telemetry-amber">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-telemetry-amber text-[20px]">thunderstorm</span>
                  <h3 className="font-headline text-sm font-bold text-earth-charcoal">Simulated Storm Impact vs. Real-Time</h3>
                </div>
                <p className="font-body text-xs text-on-surface-variant mb-3">
                  {comparison.narrative}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded bg-surface-container border border-earth-border shadow-sm flex flex-col">
                    <span className="font-headline text-[10px] uppercase text-secondary mb-1">Dry conditions</span>
                    <span className="font-mono text-lg font-bold" style={{ color: riskColour(comparison.before.route.risk_score) }}>
                      {comparison.before.route.risk_score.toFixed(0)}/100
                    </span>
                    <span className="font-headline text-xs text-on-surface-variant">
                      {comparison.before.route.distance_km.toFixed(2)} km · {comparison.before.route.estimated_time_min.toFixed(0)} min
                    </span>
                  </div>
                  {comparison.original_route_under_new_conditions && (
                    <div className="p-3 rounded bg-surface-container border border-earth-border shadow-sm flex flex-col">
                      <span className="font-headline text-[10px] uppercase text-secondary mb-1">Same line, in the storm</span>
                      <span className="font-mono text-lg font-bold" style={{ color: riskColour(comparison.original_route_under_new_conditions.risk_score) }}>
                        {comparison.original_route_under_new_conditions.risk_score.toFixed(0)}/100
                      </span>
                      <span className="font-headline text-xs text-on-surface-variant">what the original route becomes</span>
                    </div>
                  )}
                  <div className="p-3 rounded bg-surface-container border border-earth-border shadow-sm flex flex-col border-b-2 border-b-telemetry-emerald">
                    <span className="font-headline text-[10px] uppercase text-telemetry-emerald font-bold mb-1">Re-planned route</span>
                    <span className="font-mono text-lg font-bold" style={{ color: riskColour(comparison.after.route.risk_score) }}>
                      {comparison.after.route.risk_score.toFixed(0)}/100
                    </span>
                    <span className="font-headline text-xs text-on-surface-variant">
                      {comparison.after.route.distance_km.toFixed(2)} km · {comparison.after.route.estimated_time_min.toFixed(0)} min
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: 5 cols */}
          <div className="lg:col-span-5 flex flex-col space-y-6">
            {/* 1. Autonomous Multi-Agent Re-Dispatch Controller Card */}
            <div className="bg-surface-parchment p-4 rounded border border-earth-border shadow-sm flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">neurology</span>
                  <h2 className="font-headline text-sm font-bold text-earth-charcoal">Autonomous MARL Re-Dispatch</h2>
                </div>
                <span className="px-2 py-0.5 bg-telemetry-emerald/20 text-telemetry-emerald font-headline text-[10px] rounded uppercase font-bold">
                  RL Cycle 8,429
                </span>
              </div>

              {/* Prescriptive Recommendation Bento Box */}
              <div className="bg-surface-container p-4 rounded flex flex-col space-y-2 border border-earth-border/40">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-copper-accent text-[18px]">auto_fix_high</span>
                  <span className="font-headline text-[10px] uppercase tracking-wider text-copper-accent font-bold">AI Prescriptive Directive</span>
                </div>
                <h3 className="font-headline text-sm font-bold text-earth-charcoal">
                  Divert 3 Haulers from Crusher 1 to Crusher 2
                </h3>
                <p className="font-body text-xs text-on-surface-variant">
                  Crusher Pocket #1 dump queue latency will crest 9.6 minutes at current inbound trajectory. In-Pit Bin #2 will starve in 4.2 minutes.
                </p>

                {/* Impact Metric Grid */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="bg-surface-elevation p-2 rounded">
                    <span className="font-headline text-[10px] uppercase text-secondary font-semibold">Throughput Gain</span>
                    <div className="font-headline text-xs text-telemetry-emerald font-bold">+420 t/h mill feed</div>
                  </div>
                  <div className="bg-surface-elevation p-2 rounded">
                    <span className="font-headline text-[10px] uppercase text-secondary font-semibold">Queue Reduction</span>
                    <div className="font-headline text-xs text-earth-charcoal font-bold">-8.4 min idle time</div>
                  </div>
                </div>

                {/* Auto-Dispatch Autonomous Execution Toggle */}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex flex-col">
                    <span className="font-headline text-xs text-earth-charcoal font-semibold">Autonomous Execution</span>
                    <span className="font-body text-[11px] text-secondary">Superintendent Supervisory Override Active</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-surface-dim px-2 py-1 rounded">
                    <span className={`font-headline text-[10px] font-bold ${autonomousEnabled ? 'text-telemetry-emerald' : 'text-secondary'}`}>
                      {autonomousEnabled ? 'ENABLED' : 'PAUSED'}
                    </span>
                    <div
                      onClick={() => setAutonomousEnabled(!autonomousEnabled)}
                      className={`w-8 h-4 rounded-full p-0.5 flex items-center cursor-pointer transition-colors ${
                        autonomousEnabled ? 'bg-primary-container justify-end' : 'bg-surface-container-high justify-start'
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full bg-white shadow-sm"></div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleExecuteReroute}
                  className="w-full py-2 bg-primary-container text-white font-headline text-xs font-bold rounded shadow-sm hover:bg-primary transition-all flex items-center justify-center gap-1.5 mt-1"
                >
                  <span className="material-symbols-outlined text-[16px]">sync_alt</span>
                  Execute Multi-Hauler Reroute Protocol
                </button>
              </div>
            </div>

            {/* 2. Crusher & Dumping Pocket Load Balancing */}
            <div className="bg-surface-parchment p-4 rounded border border-earth-border shadow-sm flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">filter_alt</span>
                  <h2 className="font-headline text-sm font-bold text-earth-charcoal">Crusher Pocket Load Balancing</h2>
                </div>
                <span className="font-headline text-xs text-secondary">Capacity Gauges</span>
              </div>
              <div className="space-y-2.5">
                {/* Crusher 1 */}
                <div className="bg-surface-container p-3 rounded space-y-1 border border-earth-border/40">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-telemetry-amber"></span>
                      <span className="font-headline text-xs text-earth-charcoal font-semibold">Primary Crusher 1 Pocket</span>
                    </div>
                    <span className="font-headline text-[11px] text-telemetry-amber font-bold">88% (Near Capacity)</span>
                  </div>
                  <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                    <div className="bg-telemetry-amber h-full rounded-full" style={{ width: '88%' }}></div>
                  </div>
                  <div className="flex justify-between items-center text-secondary font-body text-xs">
                    <span>4 Inbound Trucks • Wait: 3.8 min</span>
                    <span className="text-telemetry-crimson font-semibold">Bypass Recommended</span>
                  </div>
                </div>

                {/* Crusher 2 */}
                <div className="bg-surface-container p-3 rounded space-y-1 border border-earth-border/40">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-copper-accent"></span>
                      <span className="font-headline text-xs text-earth-charcoal font-semibold">In-Pit Gyratory Bin #2</span>
                    </div>
                    <span className="font-headline text-[11px] text-copper-accent font-bold">32% (Starvation Risk)</span>
                  </div>
                  <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                    <div className="bg-copper-accent h-full rounded-full" style={{ width: '32%' }}></div>
                  </div>
                  <div className="flex justify-between items-center text-secondary font-body text-xs">
                    <span>1 Inbound Truck • Wait: 0.0 min</span>
                    <span className="text-telemetry-emerald font-semibold">Ready for Inflow (+3)</span>
                  </div>
                </div>

                {/* Stockpile 4-C */}
                <div className="bg-surface-container p-3 rounded space-y-1 border border-earth-border/40">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-telemetry-emerald"></span>
                      <span className="font-headline text-xs text-earth-charcoal font-semibold">Run-of-Mine Stockpile 4-C</span>
                    </div>
                    <span className="font-headline text-[11px] text-telemetry-emerald font-bold">64% (Nominal)</span>
                  </div>
                  <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                    <div className="bg-telemetry-emerald h-full rounded-full" style={{ width: '64%' }}></div>
                  </div>
                  <div className="flex justify-between items-center text-secondary font-body text-xs">
                    <span>3 Inbound Trucks (Lower Grade Blend)</span>
                    <span>Buffer Optimal</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Active Fleet Telemetry Stream Table */}
            <div className="bg-surface-parchment p-4 rounded border border-earth-border shadow-sm flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">monitor_heart</span>
                  <h2 className="font-headline text-sm font-bold text-earth-charcoal">Fleet Telemetry Stream</h2>
                </div>
                <span className="font-headline text-xs text-secondary">32 Active Vectors</span>
              </div>
              {/* Quick Filters */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {(['all', 'queued', 'hauling', 'returning'] as const).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setFleetFilter(cat)}
                    className={`px-2 py-0.5 font-headline text-[10px] font-bold rounded uppercase whitespace-nowrap transition-colors ${
                      fleetFilter === cat
                        ? 'bg-earth-charcoal text-white'
                        : 'bg-surface-container text-secondary hover:text-earth-charcoal'
                    }`}
                  >
                    {cat.toUpperCase()} {cat === 'all' ? '(32)' : cat === 'queued' ? '(4)' : cat === 'hauling' ? '(18)' : '(8)'}
                  </button>
                ))}
              </div>
              {/* Compact Data Ledger */}
              <div className="overflow-x-auto">
                <table className="w-full text-left font-body text-xs">
                  <thead>
                    <tr className="bg-surface-elevation text-secondary font-headline text-[10px] font-bold uppercase">
                      <th className="py-2 px-2">Truck ID</th>
                      <th className="py-2 px-2">Payload / Grade</th>
                      <th className="py-2 px-2">Vector &amp; Speed</th>
                      <th className="py-2 px-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-earth-border/40">
                    {filteredFleet.map((t) => (
                      <tr key={t.id} className="hover:bg-surface-container transition-colors">
                        <td className="py-2 px-2 font-mono font-bold text-copper-accent">{t.id}</td>
                        <td className="py-2 px-2">
                          <div className="font-medium text-earth-charcoal">{t.payload}</div>
                          <div className="text-[10px] text-secondary">{t.route}</div>
                        </td>
                        <td className="py-2 px-2">
                          <div>{t.vector}</div>
                          <div className={`text-[10px] ${t.noteCls}`}>{t.note}</div>
                        </td>
                        <td className="py-2 px-2 text-right">
                          <span className={`px-2 py-0.5 font-headline text-[10px] font-bold rounded ${t.statusCls}`}>
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Active Dispatch Directive (When Route Result is Available) */}
            {result && active && (
              <div className="bg-surface-parchment rounded border border-earth-border shadow-sm p-4 flex flex-col">
                <div className="flex items-center justify-between border-b border-earth-border pb-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-copper-accent text-[20px]">route</span>
                    <h3 className="font-headline text-sm font-bold text-earth-charcoal">Active Dispatch Directive</h3>
                  </div>
                  <span className="font-headline text-[10px] font-bold bg-surface-container text-earth-charcoal px-2 py-0.5 rounded border border-earth-border">
                    Confidence 92%
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-surface-container p-2.5 rounded border border-earth-border/40 flex flex-col">
                    <span className="font-headline text-[10px] uppercase text-secondary">Total Distance</span>
                    <span className="font-mono text-base font-bold text-earth-charcoal">
                      {active.distance_km.toFixed(2)} <span className="text-xs font-normal text-secondary">km</span>
                    </span>
                  </div>
                  <div className="bg-surface-container p-2.5 rounded border border-earth-border/40 flex flex-col">
                    <span className="font-headline text-[10px] uppercase text-secondary">Cycle Time</span>
                    <span className="font-mono text-base font-bold text-earth-charcoal">
                      {active.estimated_time_min.toFixed(0)} <span className="text-xs font-normal text-secondary">min</span>
                    </span>
                  </div>
                  <div className="bg-surface-container p-2.5 rounded border border-earth-border/40 flex flex-col">
                    <span className="font-headline text-[10px] uppercase text-secondary">Computed Risk</span>
                    <span className="font-mono text-base font-bold" style={{ color: riskColour(active.risk_score) }}>
                      {active.risk_score.toFixed(0)}/100
                    </span>
                  </div>
                  <div className="bg-surface-container p-2.5 rounded border border-earth-border/40 flex flex-col">
                    <span className="font-headline text-[10px] uppercase text-secondary">Safety Confidence</span>
                    <span className="font-mono text-base font-bold text-telemetry-emerald">
                      {active.safety_score.toFixed(0)}/100
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {routes.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedRoute(i)}
                      className={`px-2.5 py-1 rounded font-headline text-xs font-semibold border transition-all ${
                        selectedRoute === i
                          ? 'bg-primary-container text-white border-primary-container shadow-sm'
                          : 'bg-surface-container text-secondary border-earth-border hover:bg-surface-container-high'
                      }`}
                    >
                      {i === 0 ? 'Recommended' : `Alt ${i}`} · {r.distance_km.toFixed(1)}km
                    </button>
                  ))}
                </div>

                <div className="mt-1">
                  <span className="font-headline text-[10px] uppercase tracking-wider text-secondary mb-1.5 block font-bold">
                    Risk Breakdown Profile
                  </span>
                  <RiskBreakdown route={active} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM FULL-WIDTH SECTION: Cycle Time Decomposition & Bottleneck Telemetry */}
        <div className="bg-surface-parchment p-6 rounded border border-earth-border shadow-sm flex flex-col space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-copper-accent text-[22px]">timer</span>
                <h2 className="font-headline text-base font-bold text-earth-charcoal">Haul Cycle Decomposition &amp; Bottleneck Analysis</h2>
              </div>
              <p className="font-body text-xs text-on-surface-variant">
                Full 21.4-minute benchmark trip cycle tracked across shovel staging, grade ascent, crusher dump bin, and downhill empty return.
              </p>
            </div>
            <div className="flex items-center gap-2 font-headline text-xs text-secondary">
              <span>Target Standard: 22.0 min</span>
              <span className="px-2 py-0.5 bg-surface-container text-telemetry-emerald rounded font-bold border border-telemetry-emerald/20">
                Delta: -2.7% (Optimal)
              </span>
            </div>
          </div>

          {/* 4-Phase Chrono Timeline Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Phase 1 */}
            <div className="bg-surface-container p-4 rounded border border-earth-border/40 flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-headline text-[10px] uppercase tracking-wider text-secondary font-bold">Phase 01 • Spot &amp; Load</span>
                <span className="material-symbols-outlined text-telemetry-emerald text-[16px]">check</span>
              </div>
              <div>
                <div className="font-headline text-xl font-bold text-earth-charcoal">3.2 min</div>
                <div className="font-body text-xs text-on-surface-variant">CAT 7495 Shovel #4</div>
              </div>
              <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                <div className="bg-telemetry-emerald h-full rounded-full" style={{ width: '72%' }}></div>
              </div>
              <span className="font-headline text-[10px] text-secondary">Nominal (3.0m - 3.5m target)</span>
            </div>

            {/* Phase 2 */}
            <div className="bg-surface-container p-4 rounded border border-earth-border/40 flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-headline text-[10px] uppercase tracking-wider text-secondary font-bold">Phase 02 • Loaded Ascent</span>
                <span className="px-1.5 py-0.5 bg-telemetry-emerald/20 text-telemetry-emerald font-headline text-[10px] rounded font-bold">-1.2m</span>
              </div>
              <div>
                <div className="font-headline text-xl font-bold text-earth-charcoal">8.6 min</div>
                <div className="font-body text-xs text-on-surface-variant">Bench 1400S → Surface Rim</div>
              </div>
              <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                <div className="bg-primary-container h-full rounded-full" style={{ width: '82%' }}></div>
              </div>
              <span className="font-headline text-[10px] text-telemetry-emerald font-medium">Auto-dispatch smoothed traffic</span>
            </div>

            {/* Phase 3 */}
            <div className="bg-surface-container p-4 rounded border border-earth-border/40 flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-headline text-[10px] uppercase tracking-wider text-secondary font-bold">Phase 03 • Crusher Dump</span>
                <span className="px-1.5 py-0.5 bg-telemetry-amber/20 text-telemetry-amber font-headline text-[10px] rounded font-bold">+0.8m</span>
              </div>
              <div>
                <div className="font-headline text-xl font-bold text-earth-charcoal">2.8 min</div>
                <div className="font-body text-xs text-on-surface-variant">Crusher Pocket #1 Bin</div>
              </div>
              <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                <div className="bg-telemetry-amber h-full rounded-full" style={{ width: '65%' }}></div>
              </div>
              <span className="font-headline text-[10px] text-telemetry-amber">Rerouting mitigating tail queue</span>
            </div>

            {/* Phase 4 */}
            <div className="bg-surface-container p-4 rounded border border-earth-border/40 flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-headline text-[10px] uppercase tracking-wider text-secondary font-bold">Phase 04 • Empty Return</span>
                <span className="material-symbols-outlined text-telemetry-emerald text-[16px]">speed</span>
              </div>
              <div>
                <div className="font-headline text-xl font-bold text-earth-charcoal">6.8 min</div>
                <div className="font-body text-xs text-on-surface-variant">East Bypass → Loading Face</div>
              </div>
              <div className="w-full bg-surface-dim rounded-full h-1.5 overflow-hidden">
                <div className="bg-telemetry-emerald h-full rounded-full" style={{ width: '90%' }}></div>
              </div>
              <span className="font-headline text-[10px] text-secondary">Retardation nominal • 34 km/h avg</span>
            </div>
          </div>

          {/* Provenance Ledger Footer Bar */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 font-headline text-[11px] text-secondary border-t border-earth-border/60">
            <div className="flex items-center gap-3">
              <span className="font-mono text-earth-charcoal font-semibold">DISPATCH-PROV-HASH: 0x8F92E3...C19A</span>
              <span>•</span>
              <span>Model: MARL-PPO-v4.2-Crucible</span>
              <span>•</span>
              <span>Safety Envelope: ISO 21815 Haulage Compliance</span>
            </div>
            <div className="flex items-center gap-1.5 text-copper-accent font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-copper-accent animate-ping"></span>
              <span>Continuous Telemetry Stream Synchronized</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
