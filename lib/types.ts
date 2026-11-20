export type Mode = "car" | "motorbike" | "walk";
export type Category = "cafe" | "mall" | "restaurant" | "coworking" | "park" | "mine";
export type Objective = "fair" | "total";
export type Traffic = "light" | "normal" | "rush";

export type Place = { lat: number; lon: number; label: string };

export type Person = { id: string; name: string; mode: Mode; place: Place | null };

export type Spot = { id: string; name: string; lat: number; lon: number; category: Category; area?: string };

export type Group = {
  id: string;
  name: string;
  people: Person[];
  categories: Category[];
  objective: Objective;
  traffic: Traffic;
  mySpots: Spot[];
};

export type Result = {
  spot: Spot;
  minutes: number[]; // per person, same order as the located people
  longest: number;
  total: number;
};

export const MODE_LABEL: Record<Mode, string> = { car: "Car", motorbike: "Motorbike", walk: "Walk" };

export const CATEGORY_LABEL: Record<Category, string> = {
  cafe: "Cafe",
  mall: "Mall",
  restaurant: "Restaurant",
  coworking: "Coworking",
  park: "Park",
  mine: "My spots",
};

// Rough Jakarta traffic factors on top of free-flow routing times.
// Cars lose the most in traffic, motorbikes filter through, walking is unaffected.
export const TRAFFIC_FACTOR: Record<Traffic, Record<Mode, number>> = {
  light: { car: 1, motorbike: 1, walk: 1 },
  normal: { car: 1.4, motorbike: 1.15, walk: 1 },
  rush: { car: 2, motorbike: 1.35, walk: 1 },
};

export const TRAFFIC_LABEL: Record<Traffic, string> = { light: "Light", normal: "Normal", rush: "Rush hour" };

export const PERSON_COLORS = ["#2f6bff", "#e5484d", "#12a594", "#8e4ec6", "#f76b15", "#d6409f", "#46a758", "#a07553"];
