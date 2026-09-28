/**
 * Heaps coming to rest, judged for sleep together and each on a window of
 * its own, counted over many seeds. Without it nothing holds sleepTogether to
 * what it is for: a heap left alone going to sleep, rather than keeping pairs
 * of bodies awake for ever, as each body's own window did in Pushminer's cave.
 * A heap from one seed can go either way by chance, so each figure here is
 * from a run of them, and the file is one of its own so it is run beside the
 * rest rather than after them.
 */
import { expect, it } from 'vitest';
import { DEFAULT_TUNING, World, type Grid } from '../src/world';

const DT = 1 / 60;

/** Chance from a seed, so a run is the same every time. */
function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A grid all floor but for a border of rock. */
function walled(grid: Grid): Uint8Array {
  const out = new Uint8Array(grid.cols * grid.rows);
  for (let ty = 0; ty < grid.rows; ty++)
    for (let tx = 0; tx < grid.cols; tx++)
      out[ty * grid.cols + tx] = tx === 0 || ty === 0 || tx === grid.cols - 1 || ty === grid.rows - 1 ? 1 : 0;
  return out;
}

/** How many of a world's bodies went from asleep to awake over a number of fixed steps, each looked at after every one. */
function wokenAgain(w: World, steps: number): number {
  const was = Array.from(w.asleep);
  let woken = 0;
  for (let s = 0; s < steps; s++) {
    w.step(DEFAULT_TUNING.step, () => {});
    for (let i = 0; i < w.count; i++) {
      if (was[i] && !w.asleep[i]) woken++;
      was[i] = w.asleep[i];
    }
  }
  return woken;
}

/** The world's own tests' floor and kinds: tiles 3 across, a small ball and a big one. */
const BALLS: Grid = { cols: 60, rows: 40, originX: -90, originY: -60, tile: 3 };
/** The discs' own tests' floor: tiles a unit across, and a coin. */
const COINS: Grid = { cols: 40, rows: 40, originX: -20, originY: -20, tile: 1 };

it('with sleepTogether, leaves a settled heap of balls with none woken again and none awake, where on their own windows some wake each other for ever', () => {
  // a heap of small balls dropped in a pile as Pushminer drops one, settled, and then left alone and watched
  const heap = (seed: number, sleepTogether: boolean) => {
    const random = seeded(seed);
    const w = new World({
      capacity: 600,
      grid: BALLS,
      solid: walled(BALLS),
      radii: [0.42, 1.0],
      holes: [],
      random,
      tuning: { sleepTogether },
    });
    const wide = Math.sqrt(600) * 0.36 + 1.5,
      high = Math.sqrt(600) * 0.3 + 1.5;
    for (let k = 0; k < 600; k++) {
      const z = 1 + random() * high,
        r = wide * (1 - z / (high + 2)) * Math.sqrt(random()),
        a = random() * Math.PI * 2;
      w.spawn(0, -40 + Math.cos(a) * r, 15 + Math.sin(a) * r, z);
    }
    for (let f = 0; f < 420; f++) w.step(DT, () => {});
    const woken = wokenAgain(w, 600);
    let awake = 0;
    for (let i = 0; i < w.count; i++) if (!w.asleep[i]) awake++;
    return { woken, awake };
  };
  let ownWoken = 0;
  for (let seed = 1; seed <= 8; seed++) {
    ownWoken += heap(seed, false).woken;
    expect(heap(seed, true), `seed ${seed}`).toEqual({ woken: 0, awake: 0 });
  }
  expect(ownWoken).toBeGreaterThan(0);
});

it('with sleepTogether, settles a heap of coins with fewer awake a step than each on its own window', () => {
  // Over two dozen heaps a tenth fewer, though not in every heap. At rest a coin heap can be left with a coin or
  // two awake either way: a pair the solver never lets rest, further into each other than a coin may sleep, and
  // the sleepers they jostle. That is the coins' own, and judging together does not end it.
  const settling = (seed: number, sleepTogether: boolean) => {
    const random = seeded(seed);
    const w = new World({
      capacity: 100,
      grid: COINS,
      solid: walled(COINS),
      radii: [0.42, 0.42],
      thickness: [0.24, 0],
      random,
      tuning: { cell: 1.2, sleepTogether },
    });
    for (let k = 0; k < 100; k++) {
      const r = Math.sqrt(random()) * 2,
        t = random() * Math.PI * 2;
      w.spawn(0, Math.cos(t) * r, Math.sin(t) * r, 0.5 + random() * 4);
    }
    let awake = 0;
    for (let f = 0; f < 240; f++) {
      w.step(DT, () => {});
      for (let i = 0; i < w.count; i++) if (!w.asleep[i]) awake++;
    }
    return awake / 240;
  };
  let own = 0,
    together = 0;
  for (let seed = 1; seed <= 24; seed++) {
    own += settling(seed, false);
    together += settling(seed, true);
  }
  expect(together).toBeLessThan(own * 0.95);
}, 30_000);
