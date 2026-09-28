/**
 * The ground's hills: a height a tile, smoothed into ground a ball rolls
 * down, breaks across, runs up and comes back from, and comes to rest on
 * only where its surface can hold it. Without this file nothing holds the
 * terrain to being smooth, to pulling a ball downhill by gravity and no more,
 * to never being a wall, to refusing ground the world cannot keep a ball on,
 * or to leaving a world without it exactly as it was.
 */
import { describe, expect, it } from 'vitest';
import { heightAt, slopeAt } from '../src/terrain';
import {
  BOTTOM,
  DEFAULT_TUNING,
  World,
  type Grid,
  type Hole,
  type Pusher,
  type Surface,
  type WorldOptions,
} from '../src/world';

const DT = 1 / 60;
const STEP = DEFAULT_TUNING.step;
const G = DEFAULT_TUNING.gravity;
const R = 1;
const GRID: Grid = { cols: 40, rows: 30, originX: 0, originY: 0, tile: 3 };
const TILES = GRID.cols * GRID.rows;
/** A green with nothing to slow a ball but the slope, so what the slope does is all there is to see. */
const SLICK: Surface = { drag: 0, roll: 0 };
/** ooergolf's green: nothing drags on it, and it holds a ball against up to 16 u/s² of pull. */
const GREEN: Surface = { drag: 0, roll: 16 };
/** A golf ball's tuning, as ooergolf has it. */
const GOLF = { sleepInAir: false, sleepSpeed: 2, travel: 0.5, smoothWalls: true };
/** ooergolf's cup. */
const CUP = { radius: 1.45, depth: 6, rim: 0.3, pull: 0 };
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

/** A terrain from a height for each tile. */
const terrainOf = (height: (tx: number, ty: number) => number) =>
  Float32Array.from({ length: TILES }, (_, t) => height(t % GRID.cols, Math.floor(t / GRID.cols)));

/** The middle of a tile, along either way. */
const middle = (t: number) => (t + 0.5) * GRID.tile;

/** An even slope rising along x, `slope` units up for each unit across. */
const incline = (slope: number) => terrainOf((tx) => slope * GRID.tile * tx);

function world(over: Partial<WorldOptions> = {}): World {
  return new World({
    capacity: 16,
    grid: GRID,
    solid: walled(),
    radii: [R],
    random: seeded(1),
    surfaces: [SLICK],
    ...over,
    tuning: { ...GOLF, ...over.tuning },
  });
}

/** A ball put down at rest on the ground: its middle its radius from the ground, along the ground's normal. */
function putDown(w: World, terrain: Float32Array, x: number, y: number): number {
  const [sx, sy] = slopeAt(terrain, GRID, x, y);
  return w.spawn(0, x, y, w.floorAt(x, y) + R * Math.sqrt(1 + sx * sx + sy * sy));
}

const run = (w: World, seconds: number, collect: Parameters<World['step']>[1] = nothing) => {
  for (let f = 0; f < seconds * 60; f++) w.step(DT, collect);
};

const speedOf = (w: World, i: number) => Math.hypot(w.vx[i], w.vy[i], w.vz[i]);

/** The fixed steps a world has taken. */
const taken = (w: World) => (w as unknown as { steps: number }).steps;

/**
 * How far a ball is into the ground at the deepest, found by looking at the
 * ground all round under it and not by the world's own reckoning: its
 * radius, less how near its middle comes to any point of the ground within
 * its reach. The nearest of points looked at is never nearer than the
 * nearest there is, so this never says a ball is further in than it is; and
 * near the nearest point the distance changes slowly, so it says very
 * nearly how far.
 */
function intoGround(w: World, i: number, rings = 12, round = 32): number {
  const x = w.x[i],
    y = w.y[i],
    z = w.z[i],
    r = w.r[i];
  let nearest = Infinity;
  for (let ring = 0; ring <= rings; ring++) {
    const d = (ring / rings) * r,
      n = ring === 0 ? 1 : round;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const px = x + d * Math.cos(a),
        py = y + d * Math.sin(a);
      nearest = Math.min(nearest, Math.hypot(d, w.floorAt(px, py) - z));
    }
  }
  return r - nearest;
}

