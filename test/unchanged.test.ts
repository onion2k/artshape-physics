/**
 * The world as v0.3.0 left it, held bit for bit.
 *
 * Every game that pins this package is to behave exactly as it did until it
 * opts in to something new, and a test of what a thing does only holds it
 * to within its tolerance: a bounce that moved by a thousandth, or a heap
 * that settled a step later, would pass every other test here and still
 * change a game. So five scenes that between them go down every path the
 * world has — a heap churned beside a hole, balls shoved into a wall a tile
 * thick and thrown at it, balls on tiers with a belt, a magnet and a box
 * that carries, a bed of coins pushed over a step and a drop, and coins
 * pushed down a hole — are run from a seed, with none of the new options,
 * and every body's state is hashed as they go. The hashes were written
 * once, at v0.3.0, before anything changed. Each path a later change is to
 * touch was checked by changing it by a part in ten million and seeing a
 * scene fail.
 *
 * A hash that moves is a change in behaviour, whatever the change meant to
 * do. It is written again only for a change meant to move it, or for a
 * Node upgrade that changes the bits `Math` gives, which is confirmed by
 * checking the old commit out on the new Node first; the commit says which.
 *
 *   UNCHANGED_UPDATE=1 npx vitest run test/unchanged.test.ts    write the hashes again
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { World, type Grid, type Pusher } from '../src/world';

const RECORD = new URL('./unchanged.json', import.meta.url);
const UPDATE = process.env.UNCHANGED_UPDATE === '1';
const DT = 1 / 60;
/** How long each scene runs, and the frames its state is hashed at. */
const FRAMES = 600;
const LOOKS = [60, 300, 600];

/** What a scene was at one of the frames it is looked at: the hash, and enough besides to say how it differs. */
interface Look {
  hash: string;
  live: number;
  awake: number;
}
type Hashes = { [scene: string]: { [frame: string]: Look } };

/** FNV-1a over bytes, 32 bits of it: enough to tell one state from another, and cheap. */
class Digest {
  private h = 0x811c9dc5;
  private readonly one = new Float64Array(1);
  private readonly oneBytes = new Uint8Array(this.one.buffer);

  bytes(b: Uint8Array) {
    let h = this.h;
    for (let k = 0; k < b.length; k++) {
      h ^= b[k];
      h = Math.imul(h, 0x01000193);
    }
    this.h = h;
  }

  /** The first `n` elements of a typed array, as the bytes they are. */
  array(a: Float32Array | Uint8Array, n: number) {
    this.bytes(new Uint8Array(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT));
  }

  number(x: number) {
    this.one[0] = x;
    this.bytes(this.oneBytes);
  }

