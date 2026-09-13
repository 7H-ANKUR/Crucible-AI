/**
 * /api/geo/reverse — Location-context service (master-prompt §12).
 * Proxies Nominatim server-side (proper User-Agent, in-memory cache so we
 * never hammer the public geocoder). Failures degrade gracefully: the caller
 * still shows coordinates.
 */
import { NextResponse } from "next/server";

const cache = new Map<string, { at: number; data: unknown }>();
const TTL_MS = 1000 * 60 * 60 * 24; // 24h — locality context rarely changes
const INDIA_BOUNDS = { latMin: 6.0, latMax: 37.5, lonMin: 68.0, lonMax: 98.0 };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required numbers" }, { status: 400 });
  }
  if (
    lat < INDIA_BOUNDS.latMin || lat > INDIA_BOUNDS.latMax ||
    lon < INDIA_BOUNDS.lonMin || lon > INDIA_BOUNDS.lonMax
  ) {
    return NextResponse.json({ error: "Outside the India-only study area" }, { status: 422 });
  }

  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ...(hit.data as object), cached: true });
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}` +
      `&zoom=10&accept-language=en&countrycodes=in`;
    const res = await fetch(url, {
      headers: { "User-Agent": "MINEx-SIH26009/1.0 (minex demo; contact: superadmin@minex.in)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const j = await res.json();
    const a = j?.address ?? {};

    const payload = {
      country: a.country ?? null,
      state: a.state ?? null,
      district: a.district ?? a.county ?? null,
      nearestLocality: a.village ?? a.town ?? a.city ?? a.suburb ?? a.hamlet ?? null,
      displayName: j.display_name ?? null,
      resolvedAt: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), data: payload });
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "Location context unavailable", country: "India", state: null, district: null, nearestLocality: null },
      { status: 200 }
    );
  }
}