describe('the ground', () => {
  it("is the floor's step and the terrain's rise together, and nothing off the grid", () => {
    const terrain = terrainOf((tx, ty) => 0.5 * tx + 0.25 * ty);
    const floor = new Float32Array(TILES);
    floor[10 * GRID.cols + 12] = 2;
    const w = world({ terrain, floor });
    const x = middle(12) + 0.4,
      y = middle(10) - 0.7;
    // an even slope stays one: the smoothing of heights that rise evenly is the plane through them
    const plane = 0.5 * (x / GRID.tile - 0.5) + 0.25 * (y / GRID.tile - 0.5);
    expect(heightAt(terrain, GRID, x, y)).toBeCloseTo(plane, 5);
    expect(slopeAt(terrain, GRID, x, y)[0]).toBeCloseTo(0.5 / GRID.tile, 5);
    expect(slopeAt(terrain, GRID, x, y)[1]).toBeCloseTo(0.25 / GRID.tile, 5);
    expect(w.floorAt(x, y)).toBeCloseTo(2 + plane, 5);
    expect(w.floorAt(-1, 5)).toBe(0);
    expect(w.floorAt(5, 1000)).toBe(0);
  });

  it('is smooth across every seam: the height and the slope the same either side, and the slope its rate of rise', () => {
    const random = seeded(7);
    const terrain = terrainOf(() => random() * 1.5);
    const eps = 1e-6;
    let jump = 0,
      kink = 0,
      untrue = 0,
      low = Infinity,
      high = -Infinity;
    // the seams of the tiles, and of the smoothing, which runs from one tile's middle to the next
    for (let t = 2; t < 28; t++)
      for (const at of [t * GRID.tile, middle(t)])
        for (let k = 0; k < 20; k++) {
          const across = 6 + random() * 78;
          for (const [ax, ay, bx, by, way] of [
            [at - eps, across, at + eps, across, 0],
            [across, at - eps, across, at + eps, 1],
          ]) {
            const a = heightAt(terrain, GRID, ax, ay),
              b = heightAt(terrain, GRID, bx, by);
            const sa = slopeAt(terrain, GRID, ax, ay),
              sb = slopeAt(terrain, GRID, bx, by);
            jump = Math.max(jump, Math.abs(a - b));
            kink = Math.max(kink, Math.abs(sa[0] - sb[0]), Math.abs(sa[1] - sb[1]));
            // the slope is how fast the height rises, measured across a hair either side
            const h = 1e-4;
            const rate =
              way === 0
                ? (heightAt(terrain, GRID, ax + h, ay) - heightAt(terrain, GRID, ax - h, ay)) / (2 * h)
                : (heightAt(terrain, GRID, ax, ay + h) - heightAt(terrain, GRID, ax, ay - h)) / (2 * h);
            untrue = Math.max(untrue, Math.abs(rate - sa[way]));
            low = Math.min(low, a);
            high = Math.max(high, a);
          }
        }
    expect(jump).toBeLessThan(1e-5);
    expect(kink).toBeLessThan(1e-4);
    expect(untrue).toBeLessThan(1e-4);
    // and it is ground with hills in it, not flat
    expect(high - low).toBeGreaterThan(0.5);
  });

  it('is exactly flat over a run of equal heights, and never above or below the heights given', () => {
    // a mesa, flat at 3 in the middle, its sides as steep as they may be
    const terrain = terrainOf((tx, ty) => Math.min(3, 1.5 * Math.max(0, Math.min(tx - 10, 29 - tx, ty - 8, 21 - ty))));
    const random = seeded(3);
    for (let k = 0; k < 500; k++) {
      const x = middle(14) + random() * (middle(25) - middle(14)),
        y = middle(12) + random() * (middle(17) - middle(12));
      expect(heightAt(terrain, GRID, x, y)).toBe(3);
      const [sx, sy] = slopeAt(terrain, GRID, x, y);
      expect(Math.abs(sx) + Math.abs(sy)).toBe(0);
    }
    for (let k = 0; k < 2000; k++) {
      const h = heightAt(terrain, GRID, random() * 120, random() * 90);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(3);
    }
  });
});

