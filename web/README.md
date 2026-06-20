# mini-ro web

A tiny, educational, RO-like web game. This is the Next.js client + the
renderer-agnostic game engine. Game data is generated from the Hercules
databases by `tools/data-extract` (see `../NOTICE-DATA.md` for licensing).

## Run locally

From the repo root:

```bash
pnpm install
pnpm extract        # (re)generate packages/data-gen/*.json from db/re
pnpm dev            # start the Next.js dev server (http://localhost:3000)
```

Other scripts:

```bash
pnpm --filter @mini-ro/web test       # engine unit tests + headless sim
pnpm --filter @mini-ro/web build      # production build
```

## What works today (Phase 1 — single-player vertical slice)

- Prontera-field map (hand-authored walkability grid)
- Click to move (BFS pathfinding), click a monster to auto-attack
- Simplified RO combat (HIT/FLEE/ATK, ±10% variance, min 1 damage)
- Poring / Fabre / Lunatic with aggro, chase, attack, death, drops, respawn
- Base/Job EXP and level-ups using the real extracted exp tables (capped lv 30)
- Stat-point allocation, Novice → Swordsman job change at job level 10, Bash skill
- Inventory + potions (press **2** for a Red Potion), death + respawn

Controls: click ground to move, click a monster to attack, **1** = Bash,
**2** = Red Potion.

## Layout

- `src/game/` — pure-TS engine (no React/canvas): `rng`, `stats`, `combat`,
  `leveling`, `movement`, `world` (the simulation). Unit-tested in Node.
- `src/render/` — Canvas2D renderer (placeholder art). Swappable for PixiJS
  later without touching `src/game/`.
- `src/ui/` — React HUD + input wiring (`GameClient.tsx`).
- `src/app/` — Next.js App Router pages.

## Roadmap

- **Phase 2** — multiplayer over Firebase Realtime Database (room codes,
  anonymous auth, host-authority mob simulation). Add `NEXT_PUBLIC_FIREBASE_*`
  env vars and deploy on Vercel (root directory = `web/`).
- **Phase 3** — polish: PixiJS renderer, art/sound pass, mobile layout.
