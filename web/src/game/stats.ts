// Derived character stats, using simplified Ragnarok (renewal-ish) formulas.
// Kept pure so they can be unit-tested without any rendering or network.

import type { JobDef, Stats } from "@mini-ro/shared-types";

const clampLevel = (lv: number, table: number[]) =>
  Math.max(1, Math.min(lv, table.length));

/** Max HP: job HP table value for the level, scaled by Vit. */
export function maxHp(job: JobDef, baseLv: number, vit: number): number {
  const idx = clampLevel(baseLv, job.hpTable) - 1;
  const base = job.hpTable[idx] ?? job.hpTable[job.hpTable.length - 1] ?? 40;
  return Math.floor(base * (1 + vit / 100));
}

/** Max SP: job SP table value for the level, scaled by Int. */
export function maxSp(job: JobDef, baseLv: number, int: number): number {
  const idx = clampLevel(baseLv, job.spTable) - 1;
  const base = job.spTable[idx] ?? job.spTable[job.spTable.length - 1] ?? 11;
  return Math.floor(base * (1 + int / 100));
}

/** Status ATK from Str (+ a small base-level/dex contribution) plus weapon ATK. */
export function atk(stats: Stats, weaponAtk: number, baseLv: number): number {
  const statAtk = stats.str + Math.floor((stats.str * stats.str) / 40) +
    Math.floor(stats.dex / 5) + Math.floor(baseLv / 4);
  return statAtk + weaponAtk;
}

/** HIT (accuracy). */
export function hit(baseLv: number, dex: number): number {
  return 175 + baseLv + dex;
}

/** FLEE (evasion). */
export function flee(baseLv: number, agi: number): number {
  return 100 + baseLv + agi;
}

/** Simplified defense: armor DEF plus a small Vit contribution. */
export function defense(vit: number, armorDef = 0): number {
  return armorDef + Math.floor(vit / 2);
}

/** Player attack interval in ms (lower Agi/Dex => slower). Clamped. */
export function attackIntervalMs(agi: number, dex: number): number {
  return Math.max(300, Math.min(2000, 2000 - agi * 8 - dex * 2));
}
