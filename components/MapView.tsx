"use client";

import { useEffect, useRef, useState } from "react";
import { JAKARTA } from "@/lib/api";
import type { Place, Result, Spot } from "@/lib/types";

export type MapPerson = { id: string; name: string; color: string; place: Place | null };
export type MapRoute = { color: string; path: [number, number][] }; // [lat, lon]

type Props = {
  people: MapPerson[];
  mySpots: Spot[];
  checked: Spot[];
  results: Result[];
  selected: number | null;
  routes: MapRoute[];
  onPick: ((lat: number, lon: number) => void) | null;
  onSelect: (index: number) => void;
  fitKey: string;
};

let loading: Promise<void> | null = null;

/** Loads the Maps JavaScript API once, with the marker library. */
function loadGoogleMaps(key: string): Promise<void> {
  if (typeof window !== "undefined" && window.google?.maps?.Map) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const w = window as unknown as Record<string, unknown>;
      w.__meetingPointMapsReady = () => resolve();
      const s = document.createElement("script");
      const q = new URLSearchParams({ key, v: "weekly", libraries: "marker", loading: "async", callback: "__meetingPointMapsReady" });
      s.src = `https://maps.googleapis.com/maps/api/js?${q}`;
      s.async = true;
      s.onerror = () => {
        loading = null;
        reject(new Error("Google Maps couldn't load."));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function MapView(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const lines = useRef<google.maps.Polyline[]>([]);
  const latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The browser key comes from the server at runtime (GOOGLE_MAPS_BROWSER_KEY), not from the build
      const cfg = (await fetch("/api/config", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null)) as { mapsKey?: string; mapId?: string } | null;
      if (!cfg?.mapsKey) throw new Error("no key");
      await loadGoogleMaps(cfg.mapsKey);
      return cfg.mapId || "DEMO_MAP_ID";
    })()
      .then((mapId) => {
        if (cancelled || !box.current) return;
        const map = new google.maps.Map(box.current, {
          center: { lat: JAKARTA.lat, lng: JAKARTA.lon },
          zoom: 11,
          mapId,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          colorScheme: "FOLLOW_SYSTEM",
        } as google.maps.MapOptions);
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) latest.current.onPick?.(e.latLng.lat(), e.latLng.lng());
        });
        mapRef.current = map;
        draw();
        fit();
      })
      .catch((e: Error) =>
        setFailed(
          e.message === "no key"
            ? "Add GOOGLE_MAPS_BROWSER_KEY in Vercel, then redeploy, to show the map."
            : "Google Maps couldn't load. Check the browser key and its allowed websites in Google Cloud.",
        ),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addMarker(position: google.maps.LatLngLiteral, content: HTMLElement, title: string, zIndex: number) {
    const m = new google.maps.marker.AdvancedMarkerElement({ map: mapRef.current, position, content, title, zIndex });
    markers.current.push(m);
    return m;
  }

  function draw() {
    const map = mapRef.current;
    if (!map) return;
    const p = latest.current;

    markers.current.forEach((m) => (m.map = null));
    markers.current = [];
    lines.current.forEach((l) => l.setMap(null));
    lines.current = [];

    for (const r of p.routes) {
      const path = r.path.map(([lat, lng]) => ({ lat, lng }));
      lines.current.push(new google.maps.Polyline({ map, path, strokeColor: "#ffffff", strokeWeight: 7, strokeOpacity: 0.9, zIndex: 1 }));
      lines.current.push(new google.maps.Polyline({ map, path, strokeColor: r.color, strokeWeight: 4, strokeOpacity: 1, zIndex: 2 }));
    }

    for (const s of p.checked) {
      if (p.results.some((r) => r.spot.id === s.id)) continue;
      const el = document.createElement("div");
      el.className = "mk-dot";
      addMarker({ lat: s.lat, lng: s.lon }, el, s.name, 1);
    }

    for (const s of p.mySpots) {
      const el = document.createElement("div");
      el.className = "mk-own";
      addMarker({ lat: s.lat, lng: s.lon }, el, s.name, 2);
    }

    p.results.forEach((r, i) => {
      const el = document.createElement("div");
      el.className = `mk-spot${p.selected === i ? " is-selected" : ""}`;
      const sign = document.createElement("span");
      sign.className = "mk-sign";
      const num = document.createElement("span");
      num.textContent = String(i + 1);
      sign.appendChild(num);
      el.appendChild(sign);
      const m = addMarker({ lat: r.spot.lat, lng: r.spot.lon }, el, `Option ${i + 1}: ${r.spot.name}`, p.selected === i ? 30 : 20);
      m.gmpClickable = true;
      m.addListener("click", () => latest.current.onSelect(i));
    });

    for (const person of p.people) {
      if (!person.place) continue;
      const el = document.createElement("div");
      el.className = "mk-person";
      el.style.background = person.color;
      el.textContent = initials(person.name);
      addMarker({ lat: person.place.lat, lng: person.place.lon }, el, `${person.name}: ${person.place.label}`, 40);
    }
  }

  function fit() {
    const map = mapRef.current;
    if (!map) return;
    const p = latest.current;
    const pts = [
      ...p.people.filter((x) => x.place).map((x) => ({ lat: x.place!.lat, lng: x.place!.lon })),
      ...p.results.map((r) => ({ lat: r.spot.lat, lng: r.spot.lon })),
    ];
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.panTo(pts[0]);
      map.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    pts.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, 56);
  }

  useEffect(draw, [props.people, props.mySpots, props.checked, props.results, props.selected, props.routes]);
  useEffect(fit, [props.fitKey]);

  return (
    <div className="map" role="region" aria-label="Map">
      <div ref={box} className="map-canvas" />
      {failed && <p className="map-error">{failed}</p>}
    </div>
  );
}
