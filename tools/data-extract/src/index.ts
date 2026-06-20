// Data-extract pipeline entry point.
//
// Reads the Hercules libconfig databases (READ ONLY) and the prt_fild spawn
// list, then emits a trimmed JSON bundle under packages/data-gen/ that the web
// engine consumes. Only the MVP whitelist subset is kept.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ItemDef, MobDef, MobDrop, JobDef, ExpData, ExpTable,
  SkillDef, SpawnDef, Stats, GameData,
} from "@mini-ro/shared-types";

import {
  parseConf, asObject, asArray, asNumber, asString,
  type ConfValue,
} from "./libconfig.js";

import {
  MVP_MOB_IDS, MVP_ITEM_IDS, MVP_JOBS, MVP_SKILL_NAMES,
  ITEM_EFFECTS, MOB_COLORS, MOB_VIEW_RANGE,
  MVP_BASE_LEVEL_CAP, MVP_JOB_LEVEL_CAP, MVP_FIELD_MAP,
} from "./mvpWhitelist.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const DB = resolve(REPO_ROOT, "db/re");
const OUT = resolve(REPO_ROOT, "packages/data-gen");

const warnings: string[] = [];

function read(path: string): ConfValue {
  const src = readFileSync(path, "utf8");
  const { value, warnings: w } = parseConf(src);
  for (const msg of w) warnings.push(`${path}: ${msg}`);
  return value;
}

function statsFrom(v: ConfValue | undefined): Stats {
  const o = asObject(v);
  return {
    str: asNumber(o.Str), agi: asNumber(o.Agi), vit: asNumber(o.Vit),
    int: asNumber(o.Int), dex: asNumber(o.Dex), luk: asNumber(o.Luk),
  };
}

// ---------------------------------------------------------------------------
// Items  (also builds an AegisName -> id map used to resolve mob drops)
// ---------------------------------------------------------------------------
function extractItems(): { items: Record<number, ItemDef>; aegisToId: Map<string, number>; rawById: Map<number, Record<string, ConfValue>> } {
  const root = asObject(read(resolve(DB, "item_db.conf")));
  const list = asArray(root.item_db);
  const aegisToId = new Map<string, number>();
  const rawById = new Map<number, Record<string, ConfValue>>();

  for (const entry of list) {
    const o = asObject(entry);
    const id = asNumber(o.Id, -1);
    if (id < 0) continue;
    const aegis = asString(o.AegisName);
    if (aegis) aegisToId.set(aegis, id);
    rawById.set(id, o);
  }

  const items: Record<number, ItemDef> = {};
  const want = new Set<number>(MVP_ITEM_IDS);
  for (const id of want) {
    const o = rawById.get(id);
    if (!o) { warnings.push(`item ${id} not found in item_db`); continue; }
    items[id] = buildItem(id, o);
  }
  return { items, aegisToId, rawById };
}

