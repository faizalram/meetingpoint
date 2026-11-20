"use client";

import { useEffect, useRef } from "react";
import type { Map as MLMap, Marker as MLMarker, GeoJSONSource } from "maplibre-gl";
import { JAKARTA } from "@/lib/apis";
import type { Place, Result, Spot } from "@/lib/types";

export type MapPerson = { id: string; name: string; color: string; place: Place | null };
export type MapRoute = { color: string; coords: [number, number][] };

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

// Free vector tiles from OpenFreeMap: no key, no limits. Attribution is added by MapLibre.
const STYLE = "https://tiles.openfreemap.org/styles/positron";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const empty = { type: "FeatureCollection" as const, features: [] };

export default function MapView(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<MLMarker[]>([]);
  const ready = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  // Create the map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      lib.setWorkerUrl(new URL("/maplibre-gl-worker.mjs", window.location.href).href);
      libRef.current = lib;
      const map = new lib.Map({
        container: box.current,
        style: STYLE,
        center: [JAKARTA.lon, JAKARTA.lat],
        zoom: 10.3,
        attributionControl: { compact: true },
      });
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      map.on("click", (e) => latest.current.onPick?.(e.lngLat.lat, e.lngLat.lng));
      map.on("load", () => {
        map.addSource("routes", { type: "geojson", data: empty });
        map.addLayer({
          id: "routes-casing",
          type: "line",
          source: "routes",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "routes",
          type: "line",
          source: "routes",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 4 },
        });
        map.addSource("checked", { type: "geojson", data: empty });
        map.addLayer({
          id: "checked",
          type: "circle",
          source: "checked",
          paint: {
            "circle-radius": 3.5,
            "circle-color": "#7c8796",
            "circle-opacity": 0.7,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
          },
        });
        ready.current = true;
        draw();
        fit();
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !ready.current) return;
    const p = latest.current;

    markers.current.forEach((m) => m.remove());
    markers.current = [];

    for (const s of p.mySpots) {
      const el = document.createElement("div");
      el.className = "mk-own";
      el.title = s.name;
      markers.current.push(new lib.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map));
    }

    p.results.forEach((r, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `mk-spot${p.selected === i ? " is-selected" : ""}`;
      const sign = document.createElement("span");
      sign.className = "mk-sign";
      const num = document.createElement("span");
      num.textContent = String(i + 1);
      sign.appendChild(num);
      el.appendChild(sign);
      el.title = r.spot.name;
      el.setAttribute("aria-label", `Option ${i + 1}: ${r.spot.name}`);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        latest.current.onSelect(i);
      });
      markers.current.push(new lib.Marker({ element: el }).setLngLat([r.spot.lon, r.spot.lat]).addTo(map));
    });

    for (const person of p.people) {
      if (!person.place) continue;
      const el = document.createElement("div");
      el.className = "mk-person";
      el.style.background = person.color;
      el.textContent = initials(person.name);
      el.title = `${person.name}: ${person.place.label}`;
      markers.current.push(new lib.Marker({ element: el }).setLngLat([person.place.lon, person.place.lat]).addTo(map));
    }

    (map.getSource("checked") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: p.checked
        .filter((s) => !p.results.some((r) => r.spot.id === s.id))
        .map((s) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })),
    });
    (map.getSource("routes") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: p.routes.map((r) => ({
        type: "Feature",
        properties: { color: r.color },
        geometry: { type: "LineString", coordinates: r.coords },
      })),
    });
  }

  function fit() {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !ready.current) return;
    const p = latest.current;
    const pts: [number, number][] = [
      ...p.people.filter((x) => x.place).map((x) => [x.place!.lon, x.place!.lat] as [number, number]),
      ...p.results.map((r) => [r.spot.lon, r.spot.lat] as [number, number]),
    ];
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.easeTo({ center: pts[0], zoom: 13 });
      return;
    }
    const bounds = new lib.LngLatBounds(pts[0], pts[0]);
    pts.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 600 });
  }

  useEffect(draw, [props.people, props.mySpots, props.checked, props.results, props.selected, props.routes]);
  useEffect(fit, [props.fitKey]);

  useEffect(() => {
    mapRef.current?.getCanvas().style.setProperty("cursor", props.onPick ? "crosshair" : "");
  }, [props.onPick]);

  return <div ref={box} className="map" role="region" aria-label="Map" />;
}
