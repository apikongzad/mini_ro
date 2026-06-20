// Canvas2D renderer for the single-player slice. Deliberately placeholder art
// (colored shapes + emoji) — no RO sprites. The engine is renderer-agnostic, so
// this layer can later be swapped for PixiJS without touching game logic.

import type { World, MobEntity, PlayerEntity } from "@/game/world";

export const CELL = 28;

export interface FloatingText {
  x: number; y: number; text: string; color: string; born: number; ttl: number;
}

export interface Camera { x: number; y: number; }

const MOB_EMOJI: Record<number, string> = {
  1002: "🟣", // Poring
  1007: "🐛", // Fabre
  1063: "🐰", // Lunatic
};

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  localUid: string,
  floats: FloatingText[],
  now: number,
): void {
  const cv = ctx.canvas;
  const me = world.players.get(localUid);
  const cam: Camera = me ? { x: me.x, y: me.y } : { x: world.map.width / 2, y: world.map.height / 2 };

  const originX = cv.width / 2 - cam.x * CELL;
  const originY = cv.height / 2 - cam.y * CELL;
  const sx = (cx: number) => originX + cx * CELL;
  const sy = (cy: number) => originY + cy * CELL;

  ctx.fillStyle = "#11150f";
  ctx.fillRect(0, 0, cv.width, cv.height);

  // tiles
  for (let y = 0; y < world.map.height; y++) {
    for (let x = 0; x < world.map.width; x++) {
      const px = sx(x), py = sy(y);
      if (px < -CELL || py < -CELL || px > cv.width || py > cv.height) continue;
      const blocked = world.map.cells[y * world.map.width + x] === 1;
      ctx.fillStyle = blocked ? "#3a3326" : ((x + y) % 2 ? "#243018" : "#2a3a1d");
      ctx.fillRect(px, py, CELL - 1, CELL - 1);
    }
  }

  // ground items
  for (const g of world.ground) {
    ctx.fillStyle = "#ffd54a";
    ctx.beginPath();
    ctx.arc(sx(g.x) + CELL / 2, sy(g.y) + CELL / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // mobs
  for (const m of world.mobs.values()) {
    if (m.state === "dead") continue;
    drawMob(ctx, m, sx(m.x), sy(m.y), world);
  }

  // players
  for (const p of world.players.values()) {
    if (p.state !== "alive") continue;
    drawPlayer(ctx, p, sx(p.x), sy(p.y), p.uid === localUid);
  }

  // floating combat text
  for (const f of floats) {
    const age = (now - f.born) / f.ttl;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.fillStyle = f.color;
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(f.text, sx(f.x) + CELL / 2, sy(f.y) + CELL / 2 - age * 22);
    ctx.globalAlpha = 1;
  }
}

function drawMob(ctx: CanvasRenderingContext2D, m: MobEntity, px: number, py: number, world: World): void {
  const def = world.data.mobs[m.mobId];
  ctx.font = `${CELL - 6}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(MOB_EMOJI[m.mobId] ?? "👾", px + CELL / 2, py + CELL / 2);
  ctx.textBaseline = "alphabetic";
  // hp bar
  const ratio = Math.max(0, m.hp / m.maxHp);
  ctx.fillStyle = "#000";
  ctx.fillRect(px + 3, py - 4, CELL - 6, 3);
  ctx.fillStyle = ratio > 0.4 ? "#5dd55d" : "#d55d5d";
  ctx.fillRect(px + 3, py - 4, (CELL - 6) * ratio, 3);
  if (def) {
    ctx.fillStyle = "#cfcfcf";
    ctx.font = "9px monospace";
    ctx.fillText(def.name, px + CELL / 2, py + CELL + 8);
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: PlayerEntity, px: number, py: number, isLocal: boolean): void {
  ctx.beginPath();
  ctx.arc(px + CELL / 2, py + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = isLocal ? "#4aa3ff" : "#ff8c4a";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText(p.name, px + CELL / 2, py - 6);
}

/** Convert a canvas pixel to a world cell, given the local player's camera. */
export function pixelToCell(
  ctx: CanvasRenderingContext2D, world: World, localUid: string, mx: number, my: number,
): { x: number; y: number } {
  const cv = ctx.canvas;
  const me = world.players.get(localUid);
  const cam = me ? { x: me.x, y: me.y } : { x: world.map.width / 2, y: world.map.height / 2 };
  const originX = cv.width / 2 - cam.x * CELL;
  const originY = cv.height / 2 - cam.y * CELL;
  return {
    x: Math.floor((mx - originX) / CELL),
    y: Math.floor((my - originY) / CELL),
  };
}
