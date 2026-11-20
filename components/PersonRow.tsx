"use client";

import { useEffect, useRef, useState } from "react";
import { JAKARTA, searchPlaces, toPlace, type FoundPlace } from "@/lib/api";
import { MODE_LABEL, type Mode, type Person, type Place } from "@/lib/types";

const MODES: Mode[] = ["car", "motorbike", "walk"];

type Props = {
  person: Person;
  color: string;
  isFirst: boolean;
  picking: boolean;
  canRemove: boolean;
  onChange: (p: Person) => void;
  onPickOnMap: () => void;
  onRemove: () => void;
};

export default function PersonRow({ person, color, isFirst, picking, canRemove, onChange, onPickOnMap, onRemove }: Props) {
  const [editing, setEditing] = useState(!person.place);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<FoundPlace[]>([]);
  const [status, setStatus] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (person.place) setEditing(false);
  }, [person.place]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setOptions([]);
      return;
    }
    const t = setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      try {
        setStatus("Searching");
        const found = await searchPlaces(q, person.place ?? JAKARTA, abort.current.signal);
        setOptions(found);
        setStatus(found.length ? "" : "No matches. Try another name, or pick on the map.");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus((e as Error).message);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query, person.place]);

  function setPlace(place: Place) {
    onChange({ ...person, place });
    setQuery("");
    setOptions([]);
    setStatus("");
    setEditing(false);
  }

  function choose(p: FoundPlace) {
    setPlace(toPlace(p));
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setStatus("This browser can't share your location. Search or pick on the map.");
      return;
    }
    setStatus("Getting your location");
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "My location" }),
      () => setStatus("Location wasn't shared. Search or pick on the map."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <li className="person">
      <div className="person-top">
        <span className="swatch" style={{ background: color }} aria-hidden="true" />
        <input
          className="person-name"
          value={person.name}
          onChange={(e) => onChange({ ...person, name: e.target.value })}
          aria-label="Name"
          maxLength={24}
        />
        <div className="modes" role="radiogroup" aria-label={`How ${person.name} travels`}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={person.mode === m}
              className="mode"
              onClick={() => onChange({ ...person, mode: m })}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {canRemove && (
          <button type="button" className="icon-btn" aria-label={`Remove ${person.name}`} onClick={onRemove}>
            ×
          </button>
        )}
      </div>

      {person.place && !editing ? (
        <button type="button" className="place" onClick={() => setEditing(true)}>
          <span className="place-label">{person.place.label}</span>
          <span className="place-edit">Change</span>
        </button>
      ) : (
        <div className="place-search">
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search an area, street or building"
            aria-label={`Where ${person.name} starts`}
            autoComplete="off"
          />
          <div className="place-actions">
            <button type="button" className={`link-btn${picking ? " is-active" : ""}`} onClick={onPickOnMap}>
              {picking ? "Tap the map…" : "Pick on map"}
            </button>
            {isFirst && (
              <button type="button" className="link-btn" onClick={useMyLocation}>
                Use my location
              </button>
            )}
            {person.place && (
              <button type="button" className="link-btn" onClick={() => setEditing(false)}>
                Keep current
              </button>
            )}
          </div>
          {options.length > 0 && (
            <ul className="options">
              {options.map((o, i) => (
                <li key={`${o.lat},${o.lon},${i}`}>
                  <button type="button" onClick={() => choose(o)}>
                    <span className="opt-main">{o.main}</span>
                    {o.secondary && <span className="opt-sub">{o.secondary}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status && <p className="hint">{status}</p>}
        </div>
      )}
    </li>
  );
}
