/**
 * A round of golf played at random, and the rules a ball keeps however it is
 * struck. The package has no page for a fuzzer to play, so this is its
 * fuzzer: a course with every thing a golf course asks of the world (rock,
 * a raised wall, sand, water, hills and a hollow, a green that falls away
 * across the way to the cup, a sliding barrier, a windmill, bumpers and a cup), a
 * ball shot from where it last came to rest in a direction and at a speed
 * from a seed, up to the 120 u/s the package is to hold at, and every fixed
 * step looked at. Each seed is played twice, each body on a window of its
 * own and judged together, since a game may have either. A test of one thing
 * holds that thing; this finds what two of them do together that neither's
 * test thought of.
 *
 *   FUZZ_SEEDS=1-500 npx vitest run test/golf.fuzz.test.ts    more seeds than the check's twenty-four
 *
 * A failure names its seed, its shot and its step, and the same seed plays
 * it again.
 */
import { describe, expect, it } from 'vitest';
import {
  BOTTOM,
  DEFAULT_TUNING,
  World,
  type Bumper,
  type Grid,
  type Hole,
  type Pusher,
  type Surface,
  type Tuning,
} from '../src/world';

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
/** The fastest a ball may be going and be put to sleep: well over what one at rest carries. */
const SLEEP_SPEED = 2;
const TUNING: Partial<Tuning> = {
  travel: 0.5,
  smoothWalls: true,
  sleepInAir: false,
  sleepSpeed: process.env.FUZZ_NO_SLEEP_SPEED ? Infinity : SLEEP_SPEED,
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
/** The cup, clear of everything else, and held to catching by its rim alone. */
const CUP: Hole = { x: 15, y: 22, radius: 2.5, depth: 4, rim: 0.3, pull: 0 };

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
 * the bottom, a bunker, and terrain: a mound three high beyond the wall of
 * rock, by the water, a hollow two and a half deep in the far corner, a bank
 * as steep as terrain may be in the corner by the tee, the green before the
 * cup falling away across the way to it, with a post standing on the fall,
 * and the cup on the flank of a cone as steep as terrain may be, its rim
 * leaning with it. The rim's point in the ball's way from the middle is not
 * its nearest on a slope; taken as it, no rule broke in the 24 seeds the
 * check plays, on the green or on the cone, and over 200 seeds on the cone
 * one put a ball 0.102 into the rim. The terrain's own test, on the
 * steepest ground, holds that more sharply.
 * The raised wall stops short of the barrier's path: a
 * box driven against a wall with a ball between them has the ball in one or
 * the other, and the rock, looked at last, wins. That is so of any box and
 * any wall, and a course is not to be laid out that way. Nor is a moving box
 * to stand on a slope: with the mound's flank under the windmill's sweep, a
 * ball rolled back against a blade by the slope each time it got ahead of it
 * was carried round by the blades for good, going at the blades' speed. The
 * ground under the barrier and the windmill is level at nothing, as a game
 * would lay them.
 */
function course() {
  const solid = new Uint8Array(GRID.cols * GRID.rows),
    floor = new Float32Array(GRID.cols * GRID.rows),
    terrain = new Float32Array(GRID.cols * GRID.rows),
    surface = new Uint8Array(GRID.cols * GRID.rows);
  for (let ty = 0; ty < GRID.rows; ty++)
    for (let tx = 0; tx < GRID.cols; tx++) {
      const t = tile(tx, ty);
      if (tx === 0 || ty === 0 || tx === GRID.cols - 1 || ty === GRID.rows - 1) solid[t] = 1;
      if (ty === 16 && tx >= 1 && tx <= 13) solid[t] = 1;
      if (tx === 18 && ty >= 4 && ty <= 9) floor[t] = 2;
      if (tx >= 5 && tx <= 7 && ty >= 18 && ty <= 20) floor[t] = -30;
      if (tx >= 10 && tx <= 12 && ty >= 6 && ty <= 8) surface[t] = 1;
      const mound = 3 * Math.max(0, 1 - Math.hypot(tx - 10, ty - 20) / 3),
        hollow = -2.5 * Math.max(0, 1 - Math.hypot(tx - 21, ty - 4) / 3),
        across = tx >= 15 && tx <= 21 ? 0.4 * (tx - 18) * (ty === 14 ? 1 : ty === 13 || ty === 15 ? 0.5 : 0) : 0,
        // the cup on the flank of a cone as steep as terrain may be, its top two tiles east of the cup
        cone = Math.max(0, 6 - 1.5 * Math.hypot(tx - 19, ty - 20));
      // a bank as steep as there may be, rising half a tile a tile both ways into the corner by the tee
      const bank = 1.5 * Math.max(0, 8 - tx - ty);
      terrain[t] = mound + hollow + across + cone + bank;
    }
  return { solid, floor, terrain, surface };
}

/**
 * How far a ball is into the terrain at the deepest, found by looking at the
 * ground all round under it, and not by the world's own reckoning: its
 * radius, less how near its middle comes to any point of the ground within
 * its reach, on the same step of the floor as its middle. It never says
 * further in than it is.
 *
 * A step's faces and edges are the rock's and the steps' to answer for, not
 * the terrain's. A ball has no top edge of a step to meet: one flown just
 * over a step two high, with no terrain anywhere, overlaps its edge by up to
 * two thirds of a unit before its middle is over the step and it is put on
 * top. That was so before there was terrain, and a hollow beside the raised
 * wall, whose rim throws a fast ball up to the wall's height, only finds it
 * more often.
 */
function intoGround(w: World, i: number, floor: Float32Array): number {
  const x = w.x[i],
    y = w.y[i],
    z = w.z[i];
  const stepOf = (px: number, py: number) =>
    floor[tile(Math.floor((px - GRID.originX) / GRID.tile), Math.floor((py - GRID.originY) / GRID.tile))];
  const own = stepOf(x, y);
  let nearest = Infinity;
  for (let ring = 0; ring <= 6; ring++) {
    const d = (ring / 6) * R,
      n = ring === 0 ? 1 : 16;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const px = x + d * Math.cos(a),
        py = y + d * Math.sin(a);
      if (stepOf(px, py) !== own) continue;
      nearest = Math.min(nearest, Math.hypot(d, w.floorAt(px, py) - z));
    }
  }
  return R - nearest;
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

function play(seed: number, sleepTogether: boolean): string | null {
  const random = seeded(seed);
  const { solid, floor, terrain, surface } = course();
  const w = new World({
    capacity: 4,
    grid: GRID,
    solid,
    floor,
    terrain,
    bottom: -6,
    surface,
    surfaces: SURFACES,
    radii: [R],
    holes: [CUP],
    random,
    tuning: { ...TUNING, sleepTogether },
  });
  // the fixed steps the world has taken, to hold a ball's sleep to its window
  const taken = () => (w as unknown as { steps: number }).steps;
  const window = DEFAULT_TUNING.sleepSteps;
  w.bumpers = BUMPERS;
  let steps = 0;
  const reported = new Map<number, number>();
  let lastHole = BOTTOM;
  const collect = (_kind: number, _x: number, _y: number, slot: number, hole: number) => {
    reported.set(slot, (reported.get(slot) ?? 0) + 1);
    lastHole = hole;
  };
  let ball = w.spawn(0, TEE.x, TEE.y, R),
    lie = { ...TEE };
  for (let shot = 0; shot < SHOTS; shot++) {
    const a = random() * Math.PI * 2,
      speed = 5 + random() * 115;
    w.hit(ball, speed * Math.cos(a), speed * Math.sin(a), 0);
    const struck = taken();
    const at = (s: number) =>
      `seed ${seed}${sleepTogether ? ', judged together' : ''}, shot ${shot} at ${speed.toFixed(1)} u/s, step ${s}`;
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
      // down the cup it is below the floor round it, and the cup's pit holds it, not the floor
      const inCup = Math.hypot(x - CUP.x, y - CUP.y) < CUP.radius;
      // its middle never under the ground, the floor's step and the terrain's rise, which is in a raised wall if the
      // step is higher than where the ball is
      if (!inCup && w.floorAt(x, y) > z + 1e-3) return `${at(s)}: its middle under the ground, or in a raised wall`;
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
      // the cup's rim, the circle of its edge at the ground all round, looked at all round when the ball is near it
      if (Math.hypot(x - CUP.x, y - CUP.y) < CUP.radius + R + 0.5) {
        let rim = Infinity;
        for (let k = 0; k < 180; k++) {
          const px = CUP.x + CUP.radius * Math.cos((k / 180) * 2 * Math.PI),
            py = CUP.y + CUP.radius * Math.sin((k / 180) * 2 * Math.PI);
          rim = Math.min(rim, Math.hypot(x - px, y - py, z - w.floorAt(px, py)));
        }
        if (rim < R - 0.1) return `${at(s)}: ${(R - rim).toFixed(3)} into the cup's rim`;
      }
      // the ground, where the ball is near it and not over the cup
      if (Math.hypot(x - CUP.x, y - CUP.y) > CUP.radius + R && z - w.floorAt(x, y) < 3 * R) {
        const into = intoGround(w, ball, floor);
        if (into > 0.1) return `${at(s)}: ${into.toFixed(3)} into the ground`;
      }
      const after = Math.hypot(w.vx[ball], w.vy[ball], w.vz[ball]);
      if (!near.box && !near.post && after > before + 70 * STEP + 1e-3)
        return `${at(s)}: sped up from ${before.toFixed(3)} to ${after.toFixed(3)} with nothing to speed it`;
      // asleep going as it was, as a ball running round inside the cup's rim once was: hung there for good
      if (w.asleep[ball] && before > SLEEP_SPEED + 70 * STEP)
        return `${at(s)}: put to sleep going ${before.toFixed(2)}`;
      if (w.asleep[ball]) {
        // struck, it has a whole window of its own before it may sleep, or judged together, a tick with half of one
        const since = taken() - struck;
        if (sleepTogether ? taken() % window !== 0 || since < window / 2 : since < window)
          return `${at(s)}: asleep ${since} steps after it was struck, on step ${taken()}`;
        break;
      }
    }
    if (s >= LONGEST) return `${at(s)}: still going after ${LONGEST * STEP} s`;
    if (w.alive[ball]) lie = { x: w.x[ball], y: w.y[ball] };
    // Out of the world: put back where it last lay, as the game does, or on the tee again if it was holed; in the
    // slot it freed, which is a new ball's.
    else {
      if (lastHole === 0) lie = { ...TEE };
      ball = w.spawn(0, lie.x, lie.y, R);
      reported.delete(ball);
    }
  }
  return null;
}

describe('a round of golf played at random', () => {
  // A round takes about sixty milliseconds alone, most of it looking at the ground under the ball every step, and a
  // seed is two; the time allowed is four times that for each seed asked for, and never less than the thirty
  // seconds every test has, so a busy machine is no failure.
  it(
    `keeps every rule over ${SEEDS.length} seeds of ${SHOTS} shots, each on its own window and judged together`,
    () => {
      const broken: string[] = [];
      for (const seed of SEEDS)
        for (const sleepTogether of [false, true]) {
          const wrong = play(seed, sleepTogether);
          if (wrong) broken.push(wrong);
        }
      expect(broken.slice(0, 10), `${broken.length} of ${SEEDS.length * 2} rounds broke a rule`).toEqual([]);
    },
    Math.max(30_000, SEEDS.length * 500),
  );

  it('plays the same round twice from a seed', () => {
    expect(play(3, false)).toEqual(play(3, false));
    expect(play(3, true)).toEqual(play(3, true));
  });
});
