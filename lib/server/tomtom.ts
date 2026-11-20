// Server-side calls to TomTom. The key stays on the server.
// Free plan: 2,500 non-tile requests a day; past that TomTom blocks requests instead of billing.
// Trip times use Batch Routing (calculateRoute per person-spot pair) because TomTom's matrix
// endpoint has no motorcycle mode; each batch holds up to 100 routes.

import { HttpError, type LatLon } from "./http";

const BASE = "https://api.tomtom.com";

export type Mode = "car" | "motorbike" | "walk";
export type SpotCategory = "cafe" | "mall" | "restaurant" | "coworking" | "park";

function apiKey(): string {
  const k = process.env.TOMTOM_API_KEY;
  if (!k) throw new HttpError(500, "Missing environment variable TOMTOM_API_KEY. Add it in Vercel > Settings > Environment Variables, then redeploy.");
  return k;
}

async function tomtom<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown }, what: string): Promise<T> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey())}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(50_000),
    });
  } catch {
    throw new HttpError(504, `${what} didn't answer in time. Try again.`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    // keep the raw text for the error
  }
  if (!res.ok) {
    const d = data as { detailedError?: { message?: string; code?: string }; errorText?: string; error?: { description?: string } } | null;
    const msg = d?.detailedError?.message ?? d?.errorText ?? d?.error?.description ?? text.slice(0, 160);
    console.error(what, res.status, msg);
    if (res.status === 403) {
      throw new HttpError(
        429,
        `${what} was refused by TomTom: either today's free requests are used up (they reset daily) or the key isn't enabled for this API. (${msg})`,
      );
    }
    if (res.status === 429) throw new HttpError(429, `${what}: too many requests at once. Wait a few seconds and try again.`);
    throw new HttpError(502, `${what} failed: ${msg}`);
  }
  return data as T;
}

/* ---------- Start points ---------- */

type SearchResult = {
  id?: string;
  type?: string;
  poi?: { name?: string };
  address?: { freeformAddress?: string; streetName?: string; municipality?: string; municipalitySubdivision?: string };
  position?: { lat: number; lon: number };
};

export type FoundPlace = { lat: number; lon: number; main: string; secondary: string };

export async function searchPlaces(query: string, near: LatLon): Promise<FoundPlace[]> {
  const q = new URLSearchParams({
    typeahead: "true",
    limit: "6",
    countrySet: "ID",
    lat: String(near.lat),
    lon: String(near.lon),
  });
  const data = await tomtom<{ results?: SearchResult[] }>(`/search/2/search/${encodeURIComponent(query)}.json?${q}`, {}, "Place search");
  return (data.results ?? []).flatMap((r) => {
    if (!r.position) return [];
    const a = r.address ?? {};
    const main = r.poi?.name ?? a.streetName ?? a.freeformAddress ?? query;
    const secondary = [a.municipalitySubdivision, a.municipality].filter((x) => x && x !== main).join(", ");
    return [{ lat: r.position.lat, lon: r.position.lon, main, secondary }];
  });
}

/* ---------- Meeting spots ---------- */

// TomTom POI categories: 9376 Cafe/Pub, 7373 Shopping Center, 7315 Restaurant, 9362 Park & Recreation Area.
// There is no coworking category, so that one is a keyword search.
const CATS: Record<SpotCategory, { categorySet?: string; keyword?: string }> = {
  cafe: { categorySet: "9376" },
  mall: { categorySet: "7373" },
  restaurant: { categorySet: "7315" },
  coworking: { keyword: "coworking" },
  park: { categorySet: "9362" },
};

export type FoundSpot = { id: string; name: string; lat: number; lon: number; category: SpotCategory; area?: string };

async function spotsNear(category: SpotCategory, center: LatLon, radius: number, limit: number): Promise<FoundSpot[]> {
  const c = CATS[category];
  const q = new URLSearchParams({ lat: String(center.lat), lon: String(center.lon), radius: String(Math.round(radius)), limit: String(limit) });
  let path: string;
  if (c.categorySet) {
    q.set("categorySet", c.categorySet);
    path = `/search/2/nearbySearch/.json?${q}`;
  } else {
    q.set("countrySet", "ID");
    path = `/search/2/poiSearch/${encodeURIComponent(c.keyword!)}.json?${q}`;
  }
  const data = await tomtom<{ results?: SearchResult[] }>(path, {}, "Spot search");
  return (data.results ?? []).flatMap((r) =>
    r.position && r.poi?.name
      ? [
          {
            id: r.id ?? `${r.position.lat},${r.position.lon}`,
            name: r.poi.name,
            lat: r.position.lat,
            lon: r.position.lon,
            category,
            area: r.address?.streetName ?? r.address?.municipalitySubdivision,
          },
        ]
      : [],
  );
}

