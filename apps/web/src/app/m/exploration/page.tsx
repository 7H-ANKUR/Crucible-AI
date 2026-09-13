'use client';

/**
 * m/exploration — full-screen GIS map + bottom sheet target details.
 * Same provider config and India gate as desktop; touch-friendly markers.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sheet } from '@/components/mobile/Sheet';
import { Pill } from '@/components/mobile/ui';
import { apiFetch } from '@/lib/api';
import { FALLBACK_TARGETS, type ExplorationTarget } from '@/lib/minex';
import { resolveMapStyle, applyMapTheme, MAP_RASTER_ATTRIBUTION, assertIndiaOnly, PROB_COLOR } from '@/lib/mapConfig';
import { getTheme } from '@/lib/theme';

interface LocationContext {
  state?: string | null;
  district?: string | null;
  unavailable?: boolean;
}

export default function MobileExploration() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const targetsRef = useRef<ExplorationTarget[]>(FALLBACK_TARGETS);
  const selectedRef = useRef<string>(FALLBACK_TARGETS[0].id);

  const [targets, setTargets] = useState<ExplorationTarget[]>(FALLBACK_TARGETS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [locCtx, setLocCtx] = useState<LocationContext | null>(null);
  const [brief, setBrief] = useState<{ text: string; source: string } | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const selected = targets.find((t) => t.id === selectedRef.current) ?? targets[0];

  const pushTargets = useCallback((list: ExplorationTarget[]) => {
    targetsRef.current = list;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (map.getSource('targets')) {
        (map.getSource('targets') as any).setData({
          type: 'FeatureCollection',
          features: list.map((x) => ({
            type: 'Feature',
            properties: { id: x.id, lat: x.lat, lng: x.lng, prob: x.probability / 100, band: x.probability >= 75 ? 'high' : x.probability >= 45 ? 'medium' : 'low' },
            geometry: { type: 'Point', coordinates: [x.lng, x.lat] },
          })),
        });
        map.setFilter('target-pulse', ['==', ['get', 'id'], selectedRef.current]);
      }
    };
    if (map.isStyleLoaded?.()) apply();
    else map.once('style.load', apply);
  }, []);

  const selectTarget = useCallback(
    (id: string, fly = true) => {
      selectedRef.current = id;
      const target = targetsRef.current.find((x) => x.id === id);
      setSheetOpen(true);
      setBrief(null);
      const map = mapRef.current;
      if (!map) return;
      if (map.getLayer('target-pulse')) {
        map.setFilter('target-pulse', ['==', ['get', 'id'], id]);
      }
      if (target && fly) {
        map.easeTo({ center: [target.lng, target.lat], zoom: Math.max(map.getZoom(), 11), duration: 500 });
      }
      // Location context
      if (target) {
        setLocCtx(null);
        fetch(`/api/geo/reverse?lat=${target.lat}&lon=${target.lng}`)
          .then((r) => r.json())
          .then(setLocCtx)
          .catch(() => setLocCtx({ unavailable: true }));
      }
    },
    []
  );

  // Data
  useEffect(() => {
    let alive = true;
    (async () => {
      const api = await apiFetch<any>('/exploration/targets?limit=12').catch(() => null);
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
            assayCorrelation: `${Number(r.mn_geochemistry ?? 0).toFixed(2)} Geochem`,
            densityScore: 3,
            estimatedReserveTons: 'Not a reserve claim',
            description: `AI exploration target — ${r.belt ?? 'Sausar'} belt. Score, not a confirmed deposit.`,
          }));
        if (mapped.length) {
          setTargets(mapped);
          pushTargets(mapped);
          // frame the survey extent once style is ready
          const frame = () => {
            const lats = mapped.map((x) => x.lat);
            const lngs = mapped.map((x) => x.lng);
            mapRef.current?.fitBounds(
              [
                [Math.min(...lngs) - 0.25, Math.min(...lats) - 0.25],
                [Math.max(...lngs) + 0.25, Math.max(...lats) + 0.25],
              ],
              { padding: { top: 60, bottom: 120, left: 30, right: 30 }, duration: 0 }
            );
          };
          const map = mapRef.current;
          if (map?.isStyleLoaded?.()) frame();
          else map?.once('style.load', frame);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [pushTargets]);

  // Map init (maplibre v4 — see mapConfig notes on webview compatibility)
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
        center: [82.3, 21.5],
        zoom: 7,
        attributionControl: false,
      });
      mapRef.current = map;
      window.addEventListener('minex-theme', (e) => applyMapTheme(map, (e as CustomEvent).detail));
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
        if (!map.getSource('targets')) {
          map.addSource('targets', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: targetsRef.current.map((x) => ({
                type: 'Feature',
                properties: { id: x.id, lat: x.lat, lng: x.lng, prob: x.probability / 100 },
                geometry: { type: 'Point', coordinates: [x.lng, x.lat] },
              })),
            },
          });
          map.addLayer({
            id: 'target-glow',
            type: 'circle',
            source: 'targets',
            paint: { 'circle-radius': 22, 'circle-color': '#FFC56F', 'circle-opacity': 0.25, 'circle-blur': 1 },
          });
          map.addLayer({
            id: 'target-core',
            type: 'circle',
            source: 'targets',
            paint: {
              'circle-radius': 9,
              'circle-color': ['match', ['get', 'band'], 'high', PROB_COLOR.high, 'medium', PROB_COLOR.medium, PROB_COLOR.low],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#F4F7F6',
            },
          });
          map.addLayer({
            id: 'target-pulse',
            type: 'circle',
            source: 'targets',
            filter: ['==', ['get', 'id'], selectedRef.current],
            paint: {
              'circle-radius': 12,
              'circle-color': '#D9574F',
              'circle-opacity': 0.3,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#FFC56F',
            },
          });
        }
      });

      map.on('click', 'target-core', (e: any) => {
        const f = e.features?.[0];
        if (f) selectTarget(String(f.properties.id));
      });
      map.on('mouseenter', 'target-core', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'target-core', () => (map.getCanvas().style.cursor = ''));
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [selectTarget]);

  const askAI = async () => {
    if (!selected) return;
    setBriefLoading(true);
    setBrief(null);
    try {
      const res = await fetch('/api/ai/target-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_id: selected.id,
          coordinates: { latitude: selected.lat, longitude: selected.lng },
          resolved_location: locCtx ?? null,
          prospectivity_probability: selected.probability / 100,
          confidence: selected.subsurfaceConf === 'HIGH' ? 'MEDIUM' : 'LOW',
          uncertainty: 'HIGH',
          maturity: selected.maturity,
          geology: { belt: selected.coordinates },
          data_origin: 'SYNTHETIC',
        }),
      });
      const j = await res.json();
      setBrief({ text: j?.brief ?? 'Unavailable.', source: j?.source ?? 'error' });
    } catch {
      setBrief({ text: 'Analysis unavailable.', source: 'error' });
    } finally {
      setBriefLoading(false);
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Floating target chips */}
      <div className="absolute top-3 left-3 right-3 z-10 flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {targets.slice(0, 6).map((x) => (
          <Pill key={x.id} active={x.id === selectedRef.current} onClick={() => selectTarget(x.id)}>
            {x.name.replace('Target ', '')} · {x.probability}%
          </Pill>
        ))}
      </div>

      {/* Attribution */}
      <div className="absolute bottom-2 right-2 z-10 text-[9px] text-ink3 bg-deep2/70 px-1.5 py-0.5 rounded">
        {MAP_RASTER_ATTRIBUTION.split('·')[0]?.trim()} · SYNTHETIC
      </div>

      {/* Target sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="AI Exploration Target">
        {selected && (
          <div className="animate-fadeIn">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="font-['Manrope'] text-2xl font-bold text-ink">{selected.name}</h2>
              <span className="px-2.5 py-1 bg-warn/20 border border-warn text-warnt text-[10px] font-bold rounded-full">
                {selected.status}
              </span>
            </div>
            <p className="text-xs text-ink2 font-mono">{selected.coordinates}</p>
            <p className="text-[11px] text-infot mb-3">
              {locCtx && !locCtx.unavailable
                ? [locCtx.district, locCtx.state, 'India'].filter(Boolean).join(' · ')
                : locCtx?.unavailable
                ? 'Location context unavailable'
                : 'Locating…'}
            </p>

            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <div className="bg-card border border-line rounded-xl p-3">
                <div className="text-[9px] font-bold text-ink2 uppercase">Prospectivity</div>
                <div className="font-['Space_Grotesk'] text-2xl font-bold text-accentt">{selected.probability}%</div>
              </div>
              <div className="bg-card border border-line rounded-xl p-3">
                <div className="text-[9px] font-bold text-ink2 uppercase">Confidence</div>
                <div className="font-['Space_Grotesk'] text-2xl font-bold text-okt">{selected.subsurfaceConf}</div>
              </div>
            </div>

            <div className="bg-card border border-line rounded-xl p-3 mb-3 text-[11px] space-y-1.5">
              {[
                ['Geology', selected.geologicalLayers],
                ['Subsurface', 'Limited (no drillhole data)'],
                ['Assay', selected.assayCorrelation],
                ['Remote sens.', selected.eoDataSynthesis],
                ['Uncertainty', 'HIGH'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-ink3 uppercase font-bold text-[10px]">{k}</span>
                  <span className="text-ink text-right">{v}</span>
                </div>
              ))}
            </div>

            <div className="bg-panel2 rounded-xl border border-line2/40 p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-accentt uppercase tracking-wider">AI Assessment</span>
                <button
                  onClick={askAI}
                  disabled={briefLoading}
                  className="px-3 py-1.5 bg-accent text-onaccent text-[11px] font-bold rounded-lg active:scale-95 disabled:opacity-50"
                >
                  {briefLoading ? 'Analysing…' : brief ? 'Ask again' : 'Ask AI'}
                </button>
              </div>
              {brief && (
                <div className="text-[11px] text-ink bg-deep2 p-4 rounded-lg border border-line leading-relaxed overflow-y-auto max-h-[400px]">
                  <div className="prose prose-sm prose-invert max-w-none prose-headings:text-accentt prose-headings:font-bold prose-headings:text-[11px] prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 first:prose-headings:mt-0 prose-p:text-ink prose-p:mb-3 last:prose-p:mb-0 prose-ul:my-2 prose-li:my-0.5">
                    <ReactMarkdown>{brief.text}</ReactMarkdown>
                  </div>
                  {brief.source === 'groq' && (
                    <span className="block mt-4 text-[9px] text-ink3 uppercase font-bold pt-2 border-t border-line">
                      Interpreted by GPT-OSS-20B · scores unchanged
                    </span>
                  )}
                </div>
              )}
              {!brief && !briefLoading && (
                <p className="text-[11px] text-ink3">Explain this target&apos;s evidence in plain language.</p>
              )}
            </div>

            <p className="text-[9px] text-ink3">Model score — not a confirmed deposit or reserve claim. SYNTHETIC demo data.</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