describe('a ball on a slope', () => {
  it("speeds down an even slope at gravity times the slope's sine, less its surface's roll", () => {
    for (const [slope, roll] of [
      [0.25, 0],
      [0.4, 0],
      [0.4, 16],
    ]) {
      const terrain = incline(slope);
      const w = world({ terrain, surfaces: [{ drag: 0, roll }] });
      const i = putDown(w, terrain, middle(30), middle(15));
      run(w, 1);
      const sine = slope / Math.sqrt(1 + slope * slope);
      expect(Math.abs(speedOf(w, i) / (G * sine - roll) - 1), `slope ${slope}, roll ${roll}`).toBeLessThan(0.02);
      // straight down it, and not across
      expect(w.vx[i]).toBeLessThan(0);
      expect(Math.abs(w.vy[i])).toBeLessThan(1e-6);
    }
  });

  it('comes to rest and sleeps on a slope its surface holds, and rolls away off one a little steeper', () => {
    // the steepest slope 16 u/s² of roll holds against gravity
    const holds = Math.tan(Math.asin(16 / G));
    for (const [slope, rests] of [
      [holds * 0.95, true],
      [holds * 1.05, false],
    ] as const) {
      const terrain = incline(slope);
      const w = world({ terrain, surfaces: [GREEN] });
      const i = putDown(w, terrain, middle(30), middle(15));
      const x0 = w.x[i];
      run(w, 3);
      if (rests) {
        expect(w.asleep[i], `slope ${slope.toFixed(3)}`).toBe(1);
        expect(Math.abs(w.x[i] - x0)).toBeLessThan(0.05);
      } else {
        // a twentieth steeper pulls at 0.8 u/s² past the roll, and it is never settled to a stop
        expect(w.asleep[i], `slope ${slope.toFixed(3)}`).toBe(0);
        expect(x0 - w.x[i]).toBeGreaterThan(2);
      }
    }
  });

  it('rolls back down a hill it is struck up, never faster than gravity makes it', () => {
    const slope = 0.3;
    const terrain = incline(slope);
    const w = world({ terrain });
    const i = putDown(w, terrain, middle(12), middle(15));
    const x0 = w.x[i];
    w.hit(i, 20, 0, 0);
    let furthest = x0,
      faster = 0;
    for (let s = 0; s < 2.5 / STEP; s++) {
      const before = speedOf(w, i);
      w.step(STEP, nothing);
      if (speedOf(w, i) > before + G * STEP + 1e-9) faster++;
      furthest = Math.max(furthest, w.x[i]);
    }
    expect(faster).toBe(0);
    expect(furthest - x0).toBeGreaterThan(5);
    expect(w.x[i]).toBeLessThan(x0 - 5);
  });

  it('bounces off a slope it is dropped on, down the slope', () => {
    const terrain = incline(0.4);
    const w = world({ terrain, tuning: { restitution: 0.5, bounceFrom: 0 } });
    const x = middle(20),
      y = middle(15);
    const i = w.spawn(0, x, y, w.floorAt(x, y) + 6);
    let s = 0;
    for (; s < 240 && w.vz[i] <= 0; s++) w.step(STEP, nothing);
    expect(w.vz[i]).toBeGreaterThan(0);
    // thrown off along the ground's normal, which leans down the slope
    expect(w.vx[i]).toBeLessThan(-5);
    expect(Math.abs(w.vy[i])).toBeLessThan(1e-6);
  });

  it('curves downhill, rolled across a slope', () => {
    const terrain = terrainOf((_, ty) => 0.1 * GRID.tile * ty);
    const w = world({ terrain, surfaces: [GREEN] });
    const i = putDown(w, terrain, middle(5), middle(15));
    const y0 = w.y[i];
    w.hit(i, 30, 0, 0);
    run(w, 0.5);
    const half = y0 - w.y[i];
    run(w, 0.5);
    const whole = y0 - w.y[i];
    // down the slope, more in the second half second than the first: a putt breaking
    expect(half).toBeGreaterThan(0.3);
    expect(whole - half).toBeGreaterThan(half * 1.5);
  });

  it('is carried by a belt and pulled by the magnet, on a slope', () => {
    const terrain = incline(0.2);
    const belted = world({ terrain, surfaces: [GREEN] });
    const i = putDown(belted, terrain, middle(20), middle(10));
    belted.belts = [{ cx: middle(20), cy: middle(15), half: 20, width: 4, dx: 0, dy: 1, speed: 6 }];
    const y0 = belted.y[i];
    run(belted, 1);
    expect(belted.y[i] - y0).toBeGreaterThan(3);
    const pulled = world({ terrain, surfaces: [GREEN] });
    const j = putDown(pulled, terrain, middle(20), middle(15));
    pulled.magnet = { x: middle(20), y: middle(18), radius: 12, strength: 200 };
    const was = pulled.y[j];
    run(pulled, 0.5);
    expect(pulled.y[j] - was).toBeGreaterThan(1);
  });

  it('is slowed by the floor’s drag, with no table of surfaces, to where drag and the slope balance', () => {
    const slope = 0.3;
    const terrain = incline(slope);
    const w = world({ terrain, surfaces: [], tuning: { sleepSpeed: Infinity } });
    const i = putDown(w, terrain, middle(34), middle(15));
    run(w, 3);
    const sine = slope / Math.sqrt(1 + slope * slope);
    expect(Math.abs(speedOf(w, i) / ((G * sine) / DEFAULT_TUNING.floorDrag) - 1)).toBeLessThan(0.03);
  });

  it('comes to rest at the bottom of a hollow on a surface with drag and no roll', () => {
    // a bowl two and a half deep, on ground that drags as the bench's green does and has no roll to hold a ball
    const terrain = terrainOf((tx, ty) => -2.5 * Math.max(0, 1 - Math.hypot(tx - 20, ty - 15) / 3));
    const w = world({ terrain, surfaces: [{ drag: 0.8 }] });
    const i = putDown(w, terrain, middle(20) + 6, middle(15) + 2);
    run(w, 20);
    expect(w.asleep[i]).toBe(1);
    // where the drag holds it: the ground's pull on it no more than drags it a quarter of a unit in a window
    const [sx, sy] = slopeAt(terrain, GRID, w.x[i], w.y[i]);
    expect(G * Math.hypot(sx, sy)).toBeLessThan((0.8 * DEFAULT_TUNING.sleepDrift) / (DEFAULT_TUNING.sleepSteps * STEP));
  });

  it('is held by sand on the steepest slope there may be', () => {
    const terrain = incline(0.5);
    const w = world({ terrain, surfaces: [{ drag: 8, roll: 60 }] });
    const i = putDown(w, terrain, middle(20), middle(15));
    const x0 = w.x[i];
    run(w, 2);
    expect(w.asleep[i]).toBe(1);
    expect(Math.abs(w.x[i] - x0)).toBeLessThan(0.05);
  });
});

