// The small subset of RO content shipped in the MVP, plus manual effect maps
// for things the engine understands. Anything not listed here is ignored by
// the extractor so the generated JSON stays tiny.

import type { ItemEffect } from "@mini-ro/shared-types";

// Monsters that appear in the starter field (prt_fild). Low level, classic.
export const MVP_MOB_IDS = [
  1002, // Poring
  1007, // Fabre
  1063, // Lunatic
] as const;

// Render colours for placeholder mob sprites (no RO art).
export const MOB_COLORS: Record<number, string> = {
  1002: "#FF9EC4", // Poring  (pink)
  1007: "#E8D27A", // Fabre   (yellow worm)
  1063: "#F2B6C6", // Lunatic (pink bunny)
};

// Aggro/view range in cells for the simplified mob AI.
export const MOB_VIEW_RANGE: Record<number, number> = {
  1002: 0, // Poring is passive (won't initiate)
  1007: 0, // Fabre passive
  1063: 3, // Lunatic slightly aggressive
};

// Items shipped in the MVP. Drop items of MVP mobs are added automatically
// by the extractor even if they have no engine effect (sellable/flavor).
export const MVP_ITEM_IDS = [
  501, // Red Potion
  502, // Orange Potion
  503, // Yellow Potion
  504, // White Potion
  505, // Blue Potion (SP)
  1201, // Knife (starter weapon)
  1202, // Cutter (starter weapon)
] as const;

// Manual effect mapping. We do NOT interpret the RO `Script` language; we map
// the handful of effects we actually implement. Items mapped to `null` (or
// absent here, for non-consumables) simply have no active effect.
export const ITEM_EFFECTS: Record<number, ItemEffect | null> = {
  501: { kind: "heal", min: 45, max: 65 },
  502: { kind: "heal", min: 105, max: 145 },
  503: { kind: "heal", min: 175, max: 235 },
  504: { kind: "heal", min: 325, max: 405 },
  505: { kind: "healSp", min: 40, max: 60 },
};

// Jobs shipped: Novice (start) and Swordsman (first class).
// Hercules job_db keys are by name; ids come from constants.
export const MVP_JOBS: { id: number; key: string }[] = [
  { id: 0, key: "Novice" },
  { id: 1, key: "Swordsman" }, // Job_Swordman = 1 in db/constants.conf
];

// Skills shipped in the MVP.
export const MVP_SKILL_NAMES = [
  "SM_BASH", // Bash — single target nuke
  "NV_FIRSTAID", // First Aid — tiny self heal
] as const;

// Exp groups we care about (both base and job trees use these names).
export const MVP_EXP_GROUPS = ["Novices", "FirstClasses"] as const;

// Cap levels to keep the MVP grind short.
export const MVP_BASE_LEVEL_CAP = 30;
export const MVP_JOB_LEVEL_CAP = 30;

// Field map the MVP is built around.
export const MVP_FIELD_MAP = "prt_fild01";
