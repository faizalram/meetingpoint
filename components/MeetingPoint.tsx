"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { placeName, route, sleep } from "@/lib/apis";
import { evaluate, solve, type Solution } from "@/lib/solver";
import { load, newGroup, newId, newPerson, save } from "@/lib/store";
import {
  CATEGORY_LABEL,
  MODE_LABEL,
  PERSON_COLORS,
  TRAFFIC_LABEL,
  type Category,
  type Group,
  type Objective,
  type Person,
  type Result,
  type Traffic,
} from "@/lib/types";
import MapView, { type MapRoute } from "./MapView";
import PersonRow from "./PersonRow";

type Saved = ReturnType<typeof load>;
type Picking = { kind: "person"; id: string } | { kind: "spot" } | null;

const CATEGORIES: Category[] = ["cafe", "mall", "restaurant", "coworking", "park", "mine"];
const TRAFFIC: Traffic[] = ["light", "normal", "rush"];

export function fmtMinutes(m: number): string {
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  const h = Math.floor(r / 60);
  const mm = r % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

const mapsUrl = (r: Result) => `https://www.google.com/maps/search/?api=1&query=${r.spot.lat},${r.spot.lon}`;

export default function MeetingPoint() {
  const [saved, setSaved] = useState<Saved | null>(null);

  useEffect(() => {
    setSaved(load());
  }, []);
  useEffect(() => {
    if (saved) save(saved);
  }, [saved]);

  if (!saved) {
    return (
      <main className="app">
        <div className="panel">
          <h1 className="wordmark">MeetingPoint</h1>
        </div>
        <div className="map-wrap" />
      </main>
    );
  }
  const setLoaded = (fn: (s: Saved) => Saved) => setSaved((s) => (s ? fn(s) : s));
  return <Planner saved={saved} setSaved={setLoaded} />;
}

function Planner({ saved, setSaved }: { saved: Saved; setSaved: (fn: (s: Saved) => Saved) => void }) {
  const group = saved.groups.find((g) => g.id === saved.currentId) ?? saved.groups[0];
  const [solution, setSolution] = useState<(Solution & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [routes, setRoutes] = useState<MapRoute[]>([]);
  const [picking, setPicking] = useState<Picking>(null);
  const [notice, setNotice] = useState("");
  const routeToken = useRef(0);
  const resultsRef = useRef<HTMLElement>(null);

  const update = useCallback(
    (fn: (g: Group) => Group) =>
      setSaved((s) => ({ ...s, groups: s.groups.map((g) => (g.id === s.currentId ? fn(g) : g)) })),
    [setSaved],
  );

  const colorOf = useCallback(
    (id: string) => PERSON_COLORS[Math.max(0, group.people.findIndex((p) => p.id === id)) % PERSON_COLORS.length],
    [group.people],
  );

  // Anything that changes trip times makes old results stale
  const inputsKey = JSON.stringify([
    group.id,
    group.people.map((p) => [p.place?.lat, p.place?.lon, p.mode]),
    group.categories,
    group.mySpots.map((s) => s.id),
  ]);
  useEffect(() => {
    if (solution && solution.key !== inputsKey) {
      setSolution(null);
      setSelected(null);
      setRoutes([]);
    }
  }, [inputsKey, solution]);

  // Objective and traffic only re-rank: instant, no network
  const results: Result[] = useMemo(
    () => (solution ? evaluate(solution.scored, solution.people, group.objective, group.traffic).slice(0, 3) : []),
    [solution, group.objective, group.traffic],
  );

  const showRoutes = useCallback(
    async (i: number, list: Result[], sol: Solution) => {
      const token = ++routeToken.current;
      setSelected(i);
      setRoutes([]);
      const target = list[i]?.spot;
      if (!target) return;
      const drawn: MapRoute[] = [];
      for (const person of sol.people) {
        if (token !== routeToken.current) return;
        try {
          const r = await route(person.place!, target, person.mode);
          drawn.push({ color: colorOf(person.id), coords: r.coords });
          if (token === routeToken.current) setRoutes([...drawn]);
        } catch {
          // skip this route; the times on the card still stand
        }
        await sleep(350);
      }
    },
    [colorOf],
  );

  // Keep the drawn routes in sync when re-ranking changes which spot is at the selected position
  const firstId = results[0]?.spot.id;
  useEffect(() => {
    if (solution && results.length) showRoutes(0, results, solution);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solution, firstId]);

  async function find() {
    setError("");
    setNotice("");
    setBusy(true);
    setSelected(null);
    setRoutes([]);
    try {
      const sol = await solve(group, setProgress);
      setSolution({ ...sol, key: inputsKey });
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" }), 50);
    } catch (e) {
      setSolution(null);
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function onPick(lat: number, lon: number) {
    const p = picking;
    setPicking(null);
    if (!p) return;
    const label = await placeName({ lat, lon });
    if (p.kind === "person") {
      update((g) => ({ ...g, people: g.people.map((x) => (x.id === p.id ? { ...x, place: { lat, lon, label } } : x)) }));
    } else {
      const name = window.prompt("Name this spot", label.split(",")[0]);
      if (!name?.trim()) return;
      update((g) => ({
        ...g,
        categories: g.categories.includes("mine") ? g.categories : [...g.categories, "mine"],
        mySpots: [...g.mySpots, { id: `mine/${newId()}`, name: name.trim(), lat, lon, category: "mine", area: label }],
      }));
    }
  }

  async function share(r: Result, people: Person[]) {
    const lines = people.map((p, i) => `${p.name}: ${fmtMinutes(r.minutes[i])} by ${MODE_LABEL[p.mode].toLowerCase()}`);
    const text = `Let's meet at ${r.spot.name}\n${mapsUrl(r)}\n\nTrip times\n${lines.join("\n")}`;
    try {
      if (navigator.share) await navigator.share({ title: r.spot.name, text });
      else {
        await navigator.clipboard.writeText(text);
        setNotice("Copied. Paste it in your group chat.");
      }
    } catch {
      // share sheet closed
    }
  }

  function setPerson(next: Person) {
    update((g) => ({ ...g, people: g.people.map((p) => (p.id === next.id ? next : p)) }));
  }

  function switchGroup(id: string) {
    if (id === "__new") {
      const name = window.prompt("Name the new group", "New group");
      if (!name?.trim()) return;
      const g = newGroup(name.trim());
      setSaved((s) => ({ groups: [...s.groups, g], currentId: g.id }));
    } else {
      setSaved((s) => ({ ...s, currentId: id }));
    }
    setSolution(null);
    setError("");
  }

  function renameGroup() {
    const name = window.prompt("Rename group", group.name);
    if (name?.trim()) update((g) => ({ ...g, name: name.trim() }));
  }

  function deleteGroup() {
    if (saved.groups.length < 2 || !window.confirm(`Delete "${group.name}"?`)) return;
    setSaved((s) => {
      const groups = s.groups.filter((g) => g.id !== group.id);
      return { groups, currentId: groups[0].id };
    });
  }

  const mapPeople = useMemo(
    () => group.people.map((p) => ({ id: p.id, name: p.name, color: colorOf(p.id), place: p.place })),
    [group.people, colorOf],
  );
  const located = group.people.filter((p) => p.place).length;
  const canFind = located >= 2 && group.categories.length > 0 && !busy;
  const maxMinutes = Math.max(1, ...results.flatMap((r) => r.minutes));
  const pickingName = picking?.kind === "person" ? group.people.find((p) => p.id === picking.id)?.name : null;

  return (
    <main className="app">
      <div className="panel">
        <header className="panel-head">
          <h1 className="wordmark">MeetingPoint</h1>
          <div className="group-bar">
            <select value={group.id} onChange={(e) => switchGroup(e.target.value)} aria-label="Group">
              {saved.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value="__new">New group…</option>
            </select>
            <button type="button" className="link-btn" onClick={renameGroup}>
              Rename
            </button>
            {saved.groups.length > 1 && (
              <button type="button" className="link-btn" onClick={deleteGroup}>
                Delete
              </button>
            )}
          </div>
        </header>

        <section className="block" aria-labelledby="h-who">
          <h2 id="h-who">Who&apos;s coming</h2>
          <ul className="people">
            {group.people.map((p, i) => (
              <PersonRow
                key={p.id}
                person={p}
                color={colorOf(p.id)}
                isFirst={i === 0}
                picking={picking?.kind === "person" && picking.id === p.id}
                canRemove={group.people.length > 2}
                onChange={setPerson}
                onPickOnMap={() => setPicking(picking?.kind === "person" && picking.id === p.id ? null : { kind: "person", id: p.id })}
                onRemove={() => update((g) => ({ ...g, people: g.people.filter((x) => x.id !== p.id) }))}
              />
            ))}
          </ul>
          {group.people.length < 8 && (
            <button
              type="button"
              className="add-btn"
              onClick={() => update((g) => ({ ...g, people: [...g.people, newPerson(`Friend ${g.people.length}`)] }))}
            >
              Add person
            </button>
          )}
        </section>

        <section className="block" aria-labelledby="h-where">
          <h2 id="h-where">Meet at</h2>
          <div className="chips">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className="chip"
                aria-pressed={group.categories.includes(c)}
                onClick={() =>
                  update((g) => ({
                    ...g,
                    categories: g.categories.includes(c) ? g.categories.filter((x) => x !== c) : [...g.categories, c],
                  }))
                }
              >
                {CATEGORY_LABEL[c]}
                {c === "mine" && group.mySpots.length > 0 ? ` (${group.mySpots.length})` : ""}
              </button>
            ))}
          </div>
          {group.categories.includes("mine") && (
            <div className="my-spots">
              {group.mySpots.length === 0 && <p className="hint">Add places you like to meet, such as a friend&apos;s office or your usual spot.</p>}
              <ul>
                {group.mySpots.map((s) => (
                  <li key={s.id}>
                    <span>{s.name}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${s.name}`}
                      onClick={() => update((g) => ({ ...g, mySpots: g.mySpots.filter((x) => x.id !== s.id) }))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className={`link-btn${picking?.kind === "spot" ? " is-active" : ""}`} onClick={() => setPicking(picking?.kind === "spot" ? null : { kind: "spot" })}>
                {picking?.kind === "spot" ? "Tap the map…" : "Add a spot"}
              </button>
            </div>
          )}
        </section>

        <section className="block" aria-labelledby="h-best">
          <h2 id="h-best">Best spot is</h2>
          <div className="seg" role="radiogroup" aria-labelledby="h-best">
            {(["fair", "total"] as Objective[]).map((o) => (
              <button key={o} type="button" role="radio" aria-checked={group.objective === o} onClick={() => update((g) => ({ ...g, objective: o }))}>
                {o === "fair" ? "Fair for everyone" : "Fastest overall"}
              </button>
            ))}
          </div>
          <p className="hint">
            {group.objective === "fair" ? "Keeps the longest trip as short as possible." : "Keeps everyone's trips added together as short as possible."}
          </p>

          <h2 id="h-traffic">Traffic</h2>
          <div className="seg" role="radiogroup" aria-labelledby="h-traffic">
            {TRAFFIC.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={group.traffic === t} onClick={() => update((g) => ({ ...g, traffic: t }))}>
                {TRAFFIC_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="hint">A rough adjustment: cars slow down most, motorbikes less, walking not at all.</p>
        </section>

        <div className="find-row">
          <button type="button" className="find" disabled={!canFind} onClick={find}>
            {busy ? "Finding…" : "Find meeting point"}
          </button>
          {!busy && located < 2 && <p className="hint">Set where at least 2 people start.</p>}
          {busy && (
            <p className="progress" aria-live="polite">
              {progress}
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>

        {solution && results.length > 0 && (
          <section className="block results-block" aria-labelledby="h-results" ref={resultsRef}>
            <h2 id="h-results">Best spots</h2>
            <p className="hint">Checked {solution.checked.length} places. Tap an option to see everyone&apos;s route.</p>
            <ol className="results">
              {results.map((r, i) => (
                <li key={r.spot.id} className={`result${selected === i ? " is-selected" : ""}`}>
                  <button type="button" className="result-head" onClick={() => showRoutes(i, results, solution)}>
                    <span className="rank" aria-hidden="true">
                      <span>{i + 1}</span>
                    </span>
                    <span className="result-title">
                      <span className="result-name">{r.spot.name}</span>
                      <span className="result-sub">{[CATEGORY_LABEL[r.spot.category], r.spot.area].filter(Boolean).join(", ")}</span>
                    </span>
                  </button>
                  <p className="result-summary">
                    Longest trip <span className="nowrap">{fmtMinutes(r.longest)}</span>, total{" "}
                    <span className="nowrap">{fmtMinutes(r.total)}</span>
                  </p>
                  <ul className="bars">
                    {solution.people.map((p, k) => (
                      <li key={p.id} className={Math.round(r.minutes[k]) === Math.round(r.longest) ? "is-longest" : ""}>
                        <span className="bar-name">{p.name}</span>
                        <span className="bar-track">
                          <span className="bar" style={{ width: `${(r.minutes[k] / maxMinutes) * 100}%`, background: colorOf(p.id) }} />
                        </span>
                        <span className="bar-mins">{fmtMinutes(r.minutes[k])}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="result-actions">
                    <a className="link-btn" href={mapsUrl(r)} target="_blank" rel="noreferrer">
                      Open in Google Maps
                    </a>
                    <button type="button" className="link-btn" onClick={() => share(r, solution.people)}>
                      Share
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {notice && <p className="hint">{notice}</p>}
          </section>
        )}

        <footer className="foot">
          Trip times come from OpenStreetMap routing without live traffic, adjusted by the traffic setting. Groups are saved
          only in this browser.
        </footer>
      </div>

      <div className="map-wrap">
        <MapView
          people={mapPeople}
          mySpots={group.mySpots}
          checked={solution?.checked ?? []}
          results={results}
          selected={selected}
          routes={routes}
          onPick={picking ? onPick : null}
          onSelect={(i) => solution && showRoutes(i, results, solution)}
          fitKey={`${group.id}|${located}|${results.map((r) => r.spot.id).join(",")}`}
        />
        {picking && (
          <div className="pick-banner" role="status">
            <span>{picking.kind === "person" ? `Tap the map where ${pickingName} starts` : "Tap the map to add a spot"}</span>
            <button type="button" className="link-btn" onClick={() => setPicking(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