function buildItem(id: number, o: Record<string, ConfValue>): ItemDef {
  const atk = o.Atk !== undefined ? asNumber(o.Atk) : undefined;
  return {
    id,
    aegisName: asString(o.AegisName),
    name: asString(o.Name),
    type: asString(o.Type, "IT_ETC"),
    buy: asNumber(o.Buy),
    weight: asNumber(o.Weight),
    ...(atk !== undefined ? { atk } : {}),
    effect: ITEM_EFFECTS[id] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------
function extractMobs(
  aegisToId: Map<string, number>,
): { mobs: Record<number, MobDef>; dropItemIds: Set<number> } {
  const root = asObject(read(resolve(DB, "mob_db.conf")));
  const list = asArray(root.mob_db);
  const byId = new Map<number, Record<string, ConfValue>>();
  for (const entry of list) {
    const o = asObject(entry);
    const id = asNumber(o.Id, -1);
    if (id >= 0) byId.set(id, o);
  }

  const mobs: Record<number, MobDef> = {};
  const dropItemIds = new Set<number>();

  for (const id of MVP_MOB_IDS) {
    const o = byId.get(id);
    if (!o) { warnings.push(`mob ${id} not found in mob_db`); continue; }

    const drops: MobDrop[] = [];
    const dropObj = asObject(o.Drops);
    for (const [aegis, rate] of Object.entries(dropObj)) {
      const itemId = aegisToId.get(aegis);
      if (itemId === undefined) continue; // skip drops we can't resolve
      drops.push({ item: itemId, rate: asNumber(rate) });
      dropItemIds.add(itemId);
    }

    const attack = asArray(o.Attack);
    mobs[id] = {
      id,
      name: asString(o.Name),
      sprite: asString(o.SpriteName).toLowerCase(),
      lv: asNumber(o.Lv, 1),
      hp: asNumber(o.Hp, 1),
      exp: asNumber(o.Exp),
      jexp: asNumber(o.JExp),
      atk: asNumber(attack[0]),
      atkRange: asNumber(o.AttackRange, 1),
      def: asNumber(o.Def),
      mdef: asNumber(o.Mdef),
      stats: statsFrom(o.Stats),
      aspd: asNumber(o.AttackDelay, 1000),
      moveSpeed: asNumber(o.MoveSpeed, 400),
      viewRange: MOB_VIEW_RANGE[id] ?? asNumber(o.ViewRange, 0),
      drops,
      color: MOB_COLORS[id] ?? "#cccccc",
    };
  }
  return { mobs, dropItemIds };
}

// ---------------------------------------------------------------------------
// Jobs + exp tables (exp groups are discovered from the jobs we ship)
// ---------------------------------------------------------------------------
function extractJobsAndExp(): { jobs: Record<number, JobDef>; exp: ExpData } {
  const jobRoot = asObject(read(resolve(DB, "job_db.conf")));
  const jobs: Record<number, JobDef> = {};
  const baseGroups = new Set<string>();
  const jobGroups = new Set<string>();

  for (const { id, key } of MVP_JOBS) {
    const o = asObject(jobRoot[key]);
    if (!Object.keys(o).length) { warnings.push(`job "${key}" not found in job_db`); continue; }
    const baseExpGroup = asString(o.BaseExpGroup);
    const jobExpGroup = asString(o.JobExpGroup);
    baseGroups.add(baseExpGroup);
    jobGroups.add(jobExpGroup);
    jobs[id] = {
      id,
      name: key,
      baseExpGroup,
      jobExpGroup,
      weight: asNumber(o.Weight, 20000),
      hpTable: asArray(o.HPTable).map((x) => asNumber(x)),
      spTable: asArray(o.SPTable).map((x) => asNumber(x)),
    };
  }

  const expRoot = asObject(read(resolve(DB, "exp_group_db.conf")));
  const baseDb = asObject(expRoot.base_exp_group_db);
  const jobDb = asObject(expRoot.job_exp_group_db);

  const pull = (db: Record<string, ConfValue>, name: string, cap: number): ExpTable => {
    const g = asObject(db[name]);
    const exp = asArray(g.Exp).map((x) => asNumber(x));
    return { maxLevel: cap, exp: exp.slice(0, cap - 1) };
  };

  const exp: ExpData = { base: {}, job: {} };
  for (const name of baseGroups) exp.base[name] = pull(baseDb, name, MVP_BASE_LEVEL_CAP);
  for (const name of jobGroups) exp.job[name] = pull(jobDb, name, MVP_JOB_LEVEL_CAP);

  return { jobs, exp };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
function extractSkills(): Record<number, SkillDef> {
  const root = asObject(read(resolve(DB, "skill_db.conf")));
  const list = asArray(root.skill_db);
  const byName = new Map<string, Record<string, ConfValue>>();
  for (const entry of list) {
    const o = asObject(entry);
    const name = asString(o.Name);
    if (name) byName.set(name, o);
  }

  const skills: Record<number, SkillDef> = {};
  for (const name of MVP_SKILL_NAMES) {
    const o = byName.get(name);
    if (!o) { warnings.push(`skill "${name}" not found in skill_db`); continue; }
    const maxLevel = asNumber(o.MaxLevel, 1);
    const req = asObject(o.Requirements);
    const spCost = expandPerLevel(req.SPCost, maxLevel);
    const id = asNumber(o.Id, -1);
    skills[id >= 0 ? id : name.length] = {
      id,
      name,
      maxLevel,
      range: asNumber(o.Range, 1),
      attackType: asString(o.AttackType, "Weapon"),
      spCost,
    };
  }
  return skills;
}

// SPCost (and similar) can be either a flat number or an object { Lv1, Lv2, ... }.
function expandPerLevel(v: ConfValue | undefined, maxLevel: number): number[] {
  const out: number[] = [];
  if (typeof v === "number") {
    for (let i = 0; i < maxLevel; i++) out.push(v);
    return out;
  }
  const o = asObject(v);
  let last = 0;
  for (let lv = 1; lv <= maxLevel; lv++) {
    const key = `Lv${lv}`;
    if (o[key] !== undefined) last = asNumber(o[key]);
    out.push(last);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spawns (parsed from the npc spawn text, counts overridden for a small game)
// ---------------------------------------------------------------------------
function extractSpawns(): SpawnDef[] {
  const path = resolve(REPO_ROOT, "npc/re/mobs/fields/prontera.txt");
  const src = readFileSync(path, "utf8");
  const wanted = new Set<number>(MVP_MOB_IDS);
  const spawns: SpawnDef[] = [];
  for (const line of src.split(/\r?\n/)) {
    if (!line.includes("\tmonster\t")) continue;
    const [loc, , , rest] = line.split("\t");
    if (!loc || !rest) continue;
    if (!loc.startsWith(MVP_FIELD_MAP + ",")) continue;
    const parts = rest.split(",");
    const mobId = Number(parts[0]);
    if (!wanted.has(mobId)) continue;
    const respawnMs = Number(parts[2] ?? 5000) || 5000;
    // Override the huge MMO counts with a small per-mob count for 5-10 players.
    const count = mobId === 1063 ? 12 : 8;
    spawns.push({ map: MVP_FIELD_MAP, mobId, count, respawnMs: Math.max(respawnMs, 8000) });
  }
  return spawns;
}

// ---------------------------------------------------------------------------
// A simple hand-authored walkability grid for the field (NOT from .mcache).
// 0 = walkable, 1 = blocked. Deterministic so output is stable.
// ---------------------------------------------------------------------------
function buildFieldMap(w = 40, h = 40): { width: number; height: number; cells: number[] } {
  const cells: number[] = [];
  // deterministic LCG for stable rock placement
  let seed = 1337;
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const rock = !border && rng() < 0.04;
      cells.push(border || rock ? 1 : 0);
    }
  }
  return { width: w, height: h, cells };
}

// ---------------------------------------------------------------------------
function writeJson(name: string, data: unknown): void {
  writeFileSync(resolve(OUT, name), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function main(): void {
  mkdirSync(resolve(OUT, "maps"), { recursive: true });

  const { items, aegisToId, rawById } = extractItems();
  const { mobs, dropItemIds } = extractMobs(aegisToId);

  // ensure every drop item is present in items.json (flavor/sellable)
  for (const id of dropItemIds) {
    if (!items[id]) {
      const o = rawById.get(id);
      if (o) items[id] = buildItem(id, o);
    }
  }

  const { jobs, exp } = extractJobsAndExp();
  const skills = extractSkills();
  const spawns = extractSpawns();
  const fieldMap = buildFieldMap();

  writeJson("items.json", items);
  writeJson("mobs.json", mobs);
  writeJson("jobs.json", jobs);
  writeJson("exp.json", exp);
  writeJson("skills.json", skills);
  writeJson("spawns.json", spawns);
  writeJson(`maps/${MVP_FIELD_MAP}.json`, fieldMap);

  const bundle: GameData = { items, mobs, jobs, exp, skills, spawns };
  writeJson("index.json", bundle);

  writeAttribution(Object.keys(items).length, Object.keys(mobs).length);

  console.log(`✔ items:${Object.keys(items).length} mobs:${Object.keys(mobs).length} jobs:${Object.keys(jobs).length} skills:${Object.keys(skills).length} spawns:${spawns.length}`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 40)) console.log("  - " + w);
  }
}

function writeAttribution(nItems: number, nMobs: number): void {
  const text = `# Attribution — generated game data

These JSON files are **generated** by \`tools/data-extract\` from the Hercules
Ragnarok Online server-emulator databases under \`db/re/\` and \`npc/re/\` in this
repository.

- Source project: **Hercules** (https://github.com/HerculesWS/Hercules)
- Source license: **GNU General Public License v3** (see repository \`LICENSE\`)
- These derived files are therefore licensed **GPL-3.0-or-later**.

Do not edit these files by hand — re-run \`pnpm extract\` instead.

Generated subset: ${nItems} items, ${nMobs} monsters (MVP whitelist only).
No Gravity Co. client art is included; visuals are placeholder/free assets.
`;
  writeFileSync(resolve(OUT, "ATTRIBUTION.md"), text, "utf8");
}

main();
