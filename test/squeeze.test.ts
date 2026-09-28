/**
 * Coins squeezed in a heap, with squeezedStill and without.
 *
 * A disc's speed at the end of a step is how far it got, less what it was
 * pushed beyond stopping. In a heap a coin is squeezed: put out of the coin
 * under it, and pushed back into it by the coins lying on it, a little more
 * of one push than the other counted as beyond stopping. It gets nowhere,
 * and is read back going at a unit a second into the coin under it, and
 * spinning. Two such coins stay a twentieth of a unit into each other for
 * good, too far in to sleep, and wake whatever lies on them. Without this
 * file nothing holds squeezedStill to what it is for, nor shows that the
 * heap it is for keeps its pair awake without it. Heaps of three hundred
 * coins take a second each to settle, so the file is one of its own and is
 * run beside the rest rather than after them.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, World, type Grid, type Pusher } from '../src/world';

const DT = 1 / 60;
/** The fixed step: a frame of this long is one step, so what a body did in a step can be read between frames. */
const STEP = DEFAULT_TUNING.step;
/** The discs' own tests' floor: tiles a unit across, and a coin. */
const GRID: Grid = { cols: 40, rows: 40, originX: -20, originY: -20, tile: 1 };
const R = 0.42,
  H = 0.24;
/** How far two things may overlap at rest and still be said not to cut: a twentieth of a unit. */
const CUT = 0.05;

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A grid all floor but for a border of rock. */
function walled(): Uint8Array {
  const out = new Uint8Array(GRID.cols * GRID.rows);
  for (let ty = 0; ty < GRID.rows; ty++)
    for (let tx = 0; tx < GRID.cols; tx++)
      out[ty * GRID.cols + tx] = tx === 0 || ty === 0 || tx === GRID.cols - 1 || ty === GRID.rows - 1 ? 1 : 0;
  return out;
}

/** Coins dropped within `spread` of the middle, from half a unit to four and a half up, as the disc tests drop a heap. */
function heap(seed: number, count: number, spread: number, squeezedStill: boolean): World {
  const random = seeded(seed);
  const w = new World({
    capacity: count,
    grid: GRID,
    solid: walled(),
    radii: [R],
    thickness: [H],
    random,
    tuning: { cell: 1.2, squeezedStill },
  });
  for (let k = 0; k < count; k++) {
    const r = Math.sqrt(random()) * spread,
      t = random() * Math.PI * 2;
    w.spawn(0, Math.cos(t) * r, Math.sin(t) * r, 0.5 + random() * 4);
  }
  return w;
}

const run = (w: World, seconds: number) => {
  for (let f = 0; f < seconds * 60; f++) w.step(DT, () => {});
};

/** A heap left alone and watched: how many of its coins went from asleep to awake, and how many are awake at the end. */
function watched(w: World, seconds: number): { woken: number; awake: number } {
  const was = Array.from(w.asleep);
  let woken = 0;
  for (let f = 0; f < seconds * 60; f++) {
    w.step(DT, () => {});
    for (let i = 0; i < w.count; i++) {
      if (was[i] && !w.asleep[i]) woken++;
      was[i] = w.asleep[i];
    }
  }
  let awake = 0;
  for (let i = 0; i < w.count; i++) if (!w.asleep[i]) awake++;
  return { woken, awake };
}

/** The lowest point of a disc: its centre, less its rim's drop and its face's. */
const lowest = (w: World, i: number) => {
  const nz = Math.abs(w.axis(i)[2]);
  return w.z[i] - R * Math.sqrt(Math.max(0, 1 - nz * nz)) - (H / 2) * nz;
};

/**
 * Every step for `seconds`, the discs awake at its end read back going faster
 * than they went in it, or spinning faster than they turned: how many times,
 * and by how much at the worst. What a disc turned is the turn from how it was
 * to how it is, as the step reads its spin back from it.
 */
function readBack(w: World, seconds: number): { faster: number; byV: number; spun: number; byW: number } {
  const out = { faster: 0, byV: 0, spun: 0, byW: 0 };
  for (let s = 0; s < seconds / STEP; s++) {
    const x = w.x.slice(),
      y = w.y.slice(),
      z = w.z.slice(),
      q = w.q.slice();
    w.step(STEP, () => {});
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i] || w.asleep[i] || w.h[i] === 0) continue;
      const went = Math.hypot(w.x[i] - x[i], w.y[i] - y[i], w.z[i] - z[i]) / STEP;
      const v = Math.hypot(w.vx[i], w.vy[i], w.vz[i]);
      // a thousandth of a unit a second over, for the rounding of a position kept in a float
      if (v > went + 1e-3) {
        out.faster++;
        out.byV = Math.max(out.byV, v - went);
      }
      const o = i * 4;
      const ax = -q[o],
        ay = -q[o + 1],
        az = -q[o + 2],
        aw = q[o + 3];
      const bx = w.q[o],
        by = w.q[o + 1],
        bz = w.q[o + 2],
        bw = w.q[o + 3];
      const turned =
        (2 *
          Math.hypot(
            bw * ax + bx * aw + by * az - bz * ay,
            bw * ay + by * aw + bz * ax - bx * az,
            bw * az + bz * aw + bx * ay - by * ax,
          )) /
        STEP;
      const spin = Math.hypot(w.wx[i], w.wy[i], w.wz[i]);
      if (spin > turned + 1e-2) {
        out.spun++;
        out.byW = Math.max(out.byW, spin - turned);
      }
    }
  }
  return out;
}

