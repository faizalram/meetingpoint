// Server-side calls to Google Maps Platform. The key stays on the server.
// Field masks are kept to the cheaper SKUs where possible:
//   Autocomplete (New) + Place Details Essentials (location, address) for start points
//   Nearby Search Pro / Text Search Pro (name, location, address, type) for meeting spots
//   Compute Route Matrix: Pro with live traffic (car), Enterprise for two-wheeler, Essentials for walking

import { HttpError, type LatLon } from "./http";

const PLACES = "https://places.googleapis.com/v1";
const ROUTES = "https://routes.googleapis.com";

export type Mode = "car" | "motorbike" | "walk";
export type SpotCategory = "cafe" | "mall" | "restaurant" | "coworking" | "park";

function apiKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new HttpError(500, "Missing environment variable GOOGLE_MAPS_API_KEY. Add it in Vercel > Settings > Environment Variables, then redeploy.");
  return k;
}

type GoogleInit = { method?: "GET" | "POST"; body?: unknown; fieldMask?: string };

async function google<T>(url: string, init: GoogleInit, what: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        ...(init.fieldMask ? { "X-Goog-FieldMask": init.fieldMask } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, `${what} didn't answer in time. Try again.`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text for the error
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; status?: string } } | null)?.error;
    const msg = err?.message ?? text.slice(0, 200);
    console.error(what, res.status, err?.status, msg);
    if (res.status === 403 || err?.status === "PERMISSION_DENIED") {
      throw new HttpError(500, `${what} is blocked for this API key. In Google Cloud, enable the API and check the key's API restrictions. (${msg})`);
    }
    if (res.status === 429 || err?.status === "RESOURCE_EXHAUSTED") {
      throw new HttpError(429, `${what} reached its quota. Try again later, or raise the quota in Google Cloud.`);
    }
    throw new HttpError(502, `${what} failed: ${msg}`);
  }
  return data as T;
}

const latLng = (p: LatLon) => ({ latitude: p.lat, longitude: p.lon });
const waypoint = (p: LatLon) => ({ waypoint: { location: { latLng: latLng(p) } } });

/* ---------- Start points ---------- */

export type Suggestion = { placeId: string; main: string; secondary: string };

export async function autocomplete(input: string, sessionToken: string, near: LatLon): Promise<Suggestion[]> {
  type Res = {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        text?: { text: string };
        structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
      };
    }[];
  };
  const data = await google<Res>(
    `${PLACES}/places:autocomplete`,
    {
      body: {
        input,
        sessionToken,
        includedRegionCodes: ["id"],
        languageCode: "id",
        locationBias: { circle: { center: latLng(near), radius: 50_000 } },
      },
    },
    "Place search",
  );
  return (data.suggestions ?? []).flatMap((s) => {
    const p = s.placePrediction;
    if (!p?.placeId) return [];
    return [{ placeId: p.placeId, main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "", secondary: p.structuredFormat?.secondaryText?.text ?? "" }];
  });
}

export async function placeLocation(placeId: string, sessionToken: string): Promise<LatLon & { address: string }> {
  type Res = { location?: { latitude: number; longitude: number }; shortFormattedAddress?: string; formattedAddress?: string };
  const q = new URLSearchParams({ sessionToken, languageCode: "id" });
  const data = await google<Res>(
    `${PLACES}/places/${encodeURIComponent(placeId)}?${q}`,
    { method: "GET", fieldMask: "location,shortFormattedAddress,formattedAddress" },
    "Place details",
  );
  if (!data.location) throw new HttpError(404, "That place has no map location. Pick another.");
  return { lat: data.location.latitude, lon: data.location.longitude, address: data.shortFormattedAddress ?? data.formattedAddress ?? "" };
}

/* ---------- Meeting spots ---------- */

const TYPES: Record<SpotCategory, string[]> = {
  cafe: ["cafe", "coffee_shop"],
  mall: ["shopping_mall"],
  restaurant: ["restaurant"],
  coworking: ["coworking_space"],
  park: ["park"],
};

export type FoundSpot = { id: string; name: string; lat: number; lon: number; category: SpotCategory; area?: string };

type PlacesRes = {
  places?: {
    id: string;
    displayName?: { text: string };
    location?: { latitude: number; longitude: number };
    shortFormattedAddress?: string;
    businessStatus?: string;
  }[];
};

// businessStatus lets us drop places Google knows are closed (same Pro tier as the other fields)
const SPOT_FIELDS = "places.id,places.displayName,places.location,places.shortFormattedAddress,places.businessStatus";

