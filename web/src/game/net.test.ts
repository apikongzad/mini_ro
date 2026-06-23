import { describe, it, expect } from "vitest";
import type { GameData } from "@mini-ro/shared-types";
import { gameData } from "@mini-ro/data-gen";
import {
  createWorld, addPlayer, configureNet, step, drainOutbox,
  playerAttackMob, type World, type MobEntity,
} from "./world";

const data = gameData as GameData;

function openMap(n = 10) {
  return { width: n, height: n, cells: Array.from({ length: n * n }, () => 0) };
}

function placeMob(world: World, instId: string, mobId: number, x: number, y: number): MobEntity {
  const hp = data.mobs[mobId]!.hp;
  const m: MobEntity = {
    instId, mobId, x, y, hp, maxHp: hp, state: "idle", path: [],
    moveReadyAt: 0, attackReadyAt: 0, respawnAt: null, spawnIdx: 0,
    lastAttackerUid: null, wanderAt: 1e9,
  };
  world.mobs.set(instId, m);
  return m;
}

describe("networked host-authority routing", () => {
  it("a client's attack does NOT mutate its local mob HP — it emits a hitMob intent", () => {
    const world = createWorld(data, openMap(), 1);
    world.mobs.clear();
    const me = addPlayer(world, "c", "Client", 0);
    configureNet(world, "client", "c");
    me.stats.str = 99; me.stats.dex = 99; me.weaponId = 1201;
    const m = placeMob(world, "m1", 1002, me.x + 1, me.y);
    playerAttackMob(world, "c", "m1");

    step(world, 100);
    expect(m.hp).toBe(m.maxHp); // client never reduces mob HP locally
    const out = drainOutbox(world);
    expect(out.some((i) => i.kind === "hitMob" && i.srcUid === "c")).toBe(true);
  });

  it("the host applies inbound hitMob intents exactly once (no double damage)", () => {
    const world = createWorld(data, openMap(), 2);
    world.mobs.clear();
    addPlayer(world, "h", "Host", 0);
    configureNet(world, "host", "h");
    const m = placeMob(world, "m1", 1002, 99, 99); // far from host so it won't be auto-attacked
    const before = m.hp;
    world.inbox.push({ kind: "hitMob", srcUid: "other", mobInstId: "m1", dmg: 10 });
    step(world, 100);
    expect(m.hp).toBe(before - 10);
    expect(world.inbox.length).toBe(0); // consumed
  });

  it("a client applies its own expGrant intent and levels via the real tables", () => {
    const world = createWorld(data, openMap(), 3);
    const me = addPlayer(world, "c", "Client", 0);
    configureNet(world, "client", "c");
    const before = me.baseExp + (me.baseLv - 1) * 100000;
    world.inbox.push({ kind: "expGrant", dstUid: "c", base: 500, job: 200 });
    step(world, 100);
    expect(me.baseExp + (me.baseLv - 1) * 100000).toBeGreaterThan(before);
  });

  it("host emits an expGrant to a remote killer instead of crediting locally", () => {
    const world = createWorld(data, openMap(), 4);
    world.mobs.clear();
    addPlayer(world, "h", "Host", 0);
    configureNet(world, "host", "h");
    const m = placeMob(world, "m1", 1002, 99, 99);
    // a remote client's hit kills the mob
    world.inbox.push({ kind: "hitMob", srcUid: "remote", mobInstId: "m1", dmg: m.maxHp + 50 });
    step(world, 100);
    const out = drainOutbox(world);
    expect(out.some((i) => i.kind === "expGrant" && i.dstUid === "remote")).toBe(true);
  });
});
