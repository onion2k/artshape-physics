/**
 * A world of spheres, stepped at a fixed rate, for a game with a great many
 * small things rolling about a floor and being shoved: coins, say.
 *
 * A body is a ball. A ball pair is one distance, which is what lets a few
 * thousand of them be stepped in JavaScript at a hundred and twenty hertz;
 * what a body is drawn as is the game's business, and the world carries an
 * orientation per body for it — flat when the body rests, tumbling when it
 * flies, at whatever tilt it landed with.
 *
 * Bodies sleep. A heap at rest is most of a floor, and a heap at rest costs
 * nothing: only an awake body looks for its neighbours, and it wakes what it
 * touches. A pusher wakes what it reaches before it reaches it. A sleeper is
 * not looked at one by one either: the step walks a list of the awake,
 * sleepers keep their place in a hash of their own from one step to the
 * next, and the pushers and belts find the sleepers under them through it.
 *
 * The floor is the grid too: each tile has a height, flat at nothing unless
 * the caller says, and a body rests on the tile under it. A tile whose floor
 * stands above a body's middle is a wall to it, so a step is a wall from
 * below and an edge from above, and what goes over the edge falls to the
 * tile it lands on. Below the world's bottom a body has left it.
 *
 * The world knows nothing of any game. It is handed a grid of solid tiles
 * to keep out of, the floor's heights, the holes things fall out of it
 * through, the radius of each kind of body, where its chance comes from,
 * and the tuning, with the defaults being a coin-sized world; it says what
 * fell in, or out, through a callback.
 */
import { Discs, SLOP } from './disc';

/** The tile grid the world lies on: tiles `tile` across, `cols` by `rows` of them, from an origin. */
export interface Grid {
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  tile: number;
}

/** A hole in the floor: what rolls into it falls, and is collected `depth` down. */
export interface Hole {
  x: number;
  y: number;
  radius: number;
  depth: number;
}

/** The numbers the stepping runs on. The defaults are a coin-sized world in units of about a coin's width. */
export interface Tuning {
  /** The fixed step, in seconds. */
  step: number;
  gravity: number;
  restitution: number;
  friction: number;
  /** How hard the floor slows what rolls on it. */
  floorDrag: number;
  /** A body that has moved less than this over a window of steps goes to sleep. */
  sleepDrift: number;
  sleepSteps: number;
  /** The spatial hash's cell, in world units: about the biggest body's diameter. */
  cell: number;
  /** How the floor and the top of a box hold a disc against sliding: felt under a coin, which holds better than a coin does. */
  grip: number;
}

/**
 * How many times a step the discs' contacts with each other are gone over,
 * and how far into anything a disc must have been found the first time for
 * it and its neighbours to be gone over again. Put right by position a pass
 * a step, a push runs on through a heap one contact a pass, and what is left
 * over is coins a little into each other for good; a second pass halves it.
 * Most of a bed is a hair into its neighbours and needs no second look, and
 * going over only what was found well in costs a third less and rests a
 * heap as well, measured over two dozen heaps. It goes by the disc and not
 * by the pair, so a pair pushed into each other after its own turn in the
 * first pass is still seen in the second, by whichever of them was deep.
 */
const DISC_PASSES = 2;
const AGAIN = 0.02;
/** How far under the floor a disc may still be, once put out of it, before it is put out of it again. */
const LANDED = 0.02;
/**
 * How far into something a disc may be and still go to sleep: with the slop
 * every resting contact keeps, a twentieth of a unit, and nothing asleep is
 * further into anything. In a heap every push runs on through the coins it rests on, a
 * contact a pass, and what is put right by position always lags the weight
 * above by a little, steadily, however long it is left. Sleep is what ends
 * it, since a sleeper is a wall and a push stops at a wall; so a disc that
 * far in may sleep, and one further in is still being put right. With one
 * pass a step a crowded heap lags by more than this and never sleeps, which
 * is why there are two.
 */
const RESTING = 0.05 - SLOP;
/**
 * How far a disc's axis may have swung over a sleep window and still be at
 * rest, as the square of the sine of it: eight degrees. Solved a pass a
 * step, every resting coin is nudged a hundredth of a radian this way and
 * that, and over a window that wanders to four degrees or so, going nowhere.
 * A coin falling over swings ninety in the same time.
 */
const SWUNG = 0.0194;

export const DEFAULT_TUNING: Tuning = {
  step: 1 / 120,
  gravity: 70,
  restitution: 0.08,
  friction: 0.45,
  floorDrag: 5.5,
  sleepDrift: 0.25,
  sleepSteps: 40,
  cell: 2.5,
  grip: 0.7,
};

export interface WorldOptions {
  /** How many bodies there can ever be at once. */
  capacity: number;
  grid: Grid;
  /** Which tiles are rock, one byte a tile, row by row; the world reads it every step, so it may be rewritten in place. */
  solid: Uint8Array;
  /**
   * How high the floor stands on each tile, one a tile, row by row: flat at
   * 0 if left out. A body rests on the tile under it; a tile whose floor is
   * above a body's middle is a wall to it. Read every step, like the rock.
   */
  floor?: Float32Array;
  /** Below this height a body has fallen out of the world: reported like one down a hole, and its slot freed. */
  bottom?: number;
  /** The collision radius of each kind of body, by kind. */
  radii: readonly number[];
  /**
   * How thick each kind is, top to bottom, for a kind that is a disc: a coin,
   * with a turn of its own, that lies on a face, leans on another, or stands
   * on its rim. A kind left out, or given nothing, is a ball, as thick as it
   * is wide and with no turn worth keeping.
   */
  thickness?: readonly number[];
  holes?: readonly Hole[];
  /** Where chance comes from, for a spawned body's tilt: Math.random unless told otherwise. */
  random?: () => number;
  tuning?: Partial<Tuning>;
}

/** A box that moves through the coins and shoves them: the blade, the hull. */
export interface Pusher {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hx: number;
  hy: number;
  hz: number;
  vx: number;
  vy: number;
  /** Turn rate, for the velocity of a point out along the blade, about the pivot. */
  spin: number;
  px: number;
  py: number;
  /** Whose box it is: 0 the player, then the robo-dozers. Each has its own load count. */
  owner: number;
}

/** A pusher as it stands this step: swept back by the lag, with its turn worked out once. */
interface Placed {
  p: Pusher;
  bx: number;
  by: number;
  pivotX: number;
  pivotY: number;
  c: number;
  s: number;
  /** How far a body's centre can be from the box's, along x or y, and still touch it. */
  reach: number;
}

/** A strip of floor that carries what rests on it. */
export interface Belt {
  cx: number;
  cy: number;
  /** Half-length along its direction and half-width across. */
  half: number;
  width: number;
  dx: number;
  dy: number;
  speed: number;
}

export class World {
  readonly capacity: number;
  /** One past the highest slot ever used; slots below it may be dead. */
  count = 0;
  live = 0;
  readonly alive: Uint8Array;
  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly r: Float32Array;
  /** How thick each body is, or nothing for a ball. */
  readonly h: Float32Array;
  /** Orientation, four floats a body: a disc's own, which its contacts turn; a ball's is for drawing. */
  readonly q: Float32Array;
  readonly wx: Float32Array;
  readonly wy: Float32Array;
  readonly wz: Float32Array;
  readonly asleep: Uint8Array;
  /** Where each body was when this step started moving it, for the rock to put it back out the way it came in. */
  private readonly lastX: Float32Array;
  private readonly lastY: Float32Array;
  /** Where each body was when the sleep window opened, and how a disc was turned. */
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
  private readonly so: Float32Array;
  /** The step each body's window opened on. A body is judged on a whole window of its own, never on the tail of everyone's: one that appeared a step before a shared tick had moved nowhere yet, and slept where it appeared, in the air. */
  private readonly opened: Int32Array;
  private steps = 0;
  /** Held by a drone: not stepped, still drawn where the drone puts it. */
  readonly carried: Uint8Array;
  private readonly onFloor: Uint8Array;
  private readonly free: number[] = [];

