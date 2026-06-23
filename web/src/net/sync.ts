// RTDB <-> engine bridge. The engine stays Firebase-free: this module reads
// snapshots into `world` and writes the local player (+ mobs/ground when host)
// out, throttled. Cross-client combat flows through `world.outbox`/`world.inbox`
// (see web/src/game/world.ts) and the `events` list.

import {
  ref, set, update, remove, onValue, onChildAdded, push,
  serverTimestamp, type Database, type Unsubscribe,
} from "firebase/database";
import {
  type World, type PlayerEntity, type MobEntity, type NetIntent,
  drainOutbox, addToInventory,
} from "@/game/world";
import { cellDistance } from "@/game/combat";

const PLAYER_WRITE_MS = 150;  // ~6-7 Hz
const MOB_WRITE_MS = 150;

interface PlayerSnap {
  name: string; jobId: number; x: number; y: number;
  baseLv: number; jobLv: number; hp: number; maxHp: number; sp: number; maxSp: number;
  state: "alive" | "dead";
  str: number; agi: number; vit: number; int: number; dex: number; luk: number;
}

function toPlayerSnap(p: PlayerEntity): PlayerSnap {
  return {
    name: p.name, jobId: p.jobId, x: p.x, y: p.y,
    baseLv: p.baseLv, jobLv: p.jobLv, hp: Math.ceil(p.hp), maxHp: p.maxHp,
    sp: Math.ceil(p.sp), maxSp: p.maxSp, state: p.state,
    str: p.stats.str, agi: p.stats.agi, vit: p.stats.vit,
    int: p.stats.int, dex: p.stats.dex, luk: p.stats.luk,
  };
}

function makeRemotePlayer(uid: string, s: PlayerSnap): PlayerEntity {
  return {
    uid, name: s.name, jobId: s.jobId, x: s.x, y: s.y,
    baseLv: s.baseLv, jobLv: s.jobLv, baseExp: 0, jobExp: 0,
    hp: s.hp, maxHp: s.maxHp, sp: s.sp, maxSp: s.maxSp,
    stats: { str: s.str, agi: s.agi, vit: s.vit, int: s.int, dex: s.dex, luk: s.luk },
    statPoints: 0, skillPoints: 0, bashLv: 0,
    weaponId: null, weaponAtk: 0, inventory: {},
    state: s.state, path: [], moveReadyAt: 0, attackReadyAt: 0,
    target: null, intent: "idle", respawnReadyAt: null,
  };
}

function mobSnap(m: MobEntity) {
  return { mobId: m.mobId, x: m.x, y: m.y, hp: Math.ceil(m.hp), maxHp: m.maxHp, state: m.state };
}

export class RoomSession {
  private unsubs: Unsubscribe[] = [];
  private lastPlayerWrite = 0;
  private lastMobWrite = 0;
  private claimingGround = new Set<string>();

  constructor(
    private db: Database,
    private code: string,
    private uid: string,
    private world: World,
  ) {}

  private path(p: string) { return ref(this.db, `rooms/${this.code}/${p}`); }

