// Browser-side calls to this app's own API routes, which talk to TomTom with the server key.

import type { LatLon } from "./geo";
import type { Category, Mode, Place, Spot } from "./types";

export const JAKARTA: LatLon = { lat: -6.2, lon: 106.83 };

export class ServiceError extends Error {}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(65_000),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "AbortError") throw e;
    if (name === "TimeoutError") throw new ServiceError("This is taking too long. Try again in a minute.");
    throw new ServiceError("No connection. Check your internet and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ServiceError(data.error ?? `Request failed (${res.status}).`);
  return data;
}

export type FoundPlace = { lat: number; lon: number; main: string; secondary: string };

export async function searchPlaces(q: string, near: LatLon, signal?: AbortSignal): Promise<FoundPlace[]> {
  const r = await post<{ places: FoundPlace[] }>("/api/search", { q, near: { lat: near.lat, lon: near.lon } }, signal);
  return r.places;
}

export function toPlace(p: FoundPlace): Place {
  return { lat: p.lat, lon: p.lon, label: [p.main, p.secondary.split(",")[0]].filter(Boolean).join(", ") };
}

export async function findSpots(categories: Category[], center: LatLon, radius: number): Promise<Spot[]> {
  const cats = categories.filter((c) => c !== "mine");
  if (cats.length === 0) return [];
  const r = await post<{ spots: Spot[] }>("/api/spots", { categories: cats, center, radius: Math.round(radius) });
  return r.spots;
}

export async function tripMatrix(origins: LatLon[], destinations: LatLon[], mode: Mode, departure: string | null): Promise<(number | null)[][]> {
  const pick = (p: LatLon) => ({ lat: p.lat, lon: p.lon });
  const r = await post<{ seconds: (number | null)[][] }>("/api/matrix", {
    origins: origins.map(pick),
    destinations: destinations.map(pick),
    mode,
    departure,
  });
  return r.seconds;
}

export async function routeLines(
  legs: { from: LatLon; mode: Mode }[],
  to: LatLon,
  departure: string | null,
): Promise<([number, number][] | null)[]> {
  const pick = (p: LatLon) => ({ lat: p.lat, lon: p.lon });
  const r = await post<{ paths: ([number, number][] | null)[] }>("/api/routes", {
    legs: legs.map((l) => ({ from: pick(l.from), mode: l.mode })),
    to: pick(to),
    departure,
  });
  return r.paths;
}

/** "18:30" -> next time it's 18:30 here, as ISO. null means leave now. */
export function departureTime(leaveAt: string | null): string | null {
  if (!leaveAt) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(leaveAt);
  if (!m) return null;
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]);
  if (d.getTime() < now.getTime() + 60_000) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
