import { routeLines, type Mode } from "@/lib/server/tomtom";
import { asPoint, HttpError, route } from "@/lib/server/http";

const MODES: Mode[] = ["car", "motorbike", "walk"];

export const POST = route(async (req) => {
  const { legs, to, departure } = (await req.json()) as { legs?: { from?: unknown; mode?: Mode }[]; to?: unknown; departure?: string | null };
  if (!Array.isArray(legs) || legs.length < 1 || legs.length > 10) throw new HttpError(400, "Between 1 and 10 routes.");
  const clean = legs.map((l) => {
    if (!l.mode || !MODES.includes(l.mode)) throw new HttpError(400, "Invalid travel mode.");
    return { from: asPoint(l.from, "start"), mode: l.mode };
  });
  const dep = typeof departure === "string" && !Number.isNaN(Date.parse(departure)) ? departure : null;
  return Response.json({ paths: await routeLines(clean, asPoint(to, "spot"), dep) });
});
