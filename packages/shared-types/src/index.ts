// Shared domain types for mini-ro. Used by both the data-extract pipeline
// (which produces JSON matching these shapes) and the web engine/client.

// ----- Core stat block (RO's six primary stats) -----
export interface Stats {
  str: number;
  agi: number;
  vit: number;
  int: number;
  dex: number;
  luk: number;
}

// ----- Items -----
export type ItemEffectKind = "heal" | "healSp" | "warpSave" | "none";

export interface ItemEffect {
  kind: ItemEffectKind;
  /** for heal/healSp: inclusive random range applied on use */
  min?: number;
  max?: number;
}

export interface ItemDef {
  id: number;
  aegisName: string;
  name: string;
  /** Hercules Type, e.g. "IT_HEALING", "IT_WEAPON", "IT_ETC" */
  type: string;
  buy: number;
  weight: number;
  /** weapon attack, present for weapons */
  atk?: number;
  /** normalized effect for the MVP engine; null when not modelled */
  effect: ItemEffect | null;
}

// ----- Monsters -----
export interface MobDrop {
  item: number;
  /** drop chance in 1/10000 (Hercules units): 7000 = 70% */
  rate: number;
}

export interface MobDef {
  id: number;
  name: string;
  sprite: string;
  lv: number;
  hp: number;
  exp: number;
  jexp: number;
  atk: number;
  atkRange: number;
  def: number;
  mdef: number;
  stats: Stats;
  /** attack delay in ms (Hercules AttackDelay) */
  aspd: number;
  /** movement speed: ms to move one cell (Hercules MoveSpeed) */
  moveSpeed: number;
  /** view/aggro range in cells */
  viewRange: number;
  drops: MobDrop[];
  /** placeholder render colour */
  color: string;
}

// ----- Jobs -----
export interface JobDef {
  id: number;
  name: string;
  baseExpGroup: string;
  jobExpGroup: string;
  weight: number;
  /** HP per base level, index 0 == level 1 */
  hpTable: number[];
  /** SP per base level, index 0 == level 1 */
  spTable: number[];
}

// ----- Experience tables -----
export interface ExpTable {
  maxLevel: number;
  /** exp needed to go from level (index+1) to (index+2) */
  exp: number[];
}

export interface ExpData {
  /** keyed by exp-group name, e.g. "FirstClasses" */
  base: Record<string, ExpTable>;
  job: Record<string, ExpTable>;
}

// ----- Skills -----
export interface SkillDef {
  id: number;
  name: string;
  maxLevel: number;
  range: number;
  attackType: string;
  /** SP cost per level, index 0 == level 1 */
  spCost: number[];
}

// ----- Spawns -----
export interface SpawnDef {
  map: string;
  mobId: number;
  count: number;
  respawnMs: number;
}

// ----- Aggregate generated data bundle -----
export interface GameData {
  items: Record<number, ItemDef>;
  mobs: Record<number, MobDef>;
  jobs: Record<number, JobDef>;
  exp: ExpData;
  skills: Record<number, SkillDef>;
  spawns: SpawnDef[];
}

// ----- Runtime / network entity state (Phase 2 RTDB) -----
export type EntityState = "alive" | "dead" | "idle" | "chase";

export interface PlayerState {
  uid: string;
  name: string;
  jobId: number;
  x: number;
  y: number;
  dir: number;
  baseLv: number;
  jobLv: number;
  baseExp: number;
  jobExp: number;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  stats: Stats;
  statPoints: number;
  skillPoints: number;
  state: "alive" | "dead";
  weaponId: number | null;
  targetId: string | null;
}

export interface MobInstanceState {
  instId: string;
  mobId: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: EntityState;
  targetUid: string | null;
  ownerUid: string | null;
  respawnAt: number | null;
}

export interface GroundItem {
  dropId: string;
  itemId: number;
  qty: number;
  x: number;
  y: number;
  expireAt: number;
}

export interface HitEvent {
  type: "hit";
  srcUid: string;
  dstId: string;
  dmg: number;
  ts: number;
}

export interface ChatMessage {
  uid: string;
  name: string;
  text: string;
  ts: number;
}
