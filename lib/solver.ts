import { findSpots, sleep, tripMatrix, ServiceError } from "./apis";
import { distance, geometricMedian, spreadSample, type LatLon } from "./geo";
import { CATEGORY_LABEL, TRAFFIC_FACTOR, type Group, type Mode, type Objective, type Person, type Result, type Spot, type Traffic } from "./types";

export type Progress = (message: string) => void;

/** A spot everyone can reach, with free-flow trip minutes per person (before traffic). */
export type Scored = { spot: Spot; raw: number[] };

export type Solution = {
  people: Person[]; // located people, in the order of Scored.raw and Result.minutes
  scored: Scored[];
  checked: Spot[];
  center: LatLon;
  radius: number;
};

const PASS1_SPOTS = 40;
const PASS2_PER_AREA = 12;

/** Free-flow minutes from every located person to every spot. One routing request per travel mode. */
async function rawMinutes(people: Person[], spots: Spot[], progress: Progress): Promise<(number | null)[][]> {
  const out: (number | null)[][] = people.map(() => spots.map(() => null));
  const byMode = new Map<Mode, number[]>();
  people.forEach((p, i) => byMode.set(p.mode, [...(byMode.get(p.mode) ?? []), i]));

  let first = true;
  for (const [mode, idx] of byMode) {
    if (!first) await sleep(1100); // be gentle with the free routing server
    first = false;
    const who = idx.length === 1 ? people[idx[0]].name : `${idx.length} people`;
    progress(`Routing ${who} ${mode === "walk" ? "on foot" : `by ${mode}`} to ${spots.length} spots`);
    const seconds = await tripMatrix(
      idx.map((i) => people[i].place!),
      spots,
      mode,
    );
    idx.forEach((personIdx, row) => {
      out[personIdx] = seconds[row].map((s) => (s === null ? null : s / 60));
    });
  }
  return out;
}

function reachable(spots: Spot[], minutes: (number | null)[][]): Scored[] {
  const out: Scored[] = [];
  spots.forEach((spot, j) => {
    const m = minutes.map((row) => row[j]);
    if (m.every((x) => x !== null)) out.push({ spot, raw: m as number[] });
  });
  return out;
}

/** Applies the traffic factor for each person's mode, then ranks. Cheap: no network. */
export function evaluate(scored: Scored[], people: Person[], objective: Objective, traffic: Traffic): Result[] {
  const results = scored.map(({ spot, raw }) => {
    const minutes = raw.map((m, i) => m * TRAFFIC_FACTOR[traffic][people[i].mode]);
    return { spot, minutes, longest: Math.max(...minutes), total: minutes.reduce((a, b) => a + b, 0) };
  });
  results.sort((a, b) =>
    objective === "fair" ? a.longest - b.longest || a.total - b.total : a.total - b.total || a.longest - b.longest,
  );
  // Don't show the same place twice (chains often appear as separate entries)
  const picked: Result[] = [];
  for (const r of results) {
    if (picked.some((p) => p.spot.name === r.spot.name && distance(p.spot, r.spot) < 150)) continue;
    picked.push(r);
  }
  return picked;
}

export async function solve(group: Group, progress: Progress): Promise<Solution> {
  const people = group.people.filter((p) => p.place);
  if (people.length < 2) throw new ServiceError("Add locations for at least 2 people.");
  if (group.categories.length === 0) throw new ServiceError("Pick at least one kind of place to meet at.");
  if (group.categories.length === 1 && group.categories[0] === "mine" && group.mySpots.length === 0) {
    throw new ServiceError("You have no saved spots yet. Add one with Add a spot, or pick another kind of place.");
  }

  const points = people.map((p) => p.place!);
  const center = geometricMedian(points);
  const spread = Math.max(...points.map((p) => distance(center, p)));
  const radius = Math.min(Math.max(spread * 0.7, 1500), 8_000);

  // 1. Candidate spots around the middle of the group
  const kinds = group.categories.filter((c) => c !== "mine").map((c) => CATEGORY_LABEL[c].toLowerCase());
  progress(kinds.length ? `Finding ${kinds.join(", ")} spots near the middle of the group` : "Using your saved spots");
  const own = group.categories.includes("mine") ? group.mySpots : [];
  const found = await findSpots(group.categories, center, radius, progress);
  const all = [...own, ...found];
  if (all.length === 0) {
    throw new ServiceError("No matching places found near the middle of the group. Try another kind of place, or add your own spot.");
  }

  // 2. First pass: your own spots plus an even spread of spots over the whole area
  const pass1 = [...own.slice(0, 20), ...spreadSample(found, center, radius, PASS1_SPOTS - Math.min(own.length, 20))];
  const scored = reachable(pass1, await rawMinutes(people, pass1, progress));
  if (scored.length === 0) throw new ServiceError("No spot could be reached by everyone. Check each person's travel mode and location.");

  // 3. Second pass: more spots close to the three best areas
  const best = evaluate(scored, people, group.objective, group.traffic).slice(0, 3);
  const checkedIds = new Set(pass1.map((s) => s.id));
  const near = Math.max(radius / 6, 600);
  const pass2: Spot[] = [];
  for (const b of best) {
    const local = found.filter((s) => !checkedIds.has(s.id) && distance(s, b.spot) <= near);
    for (const s of spreadSample(local, b.spot, near, PASS2_PER_AREA)) {
      if (!checkedIds.has(s.id)) {
        checkedIds.add(s.id);
        pass2.push(s);
      }
    }
  }
  if (pass2.length > 0) {
    await sleep(1100);
    progress("Checking more spots around the best areas");
    scored.push(...reachable(pass2, await rawMinutes(people, pass2, progress)));
  }

  return { people, scored, checked: [...pass1, ...pass2], center, radius };
}
