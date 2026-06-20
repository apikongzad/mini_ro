// Typed access to the generated game data bundle.
// The JSON here is produced by `pnpm extract` (tools/data-extract) — do not
// edit it by hand. This wrapper just gives the web app a type-safe import.

import type { GameData } from "@mini-ro/shared-types";
import bundle from "./index.json" with { type: "json" };
import prtFild01 from "./maps/prt_fild01.json" with { type: "json" };

export const gameData = bundle as unknown as GameData;

export interface FieldMap { width: number; height: number; cells: number[]; }
export const fieldMap = prtFild01 as FieldMap;

export default gameData;
