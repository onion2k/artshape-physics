/**
 * A round of golf played at random, and the rules a ball keeps however it is
 * struck. The package has no page for a fuzzer to play, so this is its
 * fuzzer: a course with every thing a golf course asks of the world (rock,
 * a raised wall, sand, water, a sliding barrier, a windmill and bumpers), a
 * ball shot from where it last came to rest in a direction and at a speed
 * from a seed, up to the 120 u/s the package is to hold at, and every fixed
 * step looked at. A test of one thing holds that thing; this finds what two
 * of them do together that neither's test thought of.
 *
 *   FUZZ_SEEDS=1-500 npx vitest run test/golf.fuzz.test.ts    more seeds than the check's twenty-four
 *
 * A failure names its seed, its shot and its step, and the same seed plays
 * it again.
 */
import { describe, expect, it } from 'vitest';
import { World, type Bumper, type Grid, type Pusher, type Surface, type Tuning } from '../src/world';

const SEEDS = ((spec: string) => {
  const [a, b] = spec.split('-').map(Number);
  return Array.from({ length: (b || a) - a + 1 }, (_, k) => a + k);
})(process.env.FUZZ_SEEDS ?? '1-24');
const SHOTS = 12;
const STEP = 1 / 120;
/** The longest a shot may take to end, at rest or out of the world. */
const LONGEST = 30 / STEP;
const R = 1;

const GRID: Grid = { cols: 24, rows: 24, originX: -36, originY: -36, tile: 3 };
const TUNING: Partial<Tuning> = {
  travel: 0.5,
  smoothWalls: true,
  sleepInAir: false,
  bounceFrom: 2,
  wallRestitution: 0.8,
  restitution: 0.3,
};
const SURFACES: Surface[] = [{ drag: 0.5, roll: 8 }, { drag: 8 }];
const BUMPERS: Bumper[] = [
  [8, -18],
  [22, 8],
  [-22, 20],
  [-26, -20],
].map(([x, y]): Bumper => ({ x, y, radius: 1, top: 3, restitution: 1.3 }));
const TEE = { x: 0, y: -25 };

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const tile = (tx: number, ty: number) => ty * GRID.cols + tx;

/**
 * The course: a border of rock, a wall of rock, a raised wall, water below
 * the bottom, and a bunker. The raised wall stops short of the barrier's
 * path: a box driven against a wall with a ball between them has the ball in
 * one or the other, and the rock, looked at last, wins. That is so of any
 * box and any wall, and a course is not to be laid out that way.
 */
function course() {
  const solid = new Uint8Array(GRID.cols * GRID.rows),
    floor = new Float32Array(GRID.cols * GRID.rows),
    surface = new Uint8Array(GRID.cols * GRID.rows);
  for (let ty = 0; ty < GRID.rows; ty++)
    for (let tx = 0; tx < GRID.cols; tx++) {
      const t = tile(tx, ty);
      if (tx === 0 || ty === 0 || tx === GRID.cols - 1 || ty === GRID.rows - 1) solid[t] = 1;
      if (ty === 16 && tx >= 1 && tx <= 13) solid[t] = 1;
      if (tx === 18 && ty >= 4 && ty <= 9) floor[t] = 2;
      if (tx >= 5 && tx <= 7 && ty >= 18 && ty <= 20) floor[t] = -30;
      if (tx >= 10 && tx <= 12 && ty >= 6 && ty <= 8) surface[t] = 1;
    }
  return { solid, floor, surface };
}

/** The barrier and the windmill's four blades where they are at a time. */
function obstacles(t: number): Pusher[] {
  const w = (2 * Math.PI) / 3;
  const bx = 12 + 9 * Math.sin(w * t);
  const out: Pusher[] = [
    {
      x: bx,
      y: -2,
      z: 1.5,
      yaw: 0,
      hx: 3,
      hy: 0.25,
      hz: 1.5,
      vx: 9 * w * Math.cos(w * t),
      vy: 0,
      spin: 0,
      px: bx,
      py: -2,
      owner: 0,
    },
  ];
  for (let k = 0; k < 4; k++) {
    const a = t + (k * Math.PI) / 2;
    out.push({
      x: -15 + 3 * Math.cos(a),
      y: -8 + 3 * Math.sin(a),
      z: 1.5,
      yaw: a + Math.PI / 2,
      hx: 0.25,
      hy: 3,
      hz: 1.5,
      vx: 0,
      vy: 0,
      spin: 1,
      px: -15,
      py: -8,
      owner: 0,
    });
  }
  return out;
}

