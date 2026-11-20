import { tripTimes, type Mode } from "@/lib/server/tomtom";
import { asPoint, HttpError, route } from "@/lib/server/http";

const MODES: Mode[] = ["car", "motorbike", "walk"];

// Batch Routing can take a while for many pairs
export const maxDuration = 60;

export const POST = route(async (req) => {
  const { origins, destinations, mode, departure } = (await req.json()) as {
    origins?: unknown[];
    destinations?: unknown[];
    mode?: Mode;
    departure?: string | null;
  };
  if (!mode || !MODES.includes(mode)) throw new HttpError(400, "Invalid travel mode.");
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > 10) throw new HttpError(400, "Between 1 and 10 people.");
  if (!Array.isArray(destinations) || destinations.length < 1 || destinations.length > 60) throw new HttpError(400, "Between 1 and 60 spots.");
  const dep = typeof departure === "string" && !Number.isNaN(Date.parse(departure)) ? departure : null;
  const seconds = await tripTimes(origins.map((o) => asPoint(o)), destinations.map((d) => asPoint(d)), mode, dep);
  return Response.json({ seconds });
});
