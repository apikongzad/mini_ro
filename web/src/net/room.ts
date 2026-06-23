// Room creation / joining + presence with onDisconnect cleanup.

import {
  ref, get, set, update, onDisconnect, onValue, serverTimestamp,
  type Database, type Unsubscribe,
} from "firebase/database";
import { db } from "./firebase";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

export function makeRoomCode(len = 5): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export interface RoomMeta {
  createdAt: number | object;
  hostUid: string;
  map: string;
  state: string;
}

function database(): Database {
  if (!db) throw new Error("Firebase is not configured");
  return db;
}

export async function roomExists(code: string): Promise<boolean> {
  const snap = await get(ref(database(), `rooms/${code}/meta`));
  return snap.exists();
}

/** Create a new room with the caller as initial host. */
export async function createRoom(code: string, uid: string, map: string): Promise<void> {
  await set(ref(database(), `rooms/${code}/meta`), {
    createdAt: serverTimestamp(),
    hostUid: uid,
    map,
    state: "active",
  } satisfies RoomMeta);
}

/** Register presence for `uid` and auto-remove it on disconnect. */
export async function joinPresence(code: string, uid: string, name: string): Promise<void> {
  const pRef = ref(database(), `rooms/${code}/presence/${uid}`);
  await set(pRef, { name, connected: true, lastSeen: serverTimestamp() });
  await onDisconnect(pRef).remove();
}

export async function leavePresence(code: string, uid: string): Promise<void> {
  await set(ref(database(), `rooms/${code}/presence/${uid}`), null);
}

/** Subscribe to the set of present uids. */
export function subscribePresence(
  code: string,
  cb: (uids: string[]) => void,
): Unsubscribe {
  return onValue(ref(database(), `rooms/${code}/presence`), (snap) => {
    cb(Object.keys(snap.val() ?? {}));
  });
}

export function subscribeMeta(code: string, cb: (meta: RoomMeta | null) => void): Unsubscribe {
  return onValue(ref(database(), `rooms/${code}/meta`), (snap) => {
    cb((snap.val() as RoomMeta | null) ?? null);
  });
}

export async function touchPresence(code: string, uid: string): Promise<void> {
  await update(ref(database(), `rooms/${code}/presence/${uid}`), {
    lastSeen: serverTimestamp(),
  });
}