describe('the terrain and what stands on it', () => {
  it('is never a wall: a ball climbs the steepest slope there may be, straight and across, without being turned', () => {
    const terrain = incline(0.5);
    // a floor of steps given, all at 0, so the steps are looked at as walls and found none
    const floor = new Float32Array(TILES);
    for (const [vx, vy] of [
      [40, 0],
      [28, 28],
    ]) {
      const w = world({ terrain, floor });
      const i = putDown(w, terrain, middle(8), middle(8));
      const z0 = w.z[i];
      w.hit(i, vx, vy, 0);
      w.step(STEP, nothing);
      // what it has going up the slope once the ground has turned it along it, and how high that takes it: its
      // speed along the level, across the slope, it keeps, and it takes it no higher
      const up = Math.hypot(w.vx[i], w.vz[i]);
      let top = z0,
        turned = -1;
      for (let s = 0; s < 1.5 / STEP; s++) {
        const before = Math.hypot(w.vx[i], w.vz[i]);
        w.step(STEP, nothing);
        top = Math.max(top, w.z[i]);
        if (w.vx[i] < 0 && turned < 0) turned = before;
      }
      // it rose as high as its speed takes it, and turned back only once it had all but stopped
      expect(top - z0, `struck at ${vx}, ${vy}`).toBeGreaterThan(((up * up) / (2 * G)) * 0.97);
      expect(turned, `struck at ${vx}, ${vy}`).toBeLessThan(1);
    }
  });

  it('keeps a step on a hill a wall from below and an edge from above', () => {
    // the ground rises to 18 at tile 12 and is level on from there; a step 2 high stands on tiles 20 and on
    const terrain = terrainOf((tx) => 1.5 * Math.min(tx, 12));
    const floor = terrainOf((tx) => (tx >= 20 ? 2 : 0));
    const w = world({ terrain, floor, surfaces: [GREEN], tuning: { wallRestitution: 0.5 } });
    const i = putDown(w, terrain, middle(16), middle(10));
    w.hit(i, 20, 0, 0);
    let furthest = -Infinity,
      bounced = false;
    for (let s = 0; s < 1 / STEP; s++) {
      w.step(STEP, nothing);
      furthest = Math.max(furthest, w.x[i]);
      if (w.vx[i] < -2) bounced = true;
    }
    expect(furthest).toBeLessThan(20 * GRID.tile - R + 0.01);
    expect(bounced).toBe(true);
    // from above, rolled off its edge, it drops the step's height and rests below it
    const j = putDown(w, terrain, middle(21), middle(20));
    expect(w.z[j]).toBeCloseTo(18 + 2 + R, 5);
    w.hit(j, -15, 0, 0);
    run(w, 2);
    expect(w.x[j]).toBeLessThan(20 * GRID.tile - R);
    expect(w.asleep[j]).toBe(1);
    expect(w.z[j]).toBeCloseTo(18 + R, 5);
  });

  it('bounces a ball that rolls down a hill into the rock, and never leaves it in it', () => {
    const terrain = terrainOf((tx) => 1.5 * Math.max(0, tx - 6));
    const w = world({ terrain, tuning: { wallRestitution: 0.5 } });
    const i = putDown(w, terrain, middle(14), middle(15));
    let bounced = false;
    for (let s = 0; s < 3 / STEP; s++) {
      const before = w.vx[i];
      w.step(STEP, nothing);
      if (before < -2 && w.vx[i] > 0) bounced = true;
      // never with its middle in the rock of the border
      expect(w.x[i]).toBeGreaterThanOrEqual(GRID.tile + R - 0.01);
    }
    expect(bounced).toBe(true);
  });

  it('lets a ball on a slope too steep to hold it come to rest against the rock, and sleep', () => {
    // down the steepest slope there may be, which the green cannot hold a ball on, into the rock of the border
    const terrain = incline(0.5);
    const w = world({ terrain, surfaces: [GREEN] });
    const i = putDown(w, terrain, middle(5), middle(15));
    run(w, 4);
    expect(w.asleep[i]).toBe(1);
    expect(w.x[i]).toBeCloseTo(GRID.tile + R, 2);
  });

  it('never lets a box drive a ball on a slope into the ground', () => {
    // up the steepest slope there may be, fast: a quarter of a unit a step, which is an eighth of a unit up it
    const terrain = incline(0.5);
    const w = world({ terrain, surfaces: [GREEN] });
    const i = putDown(w, terrain, middle(12), middle(15));
    const x0 = w.x[i];
    const box: Pusher = {
      x: 0,
      y: middle(15),
      z: 0,
      yaw: 0,
      hx: 0.4,
      hy: 3,
      hz: 1.5,
      vx: 30,
      vy: 0,
      spin: 0,
      px: 0,
      py: 0,
      owner: 0,
    };
    let deepest = 0;
    for (let f = 0; f < 60; f++) {
      box.x = box.px = middle(10) + 30 * f * DT;
      // the game keeps its box on the ground
      box.z = w.floorAt(box.x, box.y) + box.hz - 0.2;
      w.pushers = [box];
      w.step(DT, nothing);
      deepest = Math.max(deepest, intoGround(w, i));
    }
    expect(deepest).toBeLessThan(0.1);
    // shoved up the slope ahead of the box
    expect(w.x[i] - x0).toBeGreaterThan(10);

    // And a box come down on a ball lying on the slope, a quarter of a unit a step: the ground is looked at after
    // the box, and the ball is left in the box, not in the ground.
    const pressed = world({ terrain: incline(0.3), surfaces: [GREEN] });
    const j = putDown(pressed, incline(0.3), middle(20), middle(15));
    const lid: Pusher = {
      ...box,
      x: pressed.x[j],
      y: pressed.y[j],
      px: pressed.x[j],
      py: pressed.y[j],
      vx: 0,
      hx: 2,
      hy: 2,
      hz: 1,
    };
    let under = 0;
    for (let s = 0; s < 16; s++) {
      lid.z = pressed.z[j] + 4 - 0.25 * s;
      pressed.pushers = [lid];
      pressed.step(STEP, nothing);
      under = Math.max(under, intoGround(pressed, j));
    }
    expect(under).toBeLessThan(0.1);
  });

  it('lets go of a carried ball over a hill to fall to the ground there, and rest', () => {
    const terrain = incline(0.15);
    const w = world({ terrain, surfaces: [GREEN] });
    const i = w.spawn(0, middle(5), middle(5), 30);
    w.carried[i] = 1;
    const x = middle(20),
      y = middle(15);
    w.x[i] = x;
    w.y[i] = y;
    w.z[i] = w.floorAt(x, y) + 5;
    run(w, 0.5);
    expect(w.x[i]).toBe(x);
    w.carried[i] = 0;
    run(w, 3);
    expect(w.asleep[i]).toBe(1);
    // landing kicks it a little way down the slope, three and a half units a second at five up, and it stops there
    expect(Math.hypot(w.x[i] - x, w.y[i] - y)).toBeLessThan(2);
    const [sx, sy] = slopeAt(terrain, GRID, w.x[i], w.y[i]);
    expect(w.z[i]).toBeCloseTo(w.floorAt(w.x[i], w.y[i]) + R * Math.sqrt(1 + sx * sx + sy * sy), 2);
  });

  it('reports once a ball that rolls off a hill into the water, down no hole', () => {
    const terrain = terrainOf((tx) => 1.5 * Math.max(0, tx - 10));
    const floor = terrainOf((tx, ty) => (tx >= 3 && tx <= 6 && ty >= 12 && ty <= 18 ? -30 : 0));
    const w = world({ terrain, floor, bottom: -6 });
    const i = putDown(w, terrain, middle(16), middle(15));
    const reported: number[] = [];
    run(w, 4, (_kind, _x, _y, slot, hole) => reported.push(slot, hole));
    expect(reported).toEqual([i, BOTTOM]);
  });

  it('rolls a ball the same way at every frame length', () => {
    const terrain = incline(0.3);
    const at = (dt: number) => {
      const w = world({ terrain, surfaces: [GREEN] });
      const i = putDown(w, terrain, middle(30), middle(15));
      w.hit(i, 3, 10, 0);
      while (taken(w) < 240) w.step(dt, nothing);
      return [w.x[i], w.y[i], w.z[i], w.vx[i], w.vy[i], w.vz[i]];
    };
    const sixty = at(1 / 60);
    expect(at(1 / 30)).toEqual(sixty);
    expect(at(1 / 144)).toEqual(sixty);
  });

  it('plays the same from the same seed, bit for bit', () => {
    const play = () => {
      const random = seeded(11);
      const terrain = terrainOf(() => random() * 1.5);
      const w = world({ terrain, surfaces: [GREEN], random });
      const balls = [0, 1, 2, 3].map((k) => putDown(w, terrain, middle(8 + k * 6), middle(15)));
      for (let shot = 0; shot < 4; shot++) {
        for (const i of balls) w.hit(i, (random() - 0.5) * 80, (random() - 0.5) * 80, 0);
        run(w, 1);
      }
      return [w.x, w.y, w.z, w.vx, w.vy, w.vz].map((a) => Array.from(a.slice(0, 4)));
    };
    expect(play()).toEqual(play());
  });
});

