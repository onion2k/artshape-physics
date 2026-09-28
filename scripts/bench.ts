/**
 * How long a frame of the physics takes, held to what it took before, both
 * ways, and to a budget.
 *
 *   npm run bench              measure, and fail if any scene has got slower or faster than the baseline by more
 *                              than the tolerance, or costs more than its budget
 *   npm run bench -- --update  write what it takes now as the new baseline
 *
 * One scene for each game that pins the package, doing the costly part of
 * what that game asks of it: a heap of balls churned by two pushers, for
 * pushminer; a bed of coins pushed toward a drop, for coinpush; one ball
 * shot round a golf course, and that course with as many balls on it as it
 * holds, for ooergolf. Without it nothing holds the package to what a frame
 * costs, and a change that makes a coin twice as dear reaches every game
 * that pins it before anyone has noticed.
 *
 * A time on one machine is not a time on another, or on the same one with
 * something else running. So each scene is run several times, fresh, in a
 * worker of its own, and the fastest run is the one that counts: noise only
 * ever makes a run slower. And it is held to the baseline as a multiple of a
 * fixed piece of arithmetic timed alongside it, which goes faster and slower
 * with the machine much as the physics does, so a baseline written on one
 * machine means something on another. The milliseconds are reported too.
 *
 * It is held both ways. A scene that has got faster fails as surely as one
 * that has got slower, since quicker is as much a change: either it was
 * meant, and the baseline is written again with the reason in the commit, or
 * something has stopped being done that should be. Each scene also has a
 * budget, in milliseconds a frame on the machine the package is made on,
 * which no baseline can excuse: what the package promises the game the
 * scene stands for, as the README does the coin machine.
 *
 * Each scene comes from a seed, so every run of it is the same work, and the
 * bench checks that every run ends with the same bodies awake and alive. A
 * figure from a scene that does different work each time is no figure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { World, type Bumper, type Grid, type Pusher } from '../src/world';

const BASELINE = 'scripts/bench-baseline.json';
/**
 * How far from the baseline, either way, before it fails: a share of it, and
 * at least an absolute amount, so a scene that costs next to nothing is not
 * failed for a hair of noise. The amount is a fifth of a microsecond, not
 * ooergolf's twentieth of a millisecond: one golf ball costs under two
 * microseconds a frame, and the fast-ball work is to be seen in it, which an
 * allowance thirty times the whole frame would hide. Measured, the fastest of
 * four runs of that scene moves by a few percent from one bench to the next.
 */
const TOLERANCE = 0.2,
  SLACK_MS = 0.0002;
const RUNS = 4;
const DT = 1 / 60;
/**
 * How many timed frames go by between looks at how many bodies are awake.
 * The look is not timed, and half a second apart is often enough to follow a
 * pushed bed waking and going back to sleep without stopping the clock every
 * frame.
 */
const LOOK = 30;

interface Result {
  /** Milliseconds a frame, the fastest run. */
  ms: number;
  /** That against the reference arithmetic. */
  relative: number;
  /** Milliseconds the reference took, the fastest time. */
  ref: number;
  /** How many bodies were awake at the end, and alive, to show the scene did what it says. */
  awake: number;
  live: number;
  /** The most awake at any look in the timed frames, and how many on average: what the time was spent on. */
  most: number;
  mean: number;
  /** How each run ended, awake of live, which must be the same every run. */
  ends: string[];
}

interface Scene {
  name: string;
  /** The most a frame may take, in milliseconds, on the fastest run, whatever the baseline says. */
  budget: number;
  frames: number;
  /**
   * Which of the frames are timed, if not all of them: the rest are stepped
   * and not counted. A scene whose costly part comes and goes, as a pusher's
   * stroke does, is held to that part, not to an average that the quiet
   * frames between would flatter.
   */
  timed?: (f: number) => boolean;
  /** The world as the timing starts, spawned and settled, and what frame `f` of it is. */
  setup: () => { world: World; frame: (f: number) => void };
}

/** Chance from a seed, so a run is the same every time: the world's own tests' source, copied. */
function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Nothing is kept of what falls out of a scene: the scenes are timed, not scored. */
const nothing = () => {};

