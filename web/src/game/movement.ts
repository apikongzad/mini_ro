// Grid model + BFS pathfinding on the hand-authored walkability map.

export interface GridMap {
  width: number;
  height: number;
  /** row-major; 0 = walkable, 1 = blocked */
  cells: number[];
}

export function isWalkable(map: GridMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.cells[y * map.width + x] === 0;
}

export interface Cell { x: number; y: number; }

// 8-directional neighbours (RO allows diagonal movement).
const DIRS: Cell[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

/**
 * BFS shortest path from `start` to `goal`, returning the list of steps AFTER
 * start (i.e. excludes the start cell). Empty array if no path / already there.
 * Diagonals are only allowed when not cutting through a blocked corner.
 */
export function findPath(map: GridMap, start: Cell, goal: Cell): Cell[] {
  if (!isWalkable(map, goal.x, goal.y)) return [];
  if (start.x === goal.x && start.y === goal.y) return [];

  const idx = (x: number, y: number) => y * map.width + x;
  const visited = new Uint8Array(map.width * map.height);
  const prev = new Int32Array(map.width * map.height).fill(-1);
  const queue: number[] = [idx(start.x, start.y)];
  visited[idx(start.x, start.y)] = 1;

  let found = false;
  while (queue.length) {
    const cur = queue.shift()!;
    const cx = cur % map.width;
    const cy = (cur - cx) / map.width;
    if (cx === goal.x && cy === goal.y) { found = true; break; }
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!isWalkable(map, nx, ny)) continue;
      // prevent diagonal corner-cutting through walls
      if (d.x !== 0 && d.y !== 0) {
        if (!isWalkable(map, cx + d.x, cy) || !isWalkable(map, cx, cy + d.y)) continue;
      }
      const ni = idx(nx, ny);
      if (visited[ni]) continue;
      visited[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (!found) return [];

  const path: Cell[] = [];
  let cur = idx(goal.x, goal.y);
  const startIdx = idx(start.x, start.y);
  while (cur !== startIdx && cur >= 0) {
    const cx = cur % map.width;
    const cy = (cur - cx) / map.width;
    path.push({ x: cx, y: cy });
    cur = prev[cur] ?? -1;
  }
  path.reverse();
  return path;
}

/** A random walkable cell, using a simple rejection sampler. */
export function randomWalkable(
  map: GridMap,
  rand: () => number,
  tries = 100,
): Cell {
  for (let i = 0; i < tries; i++) {
    const x = Math.floor(rand() * map.width);
    const y = Math.floor(rand() * map.height);
    if (isWalkable(map, x, y)) return { x, y };
  }
  // fallback: scan
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      if (isWalkable(map, x, y)) return { x, y };
  return { x: 0, y: 0 };
}
