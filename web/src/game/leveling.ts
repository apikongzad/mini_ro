// Experience / level-up logic driven by the extracted RO exp tables.

import type { ExpTable } from "@mini-ro/shared-types";

/** Exp required to advance FROM `level` to `level+1`. 0 if at/above cap. */
export function expToNext(table: ExpTable, level: number): number {
  if (level >= table.maxLevel) return 0;
  return table.exp[level - 1] ?? 0;
}

export interface LevelProgress {
  level: number;
  exp: number;
  /** how many levels were gained applying the exp */
  gained: number;
}

/**
 * Add `gain` exp to a (level, exp) pair, rolling over multiple levels as needed
 * and stopping at the table's max level (overflow exp is discarded at cap).
 */
export function addExp(
  table: ExpTable,
  level: number,
  exp: number,
  gain: number,
): LevelProgress {
  let lv = level;
  let cur = exp + gain;
  let gained = 0;
  while (lv < table.maxLevel) {
    const need = expToNext(table, lv);
    if (need <= 0 || cur < need) break;
    cur -= need;
    lv++;
    gained++;
  }
  if (lv >= table.maxLevel) cur = 0; // cap: no residual exp bar
  return { level: lv, exp: cur, gained };
}