/** A grid all floor but for a border of rock one tile thick, and whatever `rock` marks. */
function walled(grid: Grid, rock: (tx: number, ty: number) => boolean = () => false): Uint8Array {
  const { cols, rows } = grid;
  const out = new Uint8Array(cols * rows);
  for (let ty = 0; ty < rows; ty++)
    for (let tx = 0; tx < cols; tx++)
      out[ty * cols + tx] = tx === 0 || ty === 0 || tx === cols - 1 || ty === rows - 1 || rock(tx, ty) ? 1 : 0;
  return out;
}

/**
 * The heap, as the world's own tests have it: a grid walled with rock and a
 * hole in the middle, a small kind and a big one, and two thousand of them
 * poured in a pile for the pushers to churn.
 */
const HEAP = {
  grid: { cols: 60, rows: 40, originX: -90, originY: -60, tile: 3 } satisfies Grid,
  hole: { x: 0, y: 0, radius: 5, depth: 14 },
  radii: [0.42, 1.0],
  count: 2000,
  x: -40,
  y: 15,
  radius: 14,
};

/** A box driven round a circle through a heap, as a blade is: the world's own tests' sweeper, copied. */
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

function heap(seed: number) {
  const random = seeded(seed);
  const world = new World({
    capacity: HEAP.count,
    grid: HEAP.grid,
    solid: walled(HEAP.grid),
    radii: HEAP.radii,
    holes: [HEAP.hole],
    random,
  });
  for (let k = 0; k < HEAP.count; k++) {
    const r = Math.sqrt(random()) * HEAP.radius,
      a = random() * Math.PI * 2;
    world.spawn(k % 50 === 0 ? 1 : 0, HEAP.x + Math.cos(a) * r, HEAP.y + Math.sin(a) * r, 1 + random() * 6);
  }
  for (let f = 0; f < 180; f++) world.step(DT, nothing);
  let pushers: Pusher[] = [];
  const frame = (f: number) => {
    const t = f * DT;
    // one wide round the heap and one tight inside it, turning the other way, so the two meet what the other has moved
    pushers = [
      sweeper(HEAP.x, HEAP.y, 9, t, pushers[0] ?? null),
      sweeper(HEAP.x + 2, HEAP.y - 1, 5, -t, pushers[1] ?? null, 1),
    ];
    world.pushers = pushers;
    for (const p of pushers) world.wakeNear(p.x, p.y, 6);
    world.step(DT, nothing);
  };
  return { world, frame };
}

/**
 * A coin machine of one tier, on coinpush's figures: a coin, a tile a unit
 * across, and a bed laid a hair apart in staggered rows, most of a second
 * layer in the hollows of the first. The machine runs along x: the back wall,
 * the pusher on a floor standing two high, a step down to a lower shelf, and
 * the drop at the front into a pit, below which a coin has left the world.
 */
const COIN = { radius: 0.42, thickness: 0.24 };
const MACHINE = {
  half: 18,
  back: -15,
  step: -3,
  edge: 9,
  upper: 2,
  pit: -20,
  bottom: -6,
  count: 1500,
};
/**
 * The pusher: a slab spanning the machine, sliding to and fro over the
 * upper floor. Its back end never comes out from under the back wall, so
 * nothing can fall in behind it. The stroke and its period are coinpush's.
 */
const SLAB = { length: 8, travel: 4, height: 1.6, period: 5 };
/**
 * How the bed is laid, as coinpush primes its machine: how close together,
 * how far in from the walls and edges, and how far inside the pusher's
 * fullest reach it begins, so the first stroke pushes into it and the
 * strokes after meet what the first has left.
 */
const LAY = { pitch: 0.87, row: 0.76, margin: 0.6, prime: 0.75 };
/** The band woken just ahead of the pusher's face as it advances, as coinpush wakes it: only just ahead. */
const AHEAD = { radius: 1.5, height: 3, speed: 0.3 };

/** Where the pusher's face is at time `t`: fully back at the start, and at its fullest reach, its back end at the back wall's face, half a period on. */
function slabFront(t: number): number {
  const reach = MACHINE.back + SLAB.length;
  return reach - SLAB.travel * (1 + Math.cos((2 * Math.PI * t) / SLAB.period)) * 0.5;
}

