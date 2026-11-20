import { routeMatrix, type Mode } from "@/lib/server/google";
import { asPoint, HttpError, route } from "@/lib/server/http";

const MODES: Mode[] = ["car", "motorbike", "walk"];

export const POST = route(async (req) => {
  const { origins, destinations, mode, departure } = (await req.json()) as {
    origins?: unknown[];
    destinations?: unknown[];
    mode?: Mode;
    departure?: string | null;
  };
  if (!mode || !MODES.includes(mode)) throw new HttpError(400, "Invalid travel mode.");
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > 10) throw new HttpError(400, "Between 1 and 10 people.");
  if (!Array.isArray(destinations) || destinations.length < 1 || destinations.length > 120) throw new HttpError(400, "Between 1 and 120 spots.");
  const dep = typeof departure === "string" && !Number.isNaN(Date.parse(departure)) ? departure : null;
  const seconds = await routeMatrix(origins.map((o) => asPoint(o)), destinations.map((d) => asPoint(d)), mode, dep);
  return Response.json({ seconds });
});