async function nearby(category: SpotCategory, center: LatLon, radius: number): Promise<FoundSpot[]> {
  const data = await google<PlacesRes>(
    `${PLACES}/places:searchNearby`,
    {
      body: {
        includedTypes: TYPES[category],
        maxResultCount: 20,
        rankPreference: "POPULARITY",
        languageCode: "id",
        locationRestriction: { circle: { center: latLng(center), radius } },
      },
      fieldMask: SPOT_FIELDS,
    },
    "Spot search",
  );
  return (data.places ?? []).flatMap((p) =>
    p.location && p.displayName?.text && (!p.businessStatus || p.businessStatus === "OPERATIONAL")
      ? [{ id: p.id, name: p.displayName.text, lat: p.location.latitude, lon: p.location.longitude, category, area: p.shortFormattedAddress }]
      : [],
  );
}

/** Points to search around: the middle, plus a ring of 6 when the area is large. Nearby Search returns at most 20 per call. */
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
  return { points, r: Math.min(Math.max(radius * 0.5, 800), 50_000) };
}

export async function findSpots(categories: SpotCategory[], center: LatLon, radius: number): Promise<FoundSpot[]> {
  const { points, r } = searchPoints(center, radius);
  const calls = categories.flatMap((c) => points.map((p) => nearby(c, p, r)));
  const settled = await Promise.allSettled(calls);
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  if (ok.length === 0) {
    const firstError = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstError) throw firstError.reason;
  }
  const seen = new Set<string>();
  return ok.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/* ---------- Trip times and routes ---------- */

const TRAVEL: Record<Mode, string> = { car: "DRIVE", motorbike: "TWO_WHEELER", walk: "WALK" };

/** Live traffic for car and motorbike; departure (ISO time) gives predicted traffic for later. */
function travelOptions(mode: Mode, departure: string | null) {
  if (mode === "walk") return { travelMode: TRAVEL[mode] };
  const future = departure && new Date(departure).getTime() > Date.now() + 60_000 ? departure : null;
  return { travelMode: TRAVEL[mode], routingPreference: "TRAFFIC_AWARE", ...(future ? { departureTime: future } : {}) };
}

/** Seconds from each origin to each destination; null where no route exists. Splits to stay under 625 elements per request. */
export async function routeMatrix(origins: LatLon[], destinations: LatLon[], mode: Mode, departure: string | null): Promise<(number | null)[][]> {
  type El = { originIndex?: number; destinationIndex?: number; duration?: string; condition?: string };
  const out: (number | null)[][] = origins.map(() => destinations.map(() => null));
  const chunk = Math.max(1, Math.floor(600 / origins.length));
  for (let start = 0; start < destinations.length; start += chunk) {
    const part = destinations.slice(start, start + chunk);
    const rows = await google<El[]>(
      `${ROUTES}/distanceMatrix/v2:computeRouteMatrix`,
      {
        body: { origins: origins.map(waypoint), destinations: part.map(waypoint), ...travelOptions(mode, departure) },
        fieldMask: "originIndex,destinationIndex,duration,condition",
      },
      "Trip time lookup",
    );
    for (const el of Array.isArray(rows) ? rows : []) {
      if (el.condition !== "ROUTE_EXISTS" || !el.duration) continue;
      const seconds = parseFloat(el.duration);
      if (Number.isFinite(seconds)) out[el.originIndex ?? 0][start + (el.destinationIndex ?? 0)] = seconds;
    }
  }
  return out;
}

export async function routeLine(from: LatLon, to: LatLon, mode: Mode, departure: string | null): Promise<{ path: [number, number][]; seconds: number }> {
  type Res = { routes?: { duration?: string; polyline?: { encodedPolyline?: string } }[] };
  const data = await google<Res>(
    `${ROUTES}/directions/v2:computeRoutes`,
    {
      body: { origin: { location: { latLng: latLng(from) } }, destination: { location: { latLng: latLng(to) } }, polylineQuality: "OVERVIEW", ...travelOptions(mode, departure) },
      fieldMask: "routes.duration,routes.polyline.encodedPolyline",
    },
    "Route",
  );
  const r = data.routes?.[0];
  if (!r?.polyline?.encodedPolyline) throw new HttpError(404, "No route found.");
  return { path: decodePolyline(r.polyline.encodedPolyline), seconds: parseFloat(r.duration ?? "0") };
}

/** Google encoded polyline (precision 5) to [lat, lon] pairs. */
export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lon += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}
