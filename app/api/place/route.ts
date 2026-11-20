import { placeLocation } from "@/lib/server/google";
import { HttpError, route } from "@/lib/server/http";

export const POST = route(async (req) => {
  const { placeId, sessionToken } = (await req.json()) as { placeId?: string; sessionToken?: string };
  if (!placeId || !/^[\w-]{10,300}$/.test(placeId)) throw new HttpError(400, "Invalid place.");
  if (!sessionToken || !/^[\w-]{8,64}$/.test(sessionToken)) throw new HttpError(400, "Invalid session.");
  return Response.json(await placeLocation(placeId, sessionToken));
});