describe('a coin squeezed in a heap', () => {
  it('with squeezedStill, comes to rest, where without it a pair squeezed into each other stays awake for good and wakes what lies on it', () => {
    // Three hundred coins dropped within three and a half units of the middle and left eight seconds: from this
    // seed, without it, a pair of coins leaning in a shingle is left about a twentieth into each other, going
    // nowhere and read back going at a unit a second, and wakes the coins lying on it every third of a second.
    const without = heap(26, 300, 3.5, false);
    run(without, 8);
    const left = watched(without, 2);
    expect(left.awake, 'without it, coins left awake').toBeGreaterThan(0);
    expect(left.woken, 'and waking what lies on them').toBeGreaterThan(0);

    const w = heap(26, 300, 3.5, true);
    run(w, 8);
    expect(watched(w, 2), 'with it, every coin asleep and none woken again').toEqual({ woken: 0, awake: 0 });
    for (let i = 0; i < w.count; i++) expect(lowest(w, i), `disc ${i} through the floor`).toBeGreaterThan(-CUT);
    expect(w.deepest(true).depth, 'nothing at rest cuts anything').toBeLessThanOrEqual(CUT + 1e-4);
    // the same way twice, from one seed
    const again = heap(26, 300, 3.5, true);
    run(again, 10);
    expect([...again.x]).toEqual([...w.x]);
    expect([...again.q]).toEqual([...w.q]);
  });

  it('with squeezedStill, is never read back going faster than it went in a step, nor spinning faster than it turned, where without it one is every few steps', () => {
    // A heap coming to rest is squeezed all through, and not only in a pair that never rests: each of these two
    // settles with a quarter of its coins' steps read back faster than they went, by up to five units a second.
    for (const seed of [1, 2]) {
      const without = readBack(heap(seed, 100, 2, false), 3);
      expect(without.faster, `seed ${seed}: without it, read back faster than it went`).toBeGreaterThan(100);
      expect(without.spun, `seed ${seed}: without it, spinning faster than it turned`).toBeGreaterThan(100);
      expect(readBack(heap(seed, 100, 2, true), 3), `seed ${seed}: with it`).toEqual({
        faster: 0,
        byV: 0,
        spun: 0,
        byW: 0,
      });
    }
  });

  it('with squeezedStill, keeps to it on every path that pushes a coin: a box driving a bed over a lip, down a hole, round a post and into the rock', () => {
    // A floor raised half a unit as far as x = 2, with a hole cut in it, a step down beyond, a post, and rock with a
    // wall standing out from the east edge to make a corner. A bed of coins, some dropped on it at a tilt and some
    // hard, as from a tier above, and a box driving the lot east and back, a fixed step at a time so that what each
    // coin did in a step can be read.
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 0; tx < 22; tx++) floor[ty * GRID.cols + tx] = 0.5;
    const solid = walled();
    for (let tx = 30; tx < GRID.cols; tx++) solid[25 * GRID.cols + tx] = 1;
    const random = seeded(7);
    const w = new World({
      capacity: 300,
      grid: GRID,
      solid,
      floor,
      radii: [R],
      thickness: [H],
      holes: [{ x: -3, y: -4, radius: 1.2, depth: 6 }],
      random,
      tuning: { cell: 1.2, squeezedStill: true },
    });
    w.bumpers = [{ x: 6, y: -2, radius: 0.8, top: 2, restitution: 1 }];
    for (let gx = 0; gx < 12; gx++)
      for (let gy = 0; gy < 14; gy++) {
        const i = w.spawn(0, -14 + gx * 0.9 + random() * 0.04, -6 + gy * 0.9 + random() * 0.04, 0.5 + H / 2);
        w.setOrientation(i, 0, 0, 0, 1);
      }
    for (let k = 0; k < 40; k++) w.spawn(0, -14 + random() * 10, -6 + random() * 12, 2 + random() * 2);
    for (let k = 0; k < 10; k++) w.spawn(0, -12 + k, 4, 2.5, 0.5, -1.5, -17);
    const fell = new Map<number, number>();
    const collect = (_kind: number, _x: number, _y: number, i: number, hole: number) => {
      expect(hole, `disc ${i} down the hole`).toBe(0);
      fell.set(i, (fell.get(i) ?? 0) + 1);
    };
    let x = -16,
      was = x;
    const rule = { faster: 0, spun: 0, inRock: 0 };
    for (let s = 0; s < 16 / STEP; s++) {
      // east at four a second for seven seconds, back for a second, and then still for the rest to settle
      was = x;
      if (s < 7 / STEP) x += 4 * STEP;
      else if (s < 8 / STEP) x -= 4 * STEP;
      w.pushers = [
        {
          x,
          y: 2,
          z: 0.7,
          yaw: 0.1,
          hx: 0.3,
          hy: 7,
          hz: 0.7,
          vx: (x - was) / STEP,
          vy: 0,
          spin: 0,
          px: x,
          py: 2,
          owner: 0,
        },
      ];
      if (x !== was) w.wakeNear(x + 1.5, 2, 9);
      const x0 = w.x.slice(),
        y0 = w.y.slice(),
        z0 = w.z.slice(),
        q0 = w.q.slice();
      w.step(STEP, collect);
      for (let i = 0; i < w.count; i++) {
        if (!w.alive[i]) continue;
        const tx = Math.floor((w.x[i] - GRID.originX) / GRID.tile),
          ty = Math.floor((w.y[i] - GRID.originY) / GRID.tile);
        if (solid[ty * GRID.cols + tx]) rule.inRock++;
        if (w.asleep[i]) continue;
        const went = Math.hypot(w.x[i] - x0[i], w.y[i] - y0[i], w.z[i] - z0[i]) / STEP;
        if (Math.hypot(w.vx[i], w.vy[i], w.vz[i]) > went + 1e-3) rule.faster++;
        const o = i * 4;
        const turned =
          (2 *
            Math.hypot(
              w.q[o + 3] * -q0[o] + w.q[o] * q0[o + 3] + w.q[o + 1] * -q0[o + 2] - w.q[o + 2] * -q0[o + 1],
              w.q[o + 3] * -q0[o + 1] + w.q[o + 1] * q0[o + 3] + w.q[o + 2] * -q0[o] - w.q[o] * -q0[o + 2],
              w.q[o + 3] * -q0[o + 2] + w.q[o + 2] * q0[o + 3] + w.q[o] * -q0[o + 1] - w.q[o + 1] * -q0[o],
            )) /
          STEP;
        if (Math.hypot(w.wx[i], w.wy[i], w.wz[i]) > turned + 1e-2) rule.spun++;
      }
    }
    expect(rule, 'read back faster than it went, spinning faster than it turned, or its middle in the rock').toEqual({
      faster: 0,
      spun: 0,
      inRock: 0,
    });
    // every path was reached: down the hole, each reported once, over the step, and on into the corner
    expect(fell.size, 'down the hole').toBeGreaterThan(0);
    for (const [i, times] of fell) expect(times, `disc ${i} reported`).toBe(1);
    let over = 0,
      cornered = 0;
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i]) continue;
      if (w.x[i] > 2) over++;
      if (w.x[i] > 10 && w.y[i] > 3) cornered++;
    }
    expect(over, 'over the step').toBeGreaterThan(20);
    expect(cornered, 'into the corner').toBeGreaterThan(0);
    // and left alone, at rest, with nothing cutting anything
    let awake = 0;
    for (let i = 0; i < w.count; i++) if (w.alive[i] && !w.asleep[i]) awake++;
    expect(awake, 'awake at the end').toBe(0);
    expect(w.deepest(true).depth, 'nothing at rest cuts anything').toBeLessThanOrEqual(CUT + 1e-4);
  });

  it('with squeezedStill, leaves a world of balls bit for bit as it was, and a carried coin where it is held', () => {
    // A ball's speed is its own, and not read back from where it got: the option is the discs' alone. Balls in a
    // heap churned by a box, with a coin among them held up in the air, as a drone holds one.
    const world = (squeezedStill: boolean) => {
      const random = seeded(5);
      const w = new World({
        capacity: 200,
        grid: GRID,
        solid: walled(),
        radii: [R, 0.3, R],
        thickness: [0, 0, H],
        random,
        tuning: { cell: 1.2, squeezedStill },
      });
      for (let k = 0; k < 150; k++) {
        const r = Math.sqrt(random()) * 3,
          t = random() * Math.PI * 2;
        w.spawn(k % 2, Math.cos(t) * r, Math.sin(t) * r, 0.5 + random() * 3);
      }
      const held = w.spawn(2, 0, 0, 6);
      w.carried[held] = 1;
      const box: Pusher = {
        x: -6,
        y: 0,
        z: 0.5,
        yaw: 0,
        hx: 0.3,
        hy: 2,
        hz: 0.5,
        vx: 3,
        vy: 0,
        spin: 0,
        px: -6,
        py: 0,
        owner: 0,
      };
      w.pushers = [box];
      for (let f = 0; f < 240; f++) {
        box.x += box.vx * DT;
        box.px = box.x;
        w.step(DT, () => {});
      }
      return { w, held };
    };
    const off = world(false),
      on = world(true);
    for (const a of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'q', 'asleep'] as const)
      expect([...on.w[a]], a).toEqual([...off.w[a]]);
    expect([on.w.x[on.held], on.w.y[on.held], on.w.z[on.held]]).toEqual([0, 0, 6]);
    expect([on.w.vx[on.held], on.w.vy[on.held], on.w.vz[on.held]]).toEqual([0, 0, 0]);
  });
});
