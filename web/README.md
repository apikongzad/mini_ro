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

## Multiplayer (Phase 2)

Rooms run on **Firebase Realtime Database** with **anonymous auth**. One client
is elected **host** (lowest uid, via an RTDB transaction) and authoritatively
simulates all monsters; every client owns its own player. Player→monster hits
flow as intents that only the host applies (single writer ⇒ no double damage);
the host sends EXP back to the killer. With no Firebase env set, the app simply
runs offline single-player.

### Configure

Copy `.env.local.example` → `.env.local` and fill in your Firebase web config
(`NEXT_PUBLIC_FIREBASE_*`). Then `pnpm dev`, create a room, and share the 5-char
code (or the `/play/CODE` URL) with friends.

### Local end-to-end test with the emulator (no real project needed)

```bash
npm i -g firebase-tools
cd web
firebase emulators:start            # auth :9099, RTDB :9000, UI :4000
```

In `.env.local` set any non-empty `NEXT_PUBLIC_FIREBASE_PROJECT_ID` and
`NEXT_PUBLIC_FIREBASE_DATABASE_URL`, plus `NEXT_PUBLIC_FIREBASE_EMULATOR=1`, then
`pnpm dev`. Open two browser tabs in one room and verify: no double-damage on a
shared monster, EXP goes to the killer, host fail-over when the host tab closes,
and shared ground drops.

## Deploy (Vercel)

- Import the repo; set **Root Directory = `web/`** (pnpm workspace is detected).
- Build command `pnpm --filter @mini-ro/web build` (default works too).
- Add the `NEXT_PUBLIC_FIREBASE_*` env vars.
- Deploy the RTDB security rules from `web/firebase/database.rules.json`
  (`firebase deploy --only database`).

## Roadmap

- **Phase 3** — polish: PixiJS renderer, art/sound pass, chat UI, mobile layout,
  remote-position interpolation tuning.
