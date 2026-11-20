// Gives the browser what it needs to draw the Google map: the browser key and Map ID.
// The browser key is meant to be seen by browsers (Google Maps JavaScript loads with it),
// so restrict it to your website in Google Cloud. The server key never leaves the server.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return new Response("Not allowed.", { status: 403 });
  return Response.json(
    {
      mapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY ?? "",
      mapId: process.env.GOOGLE_MAP_ID || "DEMO_MAP_ID",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
