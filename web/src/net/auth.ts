// Anonymous auth — friends join with just a room code and a display name.

import { signInAnonymously, updateProfile } from "firebase/auth";
import { auth } from "./firebase";

export async function ensureSignedIn(displayName: string): Promise<string> {
  if (!auth) throw new Error("Firebase is not configured");
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await signInAnonymously(auth);
  try {
    await updateProfile(cred.user, { displayName });
  } catch {
    /* non-fatal */
  }
  return cred.user.uid;
}