/** The front of the bed as it is laid: its first row, just inside the pusher's fullest reach. */
const BED = slabFront(SLAB.period / 2) - LAY.prime;

function machine(seed: number) {
  const random = seeded(seed);
  const grid: Grid = { cols: 32, rows: MACHINE.half * 2 + 2, originX: -16, originY: -MACHINE.half - 1, tile: 1 };
  const floor = new Float32Array(grid.cols * grid.rows);
  for (let ty = 0; ty < grid.rows; ty++)
    for (let tx = 0; tx < grid.cols; tx++) {
      const x = grid.originX + tx + 0.5;
      floor[ty * grid.cols + tx] = x < MACHINE.step ? MACHINE.upper : x < MACHINE.edge ? 0 : MACHINE.pit;
    }
  const world = new World({
    capacity: MACHINE.count,
    grid,
    // the side walls are the border; the back wall is rock too, and the grid's own edge past the pit
    solid: walled(grid, (tx) => grid.originX + tx + 0.5 < MACHINE.back),
    floor,
    bottom: MACHINE.bottom,
    radii: [COIN.radius],
    thickness: [COIN.thickness],
    random,
    // the hash cell a coin and a bit across, since every body is a coin
    tuning: { cell: 1.2 },
  });
  /** How high a coin's middle stands above what it lies flat on. */
  const flat = COIN.thickness / 2;
  const first: [number, number, number][] = [],
    second: [number, number, number][] = [];
  const bed = (out: [number, number, number][], x0: number, x1: number, z: number) => {
    for (let x = x0, row = 0; x <= x1; x += LAY.row, row++) {
      const offset = row % 2 ? LAY.pitch / 2 : 0;
      for (let y = -MACHINE.half + LAY.margin + offset; y <= MACHINE.half - LAY.margin; y += LAY.pitch)
        out.push([x + (random() - 0.5) * 0.03, y + (random() - 0.5) * 0.03, z]);
    }
  };
  const start = BED;
  bed(first, start, MACHINE.step - LAY.margin, MACHINE.upper + flat + 0.002);
  bed(first, MACHINE.step + LAY.margin, MACHINE.edge - LAY.margin, flat + 0.002);
  bed(second, start + LAY.row / 2, MACHINE.step - LAY.margin - 0.3, MACHINE.upper + flat * 3 + 0.004);
  bed(second, MACHINE.step + LAY.margin + LAY.row / 2, MACHINE.edge - LAY.margin - 0.5, flat * 3 + 0.004);
  // which places in the second layer have a coin is by chance, and there are as many as make the count up
  for (let i = 0; i < second.length; i++) {
    const j = i + Math.floor(random() * (second.length - i));
    [second[i], second[j]] = [second[j], second[i]];
  }
  for (const [x, y, z] of [...first, ...second].slice(0, MACHINE.count)) {
    const i = world.spawn(0, x, y, z);
    world.setOrientation(i, 0, 0, 0, 1);
  }
  const x = slabFront(0) - SLAB.length / 2;
  // one box, written in place each frame, as a game keeps its pushers
  const slab: Pusher = {
    x,
    y: 0,
    z: MACHINE.upper + SLAB.height / 2,
    yaw: 0,
    hx: SLAB.length / 2,
    // wider than the machine, so its ends are inside the walls and never the nearest way out of it
    hy: MACHINE.half + 2,
    hz: SLAB.height / 2,
    vx: 0,
    vy: 0,
    spin: 0,
    px: x,
    py: 0,
    owner: 0,
  };
  world.pushers = [slab];
  for (let f = 0; f < 60; f++) world.step(DT, nothing);
  const frame = (f: number) => {
    const front = slabFront((f + 1) * DT);
    const was = slab.x;
    slab.x = slab.px = front - SLAB.length / 2;
    slab.vx = (slab.x - was) / DT;
    if (slab.vx > AHEAD.speed) {
      const reach = AHEAD.radius;
      for (let y = -MACHINE.half + reach; y < MACHINE.half + reach; y += reach * 1.4)
        world.wakeNear(front + reach * 0.6, y, reach, MACHINE.upper, MACHINE.upper + AHEAD.height);
    }
    world.step(DT, nothing);
  };
  return { world, frame };
}

