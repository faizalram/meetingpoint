// All calls go straight from the browser to free OpenStreetMap-based services.
// Each has a fair-use policy, so the app keeps requests few and small.

import { decodePolyline6, type LatLon } from "./geo";
import type { Category, Mode, Place, Spot } from "./types";

const PHOTON = "https://photon.komoot.io";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const VALHALLA = "https://valhalla1.openstreetmap.de";

export const JAKARTA: LatLon = { lat: -6.2, lon: 106.83 };

export class ServiceError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a time limit, so a slow free server can never leave the app stuck. */
async function fetchWithin(url: string, init: RequestInit, ms: number, what: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError") throw new ServiceError(`${what} took too long to answer. Try again in a minute.`);
    if (name === "AbortError") throw e;
    throw new ServiceError(`Couldn't reach ${what.toLowerCase()}. Check your connection and try again.`);
  }
}

/* ---------- Place search (Photon) ---------- */

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
};

function photonLabel(p: PhotonFeature["properties"]): string {
  const main = p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || "Pinned place";
  const area = [p.district || p.locality, p.city || p.county].filter((x) => x && x !== main);
  return [main, ...new Set(area)].join(", ");
}

export async function searchPlaces(query: string, near: LatLon = JAKARTA, signal?: AbortSignal): Promise<Place[]> {
  const q = new URLSearchParams({ q: query, limit: "6", lat: String(near.lat), lon: String(near.lon) });
  const res = await fetchWithin(`${PHOTON}/api/?${q}`, { signal }, 10_000, "Place search");
  if (!res.ok) throw new ServiceError("Place search is unavailable right now. Pick the spot on the map instead.");
  const data = (await res.json()) as { features?: PhotonFeature[] };
  return (data.features ?? []).map((f) => ({
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    label: photonLabel(f.properties),
  }));
}

export async function placeName(p: LatLon): Promise<string> {
  try {
    const res = await fetchWithin(`${PHOTON}/reverse?lat=${p.lat}&lon=${p.lon}&limit=1`, {}, 8_000, "Place search");
    const data = (await res.json()) as { features?: PhotonFeature[] };
    const f = data.features?.[0];
    return f ? photonLabel(f.properties) : "Pinned place";
  } catch {
    return "Pinned place";
  }
}

/* ---------- Meeting spots (OpenStreetMap via Overpass) ---------- */

const CATEGORY_QUERY: Record<Exclude<Category, "mine">, string[]> = {
  cafe: ['["amenity"="cafe"]'],
  mall: ['["shop"="mall"]'],
  restaurant: ['["amenity"~"^(restaurant|fast_food|food_court)$"]'],
  coworking: ['["amenity"="coworking_space"]', '["office"="coworking"]'],
  park: ['["leisure"="park"]'],
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function categoryOf(tags: Record<string, string>): Exclude<Category, "mine"> {
  if (tags.shop === "mall") return "mall";
  if (tags.leisure === "park") return "park";
  if (tags.amenity === "coworking_space" || tags.office === "coworking") return "coworking";
  if (tags.amenity === "cafe") return "cafe";
  return "restaurant";
}

function toSpot(el: OverpassElement): Spot | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const tags = el.tags ?? {};
  if (lat === undefined || lon === undefined || !tags.name) return null;
  return {
    id: `${el.type}/${el.id}`,
    name: tags.name,
    lat,
    lon,
    category: categoryOf(tags),
    area: tags["addr:street"] || tags["addr:suburb"] || tags["addr:city"] || undefined,
  };
}

