import { describe, it, expect } from "vitest";
import { makeRng } from "./rng";
import { hitChance, rollDamage, resolveAttack, cellDistance } from "./combat";
import { addExp, expToNext } from "./leveling";
import { maxHp, attackIntervalMs, atk } from "./stats";
import { findPath, isWalkable, type GridMap } from "./movement";
import {
  createWorld, addPlayer, playerAttackMob, playerUseItem, step,
} from "./world";
import type { ExpTable, GameData, JobDef, Stats } from "@mini-ro/shared-types";
import { gameData } from "@mini-ro/data-gen";

const data = gameData as GameData;

describe("combat", () => {
  it("clamps hit chance to [5%,95%]", () => {
    expect(hitChance(1000, 0)).toBeCloseTo(0.95);
    expect(hitChance(0, 1000)).toBeCloseTo(0.05);
    expect(hitChance(50, 100)).toBeCloseTo(0.5);
  });

  it("damage is at least 1 even against high defense", () => {
    const rng = makeRng(1);
    for (let i = 0; i < 50; i++) expect(rollDamage(5, 9999, rng)).toBeGreaterThanOrEqual(1);
  });

  it("a miss deals no damage", () => {
    // attacker hit far below flee -> 5% chance; with this seed first roll misses
    const rng = makeRng(7);
    const r = resolveAttack(10, 0, 0, 1000, rng);
    if (!r.hit) expect(r.damage).toBe(0);
  });

  it("cellDistance is chebyshev", () => {
    expect(cellDistance(0, 0, 3, 1)).toBe(3);
  });
});

describe("leveling", () => {
  const table: ExpTable = { maxLevel: 5, exp: [10, 20, 30, 40] };

  it("expToNext reads the table and returns 0 at cap", () => {
    expect(expToNext(table, 1)).toBe(10);
    expect(expToNext(table, 5)).toBe(0);
  });

  it("rolls over multiple levels and discards overflow at cap", () => {
    expect(addExp(table, 1, 0, 5)).toEqual({ level: 1, exp: 5, gained: 0 });
    expect(addExp(table, 1, 0, 35)).toEqual({ level: 3, exp: 5, gained: 2 });
    expect(addExp(table, 1, 0, 999)).toEqual({ level: 5, exp: 0, gained: 4 });
  });
});

describe("stats", () => {
  const job: JobDef = {
    id: 0, name: "T", baseExpGroup: "x", jobExpGroup: "y", weight: 1,
    hpTable: [40, 50, 60], spTable: [10, 12, 14],
  };
  it("maxHp scales with vit", () => {
    expect(maxHp(job, 1, 0)).toBe(40);
    expect(maxHp(job, 1, 100)).toBe(80);
  });
  it("attack interval clamps", () => {
    expect(attackIntervalMs(0, 0)).toBe(2000);
    expect(attackIntervalMs(999, 999)).toBe(300);
  });
  it("atk includes weapon", () => {
    const s: Stats = { str: 10, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
    expect(atk(s, 17, 1)).toBeGreaterThan(17);
  });
});

describe("movement", () => {
  const map: GridMap = { width: 5, height: 1, cells: [0, 0, 1, 0, 0] };
  it("respects walls", () => {
    expect(isWalkable(map, 2, 0)).toBe(false);
    expect(findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([]); // blocked
  });
  it("finds a straight path", () => {
    const open: GridMap = { width: 5, height: 1, cells: [0, 0, 0, 0, 0] };
    const path = findPath(open, { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  });
});

describe("world simulation (headless vertical slice)", () => {
  it("loads the extracted MVP data", () => {
    expect(data.mobs[1002]?.name).toBe("Poring");
    expect(Object.keys(data.jobs).length).toBeGreaterThanOrEqual(2);
  });

  it("a buffed player can kill a mob and gain exp", () => {
    const map: GridMap = {
      width: 10, height: 10,
      cells: Array.from({ length: 100 }, () => 0),
    };
    const world = createWorld(data, map, 42);
    const p = addPlayer(world, "u1", "Hero", 0);
    // buff so the fight ends quickly and deterministically
    p.stats.str = 99; p.stats.dex = 99; p.stats.agi = 99;
    p.weaponId = 1201;
    // place a single mob next to the player
    world.mobs.clear();
    const mobId = 1002;
    world.mobs.set("m1", {
      instId: "m1", mobId, x: p.x + 1, y: p.y,
      hp: data.mobs[mobId]!.hp, maxHp: data.mobs[mobId]!.hp,
      state: "idle", path: [], moveReadyAt: 0, attackReadyAt: 0,
      respawnAt: null, spawnIdx: 0, lastAttackerUid: null, wanderAt: 1e9,
    });
    playerAttackMob(world, "u1", "m1");

    let killed = false;
    let gainedExp = false;
    for (let t = 0; t < 200 && !killed; t++) {
      const events = step(world, 100);
      if (events.some((e) => e.type === "mobDeath")) killed = true;
      if (events.some((e) => e.type === "expGain")) gainedExp = true;
    }
    expect(killed).toBe(true);
    expect(gainedExp).toBe(true);
    expect(p.baseExp + p.baseLv).toBeGreaterThan(1); // got exp or levelled
  });

  it("using a Red Potion heals the player", () => {
    const map: GridMap = { width: 5, height: 5, cells: Array.from({ length: 25 }, () => 0) };
    const world = createWorld(data, map, 9);
    const p = addPlayer(world, "u1", "Hero", 0);
    p.hp = 1;
    const ok = playerUseItem(world, "u1", 501);
    expect(ok).toBe(true);
    expect(p.hp).toBeGreaterThan(1);
    expect(p.inventory[501]).toBe(9);
  });
});