describe('the terrain, however steep and sharp it may be', () => {
  it('never lets a ball more than a tenth into the ground, however hard it is struck into it', () => {
    // The steepest ground there may be, half a tile a tile both ways at once, thirty-five degrees; the sharpest, a
    // valley and a ridge as steep as may be either side of a tile; a pit sharp every way; and tiles half a tile up
    // and down by turns, which the smoothing makes a field of gentle bumps. Struck gently, to roll on it, and hard.
    const terrains: [string, Float32Array][] = [
      ['the steepest', terrainOf((tx, ty) => 1.5 * (tx + ty))],
      ['a valley', terrainOf((tx) => 1.5 * Math.abs(tx - 20))],
      ['a ridge', terrainOf((tx) => 30 - 1.5 * Math.abs(tx - 20))],
      ['a pit', terrainOf((tx, ty) => 1.5 * (Math.abs(tx - 20) + Math.abs(ty - 15)))],
      ['bumps', terrainOf((tx, ty) => ((tx + ty) % 2) * 1.5)],
    ];
    let deepest = 0,
      worst = '';
    for (const [name, terrain] of terrains)
      for (const speed of [5, 15, 30, 60, 120, 240])
        for (let k = 0; k < 8; k++) {
          const w = world({ terrain, surfaces: [GREEN] });
          const i = putDown(w, terrain, middle(20), middle(15));
          const a = (k / 8) * 2 * Math.PI;
          w.hit(i, speed * Math.cos(a), speed * Math.sin(a), 0);
          for (let s = 0; s < 1.5 / STEP; s++) {
            w.step(STEP, nothing);
            const into = intoGround(w, i, 6, 24);
            if (into > deepest) {
              deepest = into;
              worst = `${name}, struck at ${speed} toward ${k * 45}°, step ${s}`;
            }
          }
        }
    expect(deepest, worst).toBeLessThan(0.1);
  });

  it('swings a ball rocking in the sharpest hollow there may be back no sooner than two sleep windows, so none sleeps mid-swing', () => {
    // a valley along y, its sides as steep as may be, and its bottom as sharp
    const terrain = terrainOf((tx) => 1.5 * Math.abs(tx - 20));
    for (const from of [0.3, 1, 3, 9]) {
      const w = world({ terrain, surfaces: [{ drag: 0, roll: 2 }] });
      const i = putDown(w, terrain, middle(20) + from, middle(15));
      // the steps between one swing's farthest and the next on the same side
      let last = w.x[i],
        way = -1,
        turnedAt = -1,
        shortest = Infinity,
        fastAsleep = 0;
      for (let s = 0; s < 6 / STEP; s++) {
        const before = speedOf(w, i);
        w.step(STEP, nothing);
        if (w.asleep[i]) {
          if (before > GOLF.sleepSpeed) fastAsleep++;
          break;
        }
        const now = Math.sign(w.x[i] - last) || way;
        if (now !== way && now < 0) {
          if (turnedAt >= 0) shortest = Math.min(shortest, s - turnedAt);
          turnedAt = s;
        }
        way = now;
        last = w.x[i];
      }
      expect(shortest, `rocked from ${from} out`).toBeGreaterThan(2 * DEFAULT_TUNING.sleepSteps);
      expect(fastAsleep).toBe(0);
    }
  });
});

