"use client";

import { useState } from "react";
import GameClient from "@/ui/GameClient";

export default function Home() {
  const [name, setName] = useState("");
  const [entered, setEntered] = useState<string | null>(null);

  if (entered) return <GameClient name={entered} />;

  return (
    <main className="landing">
      <h1>mini-ro</h1>
      <p className="tag">
        A tiny, educational RO-like prototype. Single-player vertical slice — fight
        Porings in Prontera Field, level up, loot, and use potions.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setEntered(name.trim() || "Adventurer");
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={16}
          autoFocus
        />
        <button type="submit">Enter World</button>
      </form>
      <p className="fine">
        Visuals are placeholder art. Game data derived from the GPLv3 Hercules
        project; no Gravity client assets are used.
      </p>
    </main>
  );
}
