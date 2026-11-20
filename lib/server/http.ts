export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Wraps a route handler: same-origin only, errors come back as JSON { error }. */
export function route(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      // Browsers label cross-site calls; this keeps other sites from spending your daily TomTom requests
      const site = req.headers.get("sec-fetch-site");
      if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Not allowed.");
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
    }
  };
}

export type LatLon = { lat: number; lon: number };

export function asPoint(v: unknown, label = "location"): LatLon {
  const p = v as Partial<LatLon> | null;
  const ok =
    p && typeof p.lat === "number" && typeof p.lon === "number" && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  if (!ok) throw new HttpError(400, `Invalid ${label}.`);
  return { lat: p.lat!, lon: p.lon! };
}