describe('a coin on the terrain', () => {
  it('lies along a slope and sleeps there, no further into it than a coin lies in the flat floor', () => {
    const slope = 0.3;
    const terrain = incline(slope);
    const w = new World({
      capacity: 4,
      grid: GRID,
      solid: walled(),
      radii: [0.42],
      thickness: [0.24],
      random: seeded(2),
      terrain,
    });
    const x = middle(20),
      y = middle(15);
    const i = w.spawn(0, x, y, w.floorAt(x, y) + 1);
    w.setOrientation(i, 0, 0, 0, 1);
    run(w, 3);
    expect(w.asleep[i]).toBe(1);
    // its axis along the ground's normal
    const n = [-slope, 0, 1].map((c) => c / Math.sqrt(1 + slope * slope));
    const axis = w.axis(i);
    expect(Math.abs(axis[0] * n[0] + axis[1] * n[1] + axis[2] * n[2])).toBeGreaterThan(Math.cos((3 * Math.PI) / 180));
    // its middle half its thickness off the ground, measured square to it
    const off = (w.z[i] - w.floorAt(w.x[i], w.y[i])) * n[2];
    expect(Math.abs(off - 0.12)).toBeLessThan(0.03);
    // it slid no way down
    expect(Math.hypot(w.x[i] - x, w.y[i] - y)).toBeLessThan(0.5);
  });
});

describe('a coin slid on the terrain', () => {
  /** A world of one coin on terrain, and a coin put down on it lying along the ground, its middle a hair off it. */
  const coinOn = (terrain: Float32Array, x: number, y: number, sx: number, sy: number, into = 0) => {
    const w = new World({
      capacity: 2,
      grid: GRID,
      solid: walled(),
      radii: [0.42],
      thickness: [0.24],
      random: seeded(6),
      terrain,
    });
    const l = Math.hypot(sx, sy, 1),
      n = [-sx / l, -sy / l, 1 / l];
    const i = w.spawn(0, x, y, w.floorAt(x, y) + (0.12 - into) / n[2]);
    // turned from upright to the ground's normal, about the level line across it
    const al = Math.hypot(n[0], n[1]),
      turn = Math.acos(n[2]) / 2;
    w.setOrientation(i, (-n[1] / al) * Math.sin(turn), (n[0] / al) * Math.sin(turn), 0, Math.cos(turn));
    return { w, i, n };
  };

  it('drifts down a slope as it slides across it, and stops', () => {
    const { w, i } = coinOn(incline(0.5), middle(20), middle(8), 0.5, 0);
    const x = w.x[i];
    w.vy[i] = 8;
    run(w, 2);
    // gravity's pull down the slope while the felt's grip goes into stopping the slide; met as flat, it drifted
    // a two hundredth of a unit
    expect(x - w.x[i]).toBeGreaterThan(0.2);
    expect(w.asleep[i]).toBe(1);
  });

  it('is put out of the steepest ground square to it, onto it and no further', () => {
    // a tenth into ground rising half a tile a tile both ways, and stepped once
    const { w, i, n } = coinOn(
      terrainOf((tx, ty) => 1.5 * (tx + ty)),
      middle(20),
      middle(15),
      0.5,
      0.5,
      0.1,
    );
    w.step(STEP, nothing);
    // how far its face is off the ground, square to it: a hair under, as a coin at rest lies; pushed out by as
    // much as it was sunk upright, it went a fifth of a tenth too far
    const gap = (w.z[i] - w.floorAt(w.x[i], w.y[i])) * n[2] - 0.12;
    expect(Math.abs(gap)).toBeLessThan(0.01);
  });
});

