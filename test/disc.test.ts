/**
 * Discs: a kind with a thickness is a coin, a rigid disc with a turn of its
 * own, and what it does is what a coin does. It lies flat, stacks a
 * thickness apart, leans with a rim on the floor and its face on another's
 * edge, stands wedged between two others, tips off a support its middle has
 * passed, and piles when a bed of them is pushed. Nothing here is a game's:
 * a floor of the test's own making, and whatever it puts on it.
 */
import { describe, expect, it } from 'vitest';
import { World, type Grid, type Pusher, type WorldOptions } from '../src/world';

const DT = 1 / 60;
const GRID: Grid = { cols: 40, rows: 40, originX: -20, originY: -20, tile: 1 };
/** A coin and a ball of the same width: kind 0 is a disc, kind 1 is a ball. */
const R = 0.42,
  H = 0.24;
const RADII = [R, R];
const THICKNESS = [H, 0];
const DISC = 0,
  BALL = 1;
/** How far two things may overlap at rest and still be said not to cut: a twentieth of a unit. */
const CUT = 0.05;

function solid(rock: (tx: number, ty: number) => boolean = () => false): Uint8Array {
  const out = new Uint8Array(GRID.cols * GRID.rows);
  for (let ty = 0; ty < GRID.rows; ty++)
    for (let tx = 0; tx < GRID.cols; tx++)
      out[ty * GRID.cols + tx] =
        tx === 0 || ty === 0 || tx === GRID.cols - 1 || ty === GRID.rows - 1 || rock(tx, ty) ? 1 : 0;
  return out;
}

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const world = (over: Partial<WorldOptions> = {}) =>
  new World({
    capacity: 64,
    grid: GRID,
    solid: solid(),
    radii: RADII,
    thickness: THICKNESS,
    random: seeded(1),
    tuning: { cell: 1.2 },
    ...over,
  });

const run = (w: World, seconds: number) => {
  for (let f = 0; f < seconds * 60; f++) w.step(DT, () => {});
};

/** A disc put down flat, still, at a point. */
function flat(w: World, x: number, y: number, z: number): number {
  const i = w.spawn(DISC, x, y, z);
  w.setOrientation(i, 0, 0, 0, 1);
  return i;
}

/** A disc stood on its edge, its faces looking along x, tipped a little from upright about y. */
function onEdge(w: World, x: number, y: number, z: number, tip = 0): number {
  const i = w.spawn(DISC, x, y, z);
  const a = Math.PI / 2 + tip;
  w.setOrientation(i, 0, Math.sin(a / 2), 0, Math.cos(a / 2));
  return i;
}

/** How far a disc's axis is from upright, in radians: 0 lying flat, a quarter turn on edge. */
const tilt = (w: World, i: number) => Math.acos(Math.min(1, Math.abs(w.axis(i)[2])));
/** The lowest point of a disc: its centre, less its rim's drop and its face's. */
const lowest = (w: World, i: number) => {
  const nz = Math.abs(w.axis(i)[2]);
  return w.z[i] - R * Math.sqrt(Math.max(0, 1 - nz * nz)) - (H / 2) * nz;
};

