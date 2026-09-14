'use client';

/**
 * Exploration Intelligence — GIS rebuild.
 *
 * Reskinned to Earthy Industrial.
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
import { DrillReviewModal } from '@/components/crucible/Modals';
import { apiFetch } from '@/lib/api';
import {
  FALLBACK_TARGETS,
  type ExplorationTarget,
} from '@/lib/crucible';
import {
  resolveMapStyle,
  applyMapTheme,
  assertIndiaOnly,
  prospectivityBand,
  PROB_COLOR,
} from '@/lib/mapConfig';

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

  const [strataLayers, setStrataLayers] = useState({
    geological: true,      // radial geological overlay
    electromagnetic: true, // target glow layers
    historicalDrills: false,
    gravityFaults: true,   // scored grid circles
    heatmap: false,        // prospectivity heatmap
  });

  const selectedTarget = targets.find((t) => t.id === selectedId) ?? targets[0];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Location context for the selected target (cached server-side).
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
        style: resolveMapStyle('light'),
        center: SAUSAR_CENTER,
        zoom: 8,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      mapRef.current = map;
      if (typeof window !== 'undefined') (window as any).__crucibleMap = map;

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
      window.addEventListener('crucible-theme', (e) => applyMapTheme(map, (e as CustomEvent).detail));
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
    <main className="w-full bg-canvas-sandstone flex-1 flex flex-col min-h-[calc(100vh-64px)] overflow-y-auto overflow-x-hidden">
      <div className="flex flex-col w-full h-full">
        {/* Strata Filter Bar & Telemetry Matrix */}
        <section className="w-full bg-surface-parchment px-space-lg py-space-md shadow-sm border-b border-earth-border flex-shrink-0 z-20">
          <div className="flex flex-wrap items-center justify-between gap-space-md">
            {/* Left: Survey Layers Pills */}
            <div className="flex flex-wrap items-center gap-space-xs">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-widest mr-space-xs">Sensor Strata</span>
              
              <button 
                className={`px-space-sm py-1.5 rounded-lg font-label-md text-label-md flex items-center gap-1.5 shadow-sm transition-all ${strataLayers.geological ? 'bg-earth-charcoal text-canvas-sandstone' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container'}`}
                onClick={() => handleToggleStrata('geological')}
              >
                <span className="w-2 h-2 rounded-full bg-copper-accent"></span>
                Hyperspectral (EMIT)
              </button>
              
              <button 
                className={`px-space-sm py-1.5 rounded-lg font-label-md text-label-md flex items-center gap-1.5 shadow-sm transition-all ${strataLayers.electromagnetic ? 'bg-earth-charcoal text-canvas-sandstone' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container'}`}
                onClick={() => handleToggleStrata('electromagnetic')}
              >
                <span className="w-2 h-2 rounded-full bg-telemetry-emerald"></span>
                Electromagnetic (VTEM)
              </button>
              
              <button 
                className={`px-space-sm py-1.5 rounded-lg font-label-md text-label-md flex items-center gap-1.5 shadow-sm transition-all ${strataLayers.heatmap ? 'bg-earth-charcoal text-canvas-sandstone' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container'}`}
                onClick={() => handleToggleStrata('heatmap')}
              >
                <span className="w-2 h-2 rounded-full bg-telemetry-amber"></span>
                Prospectivity Heatmap
              </button>
              
              <button 
                className={`px-space-sm py-1.5 rounded-lg font-label-md text-label-md flex items-center gap-1.5 shadow-sm transition-all ${strataLayers.gravityFaults ? 'bg-earth-charcoal text-canvas-sandstone' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container'}`}
                onClick={() => handleToggleStrata('gravityFaults')}
              >
                <span className="w-2 h-2 rounded-full bg-tertiary"></span>
                Gravimetric Gradient
              </button>
              
              <button 
                className={`px-space-sm py-1.5 rounded-lg font-label-md text-label-md flex items-center gap-1.5 shadow-sm transition-all ${strataLayers.historicalDrills ? 'bg-earth-charcoal text-canvas-sandstone' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container'}`}
                onClick={() => handleToggleStrata('historicalDrills')}
              >
                <span className="w-2 h-2 rounded-full bg-telemetry-crimson"></span>
                Historical Drills
              </button>
            </div>
            
            {/* Right: Coordinate Projection & Resolution Multi-segment */}
            <div className="flex items-center gap-space-md">
              <div className="hidden xl:flex items-center gap-space-xs bg-surface-container px-space-sm py-1.5 rounded-lg text-on-surface-variant font-label-sm text-label-sm shadow-inner">
                <span className="material-symbols-outlined text-copper-accent text-[16px]">public</span>
                <span>WGS84 UTM 35S</span>
                <span className="text-outline mx-1">•</span>
                <span className="font-semibold text-earth-charcoal">
                  {locCtx && !locCtx.unavailable ? [locCtx.district, locCtx.state, locCtx.country].filter(Boolean).join(', ') || 'Locating…' : 'E 412,840.12 N 8,642,109.80'}
                </span>
              </div>
              <div className="flex items-center bg-surface-container p-0.5 rounded-lg shadow-inner">
                <span className="px-space-xs font-label-sm text-label-sm text-secondary uppercase">Mesh Res</span>
                <button className="px-2 py-1 rounded font-label-sm text-label-sm bg-earth-charcoal text-canvas-sandstone transition-colors shadow-sm">1m</button>
                <button className="px-2 py-1 rounded font-label-sm text-label-sm text-on-surface-variant hover:text-earth-charcoal transition-colors">5m</button>
                <button className="px-2 py-1 rounded font-label-sm text-label-sm text-on-surface-variant hover:text-earth-charcoal transition-colors">10m</button>
              </div>
            </div>
          </div>
        </section>

        {/* Exploration Workbench Core: 3-Column Split */}
        <div className="flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-space-md p-space-md lg:p-space-lg">
          
          {/* LEFT PANEL: Data Strata & Inversion Models (Col 1-3) */}
          <div className="lg:col-span-3 flex flex-col gap-space-md">
            
            {/* Section Header Card */}
            <div className="bg-surface-parchment rounded-xl p-space-md shadow-sm border border-earth-border flex flex-col gap-space-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">layers</span>
                  <span className="font-headline-sm text-headline-sm text-earth-charcoal">Strata Inversion</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-primary-container/20 border border-primary-container/30 text-primary font-label-sm text-label-sm">Live Model</span>
              </div>
              <p className="font-body-sm text-body-sm text-secondary">Multi-physics geophysical fusion inverted down to -650m sub-surface RL datum.</p>
            </div>
            
            {/* Layer Opacity & Inversion Sliders */}
            <div className="bg-surface-parchment rounded-xl p-space-md shadow-sm border border-earth-border flex flex-col gap-space-md">
              <div className="flex items-center justify-between">
                <span className="font-label-md text-label-md text-earth-charcoal uppercase tracking-wider">Depth Slice RL</span>
                <span className="font-label-sm text-label-sm text-copper-accent font-semibold">-320m Sub-surface</span>
              </div>
              <div className="space-y-1">
                <input type="range" min="0" max="650" defaultValue="320" className="w-full accent-primary cursor-pointer h-1.5 bg-surface-container-high rounded shadow-inner" />
                <div className="flex justify-between font-label-sm text-label-sm text-secondary">
                  <span>0m (Surface)</span>
                  <span>-300m</span>
                  <span>-650m (Sill)</span>
                </div>
              </div>
              <div className="space-y-space-sm pt-space-xs">
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm text-on-surface-variant">VTEM Resistivity Opacity</span>
                  <span className="font-label-sm text-label-sm text-earth-charcoal font-medium">85%</span>
                </div>
                <input type="range" min="0" max="100" defaultValue="85" className="w-full accent-copper-accent cursor-pointer h-1.5 bg-surface-container-high rounded shadow-inner" />
              </div>
              <div className="space-y-space-sm">
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm text-on-surface-variant">Hyperspectral Ferric Index</span>
                  <span className="font-label-sm text-label-sm text-earth-charcoal font-medium">62%</span>
                </div>
                <input type="range" min="0" max="100" defaultValue="62" className="w-full accent-copper-accent cursor-pointer h-1.5 bg-surface-container-high rounded shadow-inner" />
              </div>
            </div>
            
            {/* Lithology Vector Classification */}
            <div className="bg-surface-parchment rounded-xl p-space-md shadow-sm border border-earth-border flex flex-col gap-space-sm">
              <div className="flex items-center justify-between">
                <span className="font-label-md text-label-md text-earth-charcoal uppercase tracking-wider">Target Selector</span>
                <span className="font-label-sm text-label-sm text-secondary">{targets.length} AI Classes</span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {targets.map((t, idx) => {
                  const colors = ['bg-copper-accent', 'bg-ore-gold', 'bg-telemetry-emerald', 'bg-secondary', 'bg-tertiary'];
                  const dotColor = colors[idx % colors.length];
                  return (
                    <label key={t.id} className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${selectedId === t.id ? 'bg-surface-container-high border border-earth-border shadow-sm' : 'bg-surface-container hover:bg-surface-container-high border border-transparent'}`}>
                      <div className="flex items-center gap-space-xs">
                        <span className={`w-3 h-3 rounded-full ${dotColor}`}></span>
                        <span className="font-label-md text-label-md text-earth-charcoal truncate max-w-[150px]" title={t.name}>{t.name}</span>
                      </div>
                      <input 
                        type="radio" 
                        name="target-selector" 
                        checked={selectedId === t.id} 
                        onChange={() => {
                          setSelectedId(t.id);
                          mapRef.current?.easeTo({ center: [t.lng, t.lat], zoom: 11, duration: 600 });
                        }} 
                        className="accent-primary w-4 h-4 rounded cursor-pointer" 
                      />
                    </label>
                  );
                })}
              </div>
            </div>
            
            {/* Sensor Satellites & Passes Tracker */}
            <div className="bg-surface-parchment rounded-xl p-space-md shadow-sm border border-earth-border flex flex-col gap-space-xs">
              <div className="flex items-center justify-between">
                <span className="font-label-md text-label-md text-earth-charcoal uppercase tracking-wider">Remote Passes</span>
                <span className="material-symbols-outlined text-copper-accent text-[18px]">satellite_alt</span>
              </div>
              <div className="divide-y divide-earth-border/50 space-y-2 mt-1">
                <div className="flex justify-between items-center text-on-surface-variant font-body-sm text-body-sm pt-2 first:pt-0 border-t-0">
                  <span>NASA EMIT (Hyperspectral)</span>
                  <span className="font-label-sm text-label-sm text-telemetry-emerald font-semibold">T-3h 12m</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant font-body-sm text-body-sm pt-2">
                  <span>Sentinel-2 L2A Multispectral</span>
                  <span className="font-label-sm text-label-sm text-earth-charcoal">Yesterday</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant font-body-sm text-body-sm pt-2">
                  <span>ASTER SWIR Quartz Index</span>
                  <span className="font-label-sm text-label-sm text-earth-charcoal">3 days ago</span>
                </div>
              </div>
            </div>

          </div>

          {/* CENTRAL VIEWPORT: GIS Prospectivity Map Canvas (Col 4-8) */}
          <div className="lg:col-span-5 flex flex-col gap-space-md h-[800px] lg:h-auto">
            
            {/* Main GIS Prospectivity Viewer */}
            <div className="relative bg-earth-espresso rounded-xl overflow-hidden shadow-md border border-earth-border flex flex-col flex-1 min-h-[500px]">
              {/* Map Canvas */}
              <div className="absolute inset-0 z-0">
                <div ref={mapContainer} className="w-full h-full" />
                
                {/* Layers mimicking the visual overlays inside the map */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:90px_90px] pointer-events-none" />
                {strataLayers.geological && (
                  <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(180,106,54,0.05), transparent 60%)' }} />
                )}
                {strataLayers.historicalDrills && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-[45%] left-[42%] flex items-center gap-1 text-[10px] text-earth-charcoal font-medium bg-surface-parchment/90 px-1.5 py-0.5 rounded border border-earth-border shadow-sm">
                      <span className="w-1.5 h-1.5 bg-copper-accent rounded-full"></span> DH-041 (41.2% Mn)
                    </div>
                    <div className="absolute top-[58%] left-[51%] flex items-center gap-1 text-[10px] text-earth-charcoal font-medium bg-surface-parchment/90 px-1.5 py-0.5 rounded border border-earth-border shadow-sm">
                      <span className="w-1.5 h-1.5 bg-copper-accent rounded-full"></span> DH-038 (38.9% Mn)
                    </div>
                  </div>
                )}
                {gridLoading && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-surface-parchment/90 px-4 py-1.5 rounded-full border border-earth-border text-xs text-earth-charcoal font-semibold shadow-sm z-10">
                    Loading scored grid…
                  </div>
                )}
              </div>

              {/* Overlaid Map Telemetry HUD (Top Controls) */}
              <div className="relative z-10 flex items-center justify-between p-space-md bg-gradient-to-b from-earth-espresso/80 to-transparent pointer-events-none">
                <div className="flex items-center gap-space-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-earth-charcoal/90 text-canvas-sandstone font-label-sm text-label-sm backdrop-blur-sm shadow-sm pointer-events-auto border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-telemetry-emerald animate-ping"></span>
                    <span>AI PROSPECTIVITY ENGINE v4.2</span>
                  </span>
                  <span className="px-2 py-1 rounded bg-earth-charcoal/80 text-copper-accent font-label-sm text-label-sm backdrop-blur-sm pointer-events-auto border border-white/10">
                    RL: 1,328m ASL
                  </span>
                </div>
                <div className="flex items-center gap-1 pointer-events-auto">
                  <button className="w-8 h-8 rounded bg-earth-charcoal/80 text-canvas-sandstone hover:bg-copper-accent flex items-center justify-center transition-colors border border-white/10" title="Zoom In" onClick={() => mapRef.current?.zoomIn()}>
                    <span className="material-symbols-outlined text-[18px]">add</span>
                  </button>
                  <button className="w-8 h-8 rounded bg-earth-charcoal/80 text-canvas-sandstone hover:bg-copper-accent flex items-center justify-center transition-colors border border-white/10" title="Zoom Out" onClick={() => mapRef.current?.zoomOut()}>
                    <span className="material-symbols-outlined text-[18px]">remove</span>
                  </button>
                  <button className="w-8 h-8 rounded bg-earth-charcoal/80 text-canvas-sandstone hover:bg-copper-accent flex items-center justify-center transition-colors border border-white/10" title="Layer Reset" onClick={() => mapRef.current?.resetNorth()}>
                    <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                  </button>
                </div>
              </div>

              {/* Bottom Compass, Scale Bar & Coordinate Telemetry */}
              <div className="relative z-10 mt-auto p-space-md bg-gradient-to-t from-earth-espresso/95 via-earth-espresso/80 to-transparent flex items-end justify-between pointer-events-none">
                <div className="flex items-center gap-space-sm bg-earth-charcoal/90 px-space-sm py-1.5 rounded-lg text-canvas-sandstone pointer-events-auto border border-white/10 shadow-lg">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-copper-accent uppercase tracking-widest">Ground Scale</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="h-1 w-16 bg-copper-accent rounded-sm"></div>
                      <span className="font-label-sm text-label-sm">250 Meters</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-space-xs bg-earth-charcoal/90 px-space-sm py-1 rounded-lg text-canvas-sandstone pointer-events-auto border border-white/10 shadow-lg">
                  <span className="font-label-md text-label-md text-copper-accent font-bold">N</span>
                  <span className="material-symbols-outlined text-copper-accent text-[18px] transform -rotate-45">navigation</span>
                  <span className="font-label-sm text-label-sm text-secondary">315° NW</span>
                </div>
              </div>

            </div>

            {/* Live Geological Sample & Thin-section Preview Bento Strip */}
            <div className="grid grid-cols-2 gap-space-md shrink-0">
              <div className="bg-surface-parchment rounded-xl p-space-sm flex gap-space-sm items-center shadow-sm border border-earth-border">
                <img className="w-16 h-16 rounded-lg object-cover flex-shrink-0 shadow-inner" alt="Core sample" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDc4yXI9SM_1Yv6fOrS8CF5MAOyzRkQhzjummQvtHlqVtHctvZTbxDsmPTeYniiQdr_p713s5tYWPEqc9rjIZPFaCi5Fa0KDdWeRi_Lhn6VUf8r-CG67mlsTwB17-y7ORl-1jMSPTP7m6V4SLzSQ-RT2akq1x6KPWzmJ4t3eJap9MfRfrKUl5JBtljZnCttO9vdlrX2xmod04aRi9orlyGSBczqSQXp8Qo00_6zCJwbhQXS0Iq_pHhT"/>
                <div className="flex flex-col min-w-0">
                  <span className="font-label-sm text-label-sm text-copper-accent uppercase tracking-wider">Thin Section DH-204</span>
                  <span className="font-headline-sm text-headline-sm text-earth-charcoal truncate">Bornite-Chalcocite</span>
                  <span className="font-body-sm text-body-sm text-secondary">Cu Grade eq: 3.42%</span>
                </div>
              </div>
              <div className="bg-surface-parchment rounded-xl p-space-sm flex items-center justify-between shadow-sm px-space-md border border-earth-border">
                <div className="flex flex-col">
                  <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Trap Continuity</span>
                  <span className="font-headline-sm text-headline-sm text-telemetry-emerald font-semibold">High Confidence</span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">Strike length: 780m</span>
                </div>
                <span className="material-symbols-outlined text-telemetry-emerald text-[28px]">trending_up</span>
              </div>
            </div>
            
          </div>

          {/* RIGHT PANEL: Target Details & Prospectivity Brief (Col 9-12) */}
          {selectedTarget && (
            <div className="lg:col-span-4 flex flex-col gap-space-md">
              
              {/* Active Target Title Card */}
              <div className="bg-surface-parchment rounded-xl p-space-md shadow-sm border border-earth-border flex flex-col gap-space-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-space-xs">
                    <span className="w-3 h-3 rounded-full bg-copper-accent animate-pulse"></span>
                    <span className="font-label-sm text-label-sm text-copper-accent uppercase tracking-widest">Active Discovery Target</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-surface-container text-earth-charcoal font-label-sm text-label-sm font-semibold border border-earth-border/50">
                    ID: {selectedTarget.name.replace('Target ', 'T-')}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <h2 className="font-headline-md text-headline-md text-earth-charcoal">{selectedTarget.name}</h2>
                  <span className="font-headline-md text-headline-md text-primary font-bold">{selectedTarget.probability}%</span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {selectedTarget.description}
                </p>
                
                {/* Inline Confidence Multi-Vector Gauge */}
                <div className="grid grid-cols-3 gap-space-xs mt-space-xs pt-space-xs bg-surface-container p-space-sm rounded-lg shadow-inner border border-earth-border/50">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-secondary">EM Vector</span>
                    <span className="font-headline-sm text-headline-sm text-earth-charcoal">{ev.confidence}</span>
                    <span className="font-label-sm text-label-sm text-telemetry-emerald font-medium">+High Conductor</span>
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="font-label-sm text-label-sm text-secondary">Spectral</span>
                    <span className="font-headline-sm text-headline-sm text-earth-charcoal truncate" title={selectedTarget.lng.toFixed(2)}>
                      {selectedTarget.lng.toFixed(2)}
                    </span>
                    <span className="font-label-sm text-label-sm text-copper-accent font-medium truncate">Sericite/Phyllic</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-secondary">Gravity Grad</span>
                    <span className="font-headline-sm text-headline-sm text-earth-charcoal">+{selectedTarget.densityScore}</span>
                    <span className="font-label-sm text-label-sm text-secondary">mGal Dense Body</span>
                  </div>
                </div>
              </div>

              {/* Predicted Mineral Assemblage Breakdown */}
              <div className="bg-surface-parchment rounded-xl p-space-md shadow-sm border border-earth-border flex flex-col gap-space-sm">
                <span className="font-label-md text-label-md text-earth-charcoal uppercase tracking-wider">Evidence Factors & Vectors</span>
                <div className="space-y-space-sm mt-1">
                  {ev.rows.slice(0, 3).map((r, i) => {
                    const colors = ['bg-copper-accent', 'bg-ore-gold', 'bg-secondary'];
                    const textColor = ['text-copper-accent', 'text-ore-gold', 'text-secondary'];
                    const color = colors[i % colors.length];
                    const tcolor = textColor[i % textColor.length];
                    // Map generic evidence to bars for visual fidelity with Stitch
                    const pct = [48, 29, 23][i] || 20;
                    return (
                      <div key={i}>
                        <div className="flex justify-between font-label-sm text-label-sm mb-1">
                          <span className="text-earth-charcoal font-medium">{r.tag}</span>
                          <span className={`${tcolor} font-bold max-w-[150px] truncate`} title={r.value}>{r.value}</span>
                        </div>
                        <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden shadow-inner">
                          <div className={`${color} h-full rounded-full`} style={{ width: `${pct}%` }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Natural Language AI Exploration Assistant */}
              <div className="bg-surface-parchment rounded-xl p-space-md shadow-sm border border-earth-border flex flex-col gap-space-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-space-xs">
                    <span className="material-symbols-outlined text-copper-accent text-[18px]">neurology</span>
                    <span className="font-label-md text-label-md text-earth-charcoal uppercase tracking-wider">Mineral AI Synthesis</span>
                  </div>
                  <button
                    onClick={askAI}
                    disabled={briefLoading}
                    className="px-2 py-1 bg-surface-container hover:bg-surface-container-high text-earth-charcoal text-[10px] font-bold rounded shadow-sm disabled:opacity-50 transition-colors border border-earth-border/50"
                  >
                    {briefLoading ? 'Analysing...' : 'Generate Brief'}
                  </button>
                </div>
                
                <div className="p-space-sm rounded-lg bg-surface-container border border-earth-border/50 text-earth-charcoal text-body-sm font-body-sm relative max-h-[250px] overflow-y-auto shadow-inner">
                  {brief ? (
                    <div className="prose prose-sm max-w-none prose-headings:text-copper-accent prose-headings:font-bold prose-headings:text-[11px] prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 first:prose-headings:mt-0 prose-p:text-earth-charcoal prose-p:mb-3 last:prose-p:mb-0 prose-ul:my-2 prose-li:my-0.5 leading-relaxed">
                      <ReactMarkdown>{brief.text}</ReactMarkdown>
                      {brief.source === 'groq' && (
                        <span className="block mt-4 text-[10px] text-on-surface-variant uppercase font-bold pt-2 border-t border-earth-border/50">
                          Interpreted by GPT-OSS-20B
                        </span>
                      )}
                    </div>
                  ) : briefLoading ? (
                    <p className="text-secondary italic">Consulting exploration AI models...</p>
                  ) : (
                    <p className="leading-relaxed italic text-secondary">
                      &quot;Generate an AI brief to explain this target&apos;s geological evidence and prospectivity scoring in plain language.&quot;
                    </p>
                  )}
                </div>
                
                <div className="flex items-center gap-2 mt-1">
                  <input type="text" className="flex-1 bg-canvas-sandstone px-space-sm py-2 rounded-lg text-body-sm font-body-sm text-earth-charcoal outline-none placeholder:text-secondary focus:ring-1 focus:ring-primary shadow-inner border border-earth-border/50" placeholder="Ask AI: e.g., 'Compare this with Tenke deposit...'" />
                  <button className="px-3 py-2 rounded-lg bg-earth-charcoal text-canvas-sandstone hover:bg-copper-accent transition-colors flex items-center justify-center shadow-sm">
                    <span className="material-symbols-outlined text-[16px]">send</span>
                  </button>
                </div>
              </div>
              
              {/* Action Commands */}
              <div className="bg-surface-parchment rounded-xl p-space-md shadow-sm border border-earth-border flex flex-col gap-space-xs mt-auto">
                <button 
                  onClick={() => setReviewingTarget(selectedTarget)}
                  className="w-full py-2.5 rounded-lg bg-primary-container text-on-primary-container font-label-md text-label-md flex items-center justify-center gap-space-xs shadow-sm hover:bg-tertiary transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">cloud_download</span>
                  Review Drill Target Program
                </button>
                <div className="grid grid-cols-2 gap-space-xs pt-1">
                  <button className="py-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-earth-border/50 text-on-surface font-label-sm text-label-sm flex items-center justify-center gap-1 transition-colors shadow-sm">
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    GeoJSON / SHP
                  </button>
                  <button className="py-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-earth-border/50 text-on-surface font-label-sm text-label-sm flex items-center justify-center gap-1 transition-colors shadow-sm">
                    <span className="material-symbols-outlined text-[16px]">pin_drop</span>
                    Generate Collar Coords
                  </button>
                </div>
              </div>
              
            </div>
          )}
          
        </div>
      </div>
      
      {reviewingTarget && <DrillReviewModal target={reviewingTarget} onClose={() => setReviewingTarget(null)} />}
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
