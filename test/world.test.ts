/**
 * The world, on a grid of its own making: a floor walled with rock, a hole
 * in the middle, and whatever the test puts on it. Nothing here is a coin
 * or a cave; a kind is a radius, and that is all the world knows of one.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, World, type Grid, type Hole, type Pusher, type WorldOptions } from '../src/world';

const DT = 1 / 60;
const GRID: Grid = { cols: 60, rows: 40, originX: -90, originY: -60, tile: 3 };
const HOLE: Hole = { x: 0, y: 0, radius: 5, depth: 14 };
/** Two kinds: a small one and a big one. */
const RADII = [0.42, 1.0];

/** A grid all floor but for a border of rock, and whatever `rock` marks. */
function solid(rock: (tx: number, ty: number) => boolean = () => false): Uint8Array {
  const out = new Uint8Array(GRID.cols * GRID.rows);
  for (let ty = 0; ty < GRID.rows; ty++)
    for (let tx = 0; tx < GRID.cols; tx++)
      out[ty * GRID.cols + tx] =
        tx === 0 || ty === 0 || tx === GRID.cols - 1 || ty === GRID.rows - 1 || rock(tx, ty) ? 1 : 0;
  return out;
}

/** Chance from a seed, so a run is the same every time. */
function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const world = (over: Partial<WorldOptions> = {}) =>
  new World({ capacity: 16, grid: GRID, solid: solid(), radii: RADII, holes: [HOLE], random: seeded(1), ...over });

const tileOf = (x: number, y: number) => {
  const tx = Math.floor((x - GRID.originX) / GRID.tile),
    ty = Math.floor((y - GRID.originY) / GRID.tile);
  return tx < 0 || ty < 0 || tx >= GRID.cols || ty >= GRID.rows ? -1 : ty * GRID.cols + tx;
};

/** A box driven round a circle through a heap, as a blade is. */
function sweeper(cx: number, cy: number, radius: number, t: number, prev: Pusher | null, owner = 0): Pusher {
  const a = t * 0.6,
    x = cx + Math.cos(a) * radius,
    y = cy + Math.sin(a) * radius;
  return {
    x,
    y,
    z: 1.5,
    yaw: a + Math.PI / 2,
    hx: 0.4,
    hy: 3.5,
    hz: 1.5,
    vx: prev ? (x - prev.x) / DT : 0,
    vy: prev ? (y - prev.y) / DT : 0,
    spin: 0.6,
    px: prev?.x ?? x,
    py: prev?.y ?? y,
    owner,
  };
}

/** The private parts of the world the bookkeeping invariants are about. */
interface Innards {
  awake: Int32Array;
  awakeCount: number;
  listed: Uint8Array;
  sleepHead: Int32Array;
  sleepPrev: Int32Array;
  sleepCell: Int32Array;
  next: Int32Array;
  cellOf(x: number, y: number): number;
}

/**
 * What the stepping relies on between steps: the awake list has no repeats
 * and everything awake is on it; every sleeper's cell chain links both ways
 * and says which cell it is; and a sleeper not listed to be sorted out lies
 * in the cell it is chained in.
 */