function dedupe(spots: Spot[]): Spot[] {
  const seen = new Set<string>();
  return spots.filter((s) => {
    const key = `${s.name.toLowerCase()}|${s.lat.toFixed(3)}|${s.lon.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Main source: every matching place from OpenStreetMap, via Overpass. Throws with per-server details. */
async function overpassSpots(cats: Exclude<Category, "mine">[], center: LatLon, radius: number, onRetry: (m: string) => void) {
  const around = `(around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lon.toFixed(5)})`;
  const parts = cats.flatMap((c) => CATEGORY_QUERY[c].map((f) => `nwr${f}["name"]${around};`));
  const query = `[out:json][timeout:20];(${parts.join("")});out tags center qt 2500;`;
  const notes: string[] = [];

  for (const [n, url] of OVERPASS.entries()) {
    const host = new URL(url).host;
    if (n > 0) onRetry(`The spot search server didn't answer. Trying backup server ${n} of ${OVERPASS.length - 1}`);
    try {
      const res = await fetchWithin(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
        },
        25_000,
        "The spot search server",
      );
      if (!res.ok) {
        notes.push(`${host} ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
      if (data.remark && !(data.elements ?? []).length) {
        notes.push(`${host}: ${data.remark.slice(0, 80)}`);
        continue;
      }
      return dedupe((data.elements ?? []).map(toSpot).filter((x): x is Spot => x !== null));
    } catch (e) {
      notes.push(`${host}: ${e instanceof ServiceError ? "no answer" : (e as Error).message}`);
    }
  }
  throw new ServiceError(notes.join(", "));
}

/* Backup source: Photon keyword search filtered by OpenStreetMap tag. Finds fewer places, but works when Overpass is down. */
const PHOTON_SEARCH: Record<Exclude<Category, "mine">, { tag: string; words: string[] }[]> = {
  cafe: [{ tag: "amenity:cafe", words: ["cafe", "kopi", "coffee"] }],
  mall: [{ tag: "shop:mall", words: ["mall", "plaza", "square"] }],
  restaurant: [
    { tag: "amenity:restaurant", words: ["restoran", "rumah makan", "resto"] },
    { tag: "amenity:fast_food", words: ["ayam", "burger"] },
  ],
  coworking: [
    { tag: "amenity:coworking_space", words: ["coworking", "space"] },
    { tag: "office:coworking", words: ["coworking"] },
  ],
  park: [{ tag: "leisure:park", words: ["taman", "park"] }],
};

async function photonSpots(cats: Exclude<Category, "mine">[], center: LatLon, radius: number): Promise<Spot[]> {
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const bbox = [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat].map((x) => x.toFixed(5)).join(",");
  const out: Spot[] = [];
  for (const cat of cats) {
    for (const { tag, words } of PHOTON_SEARCH[cat]) {
      for (const word of words) {
        const q = new URLSearchParams({ q: word, osm_tag: tag, bbox, lat: String(center.lat), lon: String(center.lon), limit: "50" });
        try {
          const res = await fetchWithin(`${PHOTON}/api/?${q}`, {}, 10_000, "Place search");
          if (!res.ok) continue;
          const data = (await res.json()) as {
            features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string | number | undefined> }[];
          };
          for (const f of data.features ?? []) {
            const p = f.properties;
            if (!p.name) continue;
            out.push({
              id: `${String(p.osm_type ?? "x").toLowerCase()}/${p.osm_id ?? `${f.geometry.coordinates.join(",")}`}`,
              name: String(p.name),
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
              category: cat,
              area: (p.street || p.district || p.city || undefined) as string | undefined,
            });
          }
        } catch {
          // keep going with the other keywords
        }
        await sleep(250);
      }
    }
  }
  return dedupe(out);
}

export async function findSpots(
  categories: Category[],
  center: LatLon,
  radius: number,
  onRetry: (message: string) => void = () => {},
): Promise<Spot[]> {
  const cats = categories.filter((c): c is Exclude<Category, "mine"> => c !== "mine");
  if (cats.length === 0) return [];
  try {
    return await overpassSpots(cats, center, radius, onRetry);
  } catch (e) {
    const details = (e as Error).message;
    console.warn("overpass failed:", details);
    onRetry("The OpenStreetMap spot servers are busy. Using the backup place search");
    const backup = await photonSpots(cats, center, radius);
    if (backup.length > 0) return backup;
    throw new ServiceError(`Couldn't load spots from OpenStreetMap right now. Try again in a minute. (Details: ${details})`);
  }
}

/* ---------- Trip times and routes (Valhalla) ---------- */

export const COSTING: Record<Mode, string> = { car: "auto", motorbike: "motorcycle", walk: "pedestrian" };

async function valhalla<T>(path: string, body: object): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // GET with ?json= is a "simple" request: no CORS preflight for the public server to handle
    const res = await fetchWithin(
      `${VALHALLA}/${path}?json=${encodeURIComponent(JSON.stringify(body))}`,
      {},
      30_000,
      "The routing server",
    );
    if (res.status === 429) {
      await sleep(2500 * (attempt + 1));
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      console.warn("valhalla", path, res.status, data);
      throw new ServiceError(data.error ? `Routing failed: ${data.error}` : `The routing server returned an error (${res.status}). Try again.`);
    }
    return data;
  }
  throw new ServiceError("The routing server is busy. Wait a minute and try again.");
}

type MatrixCell = { time?: number | null } | null;
type MatrixResponse = { sources_to_targets?: MatrixCell[][] | { durations?: (number | null)[][] } };

/** Seconds from each source to each target for one travel mode; null where no route exists. */
export async function tripMatrix(sources: LatLon[], targets: LatLon[], mode: Mode): Promise<(number | null)[][]> {
  const data = await valhalla<MatrixResponse>("sources_to_targets", {
    sources: sources.map((p) => ({ lat: p.lat, lon: p.lon })),
    targets: targets.map((p) => ({ lat: p.lat, lon: p.lon })),
    costing: COSTING[mode],
  });
  const s2t = data.sources_to_targets;
  if (Array.isArray(s2t)) return s2t.map((row) => row.map((c) => (c && typeof c.time === "number" ? c.time : null)));
  if (s2t?.durations) return s2t.durations;
  throw new ServiceError("The routing server sent an unexpected answer. Try again.");
}

export type Route = { coords: [number, number][]; seconds: number };

export async function route(from: LatLon, to: LatLon, mode: Mode): Promise<Route> {
  const data = await valhalla<{ trip?: { legs?: { shape: string }[]; summary?: { time: number } } }>("route", {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: COSTING[mode],
    directions_type: "none",
  });
  const shape = data.trip?.legs?.[0]?.shape;
  if (!shape) throw new ServiceError("No route found.");
  return { coords: decodePolyline6(shape), seconds: data.trip?.summary?.time ?? 0 };
}

export { sleep };
