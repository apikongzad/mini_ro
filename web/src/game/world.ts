// The authoritative single-player simulation. Pure logic over a logical clock
// (`world.now` in ms) so it can be stepped deterministically in tests and, in
// Phase 2, driven by one host client and mirrored over Firebase.

import type {
  GameData, MobDef, Stats,
} from "@mini-ro/shared-types";
import { makeRng, type Rng } from "./rng";
import * as S from "./stats";
import { resolveAttack, bashDamage, cellDistance } from "./combat";
import { addExp } from "./leveling";
import {
  findPath, isWalkable, randomWalkable, type GridMap, type Cell,
} from "./movement";

const PLAYER_MOVE_MS = 180;        // ms per cell for players
const PICKUP_RANGE = 0;            // cells (0 = same cell)
const GROUND_TTL_MS = 30_000;
const RESPAWN_MS = 12_000;
const PLAYER_RESPAWN_MS = 3_000;
const BASH_SP_LV1 = 8;

export interface MobEntity {
  instId: string;
  mobId: number;
  x: number; y: number;
  hp: number; maxHp: number;
  state: "idle" | "chase" | "dead";
  path: Cell[];
  moveReadyAt: number;
  attackReadyAt: number;
  respawnAt: number | null;
  spawnIdx: number;
  lastAttackerUid: string | null;
  wanderAt: number;
}

export interface PlayerEntity {
  uid: string; name: string; jobId: number;
  x: number; y: number;
  baseLv: number; jobLv: number; baseExp: number; jobExp: number;
  hp: number; maxHp: number; sp: number; maxSp: number;
  stats: Stats; statPoints: number; skillPoints: number;
  bashLv: number;
  weaponId: number | null; weaponAtk: number;
  inventory: Record<number, number>;
  state: "alive" | "dead";
  path: Cell[];
  moveReadyAt: number;
  attackReadyAt: number;
  target: string | null;       // mob instId
  intent: "idle" | "move" | "attack";
  respawnReadyAt: number | null;
}

export type GameEvent =
  | { type: "damage"; x: number; y: number; amount: number; onPlayer: boolean }
  | { type: "miss"; x: number; y: number; onPlayer: boolean }
  | { type: "mobDeath"; instId: string; mobId: number; x: number; y: number }
  | { type: "expGain"; uid: string; base: number; job: number }
  | { type: "levelUp"; uid: string; kind: "base" | "job"; level: number }
  | { type: "drop"; itemId: number; x: number; y: number }
  | { type: "pickup"; uid: string; itemId: number; qty: number }
  | { type: "playerDeath"; uid: string }
  | { type: "heal"; uid: string; hp: number; sp: number };

export interface GroundDrop {
  id: string; itemId: number; qty: number; x: number; y: number; expireAt: number;
}

/**
 * Network role. `solo` = local single-player authority (Phase 1 behaviour).
 * `host` = this client owns mob simulation for the room. `client` = mobs/remote
 * players are read-only snapshots; only the local player is simulated here.
 */
export type Role = "solo" | "host" | "client";

/**
 * Cross-client intents exchanged via the net layer. The engine fills `outbox`
 * and consumes `inbox`; the net layer (web/src/net) does the transport. Keeping
 * Firebase out of the engine preserves headless testability.
 */
export type NetIntent =
  | { kind: "hitMob"; srcUid: string; mobInstId: string; dmg: number }
  | { kind: "hitPlayer"; dstUid: string; dmg: number }
  | { kind: "expGrant"; dstUid: string; base: number; job: number };

export interface World {
  data: GameData;
  map: GridMap;
  now: number;
  players: Map<string, PlayerEntity>;
  mobs: Map<string, MobEntity>;
  ground: GroundDrop[];
  rng: Rng;
  events: GameEvent[];
  townSpawn: Cell;
  private_seq: number;
  role: Role;
  localUid: string | null;
  outbox: NetIntent[];
  inbox: NetIntent[];
}