describe('a coin at a step on the terrain', () => {
  it('tips over the lip of a step on level terrain as it does with none, higher by the terrain', () => {
    // a step half a unit high on the tiles west of x = 60, and a coin put flat with its middle just past its edge
    const floor = terrainOf((tx) => (tx < 20 ? 0.5 : 0));
    const tipped = (rise: number) => {
      const w = new World({
        capacity: 2,
        grid: GRID,
        solid: walled(),
        floor,
        terrain: rise ? terrainOf(() => rise) : undefined,
        radii: [0.42],
        thickness: [0.24],
        random: seeded(4),
      });
      const i = w.spawn(0, 60.15, middle(15), rise + 0.5 + 0.12);
      w.setOrientation(i, 0, 0, 0, 1);
      const path: number[][] = [];
      for (let f = 0; f < 60; f++) {
        w.step(DT, nothing);
        path.push([w.x[i], w.y[i], w.z[i] - rise, ...w.axis(i)]);
      }
      return path;
    };
    const none = tipped(0),
      raised = tipped(3);
    // it went over the lip, and leans against the step's face below it, its axis swung a third of the way over
    expect(none[59][5]).toBeLessThan(0.9);
    expect(none[59][2]).toBeLessThan(0.4);
    let worst = 0;
    none.forEach((at, f) => at.forEach((v, k) => (worst = Math.max(worst, Math.abs(v - raised[f][k])))));
    expect(worst).toBeLessThan(1e-3);
  });
});

describe('a hole in the terrain', () => {
  const GREEN_GRID = { tx: 30, ty: 15 };
  const cup = (): Hole => ({ x: middle(GREEN_GRID.tx), y: middle(GREEN_GRID.ty), ...CUP });

  it('refuses terrain steeper than half a tile a tile, naming the tile', () => {
    const terrain = terrainOf(() => 0);
    terrain[10 * GRID.cols + 12] = 1.6;
    expect(() => world({ terrain })).toThrow(/tile 1[12], 10/);
    terrain[10 * GRID.cols + 12] = 1.5;
    expect(() => world({ terrain })).not.toThrow();
  });

  it('refuses a terrain that is not one height a tile', () => {
    expect(() => world({ terrain: new Float32Array(TILES - 1) })).toThrow(/tile/);
  });

  it('refuses tiles narrower than the biggest ball', () => {
    expect(() => world({ terrain: terrainOf(() => 0), radii: [1, 1.6] })).toThrow(/narrower/);
    expect(() => world({ terrain: terrainOf(() => 0), radii: [1, 1.5] })).not.toThrow();
  });

  it('refuses a hole that is not on level ground out as far as the smoothing reaches a ball touching its edge', () => {
    // level for three tiles all round the cup's own, and rising beyond
    const pad = (tx: number, ty: number) => Math.max(Math.abs(tx - GREEN_GRID.tx), Math.abs(ty - GREEN_GRID.ty));
    const terrain = terrainOf((tx, ty) => 0.5 * Math.max(0, pad(tx, ty) - 3));
    expect(() => world({ terrain, holes: [cup()] })).not.toThrow();
    // a tile three out, whose smoothing reaches a ball on the edge, raised a hair
    terrain[GREEN_GRID.ty * GRID.cols + GREEN_GRID.tx + 3] = 0.01;
    expect(() => world({ terrain, holes: [cup()] })).toThrow(/hole 0.*tile 33, 15/);
    // and one on a slope, anywhere near it
    expect(() => world({ terrain: incline(0.01), holes: [cup()] })).toThrow(/hole 0/);
  });

  it('is cut level in a hilltop, and takes what rolls into it', () => {
    const pad = (tx: number, ty: number) => Math.max(Math.abs(tx - GREEN_GRID.tx), Math.abs(ty - GREEN_GRID.ty));
    // a hilltop level at 6 for four tiles round the cup, falling away beyond
    const terrain = terrainOf((tx, ty) => Math.max(0, 6 - 1.5 * Math.max(0, pad(tx, ty) - 4)));
    const w = world({ terrain, holes: [cup()], surfaces: [GREEN] });
    const beside = putDown(w, terrain, middle(GREEN_GRID.tx) - 5, middle(GREEN_GRID.ty) + 3);
    const i = putDown(w, terrain, middle(GREEN_GRID.tx) - 7, middle(GREEN_GRID.ty));
    expect(w.z[i]).toBe(6 + R);
    w.hit(i, 15, 0, 0);
    const holed: number[] = [];
    // the steps from its middle going over the edge to its being taken: it falls from the hilltop, not from nothing
    let over = -1,
      taken = -1;
    for (let s = 0; s < 3 / STEP; s++) {
      w.step(STEP, (_kind, _x, _y, slot, hole) => {
        holed.push(slot, hole);
        taken = s;
      });
      if (over < 0 && Math.hypot(w.x[i] - middle(GREEN_GRID.tx), w.y[i] - middle(GREEN_GRID.ty)) < CUP.radius) over = s;
    }
    expect(holed).toEqual([i, 0]);
    // four units down from the hilltop's six to the hole's depth, 41 steps; cut at nothing it would be ten
    expect(taken - over).toBeLessThan(50);
    expect(w.asleep[beside]).toBe(1);
    expect(w.z[beside]).toBe(6 + R);
  });

  // The putt that the whole of the terrain is for: across a green that falls away to one side, aimed above the
  // cup, it breaks down into it; aimed at the cup, it misses below; and on a flat green the putt that dropped misses.
  it('takes a putt aimed above it that breaks down into it, where one aimed at it misses below', () => {
    // A green falling away along y at a tenth, level for three tiles round the cup and for the width of the green
    // beyond, the fall fading out over the four tiles before it.
    const fade = (tx: number) => Math.min(1, Math.max(0, (GREEN_GRID.tx - 3 - tx) / 4));
    const green = terrainOf((tx, ty) => 0.1 * GRID.tile * (ty - GREEN_GRID.ty) * fade(tx));
    const putt = (terrain: Float32Array, aim: number) => {
      const w = world({ terrain, holes: [cup()], surfaces: [GREEN] });
      const i = putDown(w, terrain, middle(8), middle(GREEN_GRID.ty));
      const dx = middle(GREEN_GRID.tx) - w.x[i],
        dy = middle(GREEN_GRID.ty) + aim - w.y[i];
      const d = Math.hypot(dx, dy);
      w.hit(i, (PUTT * dx) / d, (PUTT * dy) / d, 0);
      let holed = false;
      run(w, 6, (_kind, _x, _y, _slot, hole) => (holed = hole === 0));
      return { holed, y: w.y[i] };
    };
    expect(putt(green, ABOVE).holed).toBe(true);
    const straight = putt(green, 0);
    expect(straight.holed).toBe(false);
    expect(straight.y).toBeLessThan(middle(GREEN_GRID.ty));
    expect(
      putt(
        terrainOf(() => 0),
        ABOVE,
      ).holed,
    ).toBe(false);
  });
});

