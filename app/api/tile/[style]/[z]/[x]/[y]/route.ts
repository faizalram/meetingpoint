// Map tiles go through this route so the TomTom map key never reaches the browser.
// Uses TOMTOM_MAP_KEY (Map Display API); falls back to TOMTOM_API_KEY if that key also has Map Display.
// Tiles are cached by the browser and Vercel's CDN for a day, which also saves TomTom tile requests.

type Ctx = { params: Promise<{ style: string; z: string; x: string; y: string }> };

const STYLES = new Set(["main", "night"]);

function fail(status: number, message: string) {
  return new Response(message, { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}

export async function GET(req: Request, ctx: Ctx) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return fail(403, "Not allowed.");

  const key = process.env.TOMTOM_MAP_KEY || process.env.TOMTOM_API_KEY;
  if (!key) return fail(500, "Missing TOMTOM_MAP_KEY.");

  const { style, z, x, y } = await ctx.params;
  const zoom = Number(z);
  const tx = Number(x);
  const ty = Number(y.replace(/\.png$/, ""));
  const max = 2 ** zoom;
  const valid =
    STYLES.has(style) &&
    Number.isInteger(zoom) && zoom >= 0 && zoom <= 22 &&
    Number.isInteger(tx) && tx >= 0 && tx < max &&
    Number.isInteger(ty) && ty >= 0 && ty < max;
  if (!valid) return fail(400, "Invalid tile.");

  const url = `https://api.tomtom.com/map/1/tile/basic/${style}/${zoom}/${tx}/${ty}.png?tileSize=256&key=${encodeURIComponent(key)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return fail(504, "TomTom map tiles didn't answer in time.");
  }
  if (!res.ok) return fail(res.status === 403 ? 403 : 502, `TomTom map tiles returned ${res.status}.`);

  return new Response(await res.arrayBuffer(), {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