/** The middle, plus a ring of 6 when the area is large, so results don't all cluster at the center. */
function searchPoints(center: LatLon, radius: number): { points: LatLon[]; r: number } {
  if (radius <= 2500) return { points: [center], r: Math.max(radius, 800) };
  const ring = radius * 0.55;
  const dLat = ring / 111_320;
  const dLon = ring / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const points = [center];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    points.push({ lat: center.lat + dLat * Math.sin(a), lon: center.lon + dLon * Math.cos(a) });
  }
  return { points, r: Math.max(radius * 0.5, 800) };
}

export async function findSpots(categories: SpotCategory[], center: LatLon, radius: number): Promise<FoundSpot[]> {
  const { points, r } = searchPoints(center, radius);
  const limit = points.length > 1 ? 40 : 100;
  const settled = await Promise.allSettled(categories.flatMap((c) => points.map((p) => spotsNear(c, p, r, limit))));
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  if (ok.length === 0) {
    const err = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    if (err) throw err.reason;
  }
  const seen = new Set<string>();
  return ok.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/* ---------- Trip times and routes (Batch Routing) ---------- */

const TRAVEL: Record<Mode, string> = { car: "car", motorbike: "motorcycle", walk: "pedestrian" };

function routeQuery(from: LatLon, to: LatLon, mode: Mode, departure: string | null, representation: "summaryOnly" | "polyline") {
  const future = departure && new Date(departure).getTime() > Date.now() + 60_000 ? departure : null;
  const q = new URLSearchParams({
    travelMode: TRAVEL[mode],
    routeType: "fastest",
    traffic: mode === "walk" ? "false" : "true",
    departAt: future ? future.replace(/\.\d{3}(?=Z|[+-])/, "") : "now", // RFC 3339 without milliseconds
    routeRepresentation: representation,
    maxAlternatives: "0",
  });
  return `/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json?${q}`;
}

type RouteResponse = {
  routes?: { summary?: { travelTimeInSeconds?: number }; legs?: { points?: { latitude: number; longitude: number }[] }[] }[];
};
type BatchResponse = { batchItems?: { statusCode: number; response?: RouteResponse }[] };

async function batch(queries: string[], what: string): Promise<(RouteResponse | null)[]> {
  const out: (RouteResponse | null)[] = [];
  for (let i = 0; i < queries.length; i += 100) {
    const part = queries.slice(i, i + 100);
    const data = await tomtom<BatchResponse>(
      "/routing/1/batch/sync/json",
      { method: "POST", body: { batchItems: part.map((query) => ({ query })) } },
      what,
    );
    const items = data.batchItems ?? [];
    part.forEach((_, k) => out.push(items[k]?.statusCode === 200 ? (items[k].response ?? null) : null));
  }
  return out;
}

/** Seconds from each origin to each destination; null where no route was found. */
export async function tripTimes(origins: LatLon[], destinations: LatLon[], mode: Mode, departure: string | null): Promise<(number | null)[][]> {
  const pairs = origins.flatMap((o, i) => destinations.map((d, j) => ({ i, j, q: routeQuery(o, d, mode, departure, "summaryOnly") })));
  const results = await batch(pairs.map((p) => p.q), "Trip time lookup");
  const out: (number | null)[][] = origins.map(() => destinations.map(() => null));
  pairs.forEach((p, k) => {
    const t = results[k]?.routes?.[0]?.summary?.travelTimeInSeconds;
    if (typeof t === "number") out[p.i][p.j] = t;
  });
  return out;
}

/** Route lines for several people to one spot, in one request. [lat, lon] pairs; null if no route. */
export async function routeLines(
  legs: { from: LatLon; mode: Mode }[],
  to: LatLon,
  departure: string | null,
): Promise<([number, number][] | null)[]> {
  const results = await batch(legs.map((l) => routeQuery(l.from, to, l.mode, departure, "polyline")), "Route");
  return results.map((r) => {
    const pts = r?.routes?.[0]?.legs?.flatMap((leg) => leg.points ?? []) ?? [];
    return pts.length ? pts.map((p) => [p.latitude, p.longitude] as [number, number]) : null;
  });
}