/**
 * How hard the breaking putt is struck, and how far above the cup it is
 * aimed: found by putting, and fixed in the middle of the aims that drop,
 * which run from 10.5 to 12.5 above it. On a flat green all of them miss
 * by as much.
 */
const PUTT = 46;
const ABOVE = 11.5;

describe('a world without terrain', () => {
  it('steps exactly as one given terrain flat at nothing', () => {
    const scene = (terrain: Float32Array | undefined) => {
      const random = seeded(5);
      const floor = terrainOf((tx, ty) => (tx === 12 && ty > 4 && ty < 20 ? 2 : 0));
      const surface = Uint8Array.from({ length: TILES }, (_, t) => (t % GRID.cols > 25 && t % GRID.cols < 30 ? 1 : 0));
      const w = new World({
        capacity: 24,
        grid: GRID,
        solid: walled(),
        floor,
        terrain,
        surface,
        surfaces: [GREEN, { drag: 8, roll: 60 }],
        radii: [R, 0.42],
        thickness: [0, 0.24],
        holes: [{ x: middle(34), y: middle(8), ...CUP }],
        random,
        tuning: { ...GOLF, restitution: 0.4, bounceFrom: 1, wallRestitution: 0.7 },
      });
      w.bumpers = [{ x: middle(20), y: middle(20), radius: 1, top: 3, restitution: 1.3 }];
      for (let k = 0; k < 8; k++) w.spawn(0, 10 + random() * 90, 10 + random() * 60, 1 + random() * 6);
      for (let k = 0; k < 8; k++) w.spawn(1, 10 + random() * 90, 10 + random() * 60, 1 + random() * 6);
      const frames: number[][] = [];
      for (let f = 0; f < 600; f++) {
        if (f % 90 === 0)
          for (let i = 0; i < 8; i++) w.hit(i, (random() - 0.5) * 120, (random() - 0.5) * 120, random() * 10);
        w.pushers = [
          {
            x: middle(16 + 4 * Math.sin(f * DT)),
            y: middle(10),
            z: 1.5,
            yaw: f * DT,
            hx: 0.4,
            hy: 3,
            hz: 1.5,
            vx: 0,
            vy: 0,
            spin: 1,
            px: middle(16),
            py: middle(10),
            owner: 0,
          },
        ];
        w.step(DT, nothing);
        if (f % 60 === 59) frames.push(...[w.x, w.y, w.z, w.vx, w.vy, w.vz, w.q].map((a) => Array.from(a)));
      }
      return frames;
    };
    const none = scene(undefined),
      flat = scene(terrainOf(() => 0));
    // value for value, where +0 and -0 are one value
    let differ = 0;
    none.forEach((row, r) => row.forEach((v, k) => (v === flat[r][k] ? 0 : differ++)));
    expect(differ).toBe(0);
  });
});
