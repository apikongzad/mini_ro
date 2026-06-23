// Simplified RO combat resolution. Pure functions over numbers + an Rng.

import type { Rng } from "./rng";

/** Chance to land a hit, as a probability in [0.05, 0.95]. */
export function hitChance(attackerHit: number, defenderFlee: number): number {
  const pct = attackerHit - defenderFlee + 100;
  return Math.max(5, Math.min(95, pct)) / 100;
}

/** Base weapon damage: (ATK - DEF) with ±10% variance, floored at 1. */
export function rollDamage(attackerAtk: number, defenderDef: number, rng: Rng): number {
  const base = Math.max(1, attackerAtk - defenderDef);
  const variance = 0.9 + rng.next() * 0.2;
  return Math.max(1, Math.floor(base * variance));
}

/** Bash: scales weapon damage by skill level (+50% per level beyond 1-ish). */
export function bashDamage(
  attackerAtk: number,
  defenderDef: number,
  skillLv: number,
  rng: Rng,
): number {
  const mult = 1 + 0.5 * skillLv;
  const base = Math.max(1, attackerAtk * mult - defenderDef);
  const variance = 0.9 + rng.next() * 0.2;
  return Math.max(1, Math.floor(base * variance));
}

export interface AttackResult {
  hit: boolean;
  damage: number;
}

/** Resolve a single auto-attack (miss => damage 0). */
export function resolveAttack(
  attackerAtk: number,
  attackerHit: number,
  defenderDef: number,
  defenderFlee: number,
  rng: Rng,
): AttackResult {
  if (!rng.chance(hitChance(attackerHit, defenderFlee))) {
    return { hit: false, damage: 0 };
  }
  return { hit: true, damage: rollDamage(attackerAtk, defenderDef, rng) };
}

/** Chebyshev (king-move) distance in grid cells. */
export function cellDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
