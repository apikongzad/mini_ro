"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import GameClient from "@/ui/GameClient";
import { firebaseEnabled } from "@/net/firebase";
import { makeRoomCode } from "@/net/room";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [offline, setOffline] = useState(false);

  if (offline) return <GameClient name={name.trim() || "Adventurer"} />;

  const who = () => encodeURIComponent(name.trim() || "Adventurer");

  return (
    <main className="landing">
      <h1>mini-ro</h1>
      <p className="tag">
        A tiny, educational RO-like prototype for a group of friends. Fight Porings in
        Prontera Field, level up, loot, and party up in a shared room.
      </p>

      <form onSubmit={(e) => e.preventDefault()}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={16} autoFocus />
      </form>

      {firebaseEnabled ? (
        <div className="menu">
          <button onClick={() => router.push(`/play/${makeRoomCode()}?name=${who()}`)}>
            ➕ Create Room
          </button>
          <div className="join">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Room code" maxLength={6} />
            <button disabled={code.length < 4} onClick={() => router.push(`/play/${code}?name=${who()}`)}>
              Join
            </button>
          </div>
          <button className="secondary" onClick={() => setOffline(true)}>Play offline</button>
        </div>
      ) : (
        <div className="menu">
          <button onClick={() => setOffline(true)}>Enter World (single-player)</button>
          <p className="fine">Multiplayer is off — set NEXT_PUBLIC_FIREBASE_* env vars to enable rooms.</p>
        </div>
      )}

      <p className="fine">
        Visuals are placeholder art. Game data derived from the GPLv3 Hercules project;
        no Gravity client assets are used.
      </p>
    </main>
  );
}