  pushers: Pusher[] = [];
  belts: Belt[] = [];
  /** How many bodies the pushers were shoving on the last step: the blade's load. */
  load = 0;
  /** The same, per owner: the player at 0, then each robo-dozer. */
  loads: number[] = [];
  /** A pull toward a point, on whatever lies within `radius` of it on the floor. */
  magnet: { x: number; y: number; radius: number; strength: number } | null = null;
  private loadNow: number[] = [];
  private placed: Placed[] = [];
  /** Sleepers the blades and belts have already seen this step, so the awake pass leaves them be. */
  private readonly seen: Uint8Array;
  private readonly seenList: number[] = [];
  /** Which tiles are rock right now; whoever owns the grid rewrites it in place. */
  solid: Uint8Array;
  /** How high the floor stands on each tile, or nothing for a flat floor at 0; the grid's owner may rewrite it. */
  heights: Float32Array | null;
  /** Below which a body has fallen out of the world. */
  readonly bottom: number;
  readonly grid: Grid;
  readonly holes: readonly Hole[];
  private readonly radii: readonly number[];
  private readonly thickness: readonly number[];
  /** The discs' side of things, if any kind is one. */
  private readonly discs: Discs | null;
  /** The floor's height under a point, as the discs ask for it: made once, so asking makes nothing. */
  private readonly floorUnder = (px: number, py: number) => this.floorAt(px, py);
  /** Which discs were found well into something in the first going over of a step, and so are gone over again. */
  private again = new Uint8Array(0);
  private readonly maxRadius: number;
  private readonly tune: Tuning;
  private readonly random: () => number;

  /**
   * The awake, in slot order at the top of each step. Anything that might
   * have changed — woken, spawned, dozed off, removed — is on it too until
   * the next step sorts it out, which is what keeps the hashes safe to walk.
   */
  private readonly awake: Int32Array;
  private awakeCount = 0;
  private readonly listed: Uint8Array;

  private readonly gx: number;
  private readonly gy: number;
  /**
   * A cell's chain: its awake bodies, hashed afresh each step, run on into
   * its sleepers. The sleepers do not move, so they keep their place from
   * step to step, and are linked back as well so they leave it cheaply.
   */
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  private readonly sleepHead: Int32Array;
  private readonly sleepPrev: Int32Array;
  /** Which cell a body sleeps in, or -1. */
  private readonly sleepCell: Int32Array;
  private accumulator = 0;
  /** How far behind their frame's end the pushers are this step, in seconds. */
  private lag = 0;

  constructor(options: WorldOptions) {
    const { capacity, grid, solid, radii } = options;
    this.capacity = capacity;
    this.solid = solid;
    this.heights = options.floor ?? null;
    this.bottom = options.bottom ?? -Infinity;
    this.grid = grid;
    this.holes = options.holes ?? [];
    this.radii = radii;
    this.maxRadius = Math.max(...radii);
    this.tune = { ...DEFAULT_TUNING, ...options.tuning };
    // called each time, not captured, so a caller who swaps Math.random out later is heard
    this.random = options.random ?? (() => Math.random());
    const n = capacity;
    this.alive = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.r = new Float32Array(n);
    this.q = new Float32Array(n * 4);
    this.wx = new Float32Array(n);
    this.wy = new Float32Array(n);
    this.wz = new Float32Array(n);
    this.asleep = new Uint8Array(n);
    this.lastX = new Float32Array(n);
    this.lastY = new Float32Array(n);
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.sz = new Float32Array(n);
    this.carried = new Uint8Array(n);
    this.onFloor = new Uint8Array(n);
    this.h = new Float32Array(n);
    this.so = new Float32Array(n * 4);
    this.opened = new Int32Array(n);
    this.again = new Uint8Array(n);
    this.thickness = options.thickness ?? [];
    this.discs = this.thickness.some((t) => t > 0)
      ? new Discs(
          {
            x: this.x,
            y: this.y,
            z: this.z,
            vx: this.vx,
            vy: this.vy,
            vz: this.vz,
            q: this.q,
            wx: this.wx,
            wy: this.wy,
            wz: this.wz,
            r: this.r,
            h: this.h,
            onFloor: this.onFloor,
            step: this.tune.step,
            gravity: this.tune.gravity,
            friction: this.tune.friction,
            grip: this.tune.grip,
          },
          n,
        )
      : null;
    this.gx = Math.ceil((grid.cols * grid.tile) / this.tune.cell) + 2;
    this.gy = Math.ceil((grid.rows * grid.tile) / this.tune.cell) + 2;
    this.head = new Int32Array(this.gx * this.gy).fill(-1);
    this.next = new Int32Array(n);
    this.sleepHead = new Int32Array(this.gx * this.gy).fill(-1);
    this.sleepPrev = new Int32Array(n);
    this.sleepCell = new Int32Array(n).fill(-1);
    this.seen = new Uint8Array(n);
    this.awake = new Int32Array(n);
    this.listed = new Uint8Array(n);
  }

  /** Put a body in the world, awake. Returns its slot, or -1 with the world full. */
  spawn(kind: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): number {
    let i: number;
    if (this.free.length) i = this.free.pop()!;
    else if (this.count < this.capacity) i = this.count++;
    else return -1;
    this.alive[i] = 1;
    this.kind[i] = kind;
    this.r[i] = this.radii[kind];
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    const yaw = this.random() * Math.PI,
      tilt = (this.random() - 0.5) * 0.6;
    // a random yaw and a small tilt: a coin dropped, not placed
    const q = this.q;
    q[i * 4] = Math.sin(tilt / 2) * Math.cos(yaw);
    q[i * 4 + 1] = Math.sin(tilt / 2) * Math.sin(yaw);
    q[i * 4 + 2] = Math.sin(yaw) * 0.1;
    q[i * 4 + 3] = Math.cos(tilt / 2);
    this.normalise(i);
    this.wx[i] = 0;
    this.wy[i] = 0;
    this.wz[i] = 0;
    this.asleep[i] = 0;
    this.carried[i] = 0;
    this.onFloor[i] = 0;
    this.sx[i] = x;
    this.sy[i] = y;
    this.sz[i] = z;
    this.h[i] = this.thickness[kind] ?? 0;
    this.discs?.born(i);
    this.window(i);
    this.list(i);
    this.live++;
    return i;
  }

  /** A body turned as told, still: a coin put down flat, or stood on its rim, rather than dropped. */
  setOrientation(i: number, qx: number, qy: number, qz: number, qw: number) {
    const o = i * 4;
    this.q[o] = qx;
    this.q[o + 1] = qy;
    this.q[o + 2] = qz;
    this.q[o + 3] = qw;
    this.normalise(i);
    this.wx[i] = this.wy[i] = this.wz[i] = 0;
    this.discs?.rest(i);
    this.window(i);
  }

  /** The way a body's own z looks: a disc's axis, square to its faces. */
  axis(i: number): [number, number, number] {
    const q = this.q,
      o = i * 4;
    return [
      2 * (q[o] * q[o + 2] + q[o + 3] * q[o + 1]),
      2 * (q[o + 1] * q[o + 2] - q[o + 3] * q[o]),
      1 - 2 * (q[o] * q[o] + q[o + 1] * q[o + 1]),
    ];
  }