function problems(w0: World): string[] {
  const w = w0 as unknown as Innards;
  const out: string[] = [];
  const onList = new Uint8Array(w0.capacity);
  for (let k = 0; k < w.awakeCount; k++) {
    const i = w.awake[k];
    if (onList[i]) out.push(`body ${i} twice on the awake list`);
    if (!w.listed[i]) out.push(`body ${i} on the awake list and not flagged`);
    onList[i] = 1;
  }
  let chained = 0;
  for (let c = 0; c < w.sleepHead.length; c++) {
    for (let i = w.sleepHead[c], prev = -1; i >= 0; prev = i, i = w.next[i]) {
      if (chained++ > w0.count) return [...out, 'a sleeper chain runs round on itself'];
      if (w.sleepPrev[i] !== prev) out.push(`sleeper ${i} links back to ${w.sleepPrev[i]}, not ${prev}`);
      if (w.sleepCell[i] !== c) out.push(`sleeper ${i} chained in cell ${c} thinks it is in ${w.sleepCell[i]}`);
      if (!onList[i] && !(w0.alive[i] && w0.asleep[i])) out.push(`stale sleeper ${i} not listed`);
    }
  }
  let withCell = 0;
  for (let i = 0; i < w0.count; i++) {
    if (w.sleepCell[i] >= 0) withCell++;
    if (!w0.alive[i]) continue;
    if (!w0.asleep[i] && !onList[i]) out.push(`awake body ${i} missing from the awake list`);
    else if (w0.asleep[i] && !onList[i]) {
      if (w.sleepCell[i] < 0) out.push(`sleeper ${i} in no cell`);
      else if (w.sleepCell[i] !== w.cellOf(w0.x[i], w0.y[i])) out.push(`sleeper ${i} has moved out of its cell`);
    }
  }
  if (withCell !== chained) out.push(`${withCell} bodies think they are chained, ${chained} are`);
  return out;
}

