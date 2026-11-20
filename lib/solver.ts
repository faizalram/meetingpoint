import { departureTime, findSpots, sleep, tripMatrix, ServiceError } from "./api";
import { distance, geometricMedian, spreadSample, type LatLon } from "./geo";
import { CATEGORY_LABEL, type Group, type Mode, type Objective, type Person, type Result, type Spot } from "./types";

export type Progress = (message: string) => void;

/** A spot everyone can reach, with trip minutes per person (live or predicted traffic included). */
export type Scored = { spot: Spot; minutes: number[] };

export type Solution = {
  people: Person[]; // located people, in the order of Scored.minutes and Result.minutes
  scored: Scored[];
  checked: Spot[];
  center: LatLon;
  radius: number;
  departure: string | null;
};

// Kept small on purpose: every person x spot pair is one TomTom route request (2,500 free a day).
const PASS1_SPOTS = 16;
const PASS2_PER_AREA = 4;

async function minutesTo(people: Person[], spots: Spot[], departure: string | null, progress: Progress): Promise<(number | null)[][]> {
  const out: (number | null)[][] = people.map(() => spots.map(() => null));
  const byMode = new Map<Mode, number[]>();
  people.forEach((p, i) => byMode.set(p.mode, [...(byMode.get(p.mode) ?? []), i]));

  for (const [mode, idx] of byMode) {
    const who = idx.length === 1 ? people[idx[0]].name : `${idx.length} people`;
    progress(`Getting trip times for ${who} ${mode === "walk" ? "on foot" : `by ${mode}`} to ${spots.length} spots`);
    const seconds = await tripMatrix(
      idx.map((i) => people[i].place!),
      spots,
      mode,
      departure,
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
    if (m.every((x) => x !== null)) out.push({ spot, minutes: m as number[] });
  });
  return out;
}

/** Ranks spots. Cheap: no network, so switching Fair / Fastest is instant. */
export function evaluate(scored: Scored[], objective: Objective): Result[] {
  const results = scored.map(({ spot, minutes }) => ({
    spot,
    minutes,
    longest: Math.max(...minutes),
    total: minutes.reduce((a, b) => a + b, 0),
  }));
  results.sort((a, b) =>
    objective === "fair" ? a.longest - b.longest || a.total - b.total : a.total - b.total || a.longest - b.longest,
  );
  const picked: Result[] = [];
  for (const r of results) {
    if (picked.some((p) => p.spot.name === r.spot.name && distance(p.spot, r.spot) < 150)) continue;
    picked.push(r);
  }
  return picked;
}

const okCoord = (s: LatLon) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180;

export async function solve(group: Group, progress: Progress): Promise<Solution> {
  const people = group.people.filter((p) => p.place);
  if (people.length < 2) throw new ServiceError("Add locations for at least 2 people.");
  if (group.categories.length === 0) throw new ServiceError("Pick at least one kind of place to meet at.");
  if (group.categories.length === 1 && group.categories[0] === "mine" && group.mySpots.length === 0) {
    throw new ServiceError("You have no saved spots yet. Add one with Add a spot, or pick another kind of place.");
  }

  const departure = departureTime(group.leaveAt);
  const points = people.map((p) => p.place!);
  const center = geometricMedian(points);
  const spread = Math.max(...points.map((p) => distance(center, p)));
  const radius = Math.min(Math.max(spread * 0.7, 1500), 10_000);

  // 1. Candidate spots around the middle of the group (TomTom Search)
  const kinds = group.categories.filter((c) => c !== "mine").map((c) => CATEGORY_LABEL[c].toLowerCase());
  progress(kinds.length ? `Finding ${kinds.join(", ")} spots near the middle of the group` : "Using your saved spots");
  const own = (group.categories.includes("mine") ? group.mySpots : []).filter(okCoord);
  const found = (await findSpots(group.categories, center, radius)).filter(okCoord);
  if (own.length + found.length === 0) {
    throw new ServiceError("No matching places found near the middle of the group. Try another kind of place, or add your own spot.");
  }

  // 2. First pass: your own spots plus an even spread over the area
  const pass1 = [...own.slice(0, 10), ...spreadSample(found, center, radius, PASS1_SPOTS - Math.min(own.length, 10))];
  const scored = reachable(pass1, await minutesTo(people, pass1, departure, progress));
  if (scored.length === 0) throw new ServiceError("No spot could be reached by everyone. Check each person's travel mode and location.");

  // 3. Second pass: a few more spots close to the three best areas
  const best = evaluate(scored, group.objective).slice(0, 3);
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
    await sleep(200);
    progress("Checking more spots around the best areas");
    scored.push(...reachable(pass2, await minutesTo(people, pass2, departure, progress)));
  }

  return { people, scored, checked: [...pass1, ...pass2], center, radius, departure };
}