/**
 * The golf course, on ooergolf's figures: tiles 3 across, 24 of them each
 * way with a border of rock one tile thick, a ball of radius 1, and the roll
 * the game has chosen. On it are what it has so far of the obstacles the
 * design asks for: a wall of rock one tile thick across part of it, a
 * sliding barrier, a windmill of four thin blades, and eight bumpers that
 * bounce at 1.3. The surfaces and the cup come as the package grows them,
 * and each is put on this course as it lands, with the baseline written
 * again and the reason given.
 */
const COURSE = {
  grid: { cols: 24, rows: 24, originX: -36, originY: -36, tile: 3 } satisfies Grid,
  radii: [1],
  tuning: { floorDrag: 0.8 },
  /** The wall: one row of rock tiles from the west border to the middle, leaving the east side open. */
  wall: { row: 16, to: 13 },
  /** The barrier: a bar a quarter of a unit half-thick, going to and fro along x across the way up the open side. */
  barrier: { x: 12, y: -2, reach: 9, period: 3, hx: 3, hy: 0.25 },
  /** The windmill: four blades a quarter of a unit half-thick, reaching six from their pivot, turning a radian a second. */
  windmill: { x: -15, y: -8, blade: 6, spin: 1, hx: 0.25 },
  /** Eight bumpers about the course, clear of the tee, the windmill's sweep and the barrier's path. */
  bumpers: [
    [10, -20],
    [22, -14],
    [26, 6],
    [16, 22],
    [-4, 26],
    [-26, 22],
    [-28, -22],
    [5, -12],
  ].map(([x, y]): Bumper => ({ x, y, radius: 1, top: 3, restitution: 1.3 })),
  tee: { x: 0, y: -25 },
  /** ooergolf's BODY_CAPACITY. */
  capacity: 64,
};
/** The hardest the starting club strikes, what the upgrades take it to, and what the package is to hold against. */
const SPEEDS = [40, 60, 120];
/** Up the course, up and to either side, and back down past the tee. */
const DIRECTIONS = [90, 150, 30, 250].map((degrees) => (degrees * Math.PI) / 180);
/** The longest a shot is watched before the next is taken, whether or not the ball has come to rest. */
const LONGEST = 600;

function course(seed: number) {
  const random = seeded(seed);
  const { grid, wall, barrier: bar, windmill: mill } = COURSE;
  const solid = walled(grid, (tx, ty) => ty === wall.row && tx <= wall.to);
  const world = new World({
    capacity: COURSE.capacity,
    grid,
    solid,
    radii: COURSE.radii,
    random,
    tuning: COURSE.tuning,
  });
  const box = (hx: number, hy: number, spin: number, px: number, py: number): Pusher => ({
    x: px,
    y: py,
    z: 1.5,
    yaw: 0,
    hx,
    hy,
    hz: 1.5,
    vx: 0,
    vy: 0,
    spin,
    px,
    py,
    owner: 0,
  });
  const barrier = box(bar.hx, bar.hy, 0, bar.x, bar.y);
  // each blade turns about the windmill's pivot, which stands still, so the pivot is where its turn is reckoned from
  const blades = [0, 1, 2, 3].map(() => box(mill.hx, mill.blade / 2, mill.spin, mill.x, mill.y));
  /** Everything that moves put where it is at time `t`, written in place, as a game keeps its pushers. */
  const place = (t: number) => {
    const w = (2 * Math.PI) / bar.period;
    barrier.x = barrier.px = bar.x + bar.reach * Math.sin(w * t);
    barrier.vx = bar.reach * w * Math.cos(w * t);
    blades.forEach((blade, k) => {
      const a = mill.spin * t + (k * Math.PI) / 2;
      blade.x = mill.x + Math.cos(a) * (mill.blade / 2);
      blade.y = mill.y + Math.sin(a) * (mill.blade / 2);
      // the blade's length is its own y, so it points out from the pivot
      blade.yaw = a + Math.PI / 2;
    });
  };
  world.pushers = [barrier, ...blades];
  world.bumpers = COURSE.bumpers;
  // the course's own clock, from before the balls are put down, so what moves on it moves through the settling too
  let frames = 0;
  const step = () => {
    place(frames++ * DT);
    world.step(DT, nothing);
  };
  /** Whether a ball put down here is clear of the rock, the windmill's sweep, the barrier's path and every other ball. */
  const clear = (x: number, y: number) => {
    for (const [dx, dy] of [
      [-1.5, -1.5],
      [1.5, -1.5],
      [-1.5, 1.5],
      [1.5, 1.5],
    ]) {
      const tx = Math.floor((x + dx - grid.originX) / grid.tile),
        ty = Math.floor((y + dy - grid.originY) / grid.tile);
      if (solid[ty * grid.cols + tx]) return false;
    }
    if (Math.hypot(x - mill.x, y - mill.y) < mill.blade + 1.5) return false;
    for (const b of COURSE.bumpers) if (Math.hypot(x - b.x, y - b.y) < b.radius + 1.5) return false;
    if (Math.abs(y - bar.y) < 2 && Math.abs(x - bar.x) < bar.reach + bar.hx + 1.5) return false;
    for (let i = 0; i < world.count; i++) if (Math.hypot(world.x[i] - x, world.y[i] - y) < 3) return false;
    return true;
  };
  return { world, step, clear, random };
}