/** How far a ball's middle is into a box, less its radius: above nothing, it is not touching. */
function intoBox(p: Pusher, x: number, y: number, z: number): number {
  const c = Math.cos(p.yaw),
    s = Math.sin(p.yaw);
  const dx = x - p.x,
    dy = y - p.y;
  const lx = c * dx + s * dy,
    ly = -s * dx + c * dy,
    lz = z - p.z;
  const ox = Math.abs(lx) - p.hx,
    oy = Math.abs(ly) - p.hy,
    oz = Math.abs(lz) - p.hz;
  const outside = Math.hypot(Math.max(ox, 0), Math.max(oy, 0), Math.max(oz, 0));
  const inside = Math.min(Math.max(ox, oy, oz), 0);
  return R - (outside + inside);
}

/** How far a ball's middle is into a post, less its radius. */
function intoPost(b: Bumper, x: number, y: number, z: number): number {
  const d = Math.hypot(x - b.x, y - b.y),
    dz = z - b.top;
  if (dz > 0) return R - (d > b.radius ? Math.hypot(d - b.radius, dz) : dz);
  return R - (d - b.radius > -dz ? d - b.radius : Math.max(d - b.radius, dz));
}

function play(seed: number): string | null {
  const random = seeded(seed);
  const { solid, floor, surface } = course();
  const w = new World({
    capacity: 4,
    grid: GRID,
    solid,
    floor,
    bottom: -6,
    surface,
    surfaces: SURFACES,
    radii: [R],
    random,
    tuning: TUNING,
  });
  w.bumpers = BUMPERS;
  let steps = 0;
  const reported = new Map<number, number>();
  const collect = (_kind: number, _x: number, _y: number, slot: number) => {
    reported.set(slot, (reported.get(slot) ?? 0) + 1);
  };
  let ball = w.spawn(0, TEE.x, TEE.y, R),
    lie = { ...TEE };
  for (let shot = 0; shot < SHOTS; shot++) {
    const a = random() * Math.PI * 2,
      speed = 5 + random() * 115;
    w.hit(ball, speed * Math.cos(a), speed * Math.sin(a), 0);
    const at = (s: number) => `seed ${seed}, shot ${shot} at ${speed.toFixed(1)} u/s, step ${s}`;
    let s = 0;
    for (; s < LONGEST; s++) {
      w.pushers = obstacles(steps * STEP);
      const before = Math.hypot(w.vx[ball], w.vy[ball], w.vz[ball]);
      w.step(STEP, collect);
      steps++;
      if (!w.alive[ball]) {
        if (reported.get(ball) !== 1) return `${at(s)}: reported ${reported.get(ball) ?? 0} times`;
        break;
      }
      const x = w.x[ball],
        y = w.y[ball],
        z = w.z[ball];
      const tx = Math.floor((x - GRID.originX) / GRID.tile),
        ty = Math.floor((y - GRID.originY) / GRID.tile);
      if (tx < 0 || ty < 0 || tx >= GRID.cols || ty >= GRID.rows) return `${at(s)}: off the grid`;
      if (solid[tile(tx, ty)]) return `${at(s)}: its middle in the rock at ${x.toFixed(2)}, ${y.toFixed(2)}`;
      if (floor[tile(tx, ty)] > z + 1e-3) return `${at(s)}: its middle in a raised wall`;
      // near enough to have met a box or a post in the step: within half a unit and the step's travel of it
      const reach = -(0.5 + (before + 70 * STEP) * STEP);
      const near = { box: false, post: false };
      for (const p of w.pushers) {
        const d = intoBox(p, x, y, z);
        if (d > 0.1) return `${at(s)}: ${d.toFixed(3)} into a box`;
        if (d > reach) near.box = true;
      }
      for (const b of BUMPERS) {
        const d = intoPost(b, x, y, z);
        if (d > 0.1) return `${at(s)}: ${d.toFixed(3)} into a post`;
        if (d > reach) near.post = true;
      }
      const after = Math.hypot(w.vx[ball], w.vy[ball], w.vz[ball]);
      if (!near.box && !near.post && after > before + 70 * STEP + 1e-3)
        return `${at(s)}: sped up from ${before.toFixed(3)} to ${after.toFixed(3)} with nothing to speed it`;
      if (w.asleep[ball]) break;
    }
    if (s >= LONGEST) return `${at(s)}: still going after ${LONGEST * STEP} s`;
    if (w.alive[ball]) lie = { x: w.x[ball], y: w.y[ball] };
    // out of the world: put back where it last lay, as the game does, in the slot it freed, which is a new ball's
    else {
      ball = w.spawn(0, lie.x, lie.y, R);
      reported.delete(ball);
    }
  }
  return null;
}

describe('a round of golf played at random', () => {
  it(`keeps every rule over ${SEEDS.length} seeds of ${SHOTS} shots`, () => {
    const broken: string[] = [];
    for (const seed of SEEDS) {
      const wrong = play(seed);
      if (wrong) broken.push(wrong);
    }
    expect(broken.slice(0, 10), `${broken.length} of ${SEEDS.length} seeds broke a rule`).toEqual([]);
  });

  it('plays the same round twice from a seed', () => {
    expect(play(3)).toEqual(play(3));
  });
});