export function createWorld(data: GameData, map: GridMap, seed = 12345): World {
  const rng = makeRng(seed);
  const world: World = {
    data, map, now: 0,
    players: new Map(), mobs: new Map(), ground: [],
    rng, events: [],
    townSpawn: randomWalkable(map, rng.next),
    private_seq: 0,
    role: "solo", localUid: null,
    outbox: [], inbox: [],
  };
  spawnAllMobs(world);
  return world;
}

/** Switch the world into a networked role (called by the net layer on join). */
export function configureNet(world: World, role: Role, localUid: string): void {
  world.role = role;
  world.localUid = localUid;
}

function uid(world: World, prefix: string): string {
  world.private_seq += 1;
  return `${prefix}${world.private_seq}`;
}

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------
function spawnAllMobs(world: World): void {
  world.data.spawns.forEach((spawn, idx) => {
    for (let i = 0; i < spawn.count; i++) spawnMob(world, spawn.mobId, idx);
  });
}

function spawnMob(world: World, mobId: number, spawnIdx: number): void {
  const def = world.data.mobs[mobId];
  if (!def) return;
  const cell = randomWalkable(world.map, world.rng.next);
  const instId = uid(world, "m");
  world.mobs.set(instId, {
    instId, mobId, x: cell.x, y: cell.y,
    hp: def.hp, maxHp: def.hp,
    state: "idle", path: [],
    moveReadyAt: 0, attackReadyAt: 0,
    respawnAt: null, spawnIdx,
    lastAttackerUid: null,
    wanderAt: world.now + world.rng.int(1000, 4000),
  });
}