describe('the world', () => {
  it('lets a dropped body come to rest on the floor at its radius, and sleep', () => {
    const w = world();
    const i = w.spawn(0, -30, 10, 5);
    for (let f = 0; f < 180; f++) w.step(DT, () => {});
    expect(w.z[i]).toBeCloseTo(RADII[0], 2);
    expect(w.asleep[i]).toBe(1);
    const big = w.spawn(1, 20, 10, 5);
    for (let f = 0; f < 180; f++) w.step(DT, () => {});
    expect(w.z[big]).toBeCloseTo(RADII[1], 2);
  });

  it('collects what goes down a hole, once, with its kind and where, and frees its slot', () => {
    const w = world();
    const kinds = [0, 1, 0, 1];
    const random = seeded(3);
    for (const k of kinds) w.spawn(k, HOLE.x + (random() - 0.5), HOLE.y + (random() - 0.5), 2);
    const fell: { kind: number; x: number; y: number }[] = [];
    for (let f = 0; f < 240; f++) w.step(DT, (kind, x, y) => fell.push({ kind, x, y }));
    expect(fell.map((f) => f.kind).sort()).toEqual(kinds.sort());
    for (const f of fell) expect(Math.hypot(f.x - HOLE.x, f.y - HOLE.y)).toBeLessThan(HOLE.radius);
    expect(w.live).toBe(0);
    // the freed slots are used again before any new one
    w.spawn(0, -30, 10, 1);
    expect(w.count).toBe(kinds.length);
  });

  it('has as many holes as it is given, and none if none', () => {
    const two = world({ holes: [HOLE, { x: 40, y: 20, radius: 4, depth: 10 }] });
    two.spawn(0, 40, 20, 2);
    two.spawn(0, 0, 0, 2);
    let fell = 0;
    for (let f = 0; f < 240; f++) two.step(DT, () => fell++);
    expect(fell).toBe(2);
    const none = world({ holes: [] });
    const i = none.spawn(0, 0, 0, 2);
    for (let f = 0; f < 120; f++) none.step(DT, () => expect.fail('nowhere to fall'));
    expect(none.z[i]).toBeCloseTo(RADII[0], 2);
  });

  it('refuses a body when full', () => {
    const w = world({ capacity: 2 });
    expect(w.spawn(0, -30, 10, 1)).toBe(0);
    expect(w.spawn(0, -31, 10, 1)).toBe(1);
    expect(w.spawn(0, -32, 10, 1)).toBe(-1);
  });

  it('takes its chance from where it is told, so a run is the same twice', () => {
    const tilts = (seed: number) => {
      const w = world({ random: seeded(seed) });
      const i = w.spawn(0, 0, 20, 1);
      return [...w.q.slice(i * 4, i * 4 + 4)];
    };
    expect(tilts(5)).toEqual(tilts(5));
    expect(tilts(5)).not.toEqual(tilts(6));
  });

  it('takes its tuning, with a coin-sized world as the default', () => {
    expect(DEFAULT_TUNING.step).toBe(1 / 120);
    const heavy = world({ tuning: { gravity: 700 } });
    const light = world();
    const a = heavy.spawn(0, -30, 10, 8),
      b = light.spawn(0, -30, 10, 8);
    for (let f = 0; f < 6; f++) {
      heavy.step(DT, () => {});
      light.step(DT, () => {});
    }
    expect(heavy.z[a]).toBeLessThan(light.z[b]);
  });

  it('keeps its sleep bookkeeping straight, and every body out of the rock, while pushers churn a heap', () => {
    const random = seeded(7);
    const w = world({ capacity: 2000, random });
    const heap = { x: -40, y: 15 };
    for (let k = 0; k < 900; k++) {
      const r = Math.sqrt(random()) * 9,
        a = random() * Math.PI * 2;
      w.spawn(k % 50 === 0 ? 1 : 0, heap.x + Math.cos(a) * r, heap.y + Math.sin(a) * r, 1 + random() * 6);
    }
    let pushers: Pusher[] = [];
    for (let f = 0; f < 600; f++) {
      const t = f * DT;
      // the pushers only start after the heap has settled, so sleepers get woken and moved
      pushers =
        f < 120
          ? []
          : [
              sweeper(heap.x, heap.y, 7, t, pushers[0] ?? null),
              sweeper(heap.x + 2, heap.y - 1, 4, -t, pushers[1] ?? null, 1),
            ];
      w.pushers = pushers;
      for (const p of pushers) w.wakeNear(p.x, p.y, 6);
      w.step(DT, () => {});
      const wrong = problems(w);
      if (wrong.length) expect.fail(`frame ${f}: ${wrong.slice(0, 5).join('; ')}`);
    }
    expect(w.loads.length).toBe(2);
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i]) continue;
      const t = tileOf(w.x[i], w.y[i]);
      expect(t, `body ${i} off the grid`).toBeGreaterThanOrEqual(0);
      expect(w.solid[t], `body ${i} in rock at ${w.x[i]},${w.y[i]}`).toBe(0);
      expect(w.z[i]).toBeGreaterThan(-HOLE.depth);
    }
  });

  it('never lets a pusher shove a body into the rock, or through a wall a tile thick', () => {
    for (const thick of [1, 2]) {
      const rock = solid((tx) => tx >= 40 && tx < 40 + thick);
      const face = GRID.originX + 40 * GRID.tile;
      const random = seeded(7 + thick);
      const w = world({ capacity: 2000, solid: rock, random });
      // a band of bodies against the wall, and a big box driven at them, backed off, and driven at them again
      for (let k = 0; k < 500; k++) w.spawn(0, face - 0.5 - random() * 4, -10 + random() * 20, 0.5 + random() * 2);
      for (let f = 0; f < 60; f++) w.step(DT, () => {});
      let x = face - 16;
      let prev: Pusher | null = null;
      for (let f = 0; f < 60 * 5; f++) {
        x += (f % 120 < 90 ? 14 : -14) * DT;
        const p: Pusher = {
          x,
          y: 0,
          z: 1.5,
          yaw: 0,
          hx: 0.3,
          hy: 6,
          hz: 1.5,
          vx: prev ? (x - prev.x) / DT : 0,
          vy: 0,
          spin: 0,
          px: prev?.x ?? x,
          py: 0,
          owner: 0,
        };
        w.pushers = [p];
        w.wakeNear(x + 2, 0, 10);
        w.step(DT, () => {});
        prev = p;
      }
      for (let i = 0; i < w.count; i++) {
        if (!w.alive[i]) continue;
        if (rock[tileOf(w.x[i], w.y[i])]) expect.fail(`wall ${thick} thick: body ${i} in the rock`);
        if (w.x[i] > face) expect.fail(`wall ${thick} thick: body ${i} through to ${w.x[i].toFixed(1)}`);
      }
    }
  });

  it('carries a body along a running belt, and pulls one toward a magnet', () => {
    const w = world();
    w.belts = [{ cx: 30, cy: 20, half: 12, width: 6, dx: 1, dy: 0, speed: 9 }];
    const i = w.spawn(0, 22, 20, 1);
    for (let f = 0; f < 120; f++) w.step(DT, () => {});
    expect(w.x[i] - 22).toBeGreaterThan(3);
    const m = world();
    m.magnet = { x: -40, y: -20, radius: 8, strength: 20 };
    const j = m.spawn(0, -35, -20, 1);
    for (let f = 0; f < 120; f++) {
      m.wakeNear(-40, -20, 8);
      m.step(DT, () => {});
    }
    expect(Math.abs(m.x[j] - -40)).toBeLessThan(4);
  });

  it('rests each body on the floor of the tile under it, and lets one fall from a high tile to a low one', () => {
    // a step: the west half of the floor stands 4 high, the east half is at 0
    const face = GRID.originX + 30 * GRID.tile;
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 0; tx < 30; tx++) floor[ty * GRID.cols + tx] = 4;
    const w = world({ floor, holes: [] });
    const high = w.spawn(0, face - 20, 10, 10),
      low = w.spawn(0, face + 20, 10, 10);
    for (let f = 0; f < 180; f++) w.step(DT, () => {});
    expect(w.z[high]).toBeCloseTo(4 + RADII[0], 2);
    expect(w.z[low]).toBeCloseTo(RADII[0], 2);
    // pushed toward the edge until it goes over, it is never below the floor of any tile it is over
    for (let f = 0; f < 600; f++) {
      if (w.x[high] < face + 0.5) {
        w.wake(high);
        w.vx[high] = 12;
      }
      w.step(DT, () => {});
      const under = w.x[high] < face ? 4 : 0;
      expect(w.z[high], `frame ${f} at x ${w.x[high].toFixed(2)}`).toBeGreaterThan(under + RADII[0] - 0.05);
    }
    expect(w.x[high]).toBeGreaterThan(face);
    expect(w.z[high]).toBeCloseTo(RADII[0], 2);
  });

  it('stops a body at a step face from below, and puts one from under an overhang back out the way it came', () => {
    const face = GRID.originX + 30 * GRID.tile;
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 0; tx < 30; tx++) floor[ty * GRID.cols + tx] = 4;
    const w = world({ floor, holes: [] });
    const i = w.spawn(0, face + 8, 10, RADII[0]);
    for (let f = 0; f < 240; f++) {
      w.wake(i);
      w.vx[i] = -8;
      w.step(DT, () => {});
      expect(w.z[i], `frame ${f}`).toBeLessThan(1);
    }
    expect(w.x[i]).toBeGreaterThanOrEqual(face + RADII[0] - 0.01);
    expect(w.x[i]).toBeLessThan(face + 1);
    // a box drags a body along the low floor into the face: it is shoved out sideways or held, never up onto the step
    const j = w.spawn(0, face + 3, -10, RADII[0]);
    let x = face + 6;
    let prev: Pusher | null = null;
    for (let f = 0; f < 120; f++) {
      x -= 6 * DT;
      const p: Pusher = {
        x,
        y: -10,
        z: 1,
        yaw: 0,
        hx: 0.3,
        hy: 4,
        hz: 1,
        vx: prev ? (x - prev.x) / DT : 0,
        vy: 0,
        spin: 0,
        px: prev?.x ?? x,
        py: -10,
        owner: 0,
      };
      w.pushers = [p];
      w.wakeNear(x, -10, 6);
      w.step(DT, () => {});
      prev = p;
      expect(w.z[j], `frame ${f}`).toBeLessThan(2);
      expect(w.x[j], `frame ${f}`).toBeGreaterThan(face - 0.01);
    }
  });

  it('reports a body that falls below the bottom, with its kind and where, and frees its slot', () => {
    // a floor that ends at a drop: the east third is a pit far below
    const edge = GRID.originX + 40 * GRID.tile;
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 40; tx < GRID.cols; tx++) floor[ty * GRID.cols + tx] = -30;
    const w = world({ floor, holes: [], bottom: -6 });
    const i = w.spawn(1, edge - 3, 5, RADII[1]);
    const fell: { kind: number; x: number; y: number; slot: number }[] = [];
    for (let f = 0; f < 240; f++) {
      if (w.alive[i] && w.x[i] < edge + 0.5) {
        w.wake(i);
        w.vx[i] = 10;
      }
      w.step(DT, (kind, x, y, slot) => fell.push({ kind, x, y, slot }));
    }
    expect(fell).toHaveLength(1);
    expect(fell[0].kind).toBe(1);
    expect(fell[0].slot).toBe(i);
    expect(fell[0].x).toBeGreaterThan(edge);
    expect(Math.abs(fell[0].y - 5)).toBeLessThan(1);
    expect(w.live).toBe(0);
    expect(w.spawn(0, -30, 10, 1)).toBe(i);
  });

  it('lets a body rest on the top of a box, lying flat, and carries it as the box moves', () => {
    const w = world({ holes: [] });
    const box = (x: number, vx: number, px: number): Pusher => ({
      x,
      y: 20,
      z: 1,
      yaw: 0,
      hx: 6,
      hy: 6,
      hz: 1,
      vx,
      vy: 0,
      spin: 0,
      px,
      py: 20,
      owner: 0,
    });
    w.pushers = [box(0, 0, 0)];
    const i = w.spawn(0, 0, 20, 6);
    for (let f = 0; f < 180; f++) w.step(DT, () => {});
    expect(w.z[i]).toBeCloseTo(2 + RADII[0], 1);
    // flat: no tilt left about x or y
    expect(Math.abs(w.q[i * 4])).toBeLessThan(0.05);
    expect(Math.abs(w.q[i * 4 + 1])).toBeLessThan(0.05);
    // asleep on the box, and the box moves off without anyone waking it: it goes along, not left in the air
    expect(w.asleep[i]).toBe(1);
    let x = 0;
    for (let f = 0; f < 120; f++) {
      const was = x;
      x += 5 * DT;
      w.pushers = [box(x, 5, was)];
      w.step(DT, () => {});
    }
    expect(w.x[i]).toBeGreaterThan(x - 2);
    expect(w.z[i]).toBeCloseTo(2 + RADII[0], 1);
  });

  it('wakes only within the height band it is given', () => {
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 0; tx < 30; tx++) floor[ty * GRID.cols + tx] = 4;
    const w = world({ floor, holes: [] });
    const face = GRID.originX + 30 * GRID.tile;
    const up = w.spawn(0, face - 1, 10, 5),
      down = w.spawn(0, face + 1, 10, 1);
    for (let f = 0; f < 240; f++) w.step(DT, () => {});
    expect(w.asleep[up]).toBe(1);
    expect(w.asleep[down]).toBe(1);
    w.wakeNear(face, 10, 4, 3, 6);
    expect(w.asleep[up]).toBe(0);
    expect(w.asleep[down]).toBe(1);
  });

  it('holds a carried body still, and wakes the lot on request', () => {
    const w = world();
    const i = w.spawn(0, 10, 10, 6);
    w.carried[i] = 1;
    for (let f = 0; f < 60; f++) w.step(DT, () => {});
    expect(w.z[i]).toBe(6);
    w.carried[i] = 0;
    for (let f = 0; f < 240; f++) w.step(DT, () => {});
    expect(w.asleep[i]).toBe(1);
    w.wakeAll();
    expect(w.asleep[i]).toBe(0);
  });
});