  /** Subscribe to room state and start feeding the world. */
  start(): void {
    // remote players -> world.players (never touch our own entity)
    this.unsubs.push(onValue(this.path("players"), (snap) => {
      const all = (snap.val() ?? {}) as Record<string, PlayerSnap>;
      for (const [uid, s] of Object.entries(all)) {
        if (uid === this.uid) continue;
        const existing = this.world.players.get(uid);
        if (existing) {
          Object.assign(existing, makeRemotePlayer(uid, s));
        } else {
          this.world.players.set(uid, makeRemotePlayer(uid, s));
        }
      }
      // drop players that left (present in world but not in snapshot, excl. self)
      for (const uid of [...this.world.players.keys()]) {
        if (uid !== this.uid && !all[uid]) this.world.players.delete(uid);
      }
    }));

    // mobs -> world.mobs (applied only when we are NOT the host/authority)
    this.unsubs.push(onValue(this.path("mobs"), (snap) => {
      if (this.world.role !== "client") return;
      const all = (snap.val() ?? {}) as Record<string, ReturnType<typeof mobSnap>>;
      const seen = new Set<string>();
      for (const [instId, s] of Object.entries(all)) {
        seen.add(instId);
        const m = this.world.mobs.get(instId);
        if (m) {
          m.x = s.x; m.y = s.y; m.hp = s.hp; m.maxHp = s.maxHp; m.state = s.state; m.mobId = s.mobId;
        } else {
          this.world.mobs.set(instId, {
            instId, mobId: s.mobId, x: s.x, y: s.y, hp: s.hp, maxHp: s.maxHp,
            state: s.state, path: [], moveReadyAt: 0, attackReadyAt: 0,
            respawnAt: null, spawnIdx: 0, lastAttackerUid: null, wanderAt: 0,
          });
        }
      }
      for (const id of [...this.world.mobs.keys()]) if (!seen.has(id)) this.world.mobs.delete(id);
    }));

    // ground -> world.ground (client mirrors; host owns)
    this.unsubs.push(onValue(this.path("ground"), (snap) => {
      if (this.world.role !== "client") return;
      const all = (snap.val() ?? {}) as Record<string, { itemId: number; qty: number; x: number; y: number; expireAt: number }>;
      this.world.ground = Object.entries(all).map(([id, g]) => ({ id, ...g }));
    }));

    // events -> world.inbox (each consumer removes only the events meant for it)
    this.unsubs.push(onChildAdded(this.path("events"), (snap) => {
      const it = snap.val() as (NetIntent & { ts?: number }) | null;
      if (!it) return;
      const mine =
        (it.kind === "hitMob" && this.world.role === "host") ||
        ((it.kind === "hitPlayer" || it.kind === "expGrant") && it.dstUid === this.uid);
      if (!mine) return;
      this.world.inbox.push(it);
      void remove(snap.ref);
    }));
  }

  /** Called every sim tick from the game loop: flush outbox + throttled writes. */
  sync(): void {
    // 1) outbound intents -> events
    for (const it of drainOutbox(this.world)) {
      void push(this.path("events"), { ...it, ts: serverTimestamp() });
    }

    const now = Date.now();

    // 2) local player state (throttled)
    const me = this.world.players.get(this.uid);
    if (me && now - this.lastPlayerWrite >= PLAYER_WRITE_MS) {
      this.lastPlayerWrite = now;
      void set(this.path(`players/${this.uid}`), toPlayerSnap(me));
    }

    // 3) host writes the authoritative mob + ground state (throttled, batched)
    if (this.world.role === "host" && now - this.lastMobWrite >= MOB_WRITE_MS) {
      this.lastMobWrite = now;
      const mobs: Record<string, ReturnType<typeof mobSnap>> = {};
      for (const m of this.world.mobs.values()) mobs[m.instId] = mobSnap(m);
      void set(this.path("mobs"), mobs);
      const ground: Record<string, object> = {};
      for (const g of this.world.ground) {
        ground[g.id] = { itemId: g.itemId, qty: g.qty, x: g.x, y: g.y, expireAt: g.expireAt };
      }
      void set(this.path("ground"), ground);
    }

    // 4) claim ground we are standing on (transaction-free first-write-wins via remove)
    if (me && me.state === "alive") {
      for (const g of this.world.ground) {
        if (cellDistance(me.x, me.y, g.x, g.y) === 0 && !this.claimingGround.has(g.id)) {
          this.claimingGround.add(g.id);
          this.claimGround(g.id, g.itemId, g.qty);
        }
      }
    }
  }

  private async claimGround(id: string, itemId: number, qty: number): Promise<void> {
    // Remove the node; if it already vanished someone else grabbed it first.
    const node = this.path(`ground/${id}`);
    try {
      const { runTransaction } = await import("firebase/database");
      const res = await runTransaction(node, (cur) => (cur === null ? undefined : null));
      if (res.committed && res.snapshot.val() === null) {
        addToInventory(this.world, this.uid, itemId, qty);
        void update(this.path(`inventory/${this.uid}`), { [itemId]: (this.world.players.get(this.uid)?.inventory[itemId] ?? qty) });
      }
    } catch {
      /* contended; ignore */
    } finally {
      this.claimingGround.delete(id);
    }
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
