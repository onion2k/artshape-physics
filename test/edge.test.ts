/**
 * The top edge of a step, which a ball meets with stepEdges set. A step is a
 * wall to a ball whose middle is below its top and a floor to one whose
 * middle is over it; a ball above its top and beside it was neither, and
 * the edge cut into it until its middle was over the step and it was put on
 * top. Without this file nothing holds a ball out of an edge in flight, as it
 * rolls off a ledge or up a riser, along a run of raised tiles, or at a
 * corner that stands out, nor holds a world that does not ask for edges to
 * what it did before.
 */
import { describe, expect, it } from 'vitest';
import { BOTTOM, DEFAULT_TUNING, World, type Grid, type Pusher, type Surface, type WorldOptions } from '../src/world';

const DT = 1 / 60;
const STEP = DEFAULT_TUNING.step;
const R = 1;
const GRID: Grid = { cols: 40, rows: 30, originX: 0, originY: 0, tile: 3 };
const TILES = GRID.cols * GRID.rows;
/** Ground with nothing to slow a ball, so what an edge does is all there is to see. */
const SLICK: Surface = { drag: 0, roll: 0 };
/** ooergolf's green. */
const GREEN: Surface = { drag: 0, roll: 16 };
/** A golf ball's tuning, as ooergolf has it, and the edges. */
const GOLF = { sleepInAir: false, sleepSpeed: 2, travel: 0.5, smoothWalls: true, wallRestitution: 0.65 };
const EDGES = { ...GOLF, stepEdges: true };
const nothing = () => {};

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A grid all floor but for a border of rock. */
function walled(): Uint8Array {
  const out = new Uint8Array(TILES);
  for (let ty = 0; ty < GRID.rows; ty++)
    for (let tx = 0; tx < GRID.cols; tx++)
      out[ty * GRID.cols + tx] = tx === 0 || ty === 0 || tx === GRID.cols - 1 || ty === GRID.rows - 1 ? 1 : 0;
  return out;
}

/** A height a tile, from where the tile is: the floor's steps, or terrain. */
const tiles = (height: (tx: number, ty: number) => number) =>
  Float32Array.from({ length: TILES }, (_, t) => height(t % GRID.cols, Math.floor(t / GRID.cols)));

const middle = (t: number) => (t + 0.5) * GRID.tile;

function world(over: Partial<WorldOptions> = {}, edges = true): World {
  return new World({
    capacity: 16,
    grid: GRID,
    solid: walled(),
    radii: [R],
    random: seeded(1),
    surfaces: [SLICK],
    ...over,
    tuning: { ...(edges ? EDGES : GOLF), ...over.tuning },
  });
}

/**
 * How far a ball is into the ground at the deepest, every step's ground,
 * found by looking at it all round under the ball and not by the world's
 * reckoning: its radius, less how near its middle comes to any point of the
 * ground within its reach. A step's face is kept a radius off by the walls,
 * so what is found within reach of a ball beside one is its top edge.
 */
function intoGround(w: World, i: number): number {
  const x = w.x[i],
    y = w.y[i],
    z = w.z[i];
  let nearest = Infinity;
  for (let ring = 0; ring <= 12; ring++) {
    const d = (ring / 12) * R,
      n = ring === 0 ? 1 : 32;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      nearest = Math.min(nearest, Math.hypot(d, w.floorAt(x + d * Math.cos(a), y + d * Math.sin(a)) - z));
    }
  }
  return R - nearest;
}

/** Steps a world `seconds` a fixed step at a time, and says how far the ball went into the ground at the deepest. */
function deepest(w: World, i: number, seconds: number): number {
  let most = 0;
  for (let s = 0; s < seconds / STEP && w.alive[i]; s++) {
    w.step(STEP, nothing);
    if (w.alive[i]) most = Math.max(most, intoGround(w, i));
  }
  return most;
}

