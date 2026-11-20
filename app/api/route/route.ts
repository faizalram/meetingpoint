import { routeLine, type Mode } from "@/lib/server/google";
import { asPoint, HttpError, route } from "@/lib/server/http";

const MODES: Mode[] = ["car", "motorbike", "walk"];

export const POST = route(async (req) => {
  const { from, to, mode, departure } = (await req.json()) as { from?: unknown; to?: unknown; mode?: Mode; departure?: string | null };
  if (!mode || !MODES.includes(mode)) throw new HttpError(400, "Invalid travel mode.");
  const dep = typeof departure === "string" && !Number.isNaN(Date.parse(departure)) ? departure : null;
  return Response.json(await routeLine(asPoint(from, "start"), asPoint(to, "spot"), mode, dep));
});