/**
 * One ball shot round the course: at each speed in turn, in each direction,
 * each shot taken from where the last came to rest, as a round is played.
 * The twelve take 2560 frames with the bumpers on the course (2240 before
 * them), so the timing, at 2700, runs a little way into the first again.
 */
function round(seed: number) {
  const { world, step } = course(seed);
  const ball = world.spawn(0, COURSE.tee.x, COURSE.tee.y, COURSE.radii[0]);
  for (let f = 0; f < 60; f++) step();
  let shot = 0,
    shotAt = 0;
  const frame = (f: number) => {
    if (world.asleep[ball] || f - shotAt >= LONGEST) {
      const speed = SPEEDS[Math.floor(shot / DIRECTIONS.length) % SPEEDS.length],
        a = DIRECTIONS[shot % DIRECTIONS.length];
      // a shot is a speed along the ground and none upward, given as the game gives it
      world.wake(ball);
      world.vx[ball] = speed * Math.cos(a);
      world.vy[ball] = speed * Math.sin(a);
      shot++;
      shotAt = f;
    }
    step();
  };
  return { world, frame };
}

/**
 * The course with as many balls on it as the game's world holds, each struck
 * at the hardest the package is to hold against, and struck again whenever it
 * comes to rest, so the course stays as busy as it can be.
 */
function crowd(seed: number) {
  const { world, step, clear, random } = course(seed);
  // anywhere on the floor a ball's width in from the border, as far as `clear` allows
  const spread = COURSE.grid.tile * (COURSE.grid.cols / 2 - 1) - 3;
  while (world.count < COURSE.capacity) {
    const x = (random() * 2 - 1) * spread,
      y = (random() * 2 - 1) * spread;
    if (clear(x, y)) world.spawn(0, x, y, COURSE.radii[0]);
  }
  for (let f = 0; f < 60; f++) step();
  const speed = SPEEDS[SPEEDS.length - 1];
  const frame = () => {
    for (let i = 0; i < world.count; i++) {
      if (!world.asleep[i]) continue;
      const a = random() * Math.PI * 2;
      world.wake(i);
      world.vx[i] = speed * Math.cos(a);
      world.vy[i] = speed * Math.sin(a);
    }
    step();
  };
  return { world, frame };
}

