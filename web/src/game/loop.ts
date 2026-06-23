// Fixed-timestep game loop. Simulation steps at a fixed rate (default 10 Hz)
// while rendering runs every animation frame. Browser-only (uses rAF).

export interface LoopHandle {
  stop(): void;
}

export function startLoop(
  onTick: (dtMs: number) => void,
  onRender: (alpha: number) => void,
  tickMs = 100,
): LoopHandle {
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let running = true;

  const frame = (now: number) => {
    if (!running) return;
    let delta = now - last;
    last = now;
    if (delta > 250) delta = 250; // avoid spiral of death after tab switch
    acc += delta;
    while (acc >= tickMs) {
      onTick(tickMs);
      acc -= tickMs;
    }
    onRender(acc / tickMs);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
