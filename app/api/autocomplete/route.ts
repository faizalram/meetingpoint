import { autocomplete } from "@/lib/server/google";
import { asPoint, HttpError, route } from "@/lib/server/http";

export const POST = route(async (req) => {
  const { input, sessionToken, near } = (await req.json()) as { input?: string; sessionToken?: string; near?: unknown };
  const q = (input ?? "").trim().slice(0, 120);
  if (q.length < 2) return Response.json({ suggestions: [] });
  if (!sessionToken || !/^[\w-]{8,64}$/.test(sessionToken)) throw new HttpError(400, "Invalid session.");
  const suggestions = await autocomplete(q, sessionToken, near ? asPoint(near) : { lat: -6.2, lon: 106.83 });
  return Response.json({ suggestions });
});
