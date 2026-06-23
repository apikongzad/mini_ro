"use client";

import { useEffect, useRef, useState } from "react";
import { gameData, fieldMap } from "@mini-ro/data-gen";
import type { GameData } from "@mini-ro/shared-types";
import {
  createWorld, addPlayer, step,
  playerMoveTo, playerAttackMob, playerBash, playerUseItem,
  playerAddStat, playerLearnBash, playerChangeJob, playerRespawn,
  type World, type PlayerEntity,
} from "@/game/world";
import { cellDistance } from "@/game/combat";
import { startLoop } from "@/game/loop";
import { render, pixelToCell, CELL, type FloatingText } from "@/render/canvasRenderer";

const data = gameData as GameData;

interface Hud {
  baseLv: number; jobLv: number; jobName: string;
  hp: number; maxHp: number; sp: number; maxSp: number;
  baseExp: number; baseExpNext: number;
  jobExp: number; jobExpNext: number;
  statPoints: number; skillPoints: number; bashLv: number;
  stats: PlayerEntity["stats"];
  inventory: { id: number; name: string; qty: number; usable: boolean }[];
  dead: boolean;
  canChangeJob: boolean;
}

export default function GameClient({ name }: { name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const floatsRef = useRef<FloatingText[]>([]);
  const uid = "local";
  const [hud, setHud] = useState<Hud | null>(null);
  const [log, setLog] = useState<string[]>([]);

  function expNext(p: PlayerEntity, kind: "base" | "job"): number {
    const job = data.jobs[p.jobId];
    if (!job) return 0;
    const table = kind === "base" ? data.exp.base[job.baseExpGroup] : data.exp.job[job.jobExpGroup];
    if (!table) return 0;
    const lv = kind === "base" ? p.baseLv : p.jobLv;
    return table.exp[lv - 1] ?? 0;
  }

  function refreshHud() {
    const w = worldRef.current; if (!w) return;
    const p = w.players.get(uid); if (!p) return;
    const inv = Object.entries(p.inventory).map(([id, qty]) => {
      const item = data.items[Number(id)];
      return { id: Number(id), name: item?.name ?? `#${id}`, qty, usable: !!item?.effect };
    });
    setHud({
      baseLv: p.baseLv, jobLv: p.jobLv, jobName: data.jobs[p.jobId]?.name ?? "?",
      hp: Math.ceil(p.hp), maxHp: p.maxHp, sp: Math.ceil(p.sp), maxSp: p.maxSp,
      baseExp: p.baseExp, baseExpNext: expNext(p, "base"),
      jobExp: p.jobExp, jobExpNext: expNext(p, "job"),
      statPoints: p.statPoints, skillPoints: p.skillPoints, bashLv: p.bashLv,
      stats: { ...p.stats },
      inventory: inv,
      dead: p.state === "dead",
      canChangeJob: p.jobId === 0 && p.jobLv >= 10,
    });
  }

  function pushLog(msg: string) {
    setLog((l) => [msg, ...l].slice(0, 6));
  }

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const world = createWorld(data, fieldMap, (Date.now() & 0xffff) || 1);
    worldRef.current = world;
    addPlayer(world, uid, name, 0);
    refreshHud();

    const loop = startLoop(
      (dt) => {
        const events = step(world, dt);
        const now = performance.now();
        for (const e of events) {
          if (e.type === "damage") {
            floatsRef.current.push({
              x: e.x, y: e.y, text: String(e.amount),
              color: e.onPlayer ? "#ff6b6b" : "#ffe066", born: now, ttl: 700,
            });
          } else if (e.type === "miss") {
            floatsRef.current.push({ x: e.x, y: e.y, text: "miss", color: "#aaa", born: now, ttl: 600 });
          } else if (e.type === "levelUp") {
            pushLog(`⬆️ ${e.kind === "base" ? "Base" : "Job"} Level ${e.level}!`);
          } else if (e.type === "pickup") {
            pushLog(`＋ ${data.items[e.itemId]?.name ?? e.itemId} x${e.qty}`);
          } else if (e.type === "mobDeath") {
            floatsRef.current.push({ x: e.x, y: e.y, text: "💀", color: "#fff", born: now, ttl: 500 });
          } else if (e.type === "playerDeath" && e.uid === uid) {
            pushLog("You died. Click Respawn.");
          }
        }
        floatsRef.current = floatsRef.current.filter((f) => now - f.born < f.ttl);
      },
      () => {
        render(ctx, world, uid, floatsRef.current, performance.now());
      },
    );

    const hudTimer = setInterval(refreshHud, 200);

    const onClick = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cell = pixelToCell(ctx, world, uid, ev.clientX - rect.left, ev.clientY - rect.top);
      // attack if a live mob is on/near the clicked cell, else move
      let targetId: string | null = null;
      for (const [id, m] of world.mobs) {
        if (m.state !== "dead" && cellDistance(m.x, m.y, cell.x, cell.y) === 0) { targetId = id; break; }
      }
      if (targetId) playerAttackMob(world, uid, targetId);
      else playerMoveTo(world, uid, cell);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "1") playerBash(world, uid);
      if (ev.key === "2") { if (playerUseItem(world, uid, 501)) refreshHud(); }
    };
    canvas.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);

    return () => {
      loop.stop();
      clearInterval(hudTimer);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const act = (fn: () => void) => { fn(); refreshHud(); };

  return (
    <div className="game">
      <canvas ref={canvasRef} width={672} height={504} className="board" />
      <aside className="hud">
        {hud && (
          <>
            <div className="row title">{name} — {hud.jobName}</div>
            <div className="row">Base Lv {hud.baseLv} &nbsp; Job Lv {hud.jobLv}</div>
            <Bar label="HP" v={hud.hp} max={hud.maxHp} color="#5dd55d" />
            <Bar label="SP" v={hud.sp} max={hud.maxSp} color="#5d9dd5" />
            <Bar label="EXP" v={hud.baseExp} max={hud.baseExpNext || hud.baseExp} color="#d5c45d" />
            <Bar label="JEXP" v={hud.jobExp} max={hud.jobExpNext || hud.jobExp} color="#c45dd5" />

            <div className="row sub">Stats (pts: {hud.statPoints})</div>
            <div className="stats">
              {(["str", "agi", "vit", "int", "dex", "luk"] as const).map((s) => (
                <button key={s} disabled={hud.statPoints <= 0}
                  onClick={() => act(() => playerAddStat(worldRef.current!, uid, s))}>
                  {s.toUpperCase()} {hud.stats[s]} +
                </button>
              ))}
            </div>

            {hud.jobName === "Swordsman" && (
              <div className="row">
                <button disabled={hud.skillPoints <= 0}
                  onClick={() => act(() => playerLearnBash(worldRef.current!, uid))}>
                  Learn/Up Bash (Lv {hud.bashLv}) — pts {hud.skillPoints}
                </button>
              </div>
            )}
            {hud.canChangeJob && (
              <div className="row">
                <button onClick={() => act(() => playerChangeJob(worldRef.current!, uid, 1))}>
                  ⚔️ Change job → Swordsman
                </button>
              </div>
            )}

            <div className="row sub">Inventory</div>
            <div className="inv">
              {hud.inventory.map((it) => (
                <button key={it.id} disabled={!it.usable}
                  onClick={() => act(() => playerUseItem(worldRef.current!, uid, it.id))}>
                  {it.name} ×{it.qty}{it.usable ? " (use)" : ""}
                </button>
              ))}
            </div>

            {hud.dead && (
              <button className="respawn" onClick={() => act(() => playerRespawn(worldRef.current!, uid))}>
                Respawn
              </button>
            )}

            <div className="help">
              Click ground to move • Click a monster to attack • <b>1</b> Bash • <b>2</b> Red Potion
            </div>
            <div className="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
          </>
        )}
      </aside>
    </div>
  );
}

function Bar({ label, v, max, color }: { label: string; v: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
  return (
    <div className="bar">
      <span className="barlabel">{label}</span>
      <span className="bartrack"><span className="barfill" style={{ width: `${pct}%`, background: color }} /></span>
      <span className="barval">{Math.floor(v)}/{max}</span>
    </div>
  );
}
