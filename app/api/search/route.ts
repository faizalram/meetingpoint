import { searchPlaces } from "@/lib/server/tomtom";
import { asPoint, route } from "@/lib/server/http";

export const POST = route(async (req) => {
  const { q, near } = (await req.json()) as { q?: string; near?: unknown };
  const query = (q ?? "").trim().slice(0, 120);
  if (query.length < 3) return Response.json({ places: [] });
  return Response.json({ places: await searchPlaces(query, near ? asPoint(near) : { lat: -6.2, lon: 106.83 }) });
});