  get hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

/** Everything a body is, every slot ever used, what has left the world and how, and what the pushers carry. */
function look(w: World, fell: number[]): Look {
  const d = new Digest();
  const n = w.count;
  for (const a of [w.x, w.y, w.z, w.vx, w.vy, w.vz, w.wx, w.wy, w.wz, w.r, w.h]) d.array(a, n);
  d.array(w.q, n * 4);
  d.array(w.alive, n);
  d.array(w.asleep, n);
  d.array(w.carried, n);
  d.array(w.kind, n);
  for (const v of fell) d.number(v);
  for (const l of w.loads) d.number(l);
  d.number(w.live);
  d.number(n);
  let awake = 0;
  for (let i = 0; i < n; i++) if (w.alive[i] && !w.asleep[i]) awake++;
  return { hash: d.hex, live: w.live, awake };
}

/** Chance from a seed, so a run is the same every time. */
function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A grid all floor but for a border of rock, and whatever `rock` marks. */
function border(grid: Grid, rock: (tx: number, ty: number) => boolean = () => false): Uint8Array {
  const out = new Uint8Array(grid.cols * grid.rows);
  for (let ty = 0; ty < grid.rows; ty++)
    for (let tx = 0; tx < grid.cols; tx++)
      out[ty * grid.cols + tx] =
        tx === 0 || ty === 0 || tx === grid.cols - 1 || ty === grid.rows - 1 || rock(tx, ty) ? 1 : 0;
  return out;
}

/** A floor with a height for each tile, from where the tile is. */
function heights(grid: Grid, at: (tx: number, ty: number) => number): Float32Array {
  const out = new Float32Array(grid.cols * grid.rows);
  for (let ty = 0; ty < grid.rows; ty++) for (let tx = 0; tx < grid.cols; tx++) out[ty * grid.cols + tx] = at(tx, ty);
  return out;
}

/** A box driven round a circle, turning as it goes, as a blade is. */
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

/** A box sliding along x, its velocity from where it was last frame. */
function slider(x: number, y: number, prev: Pusher | null, size: Partial<Pusher>, dt = DT): Pusher {
  return {
    x,
    y,
    z: 1.5,
    yaw: 0,
    hx: 0.3,
    hy: 6,
    hz: 1.5,
    vx: prev ? (x - prev.x) / dt : 0,
    vy: 0,
    spin: 0,
    px: prev?.x ?? x,
    py: y,
    owner: 0,
    ...size,
  };
}

/** A scene: a world, and what is done to it before each frame, which says how long the frame is. */
interface Scene {
  name: string;
  build(): { world: World; frame: (f: number) => number };
}

const BALLS: Grid = { cols: 60, rows: 40, originX: -90, originY: -60, tile: 3 };
const RADII = [0.42, 1.0];

const SCENES: Scene[] = [
  {
    // Ball against ball, awake and asleep; sleepers found under turning blades; the load count; a hole's rim pull,
    // pit wall and collection; and slots freed and taken again.
    name: 'a heap churned by two sweepers, beside a hole',
    build() {
      const random = seeded(7);
      const world = new World({
        capacity: 1200,
        grid: BALLS,
        solid: border(BALLS),
        radii: RADII,
        holes: [{ x: 0, y: 0, radius: 5, depth: 14 }],
        random,
      });
      const pour = (n: number) => {
        for (let k = 0; k < n; k++) {
          const r = Math.sqrt(random()) * 9,
            a = random() * Math.PI * 2;
          world.spawn(k % 50 === 0 ? 1 : 0, -12 + Math.cos(a) * r, 2 + Math.sin(a) * r, 1 + random() * 6);
        }
      };
      pour(900);
      let pushers: Pusher[] = [];
      return {
        world,
        frame(f) {
          if (f > 0 && f % 30 === 0) pour(5);
          const t = f * DT;
          pushers =
            f < 120 ? [] : [sweeper(-12, 2, 7, t, pushers[0] ?? null), sweeper(-10, 1, 4, -t, pushers[1] ?? null, 1)];
          world.pushers = pushers;
          for (const p of pushers) world.wakeNear(p.x, p.y, 6);
          return DT;
        },
      };
    },
  },
  {
    // The rock: faces, corners, a body shoved in going back out the way it came, one buried put on open floor, a
    // plate thinner than a body, and fast balls thrown at the wall, which bounce, stop dead, or pass through.
    name: 'balls shoved into a wall a tile thick, and thrown at it',
    build() {
      const random = seeded(8);
      const face = BALLS.originX + 40 * BALLS.tile;
      const world = new World({
        capacity: 600,
        grid: BALLS,
        solid: border(BALLS, (tx, ty) => tx === 40 && ty < 30),
        radii: RADII,
        random,
      });
      for (let k = 0; k < 500; k++)
        world.spawn(k % 25 === 0 ? 1 : 0, face - 0.5 - random() * 4, -10 + random() * 20, 0.5 + random() * 2);
      let x = face - 16;
      let prev: Pusher | null = null;
      let thrown = 0;
      return {
        world,
        frame(f) {
          if (f % 40 === 20) {
            const speeds = [60, 300, 700];
            // from a spread of distances, so the fastest meets the wall at every phase of a step and some get through
            world.spawn(1, face - 12 - (thrown % 7) * 0.83, 18 + (thrown % 3), 1, speeds[thrown % 3], 0, 0);
            thrown++;
          }
          if (f < 60) return DT;
          x += ((f - 60) % 120 < 90 ? 14 : -14) * DT;
          const p = slider(x, 0, prev, { yaw: 0.05 });
          world.pushers = [p];
          world.wakeNear(x + 2, 0, 10);
          prev = p;
          return DT;
        },
      };
    },
  },
  {
    // The floor's heights: resting on a tier, a step face from below, an edge from above, the bottom, a box that
    // carries what lies on it, a belt, a magnet, a carried body, waking within a band, and frames of uneven length.
    name: 'balls on tiers, with a belt, a magnet and a box that carries, at uneven frames',
    build() {
      const random = seeded(9);
      // The west half stands 4 high and the east end is a pit far below the bottom. No hole: a hole in a world
      // with heights is a bug the cup is to fix, and a fix meant to move a hash is not this gate's to hold.
      const floor = heights(BALLS, (tx) => (tx < 30 ? 4 : tx >= 50 ? -30 : 0));
      const face = BALLS.originX + 30 * BALLS.tile,
        edge = BALLS.originX + 50 * BALLS.tile;
      const world = new World({
        capacity: 400,
        grid: BALLS,
        solid: border(BALLS),
        floor,
        bottom: -6,
        radii: RADII,
        random,
      });
      for (let k = 0; k < 100; k++)
        world.spawn(k % 10 === 0 ? 1 : 0, -85 + random() * 80, -55 + random() * 110, 5 + random() * 4);
      for (let k = 0; k < 100; k++)
        world.spawn(k % 10 === 0 ? 1 : 0, face + 3 + random() * 50, -55 + random() * 110, 1 + random() * 4);
      world.belts = [{ cx: 50, cy: -20, half: 10, width: 8, dx: 1, dy: 0, speed: 9 }];
      world.magnet = { x: -40, y: 20, radius: 10, strength: 20 };
      for (let k = 0; k < 8; k++) world.spawn(0, -48 + random() * 16, 12 + random() * 16, 5 + random() * 2);
      for (let k = 0; k < 3; k++) world.spawn(0, 20 + k, 30, 4);
      const below = world.spawn(0, face + 8, -40, RADII[0]),
        above = world.spawn(1, face - 20, 40, 6),
        held = world.spawn(0, face + 10, 0, 8);
      const lengths = [DT, 1 / 144, 1 / 30, DT];
      let box: Pusher | null = null;
      return {
        world,
        frame(f) {
          const dt = lengths[f % lengths.length];
          const bx = 20 + Math.sin(f * 0.02) * 10;
          box = slider(bx, 30, box, { z: 1, hx: 4, hy: 4, hz: 1 }, dt);
          world.pushers = [box];
          world.wakeNear(bx, 30, 7);
          // the magnet only pulls what is awake, as a game wakes what lies round it
          world.wakeNear(-40, 20, 10);
          if (f < 300 && world.alive[below]) {
            world.wake(below);
            world.vx[below] = -8;
          }
          if (world.alive[above] && world.x[above] < face + 0.5) {
            world.wake(above);
            world.vx[above] = 12;
          }
          if (f === 100) world.carried[held] = 1;
          if (f === 200) world.carried[held] = 0;
          if (f % 50 === 0) world.wakeNear(face, 0, 12, 3, 6);
          if (f % 50 === 25) world.wakeNear(edge - 10, -20, 12);
          // onto the belt, which carries them over the edge into the pit and out of the bottom
          if (f % 40 === 0) world.spawn(f % 80 === 0 ? 1 : 0, edge - 19, -20, 1.5);
          return dt;
        },
      };
    },
  },
  {
    // The coins: lying, stacking, leaning, standing on edge, dropped at a tilt, balls among them, a box pushing the
    // bed, the lips of a step down, and a drop to the bottom.
    name: 'a bed of coins and some balls pushed over a step and a drop',
    build() {
      const grid: Grid = { cols: 40, rows: 40, originX: -20, originY: -20, tile: 1 };
      const R = 0.42,
        H = 0.24;
      const random = seeded(11);
      const world = new World({
        capacity: 400,
        grid,
        solid: border(grid),
        floor: heights(grid, (tx) => (tx < 22 ? 0 : tx < 30 ? -0.6 : -30)),
        bottom: -6,
        radii: [R, R],
        thickness: [H, 0],
        random,
        tuning: { cell: 1.2 },
      });
      for (let gx = 0; gx < 14; gx++)
        for (let gy = 0; gy < 16; gy++) {
          const i = world.spawn(0, -14 + gx * 0.9 + random() * 0.04, -7 + gy * 0.9 + random() * 0.04, H / 2);
          world.setOrientation(i, 0, 0, 0, 1);
        }
      for (let k = 0; k < 40; k++) world.spawn(0, -14 + random() * 12, -7 + random() * 14, 2 + random() * 2);
      for (let k = 0; k < 20; k++) world.spawn(1, -14 + random() * 12, -7 + random() * 14, 2 + random() * 2);
      for (let k = 0; k < 6; k++) {
        const i = world.spawn(0, 1 + k * 0.5, -3 + k, R);
        const a = Math.PI / 2 + (k - 3) * 0.05;
        world.setOrientation(i, 0, Math.sin(a / 2), 0, Math.cos(a / 2));
      }
      let x = -17;
      let prev: Pusher | null = null;
      return {
        world,
        frame(f) {
          // on over the step and up to the drop, and back; deep enough to reach below the step as well as above it
          if (f >= 60) x += (f < 420 ? 5 : -5) * DT;
          const p = slider(x, 0, prev, { z: -0.1, hx: 0.3, hy: 8, hz: 0.6 });
          world.pushers = [p];
          world.wakeNear(x + 1.5, 0, 9);
          prev = p;
          return DT;
        },
      };
    },
  },
  {
    // Coins down a hole on a flat floor: the pit and its collection for a disc, which no other scene reaches.
    name: 'coins pushed down a hole on a flat floor',
    build() {
      const grid: Grid = { cols: 40, rows: 40, originX: -20, originY: -20, tile: 1 };
      const R = 0.42,
        H = 0.24;
      const random = seeded(12);
      const world = new World({
        capacity: 200,
        grid,
        solid: border(grid),
        radii: [R],
        thickness: [H],
        holes: [{ x: 6, y: 0, radius: 2.5, depth: 6 }],
        random,
        tuning: { cell: 1.2 },
      });
      for (let gx = 0; gx < 10; gx++)
        for (let gy = 0; gy < 10; gy++) {
          const i = world.spawn(0, -8 + gx * 0.9 + random() * 0.04, -4 + gy * 0.9 + random() * 0.04, H / 2);
          world.setOrientation(i, 0, 0, 0, 1);
        }
      for (let k = 0; k < 30; k++) world.spawn(0, -8 + random() * 8, -4 + random() * 8, 1 + random() * 2);
      let x = -11;
      let prev: Pusher | null = null;
      return {
        world,
        frame(f) {
          if (f >= 30) x += (f < 450 ? 4 : -4) * DT;
          const p = slider(x, 0, prev, { z: 0.5, hx: 0.3, hy: 6, hz: 0.5 });
          world.pushers = [p];
          world.wakeNear(x + 1.5, 0, 8);
          prev = p;
          return DT;
        },
      };
    },
  },
];

/** A scene run from its seed, looked at on the frames it is held to. */
function run(scene: Scene): { [frame: string]: Look } {
  const { world, frame } = scene.build();
  const fell: number[] = [];
  const collect = (kind: number, x: number, y: number, i: number) => fell.push(kind, x, y, i);
  const out: { [frame: string]: Look } = {};
  for (let f = 0; f < FRAMES; f++) {
    world.step(frame(f), collect);
    if (LOOKS.includes(f + 1)) out[f + 1] = look(world, fell);
  }
  return out;
}

const recorded: Hashes = UPDATE ? {} : (JSON.parse(readFileSync(RECORD, 'utf8')) as Hashes);

describe('the world, unchanged since v0.3.0', () => {
  for (const scene of SCENES) {
    it(scene.name, () => {
      const now = run(scene);
      // the same scene twice in one run: a hash that moves between them is chance from outside the seed, not a change
      expect(run(scene), 'the scene is not the same twice from one seed').toEqual(now);
      if (UPDATE) {
        recorded[scene.name] = now;
        return;
      }
      const then = recorded[scene.name] as { [frame: string]: Look } | undefined;
      expect(then, `no hashes recorded for "${scene.name}"`).toBeDefined();
      for (const f of LOOKS) {
        const was = then![f],
          is = now[f];
        expect(
          is,
          `frame ${f}: was ${was.live} live and ${was.awake} awake, is ${is.live} and ${is.awake}: the world has changed`,
        ).toEqual(was);
      }
    });
  }

  if (UPDATE)
    it('writes the hashes', () => {
      writeFileSync(RECORD, JSON.stringify(recorded, null, 2) + '\n');
    });
});
