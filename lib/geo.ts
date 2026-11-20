export type LatLon = { lat: number; lon: number };

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distance(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Local flat projection around a center, in meters. Fine at city scale. */
function project(p: LatLon, c: LatLon): [number, number] {
  return [rad(p.lon - c.lon) * R * Math.cos(rad(c.lat)), rad(p.lat - c.lat) * R];
}

function unproject([x, y]: [number, number], c: LatLon): LatLon {
  return { lat: c.lat + (y / R) * (180 / Math.PI), lon: c.lon + (x / (R * Math.cos(rad(c.lat)))) * (180 / Math.PI) };
}

/** Point minimizing the sum of straight-line distances (Weiszfeld). A starting guess only. */
export function geometricMedian(points: LatLon[]): LatLon {
  const c0 = { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lon: points.reduce((s, p) => s + p.lon, 0) / points.length };
  const xy = points.map((p) => project(p, c0));
  let [x, y] = [0, 0];
  for (let it = 0; it < 60; it++) {
    let nx = 0, ny = 0, w = 0;
    for (const [px, py] of xy) {
      const d = Math.hypot(px - x, py - y) || 1e-6;
      nx += px / d;
      ny += py / d;
      w += 1 / d;
    }
    const [ux, uy] = [nx / w, ny / w];
    const moved = Math.hypot(ux - x, uy - y);
    [x, y] = [ux, uy];
    if (moved < 1) break;
  }
  return unproject([x, y], c0);
}

/** Keeps at most `max` items, spread evenly over the area: one per grid cell, nearest to the cell center. */
export function spreadSample<T extends LatLon>(items: T[], center: LatLon, radius: number, max: number): T[] {
  if (items.length <= max) return items;
  const cell = (2 * radius) / Math.sqrt(max);
  const best = new Map<string, { item: T; d: number }>();
  for (const item of items) {
    const [x, y] = project(item, center);
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const d = Math.hypot(x - (cx + 0.5) * cell, y - (cy + 0.5) * cell);
    const key = `${cx}:${cy}`;
    const cur = best.get(key);
    if (!cur || d < cur.d) best.set(key, { item, d });
  }
  return [...best.values()]
    .map((b) => b.item)
    .sort((a, b) => distance(a, center) - distance(b, center))
    .slice(0, max);
}

/** Decodes a Valhalla polyline (precision 6) into [lon, lat] pairs for the map. */
export function decodePolyline6(str: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    coords.push([lon / 1e6, lat / 1e6]);
  }
  return coords;
}