const SCENES: Scene[] = [
  {
    name: 'a heap of 2000 balls churned by two pushers',
    budget: 3,
    frames: 480,
    setup: () => heap(7),
  },
  {
    name: 'a bed of 1500 discs, timed while the pusher is in it',
    // What coinpush's own bench measures its machine at, 2.35 to 2.54 ms a frame, with room. The heaviest half
    // second of the first stroke, with four hundred awake, costs 3.2 ms.
    budget: 4,
    // two strokes: the first pushes into the bed as it was primed, and the second meets what the first has left
    frames: Math.round((SLAB.period * 2) / DT),
    // Only while the pusher's face is within a unit of the bed, going in and coming back out: the push, and the
    // bed settling after it. Before that the pusher crosses empty floor and the bed sleeps, and those frames,
    // which cost next to nothing, halved the figure and hid what a push costs.
    timed: (f) => slabFront((f + 1) * DT) >= BED - 1,
    setup: () => machine(1),
  },
  {
    name: 'one ball shot round a golf course',
    budget: 0.1,
    frames: 2700,
    setup: () => round(1),
  },
  {
    name: '64 balls on that course at 120 u/s',
    budget: 1,
    frames: 600,
    setup: () => crowd(2),
  },
];

/**
 * The reference: typed-array arithmetic of the physics' own kind, a pass of
 * springs over a grid of points, the same work every time. It is ooergolf's,
 * so a figure here and a figure there are against the same thing.
 */
function reference(): number {
  const n = 200_000;
  const x = new Float32Array(n),
    v = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.37) * 3;
  const t = performance.now();
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 1; i < n - 1; i++) {
      const f = x[i - 1] + x[i + 1] - 2 * x[i];
      v[i] = v[i] * 0.99 + f * 0.1;
    }
    for (let i = 0; i < n; i++) x[i] += Math.sqrt(v[i] * v[i] + 1e-6) * Math.sign(v[i]) * 0.01;
  }
  return performance.now() - t;
}

function awakeIn(world: World): number {
  let awake = 0;
  for (let i = 0; i < world.count; i++) if (world.alive[i] && !world.asleep[i]) awake++;
  return awake;
}

function measure(s: Scene): Result {
  let best = Infinity,
    ref = Infinity,
    awake = 0,
    live = 0,
    most = 0,
    mean = 0;
  const ends: string[] = [];
  for (let k = 0; k < 3; k++) reference();
  for (let k = 0; k < RUNS * 3; k++) ref = Math.min(ref, reference());
  for (let run = 0; run < RUNS; run++) {
    const { world, frame } = s.setup();
    let spent = 0,
      counted = 0,
      looks = 0,
      seen = 0;
    most = 0;
    for (let f = 0; f < s.frames;) {
      // a stretch of frames that are all timed or all not, and no longer than a look apart
      const timing = s.timed?.(f) ?? true;
      let end = f + 1;
      while (end < s.frames && end - f < LOOK && (s.timed?.(end) ?? true) === timing) end++;
      const from = f,
        t = performance.now();
      for (; f < end; f++) frame(f);
      if (timing) {
        spent += performance.now() - t;
        counted += end - from;
      }
      awake = awakeIn(world);
      // what the timed frames were spent on, so the untimed ones do not water it down
      if (timing) {
        most = Math.max(most, awake);
        seen += awake;
        looks++;
      }
    }
    mean = seen / looks;
    best = Math.min(best, spent / counted);
    live = world.live;
    ends.push(`${awake} of ${live}`);
  }
  return { ms: best, relative: best / ref, ref, awake, live, most, mean, ends };
}

if (!isMainThread) {
  const { index } = workerData as { index: number };
  parentPort!.postMessage(measure(SCENES[index]));
} else {
  await main();
}

