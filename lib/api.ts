// Browser-side calls to this app's own API routes, which talk to Google with the server key.

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
      signal: signal ?? AbortSignal.timeout(45_000),
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

export type Suggestion = { placeId: string; main: string; secondary: string };

export async function searchPlaces(input: string, sessionToken: string, near: LatLon, signal?: AbortSignal): Promise<Suggestion[]> {
  const r = await post<{ suggestions: Suggestion[] }>("/api/autocomplete", { input, sessionToken, near }, signal);
  return r.suggestions;
}

export async function placeFromSuggestion(s: Suggestion, sessionToken: string): Promise<Place> {
  const r = await post<{ lat: number; lon: number; address: string }>("/api/place", { placeId: s.placeId, sessionToken });
  return { lat: r.lat, lon: r.lon, label: [s.main, s.secondary.split(",")[0]].filter(Boolean).join(", ") };
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

export async function routeLine(from: LatLon, to: LatLon, mode: Mode, departure: string | null): Promise<{ path: [number, number][] }> {
  return post("/api/route", { from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon }, mode, departure });
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