  /** The sleep window opened afresh on a body: where it is, and how it is turned. */
  private window(i: number) {
    this.opened[i] = this.steps;
    this.sx[i] = this.x[i];
    this.sy[i] = this.y[i];
    this.sz[i] = this.z[i];
    const o = i * 4;
    this.so[o] = this.q[o];
    this.so[o + 1] = this.q[o + 1];
    this.so[o + 2] = this.q[o + 2];
    this.so[o + 3] = this.q[o + 3];
  }

  /** Take a body out of the world for good. */
  remove(i: number) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.carried[i] = 0;
    this.list(i);
    this.free.push(i);
    this.live--;
  }

  private normalise(i: number) {
    const q = this.q,
      o = i * 4;
    const l = Math.hypot(q[o], q[o + 1], q[o + 2], q[o + 3]) || 1;
    q[o] /= l;
    q[o + 1] /= l;
    q[o + 2] /= l;
    q[o + 3] /= l;
  }

  /** Put a body on the awake list, to be sorted out at the top of the next step. */
  private list(i: number) {
    if (this.listed[i]) return;
    this.listed[i] = 1;
    this.awake[this.awakeCount++] = i;
  }

  wake(i: number) {
    if (!this.alive[i]) return;
    // where it was when it started to move this step, if it is only starting now
    if (this.asleep[i]) {
      this.lastX[i] = this.x[i];
      this.lastY[i] = this.y[i];
      // a disc's step starts from here: what moves it now is the whole of how far it gets
      if (this.h[i] > 0) this.discs!.rouse(i);
    }
    this.asleep[i] = 0;
    this.list(i);
    // a fresh window, so what woke it has time to move it
    this.window(i);
  }

  /** Wake everything within `radius` of a point — ahead of a blade, say — and, if given, only between two heights. */
  wakeNear(x: number, y: number, radius: number, z0 = -Infinity, z1 = Infinity) {
    // A sleeper is in the sleepers' hash where it lies, or it dozed off in
    // the last step and is still in the awake hash, a hair from where that
    // step hashed it, which the extra cell covers.
    const r2 = radius * radius,
      pad = radius + this.tune.cell;
    const { head, next, gx } = this;
    const x0 = this.cellX(x - pad),
      x1 = this.cellX(x + pad);
    const y0 = this.cellY(y - pad),
      y1 = this.cellY(y + pad);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = head[cy * gx + cx]; i >= 0; i = next[i]) {
          if (!this.alive[i] || !this.asleep[i]) continue;
          if (this.z[i] < z0 || this.z[i] > z1) continue;
          const dx = this.x[i] - x,
            dy = this.y[i] - y;
          if (dx * dx + dy * dy < r2) this.wake(i);
        }
      }
    }
  }

  wakeAll() {
    for (let i = 0; i < this.count; i++) this.wake(i);
  }

  /** Advance by `dt` seconds in fixed steps, reporting what fell into a hole: its kind, where, and its slot, which is freed. */
  step(dt: number, collect: (kind: number, x: number, y: number, i: number) => void) {
    this.accumulator = Math.min(this.accumulator + dt, this.tune.step * 4);
    const steps = Math.floor(this.accumulator / this.tune.step + 1e-6);
    // The machines moved the whole frame at once; the blade is swept there
    // across the steps rather than jumping. A jump of more than the blade's
    // thickness and a coin's radius — a fast engine at a phone's frame rate —
    // puts a coin's centre past the blade's middle, and out the back it goes.
    for (let k = 0; k < steps; k++) {
      this.accumulator -= this.tune.step;
      this.lag = dt * (1 - (k + 1) / steps);
      this.substep(collect);
    }
    this.lag = 0;
  }

  private substep(collect: (kind: number, x: number, y: number, i: number) => void) {
    const { x, y, z, vx, vy, vz, alive, asleep, carried, awake } = this;
    this.steps++;
    this.loadNow.length = 0;
    this.discs?.tick();
    this.settle();
    // integrate
    for (let k = 0, n = this.awakeCount; k < n; k++) {
      const i = awake[k];
      if (carried[i]) continue;
      this.lastX[i] = x[i];
      this.lastY[i] = y[i];
      if (this.h[i] > 0) {
        // a disc moves on and turns, and what it touches is put right by position after
        this.discs!.begin(i);
        this.onFloor[i] = 0;
        continue;
      }
      vz[i] -= this.tune.gravity * this.tune.step;
      x[i] += vx[i] * this.tune.step;
      y[i] += vy[i] * this.tune.step;
      z[i] += vz[i] * this.tune.step;
      this.onFloor[i] = 0;
    }
    this.hash();
    if (this.discs) this.again.fill(0, 0, this.count);
    this.pairs(false);
    // the discs found well into something are gone over again, put back on the floor first
    for (let pass = 1; pass < DISC_PASSES; pass++)
      if (this.discs) {
        this.floors();
        this.pairs(true);
      }
    this.place();
    this.sleepers();
    const seen = this.seen;
    // what the pairs and the belts and blades woke is on the end of the list, and is stepped too
    for (let k = 0; k < this.awakeCount; k++) {
      const i = awake[k];
      if (!alive[i] || carried[i] || asleep[i]) continue;
      // one a blade or belt has already moved this step is kept out of the rock, and no more
      if (seen[i]) {
        this.walls(i);
        if (this.h[i] > 0) this.discs!.finish(i);
        continue;
      }
      if (this.h[i] > 0) {
        this.stepDisc(i, collect);
        continue;
      }
      this.push(i);
      this.belt(i);
      this.pull(i);
      // the rock last, after everything else that moves it, so nothing is left in it
      this.walls(i);
      this.floor(i, collect);
      if (!alive[i]) continue;
      // A slow body is slowed further, which takes the fizz out of a
      // settling heap. Sleep is judged on where it has got to, not how fast
      // it says it is going: a stack of spheres under gravity carries
      // velocity it never turns into distance, and would never rest by speed.
      const speed2 = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
      if (speed2 < 1.5) {
        vx[i] *= 0.96;
        vy[i] *= 0.96;
        vz[i] *= 0.96;
      }
      if (this.steps - this.opened[i] >= this.tune.sleepSteps) {
        const dx = x[i] - this.sx[i],
          dy = y[i] - this.sy[i],
          dz = z[i] - this.sz[i];
        if (dx * dx + dy * dy + dz * dz < this.tune.sleepDrift * this.tune.sleepDrift) {
          asleep[i] = 1;
          vx[i] = vy[i] = vz[i] = 0;
          this.wx[i] = this.wy[i] = this.wz[i] = 0;
        }
        this.window(i);
      }
      this.turn(i);
    }
    for (const i of this.seenList) seen[i] = 0;
    this.seenList.length = 0;
    this.loads = this.loadNow.slice();
    this.load = this.loads[0] ?? 0;
  }

  private cellX(px: number): number {
    return Math.max(0, Math.min(this.gx - 1, ((px - this.grid.originX) / this.tune.cell + 1) | 0));
  }
  private cellY(py: number): number {
    return Math.max(0, Math.min(this.gy - 1, ((py - this.grid.originY) / this.tune.cell + 1) | 0));
  }

  private cellOf(px: number, py: number): number {
    return this.cellY(py) * this.gx + this.cellX(px);
  }

  /** Where each pusher is this step. */
  private place() {
    const lag = this.lag;
    const { pushers, placed } = this;
    while (placed.length < pushers.length)
      placed.push({ p: pushers[0], bx: 0, by: 0, pivotX: 0, pivotY: 0, c: 1, s: 0, reach: 0 });
    placed.length = pushers.length;
    for (let k = 0; k < pushers.length; k++) {
      const p = pushers[k],
        o = placed[k];
      // where the box was `lag` ago: back along its velocity, and back round its turn
      const ta = -p.spin * lag,
        tc = Math.cos(ta),
        ts = Math.sin(ta);
      const rx = p.x - p.px,
        ry = p.y - p.py;
      o.p = p;
      o.bx = p.px + tc * rx - ts * ry - p.vx * lag;
      o.by = p.py + ts * rx + tc * ry - p.vy * lag;
      o.pivotX = p.px - p.vx * lag;
      o.pivotY = p.py - p.vy * lag;
      const yaw = p.yaw + ta;
      o.c = Math.cos(yaw);
      o.s = Math.sin(yaw);
      o.reach = Math.hypot(p.hx + this.maxRadius, p.hy + this.maxRadius);
    }
  }

  /**
   * The sleepers under a belt or a blade, found through the hash, get what an
   * awake body would: the belt, then each pusher. The rest of them are not
   * touched at all.
   */
  private sleepers() {
    const { sleepHead, next, gx, asleep, seen, seenList } = this;
    const visit = (x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void) => {
      for (let cy = this.cellY(y0), cy1 = this.cellY(y1); cy <= cy1; cy++) {
        for (let cx = this.cellX(x0), cx1 = this.cellX(x1); cx <= cx1; cx++) {
          for (let i = sleepHead[cy * gx + cx]; i >= 0; i = next[i]) {
            if (!this.alive[i] || !(asleep[i] || seen[i])) continue;
            if (!seen[i]) {
              seen[i] = 1;
              seenList.push(i);
            }
            fn(i);
          }
        }
      }
    };
    for (const b of this.belts) {
      const ex = Math.abs(b.dx) * b.half + (Math.abs(b.dy) * b.width) / 2 + 0.01;
      const ey = Math.abs(b.dy) * b.half + (Math.abs(b.dx) * b.width) / 2 + 0.01;
      visit(b.cx - ex, b.cy - ey, b.cx + ex, b.cy + ey, (i) => this.beltOne(i, b));
    }
    for (const o of this.placed) {
      visit(o.bx - o.reach, o.by - o.reach, o.bx + o.reach, o.by + o.reach, (i) =>
        this.h[i] > 0 ? this.discBox(i, o) : this.pushOne(i, o),
      );
    }
  }

  /**
   * Sorts out the awake list: the dead and the dozed come off it, a sleeper
   * goes into its cell's sleepers and a woken one comes out. Done here, and
   * only here, before the hash, so nothing walking a chain ever has a body
   * taken out from under it.
   */
  private settle() {
    const { awake, listed, alive, asleep, sleepCell } = this;
    let kept = 0;
    for (let k = 0; k < this.awakeCount; k++) {
      const i = awake[k];
      // out and back in, even for one still asleep: it may have been woken
      // and moved and dozed off again within the one step
      if (sleepCell[i] >= 0) this.rouse(i);
      if (!alive[i]) listed[i] = 0;
      else if (asleep[i]) {
        this.doze(i);
        listed[i] = 0;
      } else awake[kept++] = i;
    }
    this.awakeCount = kept;
    // in slot order, as a walk over every slot would meet them
    awake.subarray(0, kept).sort();
  }

  private doze(i: number) {
    const c = this.cellOf(this.x[i], this.y[i]);
    const first = this.sleepHead[c];
    this.sleepCell[i] = c;
    this.sleepPrev[i] = -1;
    this.next[i] = first;
    if (first >= 0) this.sleepPrev[first] = i;
    this.sleepHead[c] = i;
  }

  private rouse(i: number) {
    const c = this.sleepCell[i],
      prev = this.sleepPrev[i],
      next = this.next[i];
    if (prev >= 0) this.next[prev] = next;
    else this.sleepHead[c] = next;
    if (next >= 0) this.sleepPrev[next] = prev;
    this.sleepCell[i] = -1;
  }

  private hash() {
    // each cell starts from its sleepers, and the awake go on in front
    this.head.set(this.sleepHead);
    const { head, next, carried, awake } = this;
    for (let k = 0; k < this.awakeCount; k++) {
      const i = awake[k];
      if (carried[i]) continue;
      const c = this.cellOf(this.x[i], this.y[i]);
      next[i] = head[c];
      head[c] = i;
    }
  }

  private pairs(discsOnly: boolean) {
    const { x, y, z, vx, vy, vz, r, alive, asleep, carried, head, next, gx, awake } = this;
    // a sleeper woken here goes on the end of the list and waits for the next step to be the outer body
    for (let k = 0, n = this.awakeCount; k < n; k++) {
      const i = awake[k];
      if (!alive[i] || asleep[i] || carried[i]) continue;
      const c = this.cellOf(x[i], y[i]);
      const cx = c % gx,
        cy = (c / gx) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= this.gy) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          if (nx < 0 || nx >= gx) continue;
          // the awake, then the sleepers — and those woken this step, still among the sleepers
          for (let j = head[ny * gx + nx]; j >= 0; j = next[j]) {
            // an awake pair is done once, from the lower index; a sleeper is
            // never the outer body, so it is done from the awake one
            if (j === i || (!asleep[j] && j < i)) continue;
            // a disc, or a ball against one, is the discs' business
            if (this.h[i] > 0 || this.h[j] > 0) {
              if (!discsOnly || this.again[i] || this.again[j]) this.discPair(i, j);
              continue;
            }
            if (discsOnly) continue;
            const dx = x[j] - x[i],
              dy = y[j] - y[i],
              dz = z[j] - z[i];
            const rr = r[i] + r[j];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rr * rr || d2 < 1e-8) continue;
            const d = Math.sqrt(d2);
            const nxx = dx / d,
              nyy = dy / d,
              nzz = dz / d;
            const pen = rr - d;
            const rvx = vx[j] - vx[i],
              rvy = vy[j] - vy[i],
              rvz = vz[j] - vz[i];
            const vn = rvx * nxx + rvy * nyy + rvz * nzz;
            // a sleeper is woken only by something arriving with intent
            if (asleep[j]) {
              if (vn < -1.2 || pen > 0.3) this.wake(j);
              else {
                // i rests against a sleeping j: j is a wall, i is stopped by it
                x[i] -= nxx * pen;
                y[i] -= nyy * pen;
                z[i] -= nzz * pen;
                if (vn < 0) {
                  vx[i] += nxx * vn;
                  vy[i] += nyy * vn;
                  vz[i] += nzz * vn;
                }
                vx[i] *= 0.98;
                vy[i] *= 0.98;
                this.onFloor[i] |= nzz < -0.5 ? 1 : 0;
                continue;
              }
            }
            const mi = r[i] * r[i] * r[i],
              mj = r[j] * r[j] * r[j];
            const wi = mj / (mi + mj),
              wj = mi / (mi + mj);
            // part of the overlap a step, past a little slop: all of it at
            // once makes a heap pop and fizz and never settle
            const fix = Math.max(0, pen - 0.01) * 0.45;
            x[i] -= nxx * fix * wi;
            y[i] -= nyy * fix * wi;
            z[i] -= nzz * fix * wi;
            x[j] += nxx * fix * wj;
            y[j] += nyy * fix * wj;
            z[j] += nzz * fix * wj;
            if (vn < 0) {
              // a slow touch does not bounce at all
              const jn = -(1 + (vn < -1.5 ? this.tune.restitution : 0)) * vn;
              vx[i] -= nxx * jn * wi;
              vy[i] -= nyy * jn * wi;
              vz[i] -= nzz * jn * wi;
              vx[j] += nxx * jn * wj;
              vy[j] += nyy * jn * wj;
              vz[j] += nzz * jn * wj;
              // friction along the tangent, capped by the normal impulse
              const tx = rvx - vn * nxx,
                ty = rvy - vn * nyy,
                tz = rvz - vn * nzz;
              const tl = Math.hypot(tx, ty, tz);
              if (tl > 1e-5) {
                const jt = Math.min(tl, this.tune.friction * jn);
                const fx = (tx / tl) * jt,
                  fy = (ty / tl) * jt,
                  fz = (tz / tl) * jt;
                vx[i] += fx * wi;
                vy[i] += fy * wi;
                vz[i] += fz * wi;
                vx[j] -= fx * wj;
                vy[j] -= fy * wj;
                vz[j] -= fz * wj;
                // and a tumble from it
                const k = 0.5;
                this.wx[i] += (nyy * fz - nzz * fy) * k;
                this.wy[i] += (nzz * fx - nxx * fz) * k;
                this.wz[i] += (nxx * fy - nyy * fx) * k;
                this.wx[j] -= (nyy * fz - nzz * fy) * k;
                this.wy[j] -= (nzz * fx - nxx * fz) * k;
                this.wz[j] -= (nxx * fy - nyy * fx) * k;
              }
            }
            if (nzz < -0.5) this.onFloor[i] |= 1;
            if (nzz > 0.5) this.onFloor[j] |= 1;
          }
        }
      }
    }
  }

  /** How high the floor stands under a point: the tile's height, or nothing off the grid or on a flat floor. */
  floorAt(px: number, py: number): number {
    if (!this.heights) return 0;
    const tx = Math.floor((px - this.grid.originX) / this.grid.tile),
      ty = Math.floor((py - this.grid.originY) / this.grid.tile);
    if (tx < 0 || ty < 0 || tx >= this.grid.cols || ty >= this.grid.rows) return 0;
    return this.heights[ty * this.grid.cols + tx];
  }

  /**
   * An awake body and another, one of them a disc at least. A sleeper is a
   * wall to a lean and is woken by a knock, by being sunk into, or by what it
   * lies on moving off; a ball pushed is slowed along the push, since nothing
   * else reads its speed back from where it got to.
   */
  private discPair(i: number, j: number) {
    const d = this.discs!;
    if (!d.pair(i, j)) return;
    if (d.deepest > AGAIN) this.again[i] = this.again[j] = 1;
    let frozen = -1;
    if (this.asleep[j]) {
      // the way from the awake one to the sleeper, to see whether the sleeper lies on it
      const up = d.from === i ? d.wayZ : -d.wayZ;
      const moving = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i] + this.vz[i] * this.vz[i] > 0.04;
      if (d.closing < -1.2 || d.deepest > 0.08 || (up > 0.5 && moving)) this.wake(j);
      else frozen = j;
    }
    const ball = this.h[i] > 0 ? (this.h[j] > 0 ? -1 : j) : i;
    const s = d.from === ball ? -1 : 1;
    const wx = d.wayX * s,
      wy = d.wayY * s,
      wz = d.wayZ * s;
    d.solve(frozen);
    if (ball >= 0 && ball !== frozen) {
      // the way from the disc to the ball: the ball's speed into the disc along it is taken off
      const other = ball === i ? j : i;
      const vn =
        (this.vx[ball] - this.vx[other]) * wx +
        (this.vy[ball] - this.vy[other]) * wy +
        (this.vz[ball] - this.vz[other]) * wz;
      if (vn < 0) {
        this.vx[ball] -= wx * vn;
        this.vy[ball] -= wy * vn;
        this.vz[ball] -= wz * vn;
      }
      if (wz > 0.5) this.onFloor[ball] |= 1;
    }
  }

  /**
   * A disc's step, after the pairs: the boxes, the rock and the floor put it
   * right by position, its speed and spin are read back from how far it
   * got, and if it has not got far, nor turned far, it sleeps.
   */
  private stepDisc(i: number, collect: (kind: number, x: number, y: number, i: number) => void) {
    const d = this.discs!;
    for (const o of this.placed) this.discBox(i, o);
    // the rock moves it like any contact: put out of it, and no faster for having been put
    const wasX = this.x[i],
      wasY = this.y[i];
    this.walls(i);
    if (this.x[i] !== wasX || this.y[i] !== wasY) d.put(i, this.x[i] - wasX, this.y[i] - wasY, 0);
    if (!this.discFloor(i, collect)) return;
    d.finish(i);
    this.belt(i);
    this.pull(i);
    const { x, y, z, vx, vy, vz, wx, wy, wz, q, so } = this;
    if (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i] < 1.5) {
      vx[i] *= 0.96;
      vy[i] *= 0.96;
      vz[i] *= 0.96;
      wx[i] *= 0.96;
      wy[i] *= 0.96;
      wz[i] *= 0.96;
    }
    if (this.steps - this.opened[i] < this.tune.sleepSteps) return;
    const dx = x[i] - this.sx[i],
      dy = y[i] - this.sy[i],
      dz = z[i] - this.sz[i];
    // how far its axis has swung since the window opened. A turn about its own axis is no move at all: a disc is
    // the same disc all the way round, and one jostled by its neighbours turns that way a little for ever.
    const o = i * 4;
    const thenX = 2 * (so[o] * so[o + 2] + so[o + 3] * so[o + 1]),
      thenY = 2 * (so[o + 1] * so[o + 2] - so[o + 3] * so[o]),
      thenZ = 1 - 2 * (so[o] * so[o] + so[o + 1] * so[o + 1]);
    const nowX = 2 * (q[o] * q[o + 2] + q[o + 3] * q[o + 1]),
      nowY = 2 * (q[o + 1] * q[o + 2] - q[o + 3] * q[o]),
      nowZ = 1 - 2 * (q[o] * q[o] + q[o + 1] * q[o + 1]);
    const same = thenX * nowX + thenY * nowY + thenZ * nowZ;
    // not far, its axis not swung by more than a couple of degrees, and not still being put out of something: at rest
    if (
      dx * dx + dy * dy + dz * dz < this.tune.sleepDrift * this.tune.sleepDrift &&
      1 - same * same < SWUNG &&
      d.into[i] < RESTING &&
      this.deepestOf(i) < RESTING + SLOP
    ) {
      this.asleep[i] = 1;
      vx[i] = vy[i] = vz[i] = 0;
      wx[i] = wy[i] = wz[i] = 0;
      d.doze(i);
    }
    this.window(i);
  }

  /**
   * The floor under every disc that is to be gone over again, between one
   * going over of their contacts and the next. A coin leaning in a heap stands on the floor by
   * its rim and bears what lies on it; pushed down through the floor by the
   * first going over and put back only when the step ends, it is never seen
   * by the second to be standing on anything, so what lies on it is never
   * lifted off it, and a shingle of leaning coins stays a tenth of a unit
   * into itself for good. They are only put back on the floor here: the
   * floor's friction is for the end of the step.
   */
  private floors() {
    const d = this.discs!;
    const { awake, alive, asleep, carried, h } = this;
    for (let k = 0, n = this.awakeCount; k < n; k++) {
      const i = awake[k];
      if (!alive[i] || asleep[i] || carried[i] || h[i] === 0 || !this.again[i]) continue;
      if (d.plane(i, 0, 0, 0, 0, 0, 1, 0, 0, this.floorUnder)) d.solve(-1, false);
    }
  }

  /**
   * How far a disc is into anything round it as it stands, at the deepest:
   * looked at once more before it sleeps. How far in it was found this step
   * is how far in it was when its turn came, and a neighbour shoved after
   * that can leave it deeper in a sleeper than anything noted; asleep, the
   * two would stay so.
   */
  private deepestOf(i: number): number {
    const d = this.discs!;
    const { head, next, gx, alive, carried } = this;
    const c = this.cellOf(this.x[i], this.y[i]);
    const cx = c % gx,
      cy = (c / gx) | 0;
    let deepest = 0;
    for (let oy = -1; oy <= 1; oy++) {
      const ny = cy + oy;
      if (ny < 0 || ny >= this.gy) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox;
        if (nx < 0 || nx >= gx) continue;
        for (let j = head[ny * gx + nx]; j >= 0; j = next[j]) {
          if (j === i || !alive[j] || carried[j]) continue;
          if (d.pair(i, j) && d.deepest > deepest) deepest = d.deepest;
        }
      }
    }
    return deepest;
  }

  /** The floor under a disc, and the bottom and the holes it may leave the world by: whether it is still in it. */
  private discFloor(i: number, collect: (kind: number, x: number, y: number, i: number) => void): boolean {
    const { x, y, z } = this;
    if (z[i] < this.bottom) {
      collect(this.kind[i], x[i], y[i], i);
      this.remove(i);
      return false;
    }
    for (const hole of this.holes) {
      if (Math.hypot(x[i] - hole.x, y[i] - hole.y) >= hole.radius) continue;
      // over the hole there is no floor, and at the bottom of it the disc is collected
      if (z[i] < -hole.depth + 3) {
        collect(this.kind[i], x[i], y[i], i);
        this.remove(i);
        return false;
      }
      return true;
    }
    const d = this.discs!;
    if (d.plane(i, 0, 0, 0, 0, 0, 1, 0, 0, this.floorUnder)) {
      d.solve(-1);
      // A coin landing hard at a tilt is put out of the floor a point of its rim at a time, and each push turns
      // it and dips another: gone over once, it ended the step a sixteenth of a unit under. So it is looked at
      // again, and if it is still well in, put out again, which halves what is left each time.
      for (let more = 0; more < 2 && d.plane(i, 0, 0, 0, 0, 0, 1, 0, 0, this.floorUnder) && d.deepest > LANDED; more++)
        d.solve(-1, false);
    }
    if (this.heights) this.lips(i);
    return true;
  }

  /**
   * The lips of the floor round a disc: where the tile under its middle and
   * the one next to it stand at different heights, the top edge of the
   * higher is a lip, and a disc near enough its height meets it. A disc is
   * narrower than two tiles, so the four tiles beside its own are all there
   * are; where two lips meet at a corner each is taken to run on.
   */
  private lips(i: number) {
    const d = this.discs!;
    const { grid, heights, solid } = this;
    const { x, y, z } = this;
    const tx = Math.floor((x[i] - grid.originX) / grid.tile),
      ty = Math.floor((y[i] - grid.originY) / grid.tile);
    if (tx < 0 || ty < 0 || tx >= grid.cols || ty >= grid.rows) return;
    const t = ty * grid.cols + tx;
    const own = heights![t],
      bound = d.bound[i];
    for (let k = 0; k < 4; k++) {
      const ox = k === 0 ? 1 : k === 1 ? -1 : 0,
        oy = k === 2 ? 1 : k === 3 ? -1 : 0;
      const ux = tx + ox,
        uy = ty + oy;
      if (ux < 0 || uy < 0 || ux >= grid.cols || uy >= grid.rows) continue;
      const u = uy * grid.cols + ux;
      if (solid[u] === 1 || heights![u] === own) continue;
      const top = Math.max(own, heights![u]);
      if (z[i] - bound >= top || z[i] + bound <= top) continue;
      // the edge the two tiles share, and the way from the higher of them to the lower
      const ex = grid.originX + (tx + (ox > 0 ? 1 : 0)) * grid.tile,
        ey = grid.originY + (ty + (oy > 0 ? 1 : 0)) * grid.tile;
      const down = heights![u] < own ? 1 : -1;
      if (Math.abs(ox ? x[i] - ex : y[i] - ey) >= bound) continue;
      if (d.lip(i, ex, ey, top, oy ? 1 : 0, ox ? 1 : 0, ox * down, oy * down)) d.solve(-1);
    }
  }

  /**
   * A box against a disc: the face of the box nearest the disc's middle is
   * the plane it meets, or the edge or corner if that is nearer, and the
   * disc's rim is put out of it. The box is not moved. A sleeper lying on a
   * box that starts to move is woken, or it would hang in the air.
   */
  private discBox(i: number, o: Placed) {
    const d = this.discs!;
    const { p, bx, by, pivotX, pivotY, c, s } = o;
    const dx = this.x[i] - bx,
      dy = this.y[i] - by;
    if (Math.abs(dx) > o.reach || Math.abs(dy) > o.reach) return;
    const lx = c * dx + s * dy,
      ly = -s * dx + c * dy,
      lz = this.z[i] - p.z;
    const reach = d.bound[i] + 0.1;
    if (Math.abs(lx) > p.hx + reach || Math.abs(ly) > p.hy + reach || Math.abs(lz) > p.hz + reach) return;
    // the nearest of the box to the disc's middle, and the way from it to the middle
    let qx = Math.max(-p.hx, Math.min(p.hx, lx)),
      qy = Math.max(-p.hy, Math.min(p.hy, ly)),
      qz = Math.max(-p.hz, Math.min(p.hz, lz));
    let fx = lx - qx,
      fy = ly - qy,
      fz = lz - qz;
    const gap = Math.hypot(fx, fy, fz);
    if (gap > 1e-4) {
      fx /= gap;
      fy /= gap;
      fz /= gap;
    } else {
      // the middle is inside the box: out by the nearest face, never downward
      const ex = p.hx - Math.abs(lx),
        ey = p.hy - Math.abs(ly),
        ez = p.hz - lz;
      fx = fy = fz = 0;
      if (ex <= ey && ex <= ez) {
        fx = Math.sign(lx) || 1;
        qx = fx * p.hx;
      } else if (ey <= ez) {
        fy = Math.sign(ly) || 1;
        qy = fy * p.hy;
      } else {
        fz = 1;
        qz = p.hz;
      }
    }
    // the box's speed where the disc is: its own, plus the turn
    const ox = this.x[i] - pivotX,
      oy = this.y[i] - pivotY;
    const pvx = p.vx - p.spin * oy,
      pvy = p.vy + p.spin * ox;
    const found = d.plane(
      i,
      bx + c * qx - s * qy,
      by + s * qx + c * qy,
      p.z + qz,
      c * fx - s * fy,
      s * fx + c * fy,
      fz,
      pvx,
      pvy,
      null,
      this.asleep[i] ? 0.05 : 0,
    );
    if (!found) return;
    if (this.asleep[i]) {
      // sunk into, or lying on a box that has started to move: woken; else left be
      if (d.deepest > 0.02 || (fz > 0.7 && (p.vx !== 0 || p.vy !== 0))) this.wake(i);
      else return;
    }
    d.solve(-1);
    if (Math.abs(fz) < 0.5 && d.deepest > 0) this.loadNow[p.owner] = (this.loadNow[p.owner] ?? 0) + 1;
  }

  /**
   * The deepest any two bodies are into each other as they stand, and which
   * two: for a test, or a game's rule, that nothing cuts. `resting` looks
   * only at pairs both asleep: what is being shoved may be a little into
   * what shoves it, for a step or two, and what has come to rest may not.
   */
  deepest(resting = false): { depth: number; i: number; j: number } {
    const cells = new Map<number, number[]>();
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const c = this.cellOf(this.x[i], this.y[i]);
      const list = cells.get(c);
      if (list) list.push(i);
      else cells.set(c, [i]);
    }
    const best = { depth: 0, i: -1, j: -1 };
    for (const [c, list] of cells) {
      const cx = c % this.gx,
        cy = (c / this.gx) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox,
            ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= this.gx || ny >= this.gy) continue;
          const others = cells.get(ny * this.gx + nx);
          if (!others) continue;
          for (const i of list) {
            for (const j of others) {
              if (j <= i || (resting && !(this.asleep[i] && this.asleep[j]))) continue;
              let depth: number;
              if (this.discs && (this.h[i] > 0 || this.h[j] > 0))
                depth = this.discs.pair(i, j) ? this.discs.deepest : 0;
              else
                depth =
                  this.r[i] +
                  this.r[j] -
                  Math.hypot(this.x[j] - this.x[i], this.y[j] - this.y[i], this.z[j] - this.z[i]);
              if (depth > best.depth) Object.assign(best, { depth, i, j });
            }
          }
        }
      }
    }
    return best;
  }

  /** Whether the tile at a point is a wall to a body whose middle is at `z`: rock, off the grid, or a floor above it. */
  private wallAt(px: number, py: number, z: number): boolean {
    const tx = Math.floor((px - this.grid.originX) / this.grid.tile),
      ty = Math.floor((py - this.grid.originY) / this.grid.tile);
    if (tx < 0 || ty < 0 || tx >= this.grid.cols || ty >= this.grid.rows) return true;
    const t = ty * this.grid.cols + tx;
    return this.solid[t] === 1 || (this.heights !== null && this.heights[t] > z);
  }

  /**
   * The rock, and the floor where it stands above a body: the tiles around
   * a body, as boxes it cannot enter.
   *
   * A body whose middle has got into a wall tile — shoved there by a blade,
   * or squeezed there out of a heap — goes back out the way it came in, not
   * out whichever face is nearest: past the middle of a tile the nearest face
   * is the far one, and a coin pushed into a wall a tile thick would come out
   * the other side of it. So it goes back along the one way it moved in on,
   * or both, to where it was when the step began; and one buried in the rock
   * with no way back is put on the nearest open floor. Then it is pushed off
   * the faces round it by its radius, as anything touching the rock is.
   */
  private walls(i: number) {
    const { x, y, z, vx, vy, r } = this;
    // A disc lies with its middle an eighth of a unit above the floor, and one landing, or pressed down by a pile,
    // can end a step's pushes with its middle under the floor it lies on, to be put back on it next: taken as it
    // stands, its own floor is rock to it, and it is put out of it sideways. So a disc is no lower to the rock than
    // it was when the step began.
    const zi = this.discs && this.h[i] > 0 ? Math.max(z[i], this.discs.pz[i]) : z[i];
    if (this.wallAt(x[i], y[i], zi)) {
      const bx = this.lastX[i],
        by = this.lastY[i];
      if (!this.wallAt(bx, y[i], zi)) {
        x[i] = bx;
        vx[i] = 0;
      } else if (!this.wallAt(x[i], by, zi)) {
        y[i] = by;
        vy[i] = 0;
      } else if (!this.wallAt(bx, by, zi)) {
        x[i] = bx;
        y[i] = by;
        vx[i] = vy[i] = 0;
      } else {
        this.outOfRock(i);
      }
    }
    const px = x[i],
      py = y[i],
      rad = r[i];
    const tx = Math.floor((px - this.grid.originX) / this.grid.tile),
      ty = Math.floor((py - this.grid.originY) / this.grid.tile);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = tx + ox,
          ny = ty + oy;
        if (
          !this.wallAt(
            this.grid.originX + (nx + 0.5) * this.grid.tile,
            this.grid.originY + (ny + 0.5) * this.grid.tile,
            zi,
          )
        )
          continue;
        const x0 = this.grid.originX + nx * this.grid.tile,
          y0 = this.grid.originY + ny * this.grid.tile;
        const cx = Math.max(x0, Math.min(x0 + this.grid.tile, x[i])),
          cy = Math.max(y0, Math.min(y0 + this.grid.tile, y[i]));
        let dx = x[i] - cx,
          dy = y[i] - cy;
        const d = Math.hypot(dx, dy);
        if (d >= rad || d < 1e-6) continue;
        dx /= d;
        dy /= d;
        x[i] += dx * (rad - d);
        y[i] += dy * (rad - d);
        const vn = vx[i] * dx + vy[i] * dy;
        if (vn < 0) {
          vx[i] -= dx * vn * 1.1;
          vy[i] -= dy * vn * 1.1;
        }
      }
    }
  }

  /** A body buried in the rock with no way back: onto the nearest open floor no higher than it, in rings out from where it is, and stopped. */
  private outOfRock(i: number) {
    const tx = Math.floor((this.x[i] - this.grid.originX) / this.grid.tile),
      ty = Math.floor((this.y[i] - this.grid.originY) / this.grid.tile);
    for (let ring = 1; ring < 12; ring++) {
      let best = -1,
        bestD = Infinity;
      for (let oy = -ring; oy <= ring; oy++) {
        for (let ox = -ring; ox <= ring; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== ring) continue;
          const nx = tx + ox,
            ny = ty + oy;
          if (nx < 0 || ny < 0 || nx >= this.grid.cols || ny >= this.grid.rows) continue;
          const t = ny * this.grid.cols + nx;
          if (this.solid[t] || (this.heights !== null && this.heights[t] > this.z[i])) continue;
          const d = ox * ox + oy * oy;
          if (d < bestD) {
            bestD = d;
            best = ny * this.grid.cols + nx;
          }
        }
      }
      if (best >= 0) {
        this.x[i] = this.grid.originX + ((best % this.grid.cols) + 0.5) * this.grid.tile;
        this.y[i] = this.grid.originY + (((best / this.grid.cols) | 0) + 0.5) * this.grid.tile;
        this.vx[i] = this.vy[i] = 0;
        return;
      }
    }
  }

  /** The blade and the hull: oriented boxes that shove. */
  private push(i: number) {
    for (const o of this.placed) this.pushOne(i, o);
  }

  private pushOne(i: number, o: Placed) {
    const { x, y, z, vx, vy, vz, r } = this;
    const { p, bx, by, pivotX, pivotY, c, s } = o;
    const dx = x[i] - bx,
      dy = y[i] - by,
      dz = z[i] - p.z;
    if (Math.abs(dx) > o.reach || Math.abs(dy) > o.reach) return;
    const lx = c * dx + s * dy,
      ly = -s * dx + c * dy,
      lz = dz;
    const rad = r[i];
    // a hair of slack, so a body lying exactly on the box's top is still looked at
    if (Math.abs(lx) > p.hx + rad + 0.1 || Math.abs(ly) > p.hy + rad + 0.1 || Math.abs(lz) > p.hz + rad + 0.1) return;
    const qx = Math.max(-p.hx, Math.min(p.hx, lx)),
      qy = Math.max(-p.hy, Math.min(p.hy, ly)),
      qz = Math.max(-p.hz, Math.min(p.hz, lz));
    let nx = lx - qx,
      ny = ly - qy,
      nz = lz - qz;
    let d = Math.hypot(nx, ny, nz);
    if (d >= rad) {
      // a sleeper lying on top of a box that has started to move is woken, or it would hang in the air as the box left
      if (this.asleep[i] && d < rad + 0.1 && nz > 0.7 * d && (p.vx !== 0 || p.vy !== 0)) this.wake(i);
      return;
    }
    if (d < 1e-4) {
      // centre inside the box: leave by the nearest face, never downward
      const ex = p.hx - Math.abs(lx),
        ey = p.hy - Math.abs(ly),
        ez = p.hz - lz;
      // a plate thinner than the coin leaves it on the side it is moving toward,
      // which is the side the coin was on before the plate got into it
      const ox = x[i] - pivotX,
        oy = y[i] - pivotY;
      const lvx = c * (p.vx - p.spin * oy) + s * (p.vy + p.spin * ox);
      if (p.hx < rad && Math.abs(lvx) > 0.5 && ex <= ey && ex <= ez) {
        nx = Math.sign(lvx);
        ny = 0;
        nz = 0;
        d = Math.sign(lvx) * lx - p.hx;
      } else if (ex <= ey && ex <= ez) {
        nx = Math.sign(lx) || 1;
        ny = 0;
        nz = 0;
        d = -ex;
      } else if (ey <= ez) {
        nx = 0;
        ny = Math.sign(ly) || 1;
        nz = 0;
        d = -ey;
      } else {
        nx = 0;
        ny = 0;
        nz = 1;
        d = -ez;
      }
    } else {
      nx /= d;
      ny /= d;
      nz /= d;
    }
    const pen = rad - d;
    // back to the world
    const wnx = c * nx - s * ny,
      wny = s * nx + c * ny,
      wnz = nz;
    if (this.asleep[i]) this.wake(i);
    x[i] += wnx * pen;
    y[i] += wny * pen;
    z[i] += wnz * pen;
    // the box's velocity at the point of contact: its own, plus the turn
    const ox = x[i] - pivotX,
      oy = y[i] - pivotY;
    const pvx = p.vx - p.spin * oy,
      pvy = p.vy + p.spin * ox;
    const vn = vx[i] * wnx + vy[i] * wny + vz[i] * wnz;
    const pvn = pvx * wnx + pvy * wny;
    if (vn < pvn) {
      const j = pvn - vn;
      vx[i] += wnx * j;
      vy[i] += wny * j;
      vz[i] += wnz * j;
    }
    // dragged along with the face a little, which is how a blade carries a load, and a platform what rests on it
    vx[i] += (pvx - vx[i]) * 0.15;
    vy[i] += (pvy - vy[i]) * 0.15;
    if (Math.abs(wnz) < 0.5) this.loadNow[p.owner] = (this.loadNow[p.owner] ?? 0) + 1;
    // on top of the box is a floor: it lies flat there
    else if (wnz > 0.5) this.onFloor[i] |= 2;
  }

  /** The magnet: a pull that grows toward the point, on things low enough to be on the floor. */
  private pull(i: number) {
    const m = this.magnet;
    if (!m || this.z[i] - this.floorAt(this.x[i], this.y[i]) > this.r[i] + 1.5) return;
    const dx = m.x - this.x[i],
      dy = m.y - this.y[i];
    const d = Math.hypot(dx, dy);
    if (d >= m.radius || d < 0.5) return;
    const k = (m.strength * (1 - d / m.radius) * this.tune.step) / d;
    this.vx[i] += dx * k;
    this.vy[i] += dy * k;
  }

  private belt(i: number) {
    for (const b of this.belts) this.beltOne(i, b);
  }

  private beltOne(i: number, b: Belt) {
    const { x, y, z, vx, vy, r } = this;
    const dx = x[i] - b.cx,
      dy = y[i] - b.cy;
    const along = dx * b.dx + dy * b.dy,
      across = -dx * b.dy + dy * b.dx;
    if (Math.abs(along) > b.half || Math.abs(across) > b.width / 2 || z[i] - this.floorAt(x[i], y[i]) > r[i] + 0.6)
      return;
    if (this.asleep[i]) this.wake(i);
    const k = 0.12;
    vx[i] += (b.dx * b.speed - vx[i]) * k;
    vy[i] += (b.dy * b.speed - vy[i]) * k;
    // gathered toward the centre line, so the belt delivers to one place
    vx[i] += -b.dy * -across * 0.6 * k;
    vy[i] += b.dx * -across * 0.6 * k;
  }

  private floor(i: number, collect: (kind: number, x: number, y: number, i: number) => void) {
    const { x, y, z, vx, vy, vz, r } = this;
    const step = this.tune.step;
    // out of the bottom of the world: gone, and reported
    if (z[i] < this.bottom) {
      collect(this.kind[i], x[i], y[i], i);
      this.remove(i);
      return;
    }
    // the nearest hole, for the floor's slope toward it; and any it is over, which it falls into
    let near: Hole | null = null,
      nd = Infinity,
      ndx = 0,
      ndy = 0;
    for (const h of this.holes) {
      const dx = x[i] - h.x,
        dy = y[i] - h.y;
      const d = Math.hypot(dx, dy);
      if (d < h.radius) {
        // over the hole: nothing under it, and the pit's wall around it
        if (z[i] < 0 && d > h.radius - r[i]) {
          const nx = dx / d,
            ny = dy / d;
          const fix = d - (h.radius - r[i]);
          x[i] -= nx * fix;
          y[i] -= ny * fix;
          const vn = vx[i] * nx + vy[i] * ny;
          if (vn > 0) {
            vx[i] -= nx * vn;
            vy[i] -= ny * vn;
          }
        }
        if (z[i] < -h.depth + 3) {
          collect(this.kind[i], x[i], y[i], i);
          this.remove(i);
        }
        return;
      }
      if (d < nd) {
        nd = d;
        ndx = dx;
        ndy = dy;
        near = h;
      }
    }
    const fz = this.floorAt(x[i], y[i]);
    if (z[i] < fz + r[i]) {
      z[i] = fz + r[i];
      if (vz[i] < 0) vz[i] = -vz[i] * this.tune.restitution;
      const drag = 1 / (1 + this.tune.floorDrag * step);
      vx[i] *= drag;
      vy[i] *= drag;
      this.onFloor[i] |= 1;
      // a body near a rim tips in: the floor slopes to the hole a little
      if (near && nd < near.radius + 2.5) {
        vx[i] -= (ndx / nd) * 6 * step;
        vy[i] -= (ndy / nd) * 6 * step;
      }
    }
  }

  /** The cosmetic spin: flat when on the floor or a box, tumbling when not. */
  private turn(i: number) {
    const q = this.q,
      o = i * 4;
    const resting =
      (this.onFloor[i] & 1 && this.z[i] <= this.floorAt(this.x[i], this.y[i]) + this.r[i] + 0.05) ||
      this.onFloor[i] & 2;
    if (resting) {
      // ease to flat, whichever face is nearer up
      const zz = 1 - 2 * (q[o] * q[o] + q[o + 1] * q[o + 1]);
      const k = 0.12;
      if (zz >= 0) {
        q[o] *= 1 - k;
        q[o + 1] *= 1 - k;
      } else {
        // toward a half turn about the axis it is already tilted round
        const l = Math.hypot(q[o], q[o + 1]) || 1;
        q[o] += (q[o] / l - q[o]) * k;
        q[o + 1] += (q[o + 1] / l - q[o + 1]) * k;
        q[o + 3] *= 1 - k;
      }
      this.normalise(i);
      this.wx[i] *= 0.7;
      this.wy[i] *= 0.7;
      this.wz[i] *= 0.7;
      return;
    }
    const wx = this.wx[i],
      wy = this.wy[i],
      wz = this.wz[i];
    const w2 = wx * wx + wy * wy + wz * wz;
    if (w2 < 1e-6) return;
    const cap = 12;
    const scale = w2 > cap * cap ? cap / Math.sqrt(w2) : 1;
    const hx = wx * scale * this.tune.step * 0.5,
      hy = wy * scale * this.tune.step * 0.5,
      hz = wz * scale * this.tune.step * 0.5;
    const qx = q[o],
      qy = q[o + 1],
      qz = q[o + 2],
      qw = q[o + 3];
    q[o] += hx * qw + hy * qz - hz * qy;
    q[o + 1] += hy * qw + hz * qx - hx * qz;
    q[o + 2] += hz * qw + hx * qy - hy * qx;
    q[o + 3] += -hx * qx - hy * qy - hz * qz;
    this.normalise(i);
    this.wx[i] *= 0.985;
    this.wy[i] *= 0.985;
    this.wz[i] *= 0.985;
  }
}