describe('a ball and the top edge of a step', () => {
  // a step two high on every tile west of x = 60, as the golf fuzzer's raised wall is
  const wall = tiles((tx) => (tx < 20 ? 2 : 0));

  it('flies over a step it clips, or is turned back or set on it, never into its edge', () => {
    let worst = 0,
      at = '',
      before = 0;
    for (const height of [2.2, 2.4, 2.6, 2.8])
      for (const speed of [10, 40, 120, 240]) {
        const w = world({ floor: wall });
        const i = w.spawn(0, 66, middle(15), height, -speed, 0, 0);
        const into = deepest(w, i, 1);
        if (into > worst) {
          worst = into;
          at = `at ${height} going ${speed}`;
        }
        const old = world({ floor: wall }, false);
        const j = old.spawn(0, 66, middle(15), height, -speed, 0, 0);
        before = Math.max(before, deepest(old, j, 1));
      }
    expect(worst, at).toBeLessThan(0.1);
    // without the edge, the step's top cut two thirds of a unit into the ball
    expect(before).toBeGreaterThan(0.5);
  });

  it('rolls round the edge of a ledge it rolls off, and lands below', () => {
    for (const speed of [3, 20]) {
      const w = world({ floor: wall });
      const i = w.spawn(0, 57, middle(15), 2 + R, speed, 0, 0);
      expect(deepest(w, i, 2.5), `${speed} u/s`).toBeLessThan(0.1);
      expect(w.x[i]).toBeGreaterThan(60 + R);
      expect(w.z[i], `${speed} u/s`).toBeCloseTo(R, 1);
    }
    // without the edge a ball rolled off slowly sinks past it until its middle is clear
    const old = world({ floor: wall }, false);
    const j = old.spawn(0, 57, middle(15), 2 + R, 3, 0, 0);
    expect(deepest(old, j, 2.5)).toBeGreaterThan(0.3);
  });

  it('climbs a riser lower than itself only with speed enough, where it climbed one at any speed', () => {
    // a riser as high as one of ooergolf's steps, east of x = 60
    const riser = tiles((tx) => (tx >= 20 ? 0.4 : 0));
    // struck on ooergolf's green from a hair short of touching the riser's edge, as it was measured
    const short = (h: number) => 60 - Math.sqrt(R * R - (R - h) ** 2) - 0.05;
    const climbs = (speed: number, edges: boolean) => {
      const w = world({ floor: riser, surfaces: [GREEN] }, edges);
      const i = w.spawn(0, short(0.4), middle(15), R, speed, 0, 0);
      const into = deepest(w, i, 2);
      // its middle over the riser, and resting on it
      return { on: w.x[i] > 60 && w.z[i] > 0.4 + R - 0.05, into };
    };
    expect(climbs(6, false).on, 'at six a second without the edge').toBe(true);
    // over its edge from fourteen a second, struck just short of it
    expect(climbs(12, true).on, 'at twelve a second with it').toBe(false);
    expect(climbs(20, true).on, 'at twenty').toBe(true);
    for (const speed of [3, 10, 20, 40]) expect(climbs(speed, true).into, `${speed} u/s`).toBeLessThan(0.1);
    // a riser of 0.6 from twenty-five a second: an edge bounces a ball as the floor does, and bounced as the step's
    // face, one of 0.6 needed fifty-eight
    const higher = tiles((tx) => (tx >= 20 ? 0.6 : 0));
    const up = (speed: number) => {
      const w = world({ floor: higher, surfaces: [GREEN] });
      const i = w.spawn(0, short(0.6), middle(15), R, speed, 0, 0);
      let on = false;
      for (let f = 0; f < 90; f++) {
        w.step(DT, nothing);
        if (w.x[i] > 60.5 && Math.abs(w.z[i] - 0.6 - R) < 0.05) on = true;
      }
      return on;
    };
    expect(up(20), 'a riser of 0.6 at twenty').toBe(false);
    expect(up(35), 'at thirty-five').toBe(true);
  });

  it('is met as one straight edge along a run of raised tiles, and as a point at a corner that stands out', () => {
    // A riser along the whole of row 15, and the ground falling toward it, so a ball rolled along it is held
    // against its edge by the slope all the way across the seams between its tiles.
    // Nothing met slower than two a second bounces, as the golf fuzzer has it: at ooergolf's own tuning, where
    // anything bounces, a ball pressed against an edge by a slope hops off it every seventeenth step, as one
    // pressed against a rail does, and that hides what a seam does.
    const floor = tiles((_, ty) => (ty >= 15 ? 0.4 : 0));
    const terrain = tiles((_, ty) => 0.3 * (20 - ty));
    const w = world({ floor, terrain, tuning: { bounceFrom: 2 } });
    const i = w.spawn(0, middle(5), 44, w.floorAt(middle(5), 44) + R + 0.2);
    // let it come to lie against the edge, then send it along
    for (let s = 0; s < 1 / STEP; s++) w.step(STEP, nothing);
    const y0 = w.y[i];
    w.hit(i, 15, 0, 0);
    let wander = 0,
      jolt = 0,
      last = w.vy[i];
    for (let s = 0; s < 1.5 / STEP; s++) {
      w.step(STEP, nothing);
      wander = Math.max(wander, Math.abs(w.y[i] - y0));
      jolt = Math.max(jolt, Math.abs(w.vy[i] - last));
      last = w.vy[i];
    }
    expect(w.x[i] - middle(5), 'rolled on along it').toBeGreaterThan(15);
    expect(wander, 'held against it the whole way').toBeLessThan(0.02);
    expect(jolt, 'never turned at a seam').toBeLessThan(0.1);
    // flown straight at the run's edge a third of a unit past a seam, a little above rolling: put back straight,
    // not on a slant off the corner of the next tile along, which lies on the same edge; met on the slant, it was
    // thrown along the edge at seven a second
    const flat = world({ floor });
    const k = flat.spawn(0, 3 * 10 + 0.3, 42.5, 1.3, 0, 30, 0);
    for (let s = 0; s < 0.2 / STEP; s++) flat.step(STEP, nothing);
    expect(Math.abs(flat.vx[k]), 'turned along the edge at a seam').toBeLessThan(0.01);
    // a lone raised tile, and a ball rolled at its corner: turned by the corner as by a post
    const lone = world({ floor: tiles((tx, ty) => (tx === 20 && ty === 15 ? 0.4 : 0)) });
    const j = lone.spawn(0, 60 - 3, 45 - 3, R, 8, 8, 0);
    lone.step(DT, nothing);
    for (let f = 0; f < 60; f++) lone.step(DT, nothing);
    const turned = Math.abs(Math.atan2(lone.vy[j], lone.vx[j]) - Math.PI / 4);
    expect(turned).toBeGreaterThan(0.2);
  });

  it('meets the edge of a step on a hill where the step and the hill put it', () => {
    const terrain = tiles((_, ty) => 0.2 * 3 * ty);
    let worst = 0;
    for (const height of [2.2, 2.6])
      for (const speed of [10, 60, 240]) {
        const w = world({ floor: wall, terrain });
        const y = middle(15);
        const i = w.spawn(0, 66, y, w.floorAt(60, y) + height, -speed, 0, 0);
        worst = Math.max(worst, deepest(w, i, 1));
      }
    expect(worst).toBeLessThan(0.1);
  });

  it('lets a ball come to rest against an edge, and sleep, on a slope too steep to hold it', () => {
    // down a slope the green cannot hold a ball on, to a riser too high to climb from rest
    const floor = tiles((_, ty) => (ty >= 15 ? 0.8 : 0));
    const terrain = tiles((_, ty) => 0.9 * (20 - ty));
    const w = world({ floor, terrain, surfaces: [GREEN] });
    const i = w.spawn(0, middle(20), 38, w.floorAt(middle(20), 38) + R + 0.2);
    for (let s = 0; s < 3 / STEP; s++) w.step(STEP, nothing);
    expect(w.asleep[i]).toBe(1);
    expect(w.y[i]).toBeLessThan(45);
    expect(intoGround(w, i)).toBeLessThan(0.1);
  });

  it('meets no edge down a hole, below the floor it is cut in', () => {
    // a wide hole in a raised floor, a step higher still on the tile east of it, and a ball already down it by that
    // side, its middle a tenth from the tile and the step's edge half a unit above: down a pit the floor round it
    // is no wall to it, and no edge either
    const floor = tiles((tx, ty) => (Math.abs(tx - 20) <= 3 && Math.abs(ty - 15) <= 3 ? (tx === 21 ? 2.4 : 2) : 0));
    const w = world({ floor, holes: [{ x: middle(20), y: middle(15), radius: 2.5, depth: 6 }] });
    const x = middle(20) + 1.4;
    const i = w.spawn(0, x, middle(15), 1.9);
    let holed = false,
      moved = 0;
    for (let s = 0; s < 1 / STEP && w.alive[i]; s++) {
      w.step(STEP, () => (holed = true));
      if (w.alive[i]) moved = Math.max(moved, Math.abs(w.x[i] - x));
    }
    expect(holed).toBe(true);
    expect(moved).toBeLessThan(0.01);
  });

  it('reports once a ball that rolls off the grass into the water, round its edge', () => {
    const floor = tiles((tx) => (tx >= 20 && tx <= 24 ? -30 : 0));
    const w = world({ floor, bottom: -6 });
    const i = w.spawn(0, 55, middle(15), R, 6, 0, 0);
    const reported: number[] = [];
    for (let f = 0; f < 180; f++) w.step(DT, (_kind, _x, _y, slot, hole) => reported.push(slot, hole));
    expect(reported).toEqual([i, BOTTOM]);
  });

  it('is driven up a riser by a box, never into the ground', () => {
    const riser = tiles((tx) => (tx >= 20 ? 0.8 : 0));
    const w = world({ floor: riser });
    const i = w.spawn(0, 57, middle(15), R);
    const box: Pusher = {
      x: 50,
      y: middle(15),
      z: 1.5,
      yaw: 0,
      hx: 0.4,
      hy: 3,
      hz: 1.5,
      vx: 12,
      vy: 0,
      spin: 0,
      px: 50,
      py: middle(15),
      owner: 0,
    };
    let into = 0;
    for (let f = 0; f < 60; f++) {
      box.x = box.px = 50 + 12 * f * DT;
      w.pushers = [box];
      w.step(DT, nothing);
      into = Math.max(into, intoGround(w, i));
    }
    expect(into).toBeLessThan(0.1);
  });
});