function mobDef(world: World, m: MobEntity): MobDef {
  return world.data.mobs[m.mobId]!;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
export function addPlayer(
  world: World, playerUid: string, name: string, jobId = 0,
): PlayerEntity {
  const stats: Stats = { str: 9, agi: 9, vit: 9, int: 9, dex: 9, luk: 9 };
  const p: PlayerEntity = {
    uid: playerUid, name, jobId,
    x: world.townSpawn.x, y: world.townSpawn.y,
    baseLv: 1, jobLv: 1, baseExp: 0, jobExp: 0,
    hp: 1, maxHp: 1, sp: 1, maxSp: 1,
    stats, statPoints: 0, skillPoints: 0,
    bashLv: 0,
    weaponId: null, weaponAtk: 0,
    inventory: { 501: 10 }, // start with a few Red Potions
    state: "alive", path: [],
    moveReadyAt: 0, attackReadyAt: 0,
    target: null, intent: "idle", respawnReadyAt: null,
  };
  recomputeDerived(world, p);
  p.hp = p.maxHp; p.sp = p.maxSp;
  world.players.set(playerUid, p);
  return p;
}

export function recomputeDerived(world: World, p: PlayerEntity): void {
  const job = world.data.jobs[p.jobId] ?? Object.values(world.data.jobs)[0]!;
  p.maxHp = S.maxHp(job, p.baseLv, p.stats.vit);
  p.maxSp = S.maxSp(job, p.baseLv, p.stats.int);
  p.weaponAtk = p.weaponId ? world.data.items[p.weaponId]?.atk ?? 0 : 0;
  if (p.hp > p.maxHp) p.hp = p.maxHp;
  if (p.sp > p.maxSp) p.sp = p.maxSp;
}

function playerAtk(world: World, p: PlayerEntity): number {
  return S.atk(p.stats, p.weaponAtk, p.baseLv);
}

// ----- player intents (called by input / network) -----
export function playerMoveTo(world: World, playerUid: string, cell: Cell): void {
  const p = world.players.get(playerUid);
  if (!p || p.state !== "alive") return;
  p.target = null;
  p.intent = "move";
  p.path = findPath(world.map, { x: p.x, y: p.y }, cell);
}

export function playerAttackMob(world: World, playerUid: string, mobInstId: string): void {
  const p = world.players.get(playerUid);
  const m = world.mobs.get(mobInstId);
  if (!p || !m || p.state !== "alive" || m.state === "dead") return;
  p.target = mobInstId;
  p.intent = "attack";
}

export function playerBash(world: World, playerUid: string): boolean {
  const p = world.players.get(playerUid);
  if (!p || p.state !== "alive" || p.bashLv <= 0 || !p.target) return false;
  const m = world.mobs.get(p.target);
  if (!m || m.state === "dead") return false;
  if (p.sp < BASH_SP_LV1) return false;
  if (cellDistance(p.x, p.y, m.x, m.y) > 1) return false;
  if (world.now < p.attackReadyAt) return false;
  p.sp -= BASH_SP_LV1;
  const dmg = bashDamage(playerAtk(world, p), mobDef(world, m).def, p.bashLv, world.rng);
  dealMobDamage(world, p.uid, m, dmg);
  p.attackReadyAt = world.now + S.attackIntervalMs(p.stats.agi, p.stats.dex);
  return true;
}

export function playerUseItem(world: World, playerUid: string, itemId: number): boolean {
  const p = world.players.get(playerUid);
  if (!p || p.state !== "alive") return false;
  if ((p.inventory[itemId] ?? 0) <= 0) return false;
  const item = world.data.items[itemId];
  const eff = item?.effect;
  if (!eff) return false;
  if (eff.kind === "heal") {
    const amt = world.rng.int(eff.min ?? 0, eff.max ?? 0);
    p.hp = Math.min(p.maxHp, p.hp + amt);
    world.events.push({ type: "heal", uid: p.uid, hp: amt, sp: 0 });
  } else if (eff.kind === "healSp") {
    const amt = world.rng.int(eff.min ?? 0, eff.max ?? 0);
    p.sp = Math.min(p.maxSp, p.sp + amt);
    world.events.push({ type: "heal", uid: p.uid, hp: 0, sp: amt });
  } else {
    return false;
  }
  consumeItem(p, itemId, 1);
  return true;
}

export function playerAddStat(world: World, playerUid: string, stat: keyof Stats): boolean {
  const p = world.players.get(playerUid);
  if (!p || p.statPoints <= 0 || p.stats[stat] >= 99) return false;
  p.stats[stat] += 1;
  p.statPoints -= 1;
  recomputeDerived(world, p);
  return true;
}

export function playerLearnBash(world: World, playerUid: string): boolean {
  const p = world.players.get(playerUid);
  if (!p || p.jobId !== 1 || p.skillPoints <= 0 || p.bashLv >= 10) return false;
  p.bashLv += 1;
  p.skillPoints -= 1;
  return true;
}

export function playerChangeJob(world: World, playerUid: string, jobId: number): boolean {
  const p = world.players.get(playerUid);
  if (!p) return false;
  // Novice -> Swordsman once job level 10 is reached.
  if (p.jobId !== 0 || jobId !== 1 || p.jobLv < 10) return false;
  p.jobId = 1;
  p.jobLv = 1; p.jobExp = 0;
  recomputeDerived(world, p);
  p.hp = p.maxHp; p.sp = p.maxSp;
  return true;
}

export function playerRespawn(world: World, playerUid: string): void {
  const p = world.players.get(playerUid);
  if (!p || p.state !== "dead") return;
  if (p.respawnReadyAt !== null && world.now < p.respawnReadyAt) return;
  p.state = "alive";
  p.x = world.townSpawn.x; p.y = world.townSpawn.y;
  p.hp = Math.max(1, Math.floor(p.maxHp / 2));
  p.sp = Math.max(1, Math.floor(p.maxSp / 2));
  p.path = []; p.target = null; p.intent = "idle";
  p.respawnReadyAt = null;
}

function consumeItem(p: PlayerEntity, itemId: number, qty: number): void {
  const left = (p.inventory[itemId] ?? 0) - qty;
  if (left > 0) p.inventory[itemId] = left;
  else delete p.inventory[itemId];
}

// ---------------------------------------------------------------------------
// Damage / death
// ---------------------------------------------------------------------------

/**
 * Route a player's hit on a mob. Solo/host apply it directly (host is the single
 * writer of mob HP, so there is no double-damage). A client instead emits an
 * intent for the host to apply.
 */
function dealMobDamage(world: World, attackerUid: string, m: MobEntity, dmg: number): void {
  if (world.role === "client") {
    world.outbox.push({ kind: "hitMob", srcUid: attackerUid, mobInstId: m.instId, dmg });
  } else {
    applyDamageToMob(world, m, dmg, attackerUid);
  }
}

function applyDamageToMob(world: World, m: MobEntity, dmg: number, attackerUid: string): void {
  m.hp -= dmg;
  m.lastAttackerUid = attackerUid;
  if (m.state === "idle") m.state = "chase";
  world.events.push({ type: "damage", x: m.x, y: m.y, amount: dmg, onPlayer: false });
  if (m.hp <= 0) killMob(world, m);
}

function killMob(world: World, m: MobEntity): void {
  m.hp = 0;
  m.state = "dead";
  m.path = [];
  m.respawnAt = world.now + RESPAWN_MS;
  world.events.push({ type: "mobDeath", instId: m.instId, mobId: m.mobId, x: m.x, y: m.y });

  const def = mobDef(world, m);
  // drops
  for (const d of def.drops) {
    if (world.rng.chance(d.rate / 10000)) {
      world.ground.push({
        id: uid(world, "g"), itemId: d.item, qty: 1,
        x: m.x, y: m.y, expireAt: world.now + GROUND_TTL_MS,
      });
      world.events.push({ type: "drop", itemId: d.item, x: m.x, y: m.y });
    }
  }
  // exp to the killer
  const killerUid = m.lastAttackerUid;
  if (!killerUid) return;
  if (world.role === "solo" || killerUid === world.localUid) {
    const killer = world.players.get(killerUid);
    if (killer) grantExp(world, killer, def.exp, def.jexp);
  } else {
    // host -> remote killer: deliver exp so that client applies it to its own player
    world.outbox.push({ kind: "expGrant", dstUid: killerUid, base: def.exp, job: def.jexp });
  }
}

function grantExp(world: World, p: PlayerEntity, baseGain: number, jobGain: number): void {
  world.events.push({ type: "expGain", uid: p.uid, base: baseGain, job: jobGain });
  const job = world.data.jobs[p.jobId];
  if (!job) return;
  const baseTable = world.data.exp.base[job.baseExpGroup];
  const jobTable = world.data.exp.job[job.jobExpGroup];

  if (baseTable) {
    const r = addExp(baseTable, p.baseLv, p.baseExp, baseGain);
    if (r.gained > 0) {
      p.baseLv = r.level; p.statPoints += r.gained * 3;
      recomputeDerived(world, p);
      p.hp = p.maxHp; p.sp = p.maxSp;
      world.events.push({ type: "levelUp", uid: p.uid, kind: "base", level: p.baseLv });
    }
    p.baseExp = r.exp;
  }
  if (jobTable) {
    const r = addExp(jobTable, p.jobLv, p.jobExp, jobGain);
    if (r.gained > 0) {
      p.jobLv = r.level; p.skillPoints += r.gained;
      world.events.push({ type: "levelUp", uid: p.uid, kind: "job", level: p.jobLv });
    }
    p.jobExp = r.exp;
  }
}

function applyDamageToPlayer(world: World, p: PlayerEntity, dmg: number): void {
  p.hp -= dmg;
  world.events.push({ type: "damage", x: p.x, y: p.y, amount: dmg, onPlayer: true });
  if (p.hp <= 0) {
    p.hp = 0; p.state = "dead";
    p.path = []; p.target = null; p.intent = "idle";
    p.respawnReadyAt = world.now + PLAYER_RESPAWN_MS;
    world.events.push({ type: "playerDeath", uid: p.uid });
  }
}

// ---------------------------------------------------------------------------
// Simulation step
// ---------------------------------------------------------------------------
export function step(world: World, dtMs: number): GameEvent[] {
  world.now += dtMs;
  world.events = [];

  processInbox(world);

  // Host & solo simulate mobs; clients render mob snapshots from the net layer.
  if (world.role !== "client") {
    for (const m of world.mobs.values()) stepMob(world, m);
  }

  // Solo steps every player; networked roles only simulate the local player
  // (remote players own themselves and arrive as snapshots).
  if (world.role === "solo") {
    for (const p of world.players.values()) stepPlayer(world, p);
  } else if (world.localUid) {
    const me = world.players.get(world.localUid);
    if (me) stepPlayer(world, me);
  }

  // expire ground items
  world.ground = world.ground.filter((g) => g.expireAt > world.now);

  return world.events;
}

/** Apply intents delivered by the net layer, routed by the local role. */
function processInbox(world: World): void {
  if (world.inbox.length === 0) return;
  const me = world.localUid ? world.players.get(world.localUid) : null;
  for (const it of world.inbox) {
    if (it.kind === "hitMob") {
      // only the host owns mob HP
      if (world.role !== "host") continue;
      const m = world.mobs.get(it.mobInstId);
      if (m && m.state !== "dead") applyDamageToMob(world, m, it.dmg, it.srcUid);
    } else if (it.kind === "hitPlayer") {
      if (me && it.dstUid === world.localUid && me.state === "alive") {
        applyDamageToPlayer(world, me, it.dmg);
      }
    } else if (it.kind === "expGrant") {
      if (me && it.dstUid === world.localUid) grantExp(world, me, it.base, it.job);
    }
  }
  world.inbox.length = 0;
}

/** Drain queued outbound intents (called by the net layer each tick). */
export function drainOutbox(world: World): NetIntent[] {
  if (world.outbox.length === 0) return [];
  const out = world.outbox.slice();
  world.outbox.length = 0;
  return out;
}

/** Add an item to a player's inventory (used by net-layer ground pickups). */
export function addToInventory(world: World, playerUid: string, itemId: number, qty: number): void {
  const p = world.players.get(playerUid);
  if (!p) return;
  p.inventory[itemId] = (p.inventory[itemId] ?? 0) + qty;
  world.events.push({ type: "pickup", uid: playerUid, itemId, qty });
}

function nearestPlayer(world: World, m: MobEntity, range: number): PlayerEntity | null {
  let best: PlayerEntity | null = null;
  let bestD = range + 1;
  for (const p of world.players.values()) {
    if (p.state !== "alive") continue;
    const d = cellDistance(m.x, m.y, p.x, p.y);
    if (d <= range && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

function stepMob(world: World, m: MobEntity): void {
  const def = mobDef(world, m);

  if (m.state === "dead") {
    if (m.respawnAt !== null && world.now >= m.respawnAt) {
      const cell = randomWalkable(world.map, world.rng.next);
      m.x = cell.x; m.y = cell.y;
      m.hp = m.maxHp; m.state = "idle";
      m.respawnAt = null; m.lastAttackerUid = null;
      m.attackReadyAt = 0; m.moveReadyAt = 0;
      m.wanderAt = world.now + world.rng.int(1000, 4000);
    }
    return;
  }

  // acquire / keep a target
  let target = m.state === "chase" && m.lastAttackerUid
    ? world.players.get(m.lastAttackerUid) ?? null
    : null;
  if (!target && def.viewRange > 0) target = nearestPlayer(world, m, def.viewRange);
  if (target && target.state !== "alive") target = null;

  if (!target) {
    m.state = "idle";
    // idle wander
    if (world.now >= m.wanderAt && world.now >= m.moveReadyAt) {
      const nx = m.x + world.rng.int(-1, 1);
      const ny = m.y + world.rng.int(-1, 1);
      if (isWalkable(world.map, nx, ny)) { m.x = nx; m.y = ny; }
      m.moveReadyAt = world.now + def.moveSpeed;
      m.wanderAt = world.now + world.rng.int(2000, 6000);
    }
    return;
  }

  m.state = "chase";
  const dist = cellDistance(m.x, m.y, target.x, target.y);
  if (dist <= def.atkRange) {
    // attack on cooldown
    if (world.now >= m.attackReadyAt) {
      const res = resolveAttack(
        def.atk,
        S.hit(def.lv, def.stats.dex),
        S.defense(target.stats.vit),
        S.flee(target.baseLv, target.stats.agi),
        world.rng,
      );
      if (res.hit) {
        if (world.role === "solo" || target.uid === world.localUid) {
          applyDamageToPlayer(world, target, res.damage);
        } else {
          // host -> remote player: that client applies the damage to its own HP
          world.outbox.push({ kind: "hitPlayer", dstUid: target.uid, dmg: res.damage });
        }
      } else {
        world.events.push({ type: "miss", x: target.x, y: target.y, onPlayer: true });
      }
      m.attackReadyAt = world.now + def.aspd;
    }
  } else if (world.now >= m.moveReadyAt) {
    // step toward target
    const path = findPath(world.map, { x: m.x, y: m.y }, { x: target.x, y: target.y });
    const next = path[0];
    if (next) { m.x = next.x; m.y = next.y; }
    m.moveReadyAt = world.now + def.moveSpeed;
  }
}

function stepPlayer(world: World, p: PlayerEntity): void {
  if (p.state !== "alive") return;

  // follow + attack a targeted mob
  if (p.intent === "attack" && p.target) {
    const m = world.mobs.get(p.target);
    if (!m || m.state === "dead") {
      p.target = null; p.intent = "idle"; p.path = [];
    } else {
      const dist = cellDistance(p.x, p.y, m.x, m.y);
      const range = Math.max(1, p.weaponId ? (world.data.items[p.weaponId] ? 1 : 1) : 1);
      if (dist <= range) {
        p.path = [];
        if (world.now >= p.attackReadyAt) {
          const res = resolveAttack(
            playerAtk(world, p),
            S.hit(p.baseLv, p.stats.dex),
            mobDef(world, m).def,
            S.flee(mobDef(world, m).lv, mobDef(world, m).stats.agi),
            world.rng,
          );
          if (res.hit) dealMobDamage(world, p.uid, m, res.damage);
          else world.events.push({ type: "miss", x: m.x, y: m.y, onPlayer: false });
          p.attackReadyAt = world.now + S.attackIntervalMs(p.stats.agi, p.stats.dex);
        }
      } else if (world.now >= p.moveReadyAt) {
        p.path = findPath(world.map, { x: p.x, y: p.y }, { x: m.x, y: m.y });
        const next = p.path[0];
        if (next && cellDistance(next.x, next.y, m.x, m.y) >= 0) {
          p.x = next.x; p.y = next.y;
          p.moveReadyAt = world.now + PLAYER_MOVE_MS;
        }
      }
    }
  } else if (p.intent === "move" && p.path.length && world.now >= p.moveReadyAt) {
    const next = p.path.shift()!;
    p.x = next.x; p.y = next.y;
    p.moveReadyAt = world.now + PLAYER_MOVE_MS;
    if (p.path.length === 0) p.intent = "idle";
  }

  // auto-pickup ground items on/near the player. In networked rooms the net
  // layer claims ground via an RTDB transaction (avoids double-pickup races),
  // so the engine only auto-picks in solo mode.
  if (world.role === "solo") {
    for (let i = world.ground.length - 1; i >= 0; i--) {
      const g = world.ground[i]!;
      if (cellDistance(p.x, p.y, g.x, g.y) <= PICKUP_RANGE) {
        p.inventory[g.itemId] = (p.inventory[g.itemId] ?? 0) + g.qty;
        world.events.push({ type: "pickup", uid: p.uid, itemId: g.itemId, qty: g.qty });
        world.ground.splice(i, 1);
      }
    }
  }
}
