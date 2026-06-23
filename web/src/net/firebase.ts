// Firebase initialization. Driven entirely by NEXT_PUBLIC_FIREBASE_* env vars.
// When the database URL / api key are absent, `firebaseEnabled` is false and the
// app falls back to offline single-player — no Firebase project required to run.

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getDatabase, connectDatabaseEmulator, type Database } from "firebase/database";

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

export const firebaseEnabled = Boolean(cfg.databaseURL && cfg.projectId);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Database | null = null;

if (firebaseEnabled && typeof window !== "undefined") {
  app = getApps()[0] ?? initializeApp(cfg as Record<string, string>);
  authInstance = getAuth(app);
  dbInstance = getDatabase(app);

  if (process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === "1") {
    try {
      connectAuthEmulator(authInstance, "http://127.0.0.1:9099", { disableWarnings: true });
      connectDatabaseEmulator(dbInstance, "127.0.0.1", 9000);
    } catch {
      /* already connected (HMR) */
    }
  }
}

export const auth = authInstance;
export const db = dbInstance;