describe('a world that asks for no edges', () => {
  it('leaves a coin at a step exactly as it was, with edges asked for or not', () => {
    // a row of coins laid flat up to a step lower than a coin lying flat, and a box pushing them west over it: a coin
    // meets the step's lip as it always has, and nothing of a ball's edges
    const run = (stepEdges: boolean) => {
      const w = new World({
        capacity: 20,
        grid: GRID,
        solid: walled(),
        floor: tiles((tx) => (tx < 20 ? 0.1 : 0)),
        radii: [0.42],
        thickness: [0.24],
        random: seeded(3),
        tuning: { stepEdges },
      });
      for (let k = 0; k < 12; k++) {
        const i = w.spawn(0, 60.5 + k * 0.9, middle(15), 0.12);
        w.setOrientation(i, 0, 0, 0, 1);
      }
      const box: Pusher = {
        x: 72,
        y: middle(15),
        z: 0.5,
        yaw: 0,
        hx: 0.3,
        hy: 2,
        hz: 0.5,
        vx: -3,
        vy: 0,
        spin: 0,
        px: 72,
        py: middle(15),
        owner: 0,
      };
      for (let f = 0; f < 240; f++) {
        box.x = box.px = 72 - 3 * f * DT;
        w.pushers = [box];
        w.wakeNear(box.x - 1, box.y, 4);
        w.step(DT, nothing);
      }
      return [w.x, w.y, w.z, w.q].map((a) => Array.from(a));
    };
    const edges = run(true);
    // the row went over the step's lip
    expect(edges[0].slice(0, 12).filter((x) => x < 60).length).toBeGreaterThan(3);
    expect(edges).toEqual(run(false));
  });
});