async function main() {
  const update = process.argv.includes('--update');
  const results: Result[] = [];
  // one at a time, so no scene is timed while another runs beside it
  for (let index = 0; index < SCENES.length; index++) {
    results.push(
      await new Promise<Result>((resolve, reject) => {
        const worker = new Worker(new URL(`file://${process.argv[1]}`), { workerData: { index } });
        worker.once('message', resolve);
        worker.once('error', reject);
      }),
    );
  }

  // Before anything is compared or written: a scene whose runs did not end alike is not the same work each time.
  const unlike = SCENES.filter((_s, k) => results[k].ends.some((e) => e !== results[k].ends[0]));
  SCENES.forEach((s, k) => {
    if (unlike.includes(s))
      console.error(
        `${s.name}: its runs ended ${results[k].ends.join(', ')} awake: not the same work each time, so its figure means nothing`,
      );
  });
  const over = SCENES.filter((s, k) => results[k].ms > s.budget);

  if (update) {
    SCENES.forEach((s, k) => console.log(`${s.name}: ${line(results[k])}${budget(s, results[k])}`));
    if (unlike.length || over.length) {
      console.error(
        `\nbaseline not written: ${[
          unlike.length ? `${unlike.length} not the same from run to run` : '',
          over.length ? `${over.length} over budget, which no baseline can excuse` : '',
        ]
          .filter(Boolean)
          .join(', and ')}`,
      );
      process.exitCode = 1;
      return;
    }
    const out = Object.fromEntries(
      SCENES.map((s, k) => {
        const r = results[k];
        return [s.name, { relative: r.relative, ms: round4(r.ms), ref: round4(r.ref), awake: r.awake, live: r.live }];
      }),
    );
    writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    console.log('baseline written');
    return;
  }

  let baseline: Partial<Record<string, { relative: number; ms: number; awake?: number; live?: number }>>;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as typeof baseline;
  } catch {
    console.error('no baseline: run npm run bench -- --update first');
    process.exitCode = 1;
    return;
  }
  let slower = 0,
    faster = 0,
    missing = 0;
  SCENES.forEach((s, k) => {
    const now = results[k],
      was = baseline[s.name];
    if (!was) {
      console.log(`${s.name}: ${line(now)}${budget(s, now)}, not in the baseline`);
      missing++;
      return;
    }
    const change = now.relative / was.relative - 1;
    // what the baseline's time comes to on this machine as it is now, for the absolute allowance
    const expected = was.relative * now.ref;
    const verdict =
      change > TOLERANCE && now.ms - expected > SLACK_MS
        ? 'SLOWER'
        : change < -TOLERANCE && expected - now.ms > SLACK_MS
          ? 'FASTER'
          : 'within tolerance';
    if (verdict === 'SLOWER') slower++;
    if (verdict === 'FASTER') faster++;
    // rounded before it is signed, so a change of a hair under nothing reads as none and not as minus nothing
    const percent = Math.round(change * 100) || 0;
    console.log(
      `${s.name}: ${line(now)}${budget(s, now)}, ${percent >= 0 ? '+' : ''}${percent}% on the baseline (${verdict})`,
    );
    // the counts are not held, since the unchanged gate holds what the bodies do; but a figure held against a
    // baseline of other work is no comparison, so it is said
    if ((was.awake !== undefined && was.awake !== now.awake) || (was.live !== undefined && was.live !== now.live))
      console.log(
        `  it ended ${now.awake} of ${now.live} awake, where the baseline's ended ${was.awake} of ${was.live}: the scene has changed since it was written`,
      );
  });
  const scenes = (n: number) => `${n} scene${n === 1 ? '' : 's'}`;
  if (slower)
    console.error(
      `\n${scenes(slower)} slower than the baseline by more than ${TOLERANCE * 100}% and ${SLACK_MS} ms a frame`,
    );
  if (faster)
    console.error(
      `\n${scenes(faster)} faster than the baseline by more than ${TOLERANCE * 100}% and ${SLACK_MS} ms a frame. ` +
        'If the change was meant to make it faster, write the baseline again with npm run bench -- --update, and ' +
        'say why in the commit: a baseline is held both ways, since quicker is as much a change as slower.',
    );
  if (over.length) console.error(`\n${scenes(over.length)} over budget, which no baseline can excuse`);
  if (missing) console.error(`\n${scenes(missing)} not in the baseline: run npm run bench -- --update`);
  if (unlike.length) console.error(`\n${scenes(unlike.length)} not the same work from run to run`);
  if (slower || faster || over.length || missing || unlike.length) process.exitCode = 1;
}

function line(r: Result): string {
  const alike = r.ends.every((e) => e === r.ends[0]);
  return (
    `${r.ms.toFixed(3)} ms a frame (${r.relative.toPrecision(3)} of the reference), ` +
    `${r.awake} of ${r.live} awake at the end of ${alike ? `every one of ${r.ends.length} runs` : 'the last run'}, ` +
    `${r.mean.toFixed(0)} on average and ${r.most} at most`
  );
}

function budget(s: Scene, r: Result): string {
  return r.ms > s.budget ? `, OVER its budget of ${s.budget} ms` : '';
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
