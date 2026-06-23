"use client";

import { use, useState } from "react";
import { useSearchParams } from "next/navigation";
import GameClient from "@/ui/GameClient";

export default function PlayRoom({ params }: { params: Promise<{ room: string }> }) {
  const { room } = use(params);
  const search = useSearchParams();
  const queryName = search.get("name") ?? "";
  const [name, setName] = useState(queryName);
  const [entered, setEntered] = useState<string | null>(queryName ? queryName : null);

  if (entered) return <GameClient name={entered} room={room.toUpperCase()} />;

  return (
    <main className="landing">
      <h1>Join room {room.toUpperCase()}</h1>
      <form onSubmit={(e) => { e.preventDefault(); setEntered(name.trim() || "Adventurer"); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={16} autoFocus />
        <button type="submit">Enter</button>
      </form>
    </main>
  );
}
