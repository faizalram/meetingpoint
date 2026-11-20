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
  const res = await fetch(`${PHOTON}/api/?${q}`, { signal });
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
    const res = await fetch(`${PHOTON}/reverse?lat=${p.lat}&lon=${p.lon}&limit=1`);
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

export async function findSpots(categories: Category[], center: LatLon, radius: number): Promise<Spot[]> {
  const cats = categories.filter((c): c is Exclude<Category, "mine"> => c !== "mine");
  if (cats.length === 0) return [];
  const around = `(around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lon.toFixed(5)})`;
  const parts = cats.flatMap((c) => CATEGORY_QUERY[c].map((f) => `nwr${f}["name"]${around};`));
  const query = `[out:json][timeout:25];(${parts.join("")});out center tags 2500;`;

  let lastStatus = 0;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      lastStatus = res.status;
      if (!res.ok) continue;
      const data = (await res.json()) as { elements?: OverpassElement[] };
      const seen = new Set<string>();
      const spots: Spot[] = [];
      for (const el of data.elements ?? []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        const tags = el.tags ?? {};
        if (lat === undefined || lon === undefined || !tags.name) continue;
        const key = `${tags.name.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        spots.push({
          id: `${el.type}/${el.id}`,
          name: tags.name,
          lat,
          lon,
          category: categoryOf(tags),
          area: tags["addr:street"] || tags["addr:suburb"] || tags["addr:city"] || undefined,
        });
      }
      return spots;
    } catch {
      // try the next server
    }
  }
  throw new ServiceError(
    lastStatus === 429
      ? "The spot search server is busy. Wait a minute and try again."
      : "Couldn't load spots from OpenStreetMap right now. Try again in a minute.",
  );
}

/* ---------- Trip times and routes (Valhalla) ---------- */

export const COSTING: Record<Mode, string> = { car: "auto", motorbike: "motorcycle", walk: "pedestrian" };

async function valhalla<T>(path: string, body: object): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${VALHALLA}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(2500 * (attempt + 1));
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new ServiceError(data.error ? `Routing failed: ${data.error}` : "The routing server didn't answer. Try again.");
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
