import { findSpots, type SpotCategory } from "@/lib/server/google";
import { asPoint, HttpError, route } from "@/lib/server/http";

const ALLOWED: SpotCategory[] = ["cafe", "mall", "restaurant", "coworking", "park"];

export const POST = route(async (req) => {
  const { categories, center, radius } = (await req.json()) as { categories?: string[]; center?: unknown; radius?: number };
  const cats = (categories ?? []).filter((c): c is SpotCategory => ALLOWED.includes(c as SpotCategory));
  if (cats.length === 0) throw new HttpError(400, "Pick at least one kind of place.");
  const r = Number(radius);
  if (!(r >= 300 && r <= 50_000)) throw new HttpError(400, "Invalid search radius.");
  return Response.json({ spots: await findSpots(cats, asPoint(center, "center"), r) });
});
