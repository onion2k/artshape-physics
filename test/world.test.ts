/**
 * The world, on a grid of its own making: a floor walled with rock, a hole
 * in the middle, and whatever the test puts on it. Nothing here is a coin
 * or a cave; a kind is a radius, and that is all the world knows of one.
 */
import { describe, expect, it } from 'vitest';
import {
  BOTTOM,
  DEFAULT_TUNING,
  World,
  type Grid,
  type Hole,
  type Pusher,
  type Tuning,
  type WorldOptions,
} from '../src/world';

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

  it('says which hole took a body, even one gone below the bottom on the way down, and each only once', () => {
    // The first hole reaches far below the world's bottom and the second does not. What goes down the first is
    // gone once it passes the bottom, as anything is, and is still the hole's.
    const w = world({
      holes: [
        { ...HOLE, depth: 1000 },
        { x: 40, y: 20, radius: 4, depth: 6 },
      ],
      bottom: -6,
    });
    const deep = w.spawn(1, HOLE.x, HOLE.y, 2),
      shallow = w.spawn(0, 40, 20, 2);
    const fell: { slot: number; hole: number; frame: number }[] = [];
    for (let f = 0; f < 240; f++) w.step(DT, (_kind, _x, _y, slot, hole) => fell.push({ slot, hole, frame: f }));
    expect(fell.sort((a, b) => a.slot - b.slot).map(({ slot, hole }) => ({ slot, hole }))).toEqual([
      { slot: deep, hole: 0 },
      { slot: shallow, hole: 1 },
    ]);
    // eight units fallen takes half a second, not the five and a half it would take to fall a thousand
    expect(fell[0].frame).toBeLessThan(60);
    expect(w.live).toBe(0);
  });

  it('says a body over two holes that overlap went down the first of them in the list', () => {
    // the first reaches from x 2 to 10 and the second from -5 to 5; the body is dropped where both are
    const w = world({ holes: [{ x: 6, y: 0, radius: 4, depth: 6 }, HOLE] });
    w.spawn(0, 3.5, 0, 2);
    const holes: number[] = [];
    for (let f = 0; f < 240; f++) w.step(DT, (_kind, _x, _y, _slot, hole) => holes.push(hole));
    expect(holes).toEqual([0]);
  });

  it('says a body that fell out of the bottom came out of no hole', () => {
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 40; tx < GRID.cols; tx++) floor[ty * GRID.cols + tx] = -30;
    const w = world({ floor, holes: [], bottom: -6 });
    w.spawn(0, GRID.originX + 45 * GRID.tile, 5, 1);
    const holes: number[] = [];
    for (let f = 0; f < 120; f++) w.step(DT, (_kind, _x, _y, _slot, hole) => holes.push(hole));
    expect(BOTTOM).toBe(-1);
    expect(holes).toEqual([BOTTOM]);
  });

  it('never reports a carried body, even one held over a hole below the bottom', () => {
    const w = world({ bottom: -6 });
    const i = w.spawn(0, HOLE.x, HOLE.y, -8);
    w.carried[i] = 1;
    for (let f = 0; f < 60; f++) w.step(DT, () => expect.fail('a carried body is not the world to report'));
    expect(w.alive[i]).toBe(1);
  });

  it('hits a sleeping body off at the speed given, just as waking it and writing its speed does', () => {
    const setUp = () => {
      const w = world();
      const i = w.spawn(0, -30, 10, 1);
      for (let f = 0; f < 180; f++) w.step(DT, () => {});
      expect(w.asleep[i]).toBe(1);
      return { w, i };
    };
    const hit = setUp(),
      written = setUp();
    hit.w.hit(hit.i, 12, -5, 3);
    written.w.wake(written.i);
    written.w.vx[written.i] = 12;
    written.w.vy[written.i] = -5;
    written.w.vz[written.i] = 3;
    expect(hit.w.asleep[hit.i]).toBe(0);
    expect([hit.w.vx[hit.i], hit.w.vy[hit.i], hit.w.vz[hit.i]]).toEqual([12, -5, 3]);
    for (let f = 0; f < 120; f++) {
      hit.w.step(DT, () => {});
      written.w.step(DT, () => {});
    }
    for (const a of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'q'] as const) expect(hit.w[a]).toEqual(written.w[a]);
    expect(hit.w.x[hit.i]).toBeGreaterThan(-30 + 1);
  });

  it('adds a hit to the speed a body already has', () => {
    const w = world();
    const i = w.spawn(0, -30, 10, 1, 5, 0, 0);
    w.hit(i, 3, 4, 0);
    expect([w.vx[i], w.vy[i]]).toEqual([8, 4]);
  });

  it('leaves be a hit on a dead body, a slot never used, and a carried body', () => {
    const w = world();
    const gone = w.spawn(0, -30, 10, 1);
    w.remove(gone);
    w.hit(gone, 10, 0, 0);
    expect(w.alive[gone]).toBe(0);
    expect(w.vx[gone]).toBe(0);
    w.hit(w.count + 3, 10, 0, 0);
    w.hit(w.capacity + 3, 10, 0, 0);
    expect(w.live).toBe(0);
    const held = w.spawn(0, 10, 10, 6);
    w.carried[held] = 1;
    w.hit(held, 10, 0, 5);
    expect([w.vx[held], w.vy[held], w.vz[held]]).toEqual([0, 0, 0]);
    for (let f = 0; f < 30; f++) w.step(DT, () => {});
    expect([w.x[held], w.z[held]]).toEqual([10, 6]);
    // and let go, it drops where it was held, with nothing of the hit in it
    w.carried[held] = 0;
    for (let f = 0; f < 60; f++) w.step(DT, () => {});
    expect(w.x[held]).toBeCloseTo(10, 5);
  });

  it('keeps its sleep bookkeeping straight when sleepers in a heap are hit', () => {
    const random = seeded(4);
    const w = world({ capacity: 400, random });
    for (let k = 0; k < 300; k++) w.spawn(0, -40 + random() * 8, 15 + random() * 8, 1 + random() * 4);
    for (let f = 0; f < 240; f++) w.step(DT, () => {});
    for (let f = 0; f < 120; f++) {
      if (f % 10 === 0) for (let k = 0; k < 5; k++) w.hit((f * 7 + k * 53) % 300, 8, -3, 2);
      w.step(DT, () => {});
      const wrong = problems(w);
      if (wrong.length) expect.fail(`frame ${f}: ${wrong.slice(0, 5).join('; ')}`);
    }
  });

  it('settles a slow ball by the figures it is given: a slow roll goes on unsettled, or settles only below a lower speed', () => {
    const roll = (tuning: Partial<Tuning>, speed: number) => {
      const w = world({ holes: [], tuning: { floorDrag: 0, ...tuning } });
      const i = w.spawn(0, -60, 10, RADII[0], speed, 0, 0);
      for (let f = 0; f < 300; f++) w.step(DT, () => {});
      return w.x[i] + 60;
    };
    expect(DEFAULT_TUNING.settle).toBe(0.96);
    expect(DEFAULT_TUNING.settleBelow).toBe(1.5);
    // at the defaults a ball at 1 u/s is under the settling speed, and stops within a third of a unit
    expect(roll({}, 1)).toBeLessThan(0.3);
    // unsettled, nothing slows it on a floor with no drag, and it rolls on for the five seconds
    expect(roll({ settle: 1 }, 1)).toBeGreaterThan(4);
    // settling only below half a unit a second, a ball at 0.8 is not settled at all
    expect(roll({ settleBelow: 0.25 }, 0.8)).toBeGreaterThan(3);
    expect(roll({}, 0.8)).toBeLessThan(0.3);
  });

  it('puts a slow roll to sleep by how far it goes, not how fast, so unsettled it sleeps still moving', () => {
    // at 0.6 u/s a ball goes 0.2 in a sleep window, under the drift a sleeper may have
    const w = world({ holes: [], tuning: { floorDrag: 0, settle: 1 } });
    const i = w.spawn(0, -60, 10, RADII[0], 0.6, 0, 0);
    let before = 0;
    for (let f = 0; f < 300 && !w.asleep[i]; f++) {
      before = w.vx[i];
      w.step(DT, () => {});
    }
    expect(w.asleep[i]).toBe(1);
    expect(before).toBeGreaterThan(0.55);
    expect(w.vx[i]).toBe(0);
  });

  /** A ball sent at a wall, at 20 u/s unless told: how fast it leaves it, across the wall and along it. */
  const offWall = (over: Partial<WorldOptions>, kind = 0, angle = 0, x = 20, speed = 20) => {
    const w = world({ holes: [], solid: solid((tx) => tx === 40), ...over, tuning: { floorDrag: 0, ...over.tuning } });
    const i = w.spawn(kind, x, 0, RADII[kind], speed * Math.cos(angle), speed * Math.sin(angle), 0);
    for (let f = 0; f < 60 && w.vx[i] > 0; f++) w.step(DT, () => {});
    return { across: -w.vx[i], along: w.vy[i] };
  };

  it('bounces a ball off the rock by the wall restitution, keeping its speed along the wall', () => {
    expect(DEFAULT_TUNING.wallRestitution).toBe(0.1);
    expect(offWall({}).across).toBeCloseTo(2, 1);
    expect(offWall({ tuning: { wallRestitution: 0.8 } }).across).toBeCloseTo(16, 0);
    const slant = offWall({ tuning: { wallRestitution: 0.8 } }, 0, Math.PI / 4);
    expect(slant.across).toBeCloseTo(0.8 * 20 * Math.SQRT1_2, 0);
    expect(slant.along).toBeCloseTo(20 * Math.SQRT1_2, 1);
    // at a restitution of one, the angle it leaves at is the angle it came in at
    const mirror = offWall({ tuning: { wallRestitution: 1 } }, 0, Math.PI / 4);
    expect((Math.atan2(mirror.along, mirror.across) * 180) / Math.PI).toBeCloseTo(45, 0);
  });

  it("bounces a kind by the wall's figure times its own bounce", () => {
    const tuning = { wallRestitution: 0.8 };
    expect(offWall({ tuning, bounce: [0.5, 1] }).across).toBeCloseTo(8, 0);
    expect(offWall({ tuning, bounce: [0.5, 1] }, 1).across).toBeCloseTo(16, 0);
  });

  it('bounces off the face of a raised floor tile, and off the edge of the grid, as off rock', () => {
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 40; tx < GRID.cols; tx++) floor[ty * GRID.cols + tx] = 4;
    const tuning = { wallRestitution: 0.8 };
    expect(offWall({ tuning, solid: solid(), floor }).across).toBeCloseTo(16, 0);
    // no border of rock: past the last column is off the grid, which is a wall too
    const open = new Uint8Array(GRID.cols * GRID.rows);
    expect(offWall({ tuning, solid: open }, 0, 0, GRID.originX + GRID.cols * GRID.tile - 10).across).toBeCloseTo(16, 0);
  });

  it("bounces off the floor by the restitution times the kind's bounce", () => {
    const drop = (bounce: number) => {
      const w = world({ holes: [], radii: [0.42, 0.42], bounce: [bounce, 1], tuning: { restitution: 0.6 } });
      const i = w.spawn(0, -30, 10, 6);
      let landed = false,
        high = 0;
      for (let f = 0; f < 180; f++) {
        w.step(DT, () => {});
        if (w.z[i] < RADII[0] + 0.05) landed = true;
        else if (landed) high = Math.max(high, w.z[i]);
      }
      return high - RADII[0];
    };
    // From 6 up the ball lands at 28 u/s, and at 0.6 leaves at 16.8, which carries it 2 up. At half the bounce it
    // leaves at half the speed, and rises a quarter as high.
    const bouncy = drop(1),
      dull = drop(0.5);
    expect(bouncy).toBeGreaterThan(1.8);
    expect(bouncy).toBeLessThan(2.1);
    expect(dull / bouncy).toBeCloseTo(0.25, 1);
  });

  it('keeps a ball rolling on a floor it bounces off harder than it met it on the floor, given bounceFrom', () => {
    // Gravity draws a rolling ball into the floor at 0.58 u/s a step. Bounced back faster than that, it skims a
    // hair above the floor, where nothing drags it, and rolls half as far again. Below bounceFrom it only stops.
    const roll = (bounce: number, bounceFrom: number) => {
      const w = world({
        holes: [],
        radii: [1, 1],
        bounce: [bounce, 1],
        tuning: { restitution: 0.9, floorDrag: 0.8, bounceFrom },
      });
      const i = w.spawn(0, -80, 10, 1, 20, 0, 0);
      for (let f = 0; f < 300; f++) w.step(DT, () => {});
      return w.x[i] + 80;
    };
    expect(DEFAULT_TUNING.bounceFrom).toBe(0);
    const dead = roll(0, 0);
    expect(roll(1.2, 0)).toBeGreaterThan(dead + 5);
    expect(roll(1.2, 2)).toBeCloseTo(dead, 1);
  });

  it('bounces two balls apart by the restitution times the mean of their bounce, as fast as they met', () => {
    const w = world({ holes: [], radii: [1, 1], bounce: [1, 0.5], tuning: { floorDrag: 0, restitution: 0.5 } });
    const a = w.spawn(0, -20, 0, 1, 10, 0, 0),
      b = w.spawn(1, -10, 0, 1, -10, 0, 0);
    for (let f = 0; f < 60 && w.vx[b] - w.vx[a] < 0; f++) w.step(DT, () => {});
    // met at 20, parted at a half of three quarters of that
    expect(w.vx[b] - w.vx[a]).toBeCloseTo(0.5 * 0.75 * 20, 0);
  });

  it('stops a ball against a wall that it meets slower than bounceFrom, and bounces one that meets it faster', () => {
    const tuning = { wallRestitution: 0.8, bounceFrom: 2 };
    expect(offWall({ tuning }, 0, 0, 29, 1.5).across).toBeCloseTo(0, 6);
    expect(offWall({ tuning }, 0, 0, 29, 3).across).toBeCloseTo(2.4, 1);
  });

  it('bounces as before where nothing is said: a kind with no bounce given is a kind of bounce 1', () => {
    const tuning = { wallRestitution: 0.8 };
    expect(offWall({ tuning, bounce: [] })).toEqual(offWall({ tuning }));
    expect(offWall({ tuning, bounce: [1, 1] })).toEqual(offWall({ tuning }));
  });

  it('with sleepInAir off, never leaves a bouncing ball asleep in the air, and lets every one rest on the floor', () => {
    // dropped from a spread of heights onto a floor it bounces off at 0.6: a ball back at the height its sleep window
    // opened at, by the time it closes, has gone no distance by the window's reckoning
    const drops = (sleepInAir: boolean) => {
      let hung = 0,
        resting = 0;
      for (let k = 0; k < 20; k++) {
        const w = world({ holes: [], tuning: { restitution: 0.6, sleepInAir } });
        const i = w.spawn(0, -30, 10, 3 + k * 0.17);
        for (let f = 0; f < 600; f++) w.step(DT, () => {});
        if (w.asleep[i] && w.z[i] > RADII[0] + 0.01) hung++;
        if (w.asleep[i] && Math.abs(w.z[i] - RADII[0]) < 0.01) resting++;
      }
      return { hung, resting };
    };
    expect(DEFAULT_TUNING.sleepInAir).toBe(true);
    // as it always was, some hang
    expect(drops(true).hung).toBeGreaterThan(0);
    expect(drops(false)).toEqual({ hung: 0, resting: 20 });
  });

  it('with sleepInAir off, settles a heap as it does with it on, a big ball nested among small ones too', () => {
    // A big ball among small ones is held up by contacts none of which is under it by the floor's reckoning, which
    // wants one within sixty degrees of straight down; held to that, it never slept. Anything below its middle
    // holds it up.
    for (const seed of [1, 2, 3]) {
      const heap = (sleepInAir: boolean) => {
        const random = seeded(seed);
        const w = world({ capacity: 400, holes: [], random, tuning: { sleepInAir } });
        for (let k = 0; k < 300; k++) {
          const r = Math.sqrt(random()) * 5,
            a = random() * Math.PI * 2;
          w.spawn(k % 10 ? 0 : 1, Math.cos(a) * r, Math.sin(a) * r, 1 + random() * 6);
        }
        for (let f = 0; f < 600; f++) w.step(DT, () => {});
        let awake = 0;
        for (let i = 0; i < w.count; i++) if (!w.asleep[i]) awake++;
        return awake;
      };
      const on = heap(true);
      expect(on).toBeLessThan(10);
      expect(heap(false), `seed ${seed}`).toBe(on);
    }
  });

  it('with sleepInAir off, lets a ball on the top of a box rest there and sleep, and carries it', () => {
    const w = world({ holes: [], tuning: { sleepInAir: false } });
    const box: Pusher = {
      x: 0,
      y: 20,
      z: 1,
      yaw: 0,
      hx: 6,
      hy: 6,
      hz: 1,
      vx: 0,
      vy: 0,
      spin: 0,
      px: 0,
      py: 20,
      owner: 0,
    };
    w.pushers = [box];
    const i = w.spawn(0, 0, 20, 6);
    for (let f = 0; f < 180; f++) w.step(DT, () => {});
    expect(w.asleep[i]).toBe(1);
    expect(w.z[i]).toBeCloseTo(2 + RADII[0], 1);
  });

  /** A world whose floor is flat but for one strip of tiles, two tiles wide from column 40 (x 30 to 36), at a height. */
  const strip = (height: number, over: Partial<WorldOptions> = {}) => {
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 40; tx < 42; tx++) floor[ty * GRID.cols + tx] = height;
    return world({ holes: [], floor, radii: [1, 1], ...over, tuning: { floorDrag: 0, ...over.tuning } });
  };
  const STRIP = GRID.originX + 40 * GRID.tile;

  it('makes a floor tile standing a radius or more above a rolling ball a wall to it, and climbs a lower one at any speed', () => {
    const roll = (height: number, speed: number) => {
      const w = strip(height);
      const i = w.spawn(0, STRIP - 3, 0, 1, speed, 0, 0);
      let highest = 0;
      for (let f = 0; f < 400; f++) {
        w.step(DT, () => {});
        highest = Math.max(highest, w.z[i]);
      }
      return { x: w.x[i], highest };
    };
    for (const speed of [2, 5, 20]) {
      for (const height of [1, 1.5]) expect(roll(height, speed).x, `${height} high at ${speed}`).toBeLessThan(STRIP);
      // lower than its radius, it is set on the top of the tile and rolls on over it
      for (const height of [0.5, 0.9]) {
        const { x, highest } = roll(height, speed);
        expect(x, `${height} high at ${speed}`).toBeGreaterThan(STRIP + 6);
        expect(highest).toBeCloseTo(height + 1, 2);
      }
    }
  });

  it('lets a ball in flight clear a wall below its bottom, sets one on the top of a wall between its bottom and middle, and bounces one off a wall above its middle', () => {
    const fly = (z: number) => {
      const w = strip(2);
      const i = w.spawn(0, STRIP - 1.2, 0, z, 40, 0, 0);
      // whether it went up at any step while it was over the wall
      let rose = false,
        was = z;
      for (let f = 0; f < 60; f++) {
        w.step(DT, () => {});
        if (w.z[i] > was + 1e-6 && w.x[i] > STRIP - 1 && w.x[i] < STRIP + 7) rose = true;
        was = w.z[i];
      }
      return { x: w.x[i], rose };
    };
    // its bottom above the top: over it, falling all the way
    expect(fly(3.5).rose).toBe(false);
    expect(fly(3.5).x).toBeGreaterThan(STRIP + 6);
    // its middle above the top and its bottom not: put up onto it, and on over it
    expect(fly(2.6).rose).toBe(true);
    expect(fly(2.6).x).toBeGreaterThan(STRIP + 6);
    // its middle below the top: a wall
    expect(fly(1.8).x).toBeLessThan(STRIP);
  });

  it('takes a ball that rolls onto water, a floor far below the bottom, and reports it out of the bottom over the water; one thrown over it lands beyond', () => {
    const water = () => strip(-30, { bottom: -6 });
    const w = water();
    const rolled = w.spawn(0, STRIP - 3, 0, 1, 10, 0, 0);
    const fell: { hole: number; x: number; slot: number }[] = [];
    for (let f = 0; f < 120; f++) w.step(DT, (_kind, x, _y, slot, hole) => fell.push({ hole, x, slot }));
    expect(fell).toHaveLength(1);
    expect(fell[0].slot).toBe(rolled);
    expect(fell[0].hole).toBe(BOTTOM);
    expect(fell[0].x).toBeGreaterThan(STRIP);
    expect(fell[0].x).toBeLessThan(STRIP + 6);
    // from the bank, up and over the six units of water
    const v = water();
    const thrown = v.spawn(0, STRIP - 1, 0, 1);
    v.hit(thrown, 25, 0, 15);
    for (let f = 0; f < 120; f++) v.step(DT, () => expect.fail('it clears the water'));
    expect(v.x[thrown]).toBeGreaterThan(STRIP + 6);
    expect(v.z[thrown]).toBeCloseTo(1, 2);
  });

  /** A box across the way, 1 thick and 12 long, still unless told otherwise. */
  const block = (x: number, more: Partial<Pusher> = {}): Pusher => ({
    x,
    y: 0,
    z: 1,
    yaw: 0,
    hx: 0.5,
    hy: 6,
    hz: 1,
    vx: 0,
    vy: 0,
    spin: 0,
    px: x,
    py: 0,
    owner: 0,
    ...more,
  });
  /** A ball sent at a still box, at 20 u/s and an angle: how fast it leaves, across the box's face and along it. */
  const offBox = (more: Partial<Pusher>, angle = 0, tuning: Partial<Tuning> = {}) => {
    const w = world({ holes: [], tuning: { floorDrag: 0, ...tuning } });
    w.pushers = [block(0, more)];
    const i = w.spawn(0, -5, 0, RADII[0], 20 * Math.cos(angle), 20 * Math.sin(angle), 0);
    for (let f = 0; f < 60 && w.vx[i] > 0; f++) w.step(DT, () => {});
    // a few frames more, clear of the box, for what it carried to be done
    for (let f = 0; f < 5; f++) w.step(DT, () => {});
    return { across: -w.vx[i], along: w.vy[i] };
  };

  it('bounces a ball off a still box by its restitution, and by nothing if it has none', () => {
    expect(offBox({}).across).toBeCloseTo(0, 3);
    expect(offBox({ restitution: 0.8 }).across).toBeCloseTo(16, 0);
    expect(offBox({ restitution: 0.8, carry: 0 }).across).toBeCloseTo(16, 0);
    // and the kind's bounce scales it, as it does every restitution
    const w = world({ holes: [], bounce: [0.5, 1], tuning: { floorDrag: 0 } });
    w.pushers = [block(0, { restitution: 0.8 })];
    const i = w.spawn(0, -5, 0, RADII[0], 20, 0, 0);
    for (let f = 0; f < 60 && w.vx[i] > 0; f++) w.step(DT, () => {});
    expect(-w.vx[i]).toBeCloseTo(8, 0);
  });

  it('stops a ball against a bouncing box that it meets slower than bounceFrom', () => {
    // settling off, so a ball bounced off at 1.2 u/s is not also settled
    const slow = (bounceFrom: number) => {
      const w = world({ holes: [], tuning: { floorDrag: 0, settle: 1, bounceFrom } });
      w.pushers = [block(0, { restitution: 0.8 })];
      const i = w.spawn(0, -1.2, 0, RADII[0], 1.5, 0, 0);
      for (let f = 0; f < 60 && w.vx[i] > 0; f++) w.step(DT, () => {});
      return -w.vx[i];
    };
    expect(slow(0)).toBeCloseTo(1.2, 1);
    expect(slow(2)).toBeCloseTo(0, 3);
  });

  it('lets a ball glance off a still box keeping its speed along the face with carry at 0, and drags it with the default', () => {
    const slant = Math.PI / 6;
    // at 30 degrees off square: 20 sin 30 = 10 along the face
    expect(offBox({ carry: 0 }, slant).along).toBeCloseTo(10, 1);
    expect(offBox({}, slant).along).toBeLessThan(9);
    // bounced, it is carried along the face only, and leaves across it as fast as the bounce says
    const bounced = offBox({ restitution: 0.5 }, slant);
    expect(bounced.across).toBeCloseTo(0.5 * 20 * Math.cos(slant), 0);
    expect(bounced.along).toBeLessThan(10);
  });

  it('knocks a ball at rest off a moving box at its speed and its restitution again, at any frame length', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      for (const [restitution, leaves] of [
        [0, 10],
        [0.5, 15],
      ]) {
        const w = world({ holes: [], tuning: { floorDrag: 0 } });
        const i = w.spawn(0, 2, 0, RADII[0]);
        let x = -1;
        for (let f = 0; f < 0.6 / dt; f++) {
          x += 10 * dt;
          w.pushers = [block(x, { vx: 10, px: x, restitution })];
          w.step(dt, () => {});
        }
        expect(w.vx[i], `restitution ${restitution} at ${Math.round(1 / dt)} fps`).toBeCloseTo(leaves, 0);
      }
    }
  });

  it('bounces off a turning blade by the speed of the blade where it struck, and its restitution', () => {
    // a blade 8 long from a pivot at the origin, turning at 2 rad/s; balls in its way at 2.5 and 5 out
    const strike = (restitution: number) => {
      const w = world({ holes: [], radii: [0.42, 0.42], tuning: { floorDrag: 0 } });
      const at = Math.PI / 6;
      const near = w.spawn(0, 2.5 * Math.cos(at), 2.5 * Math.sin(at), 0.42),
        far = w.spawn(0, 5 * Math.cos(at), 5 * Math.sin(at), 0.42);
      for (let f = 0; f < 30; f++) {
        const a = 2 * f * DT;
        w.pushers = [
          {
            x: 4 * Math.cos(a),
            y: 4 * Math.sin(a),
            z: 1,
            yaw: a,
            hx: 4,
            hy: 0.25,
            hz: 1,
            vx: 0,
            vy: 0,
            spin: 2,
            px: 0,
            py: 0,
            owner: 0,
            restitution,
          },
        ];
        w.step(DT, () => {});
      }
      return [Math.hypot(w.vx[near], w.vy[near]), Math.hypot(w.vx[far], w.vy[far])];
    };
    const [near, far] = strike(0.5);
    expect(far / near).toBeCloseTo(2, 0);
    // the blade moves at 2 × 5 = 10 where it meets the far ball, and at 0.5 sends it off at 15
    expect(far).toBeGreaterThan(13);
    expect(far).toBeLessThan(16);
    expect(strike(0)[1]).toBeLessThan(11);
  });

  it('lets a ball rest on the top of a bouncing box, carried and asleep, given bounceFrom', () => {
    const w = world({ holes: [], tuning: { bounceFrom: 2, sleepInAir: false } });
    const top = (x: number, vx: number): Pusher => ({ ...block(x, { vx, restitution: 0.8 }), hx: 6, y: 20, py: 20 });
    w.pushers = [top(0, 0)];
    const i = w.spawn(0, 0, 20, 6);
    for (let f = 0; f < 240; f++) w.step(DT, () => {});
    expect(w.asleep[i]).toBe(1);
    expect(w.z[i]).toBeCloseTo(2 + RADII[0], 1);
    let x = 0;
    for (let f = 0; f < 120; f++) {
      x += 5 * DT;
      w.pushers = [top(x, 5)];
      w.step(DT, () => {});
    }
    expect(w.x[i]).toBeGreaterThan(x - 2);
    expect(w.z[i]).toBeCloseTo(2 + RADII[0], 1);
  });

  it('counts the same load on a bouncing box as on a dead one', () => {
    const load = (restitution: number) => {
      const w = world({ holes: [] });
      for (let k = 0; k < 20; k++) w.spawn(0, 3 + (k % 5) * 0.9, -2 + Math.floor(k / 5) * 0.9, RADII[0]);
      for (let f = 0; f < 60; f++) w.step(DT, () => {});
      w.pushers = [block(1.5, { vx: 0.001, restitution })];
      w.step(DT, () => {});
      return w.load;
    };
    expect(load(0.8)).toBe(load(0));
  });
});
