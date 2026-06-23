// Host election. The host is the connected player with the lexicographically
// smallest uid. Pure `pickHost` is unit-tested; `claimHost` uses an RTDB
// transaction so two clients can't both believe they are host (split-brain).

import { ref, runTransaction, type Database } from "firebase/database";

/** Deterministic host choice from the set of currently-present uids. */
export function pickHost(presentUids: string[]): string | null {
  if (presentUids.length === 0) return null;
  return [...presentUids].sort()[0]!;
}

/**
 * Ensure `meta/hostUid` names a present player. If the recorded host is absent
 * from `presentUids`, atomically claim host for `pickHost(presentUids)`.
 * Returns the resulting host uid (may be unchanged).
 */
export async function claimHost(
  db: Database,
  roomCode: string,
  presentUids: string[],
): Promise<string | null> {
  const desired = pickHost(presentUids);
  if (!desired) return null;
  const hostRef = ref(db, `rooms/${roomCode}/meta/hostUid`);
  const result = await runTransaction(hostRef, (current: string | null) => {
    if (current && presentUids.includes(current)) return current; // valid host stays
    return desired;
  });
  return (result.snapshot.val() as string | null) ?? desired;
}
