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
 * The world knows nothing of any game. It is handed a grid of solid tiles
 * to keep out of, the holes things fall out of it through, the radius of
 * each kind of body, where its chance comes from, and the tuning, with the
 * defaults being a coin-sized world; it says what fell in through a callback.
 */

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
}

export const DEFAULT_TUNING: Tuning = {
  step: 1 / 120,
  gravity: 70,
  restitution: 0.08,
  friction: 0.45,
  floorDrag: 5.5,
  sleepDrift: 0.25,
  sleepSteps: 40,
  cell: 2.5,
};

export interface WorldOptions {
  /** How many bodies there can ever be at once. */
  capacity: number;
  grid: Grid;
  /** Which tiles are rock, one byte a tile, row by row; the world reads it every step, so it may be rewritten in place. */
  solid: Uint8Array;
  /** The collision radius of each kind of body, by kind. */
  radii: readonly number[];
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
  /** Orientation, four floats a body, for drawing. */
  readonly q: Float32Array;
  readonly wx: Float32Array;
  readonly wy: Float32Array;
  readonly wz: Float32Array;
  readonly asleep: Uint8Array;
  /** Where each body was when this step started moving it, for the rock to put it back out the way it came in. */
  private readonly lastX: Float32Array;
  private readonly lastY: Float32Array;
  /** Where each body was when the sleep window opened. */
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
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
  readonly grid: Grid;
  readonly holes: readonly Hole[];
  private readonly radii: readonly number[];
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
    this.list(i);
    this.live++;
    return i;
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
    }
    this.asleep[i] = 0;
    this.list(i);
    // a fresh window, so what woke it has time to move it
    this.sx[i] = this.x[i];
    this.sy[i] = this.y[i];
    this.sz[i] = this.z[i];
  }

  /** Wake everything within `radius` of a point — ahead of a blade, say. */
  wakeNear(x: number, y: number, radius: number) {
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
    const window = ++this.steps % this.tune.sleepSteps === 0;
    this.loadNow.length = 0;
    this.settle();
    // integrate
    for (let k = 0, n = this.awakeCount; k < n; k++) {
      const i = awake[k];
      if (carried[i]) continue;
      vz[i] -= this.tune.gravity * this.tune.step;
      this.lastX[i] = x[i];
      this.lastY[i] = y[i];
      x[i] += vx[i] * this.tune.step;
      y[i] += vy[i] * this.tune.step;
      z[i] += vz[i] * this.tune.step;
      this.onFloor[i] = 0;
    }
    this.hash();
    this.pairs();
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
      if (window) {
        const dx = x[i] - this.sx[i],
          dy = y[i] - this.sy[i],
          dz = z[i] - this.sz[i];
        if (dx * dx + dy * dy + dz * dz < this.tune.sleepDrift * this.tune.sleepDrift) {
          asleep[i] = 1;
          vx[i] = vy[i] = vz[i] = 0;
          this.wx[i] = this.wy[i] = this.wz[i] = 0;
        }
        this.sx[i] = x[i];
        this.sy[i] = y[i];
        this.sz[i] = z[i];
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
      visit(o.bx - o.reach, o.by - o.reach, o.bx + o.reach, o.by + o.reach, (i) => this.pushOne(i, o));
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

  private pairs() {
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

  /** Whether the tile at a point is rock, or off the grid. */
  private rockAt(px: number, py: number): boolean {
    const tx = Math.floor((px - this.grid.originX) / this.grid.tile),
      ty = Math.floor((py - this.grid.originY) / this.grid.tile);
    return (
      tx < 0 || ty < 0 || tx >= this.grid.cols || ty >= this.grid.rows || this.solid[ty * this.grid.cols + tx] === 1
    );
  }

  /**
   * The rock: the tiles around a body, as boxes it cannot enter.
   *
   * A body whose middle has got into a rock tile — shoved there by a blade,
   * or squeezed there out of a heap — goes back out the way it came in, not
   * out whichever face is nearest: past the middle of a tile the nearest face
   * is the far one, and a coin pushed into a wall a tile thick would come out
   * the other side of it. So it goes back along the one way it moved in on,
   * or both, to where it was when the step began; and one buried in the rock
   * with no way back is put on the nearest open floor. Then it is pushed off
   * the faces round it by its radius, as anything touching the rock is.
   */
  private walls(i: number) {
    const { x, y, vx, vy, r, solid } = this;
    if (this.rockAt(x[i], y[i])) {
      const bx = this.lastX[i],
        by = this.lastY[i];
      if (!this.rockAt(bx, y[i])) {
        x[i] = bx;
        vx[i] = 0;
      } else if (!this.rockAt(x[i], by)) {
        y[i] = by;
        vy[i] = 0;
      } else if (!this.rockAt(bx, by)) {
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
        const rock =
          nx < 0 || ny < 0 || nx >= this.grid.cols || ny >= this.grid.rows || solid[ny * this.grid.cols + nx];
        if (!rock) continue;
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

  /** A body buried in the rock with no way back: onto the nearest open floor, in rings out from where it is, and stopped. */
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
          if (nx < 0 || ny < 0 || nx >= this.grid.cols || ny >= this.grid.rows || this.solid[ny * this.grid.cols + nx])
            continue;
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
    if (Math.abs(lx) > p.hx + rad || Math.abs(ly) > p.hy + rad || Math.abs(lz) > p.hz + rad) return;
    const qx = Math.max(-p.hx, Math.min(p.hx, lx)),
      qy = Math.max(-p.hy, Math.min(p.hy, ly)),
      qz = Math.max(-p.hz, Math.min(p.hz, lz));
    let nx = lx - qx,
      ny = ly - qy,
      nz = lz - qz;
    let d = Math.hypot(nx, ny, nz);
    if (d >= rad) return;
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
    // dragged along with the face a little, which is how a blade carries a load
    vx[i] += (pvx - vx[i]) * 0.15;
    vy[i] += (pvy - vy[i]) * 0.15;
    if (Math.abs(wnz) < 0.5) this.loadNow[p.owner] = (this.loadNow[p.owner] ?? 0) + 1;
  }

  /** The magnet: a pull that grows toward the point, on things low enough to be on the floor. */
  private pull(i: number) {
    const m = this.magnet;
    if (!m || this.z[i] > this.r[i] + 1.5) return;
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
    if (Math.abs(along) > b.half || Math.abs(across) > b.width / 2 || z[i] > r[i] + 0.6) return;
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
    if (z[i] < r[i]) {
      z[i] = r[i];
      if (vz[i] < 0) vz[i] = -vz[i] * this.tune.restitution;
      const drag = 1 / (1 + this.tune.floorDrag * step);
      vx[i] *= drag;
      vy[i] *= drag;
      this.onFloor[i] = 1;
      // a body near a rim tips in: the floor slopes to the hole a little
      if (near && nd < near.radius + 2.5) {
        vx[i] -= (ndx / nd) * 6 * step;
        vy[i] -= (ndy / nd) * 6 * step;
      }
    }
  }

  /** The cosmetic spin: flat when on the floor, tumbling when not. */
  private turn(i: number) {
    const q = this.q,
      o = i * 4;
    if (this.onFloor[i] && this.z[i] <= this.r[i] + 0.05) {
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
