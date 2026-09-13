'use client';

/**
 * Exploration Intelligence — GIS rebuild.
 *
 * UI unchanged: Data Strata panel (left), target detail panel (right), quick
 * target chips, Drill Review modal. Map internals rebuilt:
 *   - basemap via the MapProvider abstraction (OpenFreeMap, no API key)
 *   - AI targets + scored grid as GeoJSON/GL circle layers (core/glow/pulse)
 *   - every rendered target and grid cell is clickable → evidence panel
 *   - prospectivity heatmap layer, India-only gate, reverse-geocoded locality
 *   - "Ask AI" calls /api/ai/target-brief (Groq GPT-OSS-20B server-side,
 *     deterministic fallback) — the LLM explains; the model decides.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@clerk/nextjs';
import { DrillReviewModal } from '@/components/minex/Modals';
import { apiFetch } from '@/lib/api';
import {
  FALLBACK_TARGETS,
  type ExplorationTarget,
} from '@/lib/minex';
import {
  resolveMapStyle,
  applyMapTheme,
  MAP_RASTER_ATTRIBUTION,
  assertIndiaOnly,
  prospectivityBand,
  PROB_COLOR,
} from '@/lib/mapConfig';
import { getTheme } from '@/lib/theme';

const SAUSAR_CENTER: [number, number] = [79.25, 21.95]; // [lng, lat]

interface GridCell {
  id: string;
  lat: number;
  lng: number;
  prob: number;
  belt?: string;
  ndvi?: number | null;
  elevation?: number | null;
  geochem?: number | null;
  lithology?: string | null;
}

interface LocationContext {
  country?: string | null;
  state?: string | null;
  district?: string | null;
  nearestLocality?: string | null;
  unavailable?: boolean;
}

export default function ExplorationPage() {
  const { getToken } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const pulsePhaseRef = useRef(0);
  const gridByIdRef = useRef<Map<string, GridCell>>(new Map());

  const [targets, setTargets] = useState<ExplorationTarget[]>(FALLBACK_TARGETS);
  const [selectedId, setSelectedId] = useState<string>(FALLBACK_TARGETS[0].id);
  const [reviewingTarget, setReviewingTarget] = useState<ExplorationTarget | null>(null);
  const [gridLoading, setGridLoading] = useState(true);
  const [locCtx, setLocCtx] = useState<LocationContext | null>(null);
  const [brief, setBrief] = useState<{ text: string; source: string } | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const [strataLayers, setStrataLayers] = useState({
    geological: true,      // radial geological overlay
    electromagnetic: true, // target glow layers
    historicalDrills: false,
    gravityFaults: true,   // scored grid circles
    heatmap: false,        // prospectivity heatmap
  });

  const selectedTarget = targets.find((t) => t.id === selectedId) ?? targets[0];
  const compareTarget = compareWith ? targets.find((t) => t.id === compareWith) ?? null : null;

  // ---------------------------------------------------------------- data
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getToken();
      try {
        const api = await apiFetch<any>('/exploration/targets?limit=12', {}, token);
        if (!alive) return;
        const rows = Array.isArray(api?.targets) ? api.targets : [];
        if (rows.length) {
          const mapped: ExplorationTarget[] = rows
            .filter((r: any) => assertIndiaOnly(Number(r.latitude), Number(r.longitude)))
            .map((r: any) => ({
              id: String(r.target_id ?? 'target'),
              name: `Target ${String(r.target_id ?? '0000').slice(-4)}`,
              coordinates: `${Number(r.latitude).toFixed(4)}° N, ${Number(r.longitude).toFixed(4)}° E`,
              lat: Number(r.latitude),
              lng: Number(r.longitude),
              status: r.maturity_stage ?? 'Screened',
              probability: Math.round((Number(r.prospectivity_prob) || 0) * 100),
              subsurfaceConf:
                (Number(r.prospectivity_prob) || 0) >= 0.75 ? 'HIGH' : (Number(r.prospectivity_prob) || 0) >= 0.55 ? 'MEDIUM' : 'MODERATE',
              maturity: r.maturity_stage ?? 'Screened',
              geologicalLayers: 'Real',
              eoDataSynthesis: 'Synthetic',
              assayCorrelation: `${Number(r.mn_geochemistry ?? 0).toFixed(2)} Geochem Index`,
              densityScore: Number((1 + (Number(r.prospectivity_prob) || 0) * 3.8).toFixed(2)),
              estimatedReserveTons: 'Prospectivity score — not a reserve claim',
              description: `AI exploration target in the ${r.belt ?? 'Sausar'} belt. Lithology signature: ${r.lithology_code ?? 'unknown'}. Model score — not a confirmed deposit. All data SYNTHETIC.`,
            }));
          if (mapped.length) {
            setTargets(mapped);
            pushTargets(mapped);
            setSelectedId(mapped[0].id);
            // Frame the survey extent once the map exists
            const wait = setInterval(() => {
              const map = mapRef.current;
              if (!map?.isStyleLoaded?.()) return;
              clearInterval(wait);
              const lats = mapped.map((x) => x.lat);
              const lngs = mapped.map((x) => x.lng);
              map.fitBounds(
                [
                  [Math.min(...lngs) - 0.2, Math.min(...lats) - 0.2],
                  [Math.max(...lngs) + 0.2, Math.max(...lats) + 0.2],
                ],
                { padding: 90, duration: 0 }
              );
            }, 400);
          }
        }
      } catch {
        /* fallback targets remain */
      }

      // Scored grid (heavier call) — load after the primary targets render.
      try {
        const grid = await apiFetch<any>('/exploration/map', {}, token);
        if (!alive) return;
        const feats: any[] = Array.isArray(grid?.features) ? grid.features : [];
        const cells: GridCell[] = feats
          .map((f) => ({
            id: String(f.grid_id ?? ''),
            lat: Number(f.latitude),
            lng: Number(f.longitude),
            prob: Number(f.prospectivity_prob) || 0,
            belt: f.belt ?? null,
            ndvi: f.ndvi ?? f.NDVI ?? null,
            elevation: f.elevation_m ?? null,
            geochem: f.mn_geochemistry ?? null,
            lithology: f.lithology_code ?? null,
          }))
          .filter((c) => c.id && assertIndiaOnly(c.lat, c.lng));
        gridByIdRef.current = new Map(cells.map((c) => [c.id, c]));
        addGridSource(cells);
      } catch {
        /* grid layer simply stays empty */
      } finally {
        if (alive) setGridLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // Mount-only data load, intentionally. `addGridSource` and `pushTargets` are
    // useCallback(..., []) so their identity never changes, and both are declared
    // further down the component body — naming them here would evaluate them in
    // their TDZ during render and throw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Location context for the selected target (cached server-side).
  // Keyed on the coordinates actually read inside the effect, not just the id:
  // the target list is swapped from fallback data to API data after mount, so an
  // id-only key could keep stale coordinates for a re-used id.
  const selLat = selectedTarget?.lat;
  const selLng = selectedTarget?.lng;
  useEffect(() => {
    if (selLat == null || selLng == null) return;
    let alive = true;
    setLocCtx(null);
    (async () => {
      try {
        const res = await fetch(`/api/geo/reverse?lat=${selLat}&lon=${selLng}`);
        const j = await res.json();
        if (alive) setLocCtx(j);
      } catch {
        if (alive) setLocCtx({ unavailable: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [selLat, selLng]);

  // ---------------------------------------------------------------- map
  const addGridSource = useCallback((cells: GridCell[]) => {
    const map = mapRef.current;
    if (!map || !cells.length) return;
    if (!map.isStyleLoaded?.()) {
      map.once('style.load', () => addGridSource(cells));
      return;
    }
    if (map.getSource('grid')) {
      (map.getSource('grid') as any).setData(toGeoJSON(cells));
      return;
    }
    map.addSource('grid', { type: 'geojson', data: toGeoJSON(cells) });
    // Prospectivity heatmap (toggle, non-interactive)
    map.addLayer({
      id: 'grid-heat', type: 'heatmap', source: 'grid',
      maxzoom: 14, layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'prob'], 0, 0, 1, 1],
        'heatmap-intensity': 0.7,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(7,20,27,0)', 0.4, '#16313D', 0.6, '#41606B',
          0.75, '#D99523', 0.9, '#FFC56F',
        ],
        'heatmap-radius': 28,
        'heatmap-opacity': 0.55,
      },
    });
    // Scored grid circles (gravity/structures toggle) — only visible when zoomed in
    map.addLayer({
      id: 'grid-circles', type: 'circle', source: 'grid',
      minzoom: 10,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 8],
        'circle-color': [
          'match', ['get', 'band'],
          'high', PROB_COLOR.high, 'medium', PROB_COLOR.medium, PROB_COLOR.low,
        ],
        'circle-opacity': 0.5,
        'circle-stroke-width': 1,
        'circle-stroke-color': [
          'match', ['get', 'band'],
          'high', PROB_COLOR.high, 'medium', PROB_COLOR.medium, PROB_COLOR.low,
        ],
        'circle-stroke-opacity': 0.6,
      },
    });
    // Pulse ring under the primary-target glow layers
    if (!map.getLayer('target-pulse')) addPulseLayer(map);
  }, []);

  const addPulseLayer = (map: any) => {
    map.addLayer({
      id: 'target-pulse', type: 'circle', source: 'targets',
      filter: ['==', ['get', 'id'], selectedIdRef.current],
      paint: {
        'circle-radius': 10,
        'circle-color': '#D9574F',
        'circle-opacity': 0.25,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFC56F',
        'circle-stroke-opacity': 0.7,
      },
    });
  };

  // selectedId accessible inside map callbacks without re-binding handlers
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    const map = mapRef.current;
    if (map?.getLayer?.('target-pulse')) {
      map.setFilter('target-pulse', ['==', ['get', 'id'], selectedId]);
      map.setPaintProperty('target-glow', 'circle-opacity', [
        'case', ['==', ['get', 'id'], selectedId], 0.0, 0.18,
      ]);
    }
  }, [selectedId]);

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
        center: SAUSAR_CENTER,
        zoom: 8,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      mapRef.current = map;
      if (typeof window !== 'undefined') (window as any).__minexMap = map;

      map.on('styleimagemissing', (e: any) => {
        const id = e.id;
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          map.addImage(id, ctx.getImageData(0, 0, 1, 1));
        }
      });

      map.on('style.load', () => {
        if (cancelled) return;
        // Primary AI exploration targets (clickable)
        const cached = targetsRef.current;
        if (!map.getSource('targets')) {
          map.addSource('targets', { type: 'geojson', data: toGeoJSON(cached) });
          map.addLayer({
            id: 'target-glow', type: 'circle', source: 'targets',
            minzoom: 8,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 12, 16],
              'circle-color': '#FFC56F', 'circle-opacity': 0.18,
              'circle-blur': 1.2,
            },
          });
          map.addLayer({
            id: 'target-core', type: 'circle', source: 'targets',
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 12, 8],
              'circle-color': '#D9574F',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#F4F7F6',
            },
          });
          addPulseLayer(map);
          startPulse(map);
        }
      });

      // Click any rendered target or grid cell
      const pick = () => (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = String(f.properties?.id ?? '');
        if (!id) return;
        setSelectedId(id);
        map.easeTo({ center: [f.properties.lng, f.properties.lat], zoom: Math.max(map.getZoom(), 10), duration: 600 });
      };
      map.on('click', 'target-core', pick());
      map.on('click', 'grid-circles', pick());
      for (const layer of ['target-core', 'target-glow', 'grid-circles']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
      window.addEventListener('minex-theme', (e) => applyMapTheme(map, (e as CustomEvent).detail));
    })();
    return () => {
      cancelled = true;
      clearInterval(rafRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Targets accessible to map callbacks — race-free: waits for style if needed
  const targetsRef = useRef(targets);
  const pushTargets = useCallback((list: ExplorationTarget[]) => {
    targetsRef.current = list;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (map.getSource('targets')) {
        (map.getSource('targets') as any).setData(toGeoJSON(list));
      }
    };
    if (map.isStyleLoaded?.()) apply();
    else map.once('style.load', apply);
  }, []);

  useEffect(() => {
    pushTargets(targets);
  }, [targets, pushTargets]);

  // Pulse animation — light interval (≈7fps paint updates, no DOM animation)
  const startPulse = (map: any) => {
    const tick = () => {
      if (!mapRef.current) return;
      if (map.getLayer('target-pulse') && strataRef.current.electromagnetic) {
        pulsePhaseRef.current = (pulsePhaseRef.current + 0.15) % 1;
        const phase = pulsePhaseRef.current;
        map.setPaintProperty('target-pulse', 'circle-radius', 8 + phase * 26);
        map.setPaintProperty('target-pulse', 'circle-opacity', 0.35 * (1 - phase));
        map.setPaintProperty('target-pulse', 'circle-stroke-opacity', 0.8 * (1 - phase));
      }
    };
    const id = window.setInterval(tick, 150);
    rafRef.current = id as unknown as number;
  };

  const strataRef = useRef(strataLayers);
  useEffect(() => {
    strataRef.current = strataLayers;
    const map = mapRef.current;
    if (!map?.isStyleLoaded?.()) return;
    const setVis = (layer: string, visible: boolean) => {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
    };
    setVis('grid-heat', strataLayers.heatmap);
    setVis('grid-circles', strataLayers.gravityFaults);
    setVis('target-glow', strataLayers.electromagnetic);
    setVis('target-pulse', strataLayers.electromagnetic);
  }, [strataLayers]);

  useEffect(() => {
    // When the grid source arrives after style load, reapply toggle visibility
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => {
      if (!map.isStyleLoaded?.()) return;
      const setVis = (layer: string, visible: boolean) => {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
      };
      setVis('grid-heat', strataLayers.heatmap);
      setVis('grid-circles', strataLayers.gravityFaults);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridLoading]);

  const handleToggleStrata = (key: keyof typeof strataLayers) =>
    setStrataLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  // ---------------------------------------------------------------- AI
  const askAI = useCallback(async () => {
    if (!selectedTarget) return;
    setBriefLoading(true);
    setBrief(null);
    try {
      const cell = gridByIdRef.current.get(selectedTarget.id);
      const res = await fetch('/api/ai/target-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_id: selectedTarget.id,
          coordinates: { latitude: selectedTarget.lat, longitude: selectedTarget.lng },
          resolved_location: locCtx ?? null,
          prospectivity_probability: selectedTarget.probability / 100,
          confidence: evidenceOf(selectedTarget, cell).confidence,
          uncertainty: evidenceOf(selectedTarget, cell).uncertainty,
          maturity: selectedTarget.maturity,
          geology: {
            mn_geochemistry: cell?.geochem ?? null,
            elevation_m: cell?.elevation ?? null,
            ndvi: cell?.ndvi ?? null,
            lithology_code: cell?.lithology ?? selectedTarget.id,
            belt: selectedTarget.coordinates,
          },
          data_origin: 'SYNTHETIC',
        }),
      });
      const j = await res.json();
      setBrief({ text: j?.brief ?? 'No summary available.', source: j?.source ?? 'deterministic' });
    } catch {
      setBrief({ text: 'Analysis unavailable — showing coordinates only.', source: 'error' });
    } finally {
      setBriefLoading(false);
    }
  }, [selectedTarget, locCtx]);

  // ---------------------------------------------------------------- render helpers
  const cell = gridByIdRef.current.get(selectedId);
  const ev = evidenceOf(selectedTarget, cell);

  return (
    <main id="exploration-view-root" className="flex-1 flex flex-col relative h-[calc(100vh-56px)] overflow-hidden bg-deep2">
      {/* Real map canvas (provider from mapConfig — no CARTO, no API key) */}
      <div className="absolute inset-0 z-0 overflow-hidden select-none">
        <div ref={mapContainer} className="w-full h-full" />
        {gridLoading && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-deep2/90 px-3 py-1.5 rounded-full border border-line text-[11px] text-inkb z-10">
            Loading scored grid…
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:90px_90px] pointer-events-none" />
        {strataLayers.geological && (
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(255,197,111,0.08), transparent 60%)' }} />
        )}
        {strataLayers.historicalDrills && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[45%] left-[42%] flex items-center gap-1 text-[10px] text-infot bg-deep2/90 px-1.5 py-0.5 rounded border border-info/40">
              <span className="w-1.5 h-1.5 bg-info rounded-full"></span> DH-041 (41.2% Mn)
            </div>
            <div className="absolute top-[58%] left-[51%] flex items-center gap-1 text-[10px] text-infot bg-deep2/90 px-1.5 py-0.5 rounded border border-info/40">
              <span className="w-1.5 h-1.5 bg-info rounded-full"></span> DH-038 (38.9% Mn)
            </div>
          </div>
        )}
      </div>

      {/* Overlay panels — unchanged layout */}
      <div className="absolute inset-0 z-10 p-4 md:p-6 lg:p-8 flex flex-col md:flex-row justify-between pointer-events-none gap-6">
        {/* Left: Data Strata */}
        <div className="w-full md:w-80 flex flex-col gap-4 pointer-events-auto overflow-y-auto max-h-full">
          <div className="liquid-glass-dark rounded-xl ambient-shadow border border-line backdrop-blur-xl overflow-hidden">
            {/* Collapsible header */}
            <div
              className="flex items-center justify-between px-5 py-3 cursor-pointer select-none hover:bg-white/5 transition-colors border-b border-line/50"
              onClick={() => setLeftCollapsed((v) => !v)}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-accentt text-base">layers</span>
                <span className="text-xs font-bold uppercase tracking-wider text-ink">Data Strata</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-okt font-bold bg-ok/10 px-2 py-0.5 rounded border border-ok/30">ACTIVE</span>
                <span
                  className="material-symbols-outlined text-ink3 text-base transition-transform duration-300"
                  style={{ transform: leftCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >expand_less</span>
              </div>
            </div>
            {!leftCollapsed && (
              <div className="p-5 pt-4">
                <div className="space-y-3 text-xs">
              {(
                [
                  ['geological', 'Geological Structures'],
                  ['electromagnetic', 'Electromagnetic Anomalies'],
                  ['historicalDrills', 'Historical Drill Collars'],
                  ['gravityFaults', 'Scored Grid Cells'],
                  ['heatmap', 'Prospectivity Heatmap'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer group select-none">
                  <input
                    type="checkbox"
                    checked={strataLayers[key]}
                    onChange={() => handleToggleStrata(key)}
                    className="h-4 w-4 accent-accent cursor-pointer"
                  />
                  <span className="text-ink2 group-hover:text-ink transition-colors font-medium">{label}</span>
                </label>
              ))}
                </div>
                <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-[11px] text-ink3">
                  <span>Sausar Belt</span>
                  <span>{MAP_RASTER_ATTRIBUTION.split('·')[0]?.trim() ?? 'Esri'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Quick target selector + compare mode */}
          <div className="liquid-glass-dark rounded-xl p-3 border border-line flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-inkb uppercase tracking-wider px-1">
              {compareWith ? 'Compare B:' : 'Targets:'}
            </span>
            {targets.slice(0, 6).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  if (compareWith === t.id) {
                    setCompareWith(null);
                    return;
                  }
                  if (compareWith === '__pending__') {
                    setCompareWith(t.id);
                    return;
                  }
                  setSelectedId(t.id);
                  mapRef.current?.easeTo({ center: [t.lng, t.lat], zoom: 11, duration: 600 });
                }}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                  t.id === selectedId || t.id === compareWith
                    ? 'bg-accent text-onaccent shadow-md font-bold'
                    : 'bg-panel2 text-ink2 hover:bg-panel4'
                }`}
              >
                {t.name.replace('Target ', '')}
              </button>
            ))}
            <button
              onClick={() => setCompareWith(compareWith ? null : '__pending__')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all border ${
                compareWith
                  ? 'bg-chipon text-inkb border-chipon'
                  : 'border-line3 text-inkb hover:border-accent hover:text-accentt'
              }`}
            >
              ⇄ Compare
            </button>
          </div>
        </div>

        {/* Right: target detail (existing panel, enriched) */}
        {selectedTarget && (
          <div className="w-full md:w-[420px] pointer-events-auto flex flex-col justify-end md:justify-start overflow-y-auto max-h-full">
            <div className="liquid-glass-dark rounded-[24px] ambient-shadow border border-line backdrop-blur-2xl shadow-2xl overflow-hidden">
              {/* Collapsible header — always visible */}
              <div
                className="flex items-center justify-between px-6 py-4 cursor-pointer select-none hover:bg-white/5 transition-colors"
                onClick={() => setRightCollapsed((v) => !v)}
              >
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-infot uppercase tracking-widest">AI Exploration Target</span>
                  <span className="font-['Manrope'] text-lg font-bold text-ink leading-tight">{selectedTarget.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-warnt bg-warn/10 border border-warn/40 px-2 py-0.5 rounded">SYNTHETIC</span>
                  <span
                    className="material-symbols-outlined text-ink3 text-base transition-transform duration-300"
                    style={{ transform: rightCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  >expand_less</span>
                </div>
              </div>
              {!rightCollapsed && (
              <div className="px-6 lg:px-7 pb-6 lg:pb-7 flex flex-col gap-4">
                <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-infot uppercase tracking-widest">AI Exploration Target</span>
                  <span className="text-[10px] font-bold text-warnt bg-warn/10 border border-warn/40 px-2 py-0.5 rounded">
                    SYNTHETIC
                  </span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-['Manrope'] text-3xl font-bold text-ink">{selectedTarget.name}</h2>
                  <span className="px-3 py-1 bg-warn/20 border border-warn text-warnt text-xs font-bold rounded-full">
                    {selectedTarget.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-ink2 text-sm">
                  <span className="material-symbols-outlined text-sm text-accentt">my_location</span>
                  <span className="font-mono">{selectedTarget.coordinates}</span>
                </div>
                <p className="text-[11px] text-inkb mt-1">
                  {locCtx && !locCtx.unavailable
                    ? [locCtx.district, locCtx.state, locCtx.country].filter(Boolean).join(' · ') || 'Locating…'
                    : locCtx?.unavailable
                    ? 'Location context unavailable'
                    : 'Locating…'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-deep2 p-3.5 rounded-xl border border-line">
                  <div className="text-[10px] font-bold text-ink2 uppercase tracking-wider mb-1">Prospectivity</div>
                  <div className="font-['Manrope'] text-2xl font-bold text-accentt">{selectedTarget.probability}%</div>
                </div>
                <div className="bg-deep2 p-3.5 rounded-xl border border-line">
                  <div className="text-[10px] font-bold text-ink2 uppercase tracking-wider mb-1">Confidence</div>
                  <div className="font-['Manrope'] text-2xl font-bold text-okt">{ev.confidence}</div>
                </div>
              </div>

              {/* Evidence — OBSERVED / DERIVED / INFERRED / SIMULATED (master-prompt §13) */}
              <div className="bg-deep2 p-4 rounded-xl border border-line">
                <div className="text-[10px] font-bold text-ink2 uppercase tracking-wider mb-2.5">Evidence</div>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[11px]">
                  {ev.rows.map((r, i) => (
                    <React.Fragment key={i}>
                      <span className="text-ink3 uppercase font-bold">{r.tag}</span>
                      <span className="text-ink text-right">{r.value}</span>
                    </React.Fragment>
                  ))}
                  <span className="text-ink3 uppercase font-bold">Uncertainty</span>
                  <span className="text-ink text-right">{ev.uncertainty}</span>
                </div>
              </div>

              {/* Ask AI (Groq server-side; deterministic fallback) */}
              <div className="bg-panel2 p-4 rounded-xl border border-line2/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-accentt uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">auto_awesome</span>
                    AI Assessment
                  </span>
                  <button
                    onClick={askAI}
                    disabled={briefLoading}
                    className="px-3 py-1 bg-accent text-onaccent text-[11px] font-bold rounded-lg hover:bg-accent2 transition-all disabled:opacity-50"
                  >
                    {briefLoading ? 'Analysing evidence…' : brief ? 'Ask again' : 'Ask AI'}
                  </button>
                </div>
                {brief && (
                  <div className="text-[11px] text-ink bg-deep2 p-4 rounded-lg border border-line leading-relaxed overflow-y-auto animate-fadeIn max-h-[400px]">
                    <div className="prose prose-sm prose-invert max-w-none prose-headings:text-accentt prose-headings:font-bold prose-headings:text-[11px] prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 first:prose-headings:mt-0 prose-p:text-ink prose-p:mb-3 last:prose-p:mb-0 prose-ul:my-2 prose-li:my-0.5">
                      <ReactMarkdown>{brief.text}</ReactMarkdown>
                    </div>
                    {brief.source === 'groq' && (
                      <span className="block mt-4 text-[9px] text-ink3 uppercase font-bold pt-2 border-t border-line">
                        Interpreted by GPT-OSS-20B · model scores unchanged
                      </span>
                    )}
                  </div>
                )}
                {!brief && !briefLoading && (
                  <p className="text-[11px] text-ink3">
                    Ask the AI to explain this target&apos;s evidence in plain language.
                  </p>
                )}
              </div>

              {compareTarget && compareTarget.id !== selectedTarget.id && (
                <div className="bg-deep2 p-4 rounded-xl border border-line">
                  <div className="text-[10px] font-bold text-ink2 uppercase tracking-wider mb-2">
                    {selectedTarget.name} vs {compareTarget.name}
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {[
                        ['Prospectivity', `${selectedTarget.probability}%`, `${compareTarget.probability}%`],
                        ['Confidence', evidenceOf(compareTarget, gridByIdRef.current.get(compareTarget.id)).confidence, ev.confidence],
                        ['Maturity', selectedTarget.maturity, compareTarget.maturity],
                      ].map(([k, a, b], i) => (
                        <tr key={i} className="border-t border-line/60">
                          <td className="py-1 text-ink3">{k}</td>
                          <td className="py-1 text-right text-ink">{a}</td>
                          <td className="py-1 text-right text-ink">{b}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                onClick={() => setReviewingTarget(selectedTarget)}
                className="mt-1 w-full bg-accent hover:bg-accent2 text-onaccent text-xs font-bold uppercase tracking-wider py-3.5 rounded-[18px] transition-all flex items-center justify-center gap-2 shadow-lg shadow-accent/20 active:scale-95"
              >
                <span>Advance Review</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
              </div>
              )}
            </div>
          </div>
        )}
      </div>

      <DrillReviewModal target={reviewingTarget} onClose={() => setReviewingTarget(null)} />
    </main>
  );
}

// ------------------------------------------------------------------ utils

function toGeoJSON(items: { id: string; lat: number; lng: number; prob?: number }[]) {
  return {
    type: 'FeatureCollection' as const,
    features: items.map((t) => ({
      type: 'Feature' as const,
      properties: {
        id: t.id,
        lat: t.lat,
        lng: t.lng,
        prob: t.prob ?? 0,
        band: prospectivityBand(t.prob ?? 0),
      },
      geometry: { type: 'Point' as const, coordinates: [t.lng, t.lat] },
    })),
  };
}

/**
 * Evidence assembly — only values that actually exist (master-prompt §13/§23).
 * Confidence is a data-availability concept, deliberately NOT the probability.
 */
function evidenceOf(target: ExplorationTarget | undefined, cell: GridCell | undefined) {
  const rows: { tag: string; value: string }[] = [];
  const observed: string[] = [];
  if (cell?.geochem != null) observed.push(`geochem ${Number(cell.geochem).toFixed(2)}`);
  if (cell?.ndvi != null) observed.push(`NDVI ${Number(cell.ndvi).toFixed(2)}`);
  if (cell?.elevation != null) observed.push(`${Number(cell.elevation).toFixed(0)} m elev.`);
  if (target?.geologicalLayers) rows.push({ tag: 'Geology', value: String(target.geologicalLayers) });
  rows.push({ tag: 'Surface', value: observed.length ? observed.join(' · ') : 'Belt context only' });
  rows.push({ tag: 'Subsurface', value: 'Limited (no drillhole data)' });
  rows.push({ tag: 'Assay', value: cell?.geochem != null ? 'Geochemical proxy only' : 'Unavailable' });
  rows.push({ tag: 'Remote sens.', value: String(target?.eoDataSynthesis ?? 'Synthetic') });

  const evidenceScore =
    (cell?.geochem != null ? 1 : 0) + (cell?.ndvi != null ? 1 : 0) + (cell?.elevation != null ? 1 : 0);
  const confidence = evidenceScore >= 2 ? 'MEDIUM' : 'LOW';
  const uncertainty = confidence === 'MEDIUM' ? 'MEDIUM' : 'HIGH';
  return { rows, confidence, uncertainty };
}
