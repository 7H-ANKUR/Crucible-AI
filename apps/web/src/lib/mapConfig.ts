/**
 * mapConfig — MapProvider abstraction (master-prompt §2).
 * The basemap is configuration, not code: swap providers via env without
 * touching the GIS component. Never place private keys here.
 *
 * Default: Esri World Dark Gray — free keyless RASTER tiles (renders in every
 * browser/webview, including embedded ones that suppress MapLibre workers).
 * Set NEXT_PUBLIC_MAP_STYLE_URL to any vector style (e.g. OpenFreeMap dark)
 * and the map will use it instead.
 */
export const MAP_DARK_TILES =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
export const MAP_LIGHT_TILES =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
export const MAP_RASTER_TILES = process.env.NEXT_PUBLIC_MAP_RASTER_TILES || MAP_DARK_TILES;

export const MAP_RASTER_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "Esri, HERE, Garmin, FAO, NOAA · OpenStreetMap contributors";

export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "";

/** Style object with BOTH raster basemaps; visibility set per theme. */
export function rasterStyle(): maplibregl.StyleSpecification | any {
  return {
    version: 8,
    sources: {
      "basemap-dark": {
        type: "raster",
        tiles: [MAP_DARK_TILES],
        tileSize: 256,
        attribution: MAP_RASTER_ATTRIBUTION,
        maxzoom: 16,
      },
      "basemap-light": {
        type: "raster",
        tiles: [MAP_LIGHT_TILES],
        tileSize: 256,
        attribution: MAP_RASTER_ATTRIBUTION,
        maxzoom: 16,
      },
    },
    layers: [
      { id: "basemap-light", type: "raster", source: "basemap-light", layout: { visibility: "none" } },
      { id: "basemap-dark", type: "raster", source: "basemap-dark" },
    ],
  };
}

/** Resolved MapLibre style for the active theme. */
export function resolveMapStyle(theme: "light" | "dark"): string | object {
  if (MAP_STYLE_URL) return MAP_STYLE_URL;
  const style = rasterStyle();
  const darkLayer = style.layers.find((l: any) => l.id === "basemap-dark");
  const lightLayer = style.layers.find((l: any) => l.id === "basemap-light");
  if (darkLayer?.layout) darkLayer.layout.visibility = theme === "dark" ? "visible" : "none";
  if (lightLayer?.layout) lightLayer.layout.visibility = theme === "dark" ? "none" : "visible";
  return style;
}

/** Flip the basemap layers on an existing map (theme event handler). */
export function applyMapTheme(map: any, theme: "light" | "dark") {
  if (!map?.isStyleLoaded?.()) return;
  if (map.getLayer("basemap-dark")) {
    map.setLayoutProperty("basemap-dark", "visibility", theme === "dark" ? "visible" : "none");
  }
  if (map.getLayer("basemap-light")) {
    map.setLayoutProperty("basemap-light", "visibility", theme === "dark" ? "none" : "visible");
  }
}

/** India-only gate (master-prompt §8) — every rendered point must pass. */
export const INDIA_BOUNDS = { latMin: 6.0, latMax: 37.5, lonMin: 68.0, lonMax: 98.0 };

export function assertIndiaOnly(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= INDIA_BOUNDS.latMin &&
    lat <= INDIA_BOUNDS.latMax &&
    lon >= INDIA_BOUNDS.lonMin &&
    lon <= INDIA_BOUNDS.lonMax
  );
}

/** Prospectivity bands drive color + animation intensity (master-prompt §9). */
export function prospectivityBand(p: number): "low" | "medium" | "high" {
  if (p >= 0.75) return "high";
  if (p >= 0.45) return "medium";
  return "low";
}

export const PROB_COLOR = {
  low: "#41606B",
  medium: "#D99523",
  high: "#FFC56F",
};