describe('a disc', () => {
  it('dropped at a tilt comes to lie flat on the floor at half its thickness, and sleeps', () => {
    const w = world();
    const i = w.spawn(DISC, 0, 0, 3);
    w.setOrientation(i, Math.sin(0.4), 0, 0, Math.cos(0.4));
    run(w, 4);
    expect(w.z[i]).toBeCloseTo(H / 2, 1);
    expect(tilt(w, i)).toBeLessThan(0.03);
    expect(w.asleep[i]).toBe(1);
  });

  it('dropped flat on another rests a thickness above it, and two pressed side by side part to a diameter, level', () => {
    const w = world();
    const a = flat(w, 0, 0, H / 2);
    run(w, 1);
    const b = flat(w, 0.05, 0, 2);
    run(w, 3);
    expect(w.z[b] - w.z[a]).toBeCloseTo(H, 1);
    expect(tilt(w, b)).toBeLessThan(0.05);
    expect(w.deepest().depth).toBeLessThan(CUT);
    // two on the floor, overlapping across: they part sideways and neither rides up
    const c = flat(w, 5, 0, H / 2),
      d = flat(w, 5 + 2 * R - 0.15, 0, H / 2);
    run(w, 2);
    expect(Math.hypot(w.x[d] - w.x[c], w.y[d] - w.y[c])).toBeGreaterThan(2 * R - 0.03);
    expect(w.z[c]).toBeCloseTo(H / 2, 1);
    expect(w.z[d]).toBeCloseTo(H / 2, 1);
  });

  it("leans on another's edge, a rim on the floor and its face on the other's rim, and stays", () => {
    const w = world();
    const a = flat(w, 0, 0, H / 2);
    run(w, 1);
    // put down already leaning at twenty degrees: its foot on the floor, its face on the other's top rim
    const th = (20 * Math.PI) / 180,
      along = H / Math.sin(th),
      foot = R + along * Math.cos(th);
    const b = w.spawn(
      DISC,
      foot - R * Math.cos(th) + (H / 2) * Math.sin(th),
      0,
      R * Math.sin(th) + (H / 2) * Math.cos(th),
    );
    w.setOrientation(b, 0, Math.sin(th / 2), 0, Math.cos(th / 2));
    const x = w.x[b];
    run(w, 4);
    expect(tilt(w, b), 'still leaning as it was put').toBeGreaterThan(th - 0.06);
    expect(tilt(w, b)).toBeLessThan(th + 0.06);
    expect(Math.abs(w.x[b] - x), 'and where it was put').toBeLessThan(0.05);
    expect(lowest(w, b), 'a rim on the floor').toBeLessThan(0.04);
    expect(w.asleep[b]).toBe(1);
    expect(w.asleep[a]).toBe(1);
    expect(w.deepest().depth).toBeLessThan(CUT);
  });

  it("dropped onto another's edge, most come to rest leaning on it, and none cut it", () => {
    // its middle out past the rim of the one below, so it cannot lie on it: by how far, and from how high, varies
    let leaning = 0,
      tried = 0;
    for (const height of [0.4, 0.7, 1])
      for (const out of [0.05, 0.15, 0.25, 0.35]) {
        const w = world();
        flat(w, 0, 0, H / 2);
        run(w, 1);
        const b = flat(w, R + out, 0, height);
        run(w, 5);
        tried++;
        if (tilt(w, b) > 0.12 && w.z[b] > H / 2 + 0.03 && lowest(w, b) < 0.04) leaning++;
        // leaning or slid off to lie beside it, it is at rest, on the floor, and into nothing
        expect(w.asleep[b], `out ${out} from ${height}`).toBe(1);
        expect(lowest(w, b)).toBeGreaterThan(-0.03);
        expect(w.deepest().depth).toBeLessThan(CUT);
      }
    expect(leaning / tried, 'most of them lean').toBeGreaterThan(0.5);
  });

  it('finds two that are not quite level as deep in each other as they are, by the way the whole coin would come out', () => {
    // tipped six degrees, so they are not taken to lie in one plane, about the line between them, so neither end is nearer
    const tipped = (w: World, x: number, y: number, z: number) => {
      const i = w.spawn(DISC, x, y, z);
      const a = (6 * Math.PI) / 180;
      w.setOrientation(i, Math.sin(a / 2), 0, 0, Math.cos(a / 2));
      return i;
    };
    // side by side on a level, their rims 0.07 into each other: a rim of each is a hair under the other's face, and
    // out by that face is no way out for the coin behind it
    const side = world();
    flat(side, 0, 0, 1);
    tipped(side, 2 * R - 0.07, 0, 1);
    expect(side.deepest().depth, 'side by side').toBeGreaterThan(0.05);
    expect(side.deepest().depth).toBeLessThan(0.09);
    // one all but squarely on the other and 0.11 down into it: its rim is a hair inside the other's side all the way
    // round, and out by the side is no way out for a coin lying on it
    const on = world();
    flat(on, 0, 0, 1);
    tipped(on, 0.03, 0, 1 + H - 0.11);
    expect(on.deepest().depth, 'one on the other').toBeGreaterThan(0.09);
    expect(on.deepest().depth).toBeLessThan(0.2);
    // and two that only look close: one standing on edge a hair clear of the rim of one lying flat
    const clear = world();
    flat(clear, 0, 0, H / 2);
    onEdge(clear, R + H / 2 + 0.01, 0, R);
    expect(clear.deepest().depth, 'not touching').toBe(0);
  });

  it('dropped on edge between two others stays wedged on edge, and on edge alone it falls flat', () => {
    const w = world();
    // two lying flat with a gap between their rims a little wider than a coin is thick
    flat(w, -(R + 0.17), 0, H / 2);
    flat(w, R + 0.17, 0, H / 2);
    run(w, 1);
    const c = onEdge(w, 0, 0, R + 0.3, 0.05);
    run(w, 5);
    expect(tilt(w, c), 'still on edge').toBeGreaterThan(1);
    expect(w.asleep[c]).toBe(1);
    expect(w.deepest().depth).toBeLessThan(CUT);
    // alone, tipped past where a coin this thick can stand: a rim this wide holds it up to about sixteen degrees
    const alone = onEdge(w, 8, 0, R + 0.3, 0.5);
    run(w, 5);
    expect(tilt(w, alone), 'fallen flat').toBeLessThan(0.05);
    expect(w.z[alone]).toBeCloseTo(H / 2, 1);
  });

  it('stays on a support its middle is over, and tips off one its middle has passed', () => {
    const w = world();
    const a = flat(w, 0, 0, H / 2);
    const under = flat(w, 6, 0, H / 2);
    run(w, 1);
    const held = flat(w, 0.25, 0, H * 1.5 + 0.02);
    const tipped = flat(w, 6 + R + 0.12, 0, H * 1.5 + 0.02);
    run(w, 4);
    expect(w.z[held] - w.z[a]).toBeCloseTo(H, 1);
    expect(tilt(w, held)).toBeLessThan(0.05);
    // the other did not stay lying on the one below: it has come down, leaning on it or off it
    expect(w.z[tipped] - w.z[under]).toBeLessThan(H - 0.04);
    // and the same off the edge of a raised floor
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 0; tx < 20; tx++) floor[ty * GRID.cols + tx] = 2;
    const s = world({ floor });
    const on = flat(s, -0.2, 0, 2 + H / 2),
      off = flat(s, 0.1, 5, 2 + H / 2);
    run(s, 4);
    expect(s.z[on]).toBeCloseTo(2 + H / 2, 1);
    expect(s.z[off], 'over the edge and down').toBeLessThan(1);
  });

  it("goes over a lip of the floor with the step's corner never in it, pushed or tipping, and rests propped on one the same", () => {
    // a floor standing two high as far as x = 0, and a drop beyond: the lip runs along y
    const floor = new Float32Array(GRID.cols * GRID.rows);
    for (let ty = 0; ty < GRID.rows; ty++) for (let tx = 0; tx < 20; tx++) floor[ty * GRID.cols + tx] = 2;
    /** How far the lip is inside a disc: by the nearer of its faces and its rim, at the deepest along the lip. */
    const corner = (w: World, i: number) => {
      const [nx, ny, nz] = w.axis(i);
      let deepest = 0;
      for (let s = -R; s <= R; s += 0.02) {
        const dx = -w.x[i],
          dy = s,
          dz = 2 - w.z[i];
        const along = dx * nx + dy * ny + dz * nz;
        const across = Math.hypot(dx - along * nx, dy - along * ny, dz - along * nz);
        deepest = Math.max(deepest, Math.min(H / 2 - Math.abs(along), R - across));
      }
      return deepest;
    };
    // tipping: put down with its middle just past the lip, it goes over, and the corner is never in it
    const w = world({ floor });
    const tipping = flat(w, 0.06, 0, 2 + H / 2);
    let worst = 0;
    for (let f = 0; f < 120; f++) {
      w.step(DT, () => {});
      worst = Math.max(worst, corner(w, tipping));
    }
    expect(w.z[tipping], 'over and down').toBeLessThan(1);
    expect(worst, 'the corner in the one tipping').toBeLessThan(CUT);
    // pushed: a row of three shoved over the lip by a box, slowly, as a pusher does
    const p = world({ floor });
    const row = [flat(p, -2.6, 0, 2 + H / 2), flat(p, -1.75, 0, 2 + H / 2), flat(p, -0.9, 0, 2 + H / 2)];
    const box = (x: number, vx: number, px: number): Pusher => ({
      x,
      y: 0,
      z: 2.8,
      yaw: 0,
      hx: 1,
      hy: 3,
      hz: 0.8,
      vx,
      vy: 0,
      spin: 0,
      px,
      py: 0,
      owner: 0,
    });
    let x = -4.1;
    worst = 0;
    for (let f = 0; f < 60 * 5; f++) {
      const was = x;
      x = Math.min(-1.5, x + 0.8 * DT);
      p.pushers = [box(x, (x - was) / DT, was)];
      p.wakeNear(x + 1.5, 0, 3);
      p.step(DT, () => {});
      for (const i of row) worst = Math.max(worst, corner(p, i));
    }
    expect(row.filter((i) => p.z[i] < 1).length, 'pushed over').toBeGreaterThan(0);
    expect(worst, 'the corner in one being pushed over').toBeLessThan(CUT);
    // propped: put down leaning from the rim of one lying behind the lip to the lip, its low end just past it
    const q = world({ floor });
    flat(q, -1, 5, 2 + H / 2);
    run(q, 1);
    const th = Math.atan2(H, 1 - R),
      past = 0.06;
    const endX = past * Math.cos(th),
      endZ = 2 - past * Math.sin(th);
    const propped = q.spawn(
      DISC,
      endX - R * Math.cos(th) + (H / 2) * Math.sin(th),
      5,
      endZ + R * Math.sin(th) + (H / 2) * Math.cos(th),
    );
    q.setOrientation(propped, 0, Math.sin(th / 2), 0, Math.cos(th / 2));
    const put = q.x[propped];
    worst = 0;
    for (let f = 0; f < 60 * 5; f++) {
      q.step(DT, () => {});
      worst = Math.max(worst, corner(q, propped));
    }
    expect(q.asleep[propped], 'at rest').toBe(1);
    expect(Math.abs(tilt(q, propped) - th), 'leaning as it was put').toBeLessThan(0.06);
    expect(Math.abs(q.x[propped] - put), 'and where it was put').toBeLessThan(0.05);
    expect(worst, 'the corner in the one propped').toBeLessThan(CUT);
    expect(q.deepest().depth).toBeLessThan(CUT);
  });

  it('piles into a heap that comes to rest with nothing cutting anything, none through the floor, the same way twice', () => {
    const heap = (seed: number) => {
      const random = seeded(seed);
      // a pen of rock six tiles square, so what is rained into it has to pile
      const w = world({
        capacity: 400,
        random,
        solid: solid((tx, ty) => !(tx >= 17 && tx < 23 && ty >= 17 && ty < 23)),
      });
      let top = 0;
      for (let k = 0; k < 150; k++) {
        // from a little above whatever has come to rest, as anything real arrives, and a few a second, as coins are fed
        w.spawn(DISC, -2.4 + random() * 4.8, -2.4 + random() * 4.8, top + 1 + random());
        for (let f = 0; f < 8; f++) w.step(DT, () => {});
        // the heap's height is what is lying in it, not what is still on its way down
        top = 0;
        for (let i = 0; i < w.count; i++) if (Math.abs(w.vz[i]) < 1) top = Math.max(top, w.z[i]);
        top = Math.min(top, 2);
      }
      // until every one of them is asleep, which a crowded corner can put off for a quarter of a minute
      for (let second = 0; second < 30 && [...w.asleep.subarray(0, w.count)].some((a) => !a); second++) run(w, 1);
      return w;
    };
    // Over three heaps, not one: from one seed a heap once came to rest that from the next had a coin sunk through
    // another and a third of it awake for good.
    const first = heap(3);
    for (const w of [first, heap(8), heap(12)]) {
      let top = 0,
        leaning = 0,
        asleep = 0;
      for (let i = 0; i < w.count; i++) {
        expect(lowest(w, i), `disc ${i} through the floor`).toBeGreaterThan(-CUT);
        top = Math.max(top, w.z[i]);
        if (tilt(w, i) > 0.15) leaning++;
        asleep += w.asleep[i];
      }
      expect(top, 'more than two deep').toBeGreaterThan(H * 2);
      expect(leaning, 'some lean').toBeGreaterThan(5);
      expect(asleep, 'and it comes to rest, every one of them').toBe(w.count);
      // as far into something as a disc may be and still sleep, and no further
      expect(w.deepest(true).depth, 'nothing at rest cuts anything').toBeLessThanOrEqual(CUT + 1e-4);
    }
    const w = first;
    const again = heap(3);
    expect([...again.x.slice(0, 150)]).toEqual([...w.x.slice(0, 150)]);
    expect([...again.q.slice(0, 600)]).toEqual([...w.q.slice(0, 600)]);
  });

  it('lands hard at any tilt, tumbling, and never ends a frame well under the floor', () => {
    const random = seeded(9);
    const w = world({ capacity: 200 });
    let deepest = 0;
    // one after another onto a bare floor, as fast as a coin falls from a tier above, turned every way and spinning
    for (let k = 0; k < 60; k++) {
      const i = w.spawn(DISC, -8 + (k % 10) * 1.8, -6 + Math.floor(k / 10) * 1.8, 2.5, 0.5, -1.5, -17);
      const a = random() * Math.PI,
        b = random() * Math.PI * 2;
      w.setOrientation(i, Math.sin(a / 2) * Math.cos(b), Math.sin(a / 2) * Math.sin(b), 0, Math.cos(a / 2));
      w.wx[i] = (random() - 0.5) * 20;
      w.wy[i] = (random() - 0.5) * 20;
      for (let f = 0; f < 20; f++) {
        w.step(DT, () => {});
        for (let j = 0; j <= i; j++) deepest = Math.max(deepest, -lowest(w, j));
      }
    }
    expect(deepest, 'the furthest any got under the floor').toBeLessThan(CUT);
  });

  it('never passes through another or the floor, dropped from a height', () => {
    const random = seeded(5);
    // a bed of them lying flat, wall to wall in a pen of rock, so there is no way to the floor but through a coin
    const w = world({
      capacity: 400,
      random,
      solid: solid((tx, ty) => !(tx >= 14 && tx < 26 && ty >= 14 && ty < 26)),
    });
    for (let ix = 0; ix < 14; ix++)
      for (let iy = 0; iy < 14; iy++) flat(w, -5.57 + ix * 0.857, -5.57 + iy * 0.857, H / 2);
    run(w, 1);
    const bed = w.count;
    // flat ones first: each must come to rest on top
    for (let k = 0; k < 20; k++) {
      flat(w, -4 + random() * 8, -4 + random() * 8, 5);
      run(w, 0.5);
    }
    run(w, 3);
    for (let i = bed; i < w.count; i++) expect(w.z[i], `flat disc ${i} dropped on the bed`).toBeGreaterThan(H);
    for (let i = 0; i < bed; i++) expect(w.z[i], `bed disc ${i}`).toBeLessThan(H);
    // then at any tilt: nothing at rest cuts anything, and none goes through the floor
    for (let k = 0; k < 20; k++) {
      const i = w.spawn(DISC, -4 + random() * 8, -4 + random() * 8, 5);
      const a = random() * Math.PI,
        b = random() * Math.PI * 2;
      w.setOrientation(i, Math.sin(a / 2) * Math.cos(b), Math.sin(a / 2) * Math.sin(b), 0, Math.cos(a / 2));
      run(w, 0.5);
    }
    run(w, 5);
    // one on edge may wedge down between two of the bed, and squeeze a neighbour up on top of the rest; but
    // nothing is through the floor, and nothing at rest is into anything
    for (let i = 0; i < w.count; i++) expect(lowest(w, i), `disc ${i}`).toBeGreaterThan(-CUT);
    expect(w.deepest(true).depth).toBeLessThan(CUT);
  });

  it('piles when a bed of them, wall to wall, is pushed by a box against a wall', () => {
    // rock to north and south as well as east, so the bed can go nowhere but up
    const w = world({ capacity: 400, solid: solid((_tx, ty) => ty < 12 || ty >= 28) });
    for (let ix = 0; ix < 14; ix++) for (let iy = 0; iy < 18; iy++) flat(w, 6.2 + ix * 0.9, -7.55 + iy * 0.888, H / 2);
    run(w, 1);
    let above = 0;
    for (let i = 0; i < w.count; i++) if (w.z[i] > H) above++;
    expect(above, 'one deep to begin with').toBe(0);
    let x = 4;
    let prev: Pusher | null = null;
    const box = (vx: number, px: number): Pusher => ({
      x,
      y: 0,
      z: 0.8,
      yaw: 0,
      hx: 1.5,
      hy: 12,
      hz: 0.8,
      vx,
      vy: 0,
      spin: 0,
      px,
      py: 0,
      owner: 0,
    });
    for (let f = 0; f < 60 * 4; f++) {
      const was = x;
      x += 1.2 * DT;
      prev = box(prev ? (x - was) / DT : 0, was);
      w.pushers = [prev];
      w.wakeNear(x + 3, 0, 12);
      w.step(DT, () => {});
    }
    w.pushers = [box(0, x)];
    run(w, 6);
    above = 0;
    for (let i = 0; i < w.count; i++) if (w.z[i] > H) above++;
    expect(above / w.count, 'a good share above the first layer').toBeGreaterThan(0.1);
    for (let i = 0; i < w.count; i++) expect(w.x[i], `disc ${i} behind the face`).toBeGreaterThan(x + 1.5 - CUT);
    expect(w.deepest(true).depth, 'nothing at rest cuts anything').toBeLessThan(CUT);
  });

  it('is never slid far aside, nor down through the floor, by a hair of overlap: a bed pushed slowly, its far rows asleep', () => {
    for (const seed of [2, 3]) {
      const random = seeded(seed);
      // a bed in staggered rows, a hair of chance in where each lies, in a lane of rock twelve tiles wide
      const w = world({ capacity: 200, random, solid: solid((_tx, ty) => ty < 14 || ty >= 26) });
      const pitch = 2 * R + 0.02;
      for (let row = 0; row < 8; row++)
        for (let c = 0; c < 13; c++) {
          const y = -5.4 + c * pitch + (row % 2 ? pitch / 2 : 0) + (random() - 0.5) * 0.01;
          if (y <= 5.5) flat(w, -8 + row * pitch * 0.87 + (random() - 0.5) * 0.01, y, H / 2 + 0.002);
        }
      run(w, 1.5);
      const box = (x: number, vx: number, px: number): Pusher => ({
        x,
        y: 0,
        z: 0.8,
        yaw: 0,
        hx: 1,
        hy: 8,
        hz: 0.8,
        vx,
        vy: 0,
        spin: 0,
        px,
        py: 0,
        owner: 0,
      });
      let x = -9.6,
        furthest = 0,
        lowest = 1;
      const was = { x: new Float32Array(w.count), y: new Float32Array(w.count), z: new Float32Array(w.count) };
      for (let f = 0; f < 60 * 4; f++) {
        const from = x;
        x += 0.7 * DT;
        w.pushers = [box(x, (x - from) / DT, from)];
        // only what lies just ahead of the face is woken, as a game would: the rest is asleep until the row reaches it
        for (let y = -6; y <= 6; y += 2) w.wakeNear(x + 1.9, y, 1.5);
        was.x.set(w.x.subarray(0, w.count));
        was.y.set(w.y.subarray(0, w.count));
        was.z.set(w.z.subarray(0, w.count));
        w.step(DT, () => {});
        for (let i = 0; i < w.count; i++) {
          furthest = Math.max(furthest, Math.hypot(w.x[i] - was.x[i], w.y[i] - was.y[i], w.z[i] - was.z[i]));
          lowest = Math.min(lowest, w.z[i]);
        }
      }
      // a row backed by the face and met by a sleeper a degree off its line was slid nine units aside in a frame
      expect(furthest, `the furthest any moved in a frame, seed ${seed}`).toBeLessThan(0.3);
      expect(lowest, `the lowest any got, seed ${seed}`).toBeGreaterThan(H / 2 - CUT);
    }
  });

  it("rests on a box's top at half its thickness, lying flat, and is carried when the box moves off unasked", () => {
    const w = world();
    const box = (x: number, vx: number, px: number): Pusher => ({
      x,
      y: 10,
      z: 1,
      yaw: 0,
      hx: 6,
      hy: 6,
      hz: 1,
      vx,
      vy: 0,
      spin: 0,
      px,
      py: 10,
      owner: 0,
    });
    w.pushers = [box(0, 0, 0)];
    const i = w.spawn(DISC, 0, 10, 4);
    run(w, 3);
    expect(w.z[i]).toBeCloseTo(2 + H / 2, 1);
    expect(tilt(w, i)).toBeLessThan(0.05);
    expect(w.asleep[i]).toBe(1);
    let x = 0;
    for (let f = 0; f < 120; f++) {
      const was = x;
      x += 5 * DT;
      w.pushers = [box(x, 5, was)];
      w.step(DT, () => {});
    }
    expect(w.x[i]).toBeGreaterThan(x - 2);
    expect(w.z[i]).toBeCloseTo(2 + H / 2, 1);
  });

  it('meets a ball as a disc meets anything: neither cuts the other', () => {
    const w = world();
    const d = flat(w, 0, 0, H / 2);
    run(w, 1);
    const b = w.spawn(BALL, 0.05, 0, 2);
    run(w, 3);
    expect(w.deepest().depth).toBeLessThan(CUT);
    expect(w.z[b]).toBeGreaterThan(R - 0.05);
    expect(w.z[d]).toBeCloseTo(H / 2, 1);
    // and the ball is a ball still: on the floor it rests at its radius
    const alone = w.spawn(BALL, 8, 8, 2);
    run(w, 3);
    expect(w.z[alone]).toBeCloseTo(R, 2);
  });
});
