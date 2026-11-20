import type { Group, Person } from "./types";

const KEY = "meetingpoint:v1";

type Saved = { groups: Group[]; currentId: string };

export const newId = () => Math.random().toString(36).slice(2, 10);

export function newPerson(name: string): Person {
  return { id: newId(), name, mode: "motorbike", place: null };
}

export function newGroup(name: string): Group {
  return {
    id: newId(),
    name,
    people: [newPerson("Me"), newPerson("Friend 1")],
    categories: ["cafe"],
    objective: "fair",
    traffic: "normal",
    mySpots: [],
  };
}

/** Groups live only in this browser (localStorage). Nothing is sent to a server. */
export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s.groups?.length) return s;
    }
  } catch {
    // fall through to a fresh start
  }
  const g = newGroup("My group");
  return { groups: [g], currentId: g.id };
}

export function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or disabled: the app still works for this session
  }
}
