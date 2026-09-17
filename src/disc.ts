/**
 * Discs: bodies with a thickness as well as a radius. A coin, not a ball.
 *
 * A ball has no turn worth keeping, which is what makes a world of them
 * cheap; but a heap of balls is not a heap of coins. A coin lies on a face,
 * leans with a rim on the floor and its face on another's edge, stands
 * wedged on its rim between two others, and tips off a support its middle
 * has passed. All of that is its turn, so a disc has a real one: an
 * orientation and a spin that contacts change, through where on it they
 * touch.
 *
 * It is solved by position, a step at a time. A disc is moved on by its
 * speed and turned by its spin; then every contact found pushes the two
 * things apart along its normal, each moved and turned by its share, which
 * is its inverse mass and its inverse inertia about where it was touched;
 * friction takes back the slide along the surface, up to what the push
 * allows; and at the end of the step speed and spin are read back from how
 * far each disc got. Nothing bounces: a coin landing on coins does not.
 *
 * Contacts are found from a disc's own shape. Against a plane, the floor or
 * a box's face, it is the rim's points nearest the plane, on both faces, so
 * a coin flat on it has four and one on edge has two; against a lip of the
 * floor, it is the lip against the disc's face or rim. Two discs lying in
 * the same plane meet as circles, side by side, or as faces, one on the
 * other, over the lens where they overlap. Two that are not are judged as a
 * pair: how far they overlap along each way they could be put apart, the
 * least of those walked downhill to the least there is, and then the points
 * of one's rim inside the other are put out that way, or the two touch at
 * the furthest point of one along it. Judged a point at a time instead,
 * coins sank through each other unseen, slept a tenth of a unit into each
 * other, and were pushed off the coins they leant on.
 *
 * This works on the world's own arrays, handed in, and knows nothing of the
 * grid, the rock, the sleeping or the hash: the world asks it about a pair,
 * a plane or a disc, and keeps the rest to itself.
 */

/** The world's arrays a disc is kept in, and the numbers it is stepped by. */
export interface DiscState {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  /** Orientation, four floats a body: x, y, z, w. */
  q: Float32Array;
  wx: Float32Array;
  wy: Float32Array;
  wz: Float32Array;
  r: Float32Array;
  /** Thickness, or nothing for a ball. */
  h: Float32Array;
  onFloor: Uint8Array;
  step: number;
  gravity: number;
  /** How two bodies hold against sliding on each other, and how the floor and a box's top hold a disc. */
  friction: number;
  grip: number;
}

/** How many points round a rim are tried against another disc that is not lying in its plane. */
const RIM = 12;
/** Two discs whose axes are within five degrees are taken to lie in one plane: their rims differ by less than the slop. */
const PARALLEL = 0.9962;
/** How far two things may sink into each other before they are pushed apart: it keeps a resting contact a contact. */
export const SLOP = 0.004;
/**
 * How much a rim pushes up or down as well as across, by how far the two
 * are out of level: a coin's rim is rounded, and under a shove the higher
 * of two rides up over the lower, which is how a bed buckles into a pile.
 */
const BEVEL = 0.5;
/** Two coins no further out of level than this are dead level, and which goes over which is settled by order. */
const LEVEL_BAND = 0.02;
/** How far out of level two coins dead level are taken to be, as a share of a thickness: what lets a level bed buckle. */
const LEVEL = 0.04;
/**
 * Two discs lying in one plane and closing faster than this came together
 * the way they are going, whichever way out is nearer: a fast coin crosses
 * half a thickness in a step. Slower than this the shallower way out is
 * taken, since what is at rest jitters, and a jitter read as an arrival
 * picks the deep way out and shoves what was resting clean across the other.
 */
const FAST = 3;
/** How many steps the way apart is walked downhill from the best of the four. */
const WALK = 10;
/** A contact found this much shallower than the two are in by has missed where they touch. */
const SHORT = 0.01;
/** Two discs whose axes are within this of square on to each other, as a cosine, have both rims of one about as deep in a face of the other. */
const SQUARE_ON = 0.3;
/** The most a disc may spin, in radians a second: a guard, not a figure anything reaches in play. */
const MAX_SPIN = 60;
/**
 * The most one contact pushes two things apart in a step, over and above
 * what they closed by in it. What is deep in something comes out of it over
 * a few steps, not in one: all at once is a kick, and a heap of kicks is an
 * explosion. What arrived fast this step is another matter, and is put out
 * by all it came in by, or it would be through the other side by the next.
 */
const MAX_PUSH = 0.05;
const MAX_CONTACTS = 96;
/** A push within this of the way a disc is backed, as a cosine, is met by its backing: forty-five degrees. */
const BACKED = 0.7;
/**
 * A push within thirty degrees of the way a disc is held, as the square of
 * the sine of that, is held squarely, and the disc gives no way at all. Put
 * right by sliding across what holds it, a disc goes further the squarer
 * the push: a hundredth of a unit into the coin ahead, a degree off the row
 * that backed it, and a coin in a pushed bed was slid half a unit sideways
 * and down through the floor, where the rock took it for buried and put it
 * out five units off. Thirty degrees off, it slides twice what it was in
 * by, and no more.
 */
const SQUARELY = 0.25;
/** How many discs may stand between a disc and the world and it still count as backed. */
const MAX_LINKS = 60;
/** How fast a face of the world must be coming at a disc to back it. */
const ADVANCING = 0.05;
/** The step a sleeping disc is said to have last lain on something: every step, for as long as it sleeps. */
const ASLEEP = 0x3fffffff;

export class Discs {
  /** Where each disc was, and how it was turned, when this step began. */
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly pq: Float32Array;
  /** Each disc's axis, the way its face looks, kept beside its orientation so it is worked out once a change. */
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly nz: Float32Array;
  /** Inverse mass, and inverse inertia about the axis and about a diameter; a ball has the first alone. */
  readonly im: Float32Array;
  readonly ia: Float32Array;
  readonly id: Float32Array;
  /** How far from its middle any of it can be. */
  readonly bound: Float32Array;
  /**
   * How fast each disc was going as its step began, and the fastest thing it
   * has touched in it. Being put out of something is not being thrown by it:
   * a disc ends its step no faster than it began or than what struck it,
   * however far it was moved, so a deep overlap comes apart without a pop.
   */
  private readonly was: Float32Array;
  private readonly spun: Float32Array;
  private readonly struck: Float32Array;
  /**
   * How far each disc has been pushed this step beyond what stopped it
   * coming on. Where it ends up keeps all of a push; how fast it is then
   * going keeps only the part that met its approach. Two things found deep
   * in each other are put apart, and neither leaves with the speed of being
   * put: in a heap, where something is always a little into something, that
   * speed never runs out, and the heap boils.
   */
  private readonly overX: Float32Array;
  private readonly overY: Float32Array;
  private readonly overZ: Float32Array;
  /** And how far it has been turned beyond that, about each of the world's axes. */
  private readonly overA: Float32Array;
  private readonly overB: Float32Array;
  private readonly overC: Float32Array;
  /** How far each disc is into anything this step, at the deepest: one still well into something is not at rest, however still. */
  readonly into: Float32Array;
  /** Whether each disc has touched anything this step: a wobble against something dies away far sooner than a spin in the air. */
  private readonly touched: Uint8Array;
  /** Whether each disc has landed flat on the world this step, and the way into what it landed on. */
  private readonly stopped: Uint8Array;
  private readonly stopX: Float32Array;
  private readonly stopY: Float32Array;
  private readonly stopZ: Float32Array;
  /**
   * What each disc last lay flat on: the way to it, the middle of where it
   * bore, from the disc's own middle, how far round that it bore, and the
   * step it was seen. A push that goes down through what a disc is lying on
   * cannot turn it, only press it; without this a coin lying on the floor
   * rocks under one landing on it, its top slides along with the newcomer
   * for that instant, and friction sees nothing to stop. A push outside the
   * support still turns it, which is a coin tipped by its overhang.
   */
  private readonly upX: Float32Array;
  private readonly upY: Float32Array;
  private readonly upZ: Float32Array;
  private readonly atX: Float32Array;
  private readonly atY: Float32Array;
  private readonly atZ: Float32Array;
  private readonly over: Float32Array;
  private readonly since: Int32Array;
  /**
   * What each disc is backed by, sideways: the way to it, the step it was
   * seen, and how many discs stand between this one and the world. A coin
   * against a box's face cannot give way toward the face, nor can the coin
   * against that one: pushed from behind, a row of coins moves as a row.
   * Without this every push is shared evenly at every contact, so a face's
   * push spreads down a row like heat instead of moving it like a rod, and
   * a bed buckles at the back while its front never stirs. It is the
   * sideways twin of what a disc lies on. The count of links lets a ring
   * of coins, each taking the next for its backing, run out instead of
   * holding itself up for ever.
   */
  private readonly backX: Float32Array;
  private readonly backY: Float32Array;
  private readonly backZ: Float32Array;
  private readonly backedAt: Int32Array;
  private readonly links: Uint8Array;
  /** The way a push was found to be held, by what a disc lies on or is backed by, for the first and the second of a contact. */
  private readonly holdA = new Float64Array(3);
  private readonly holdB = new Float64Array(3);
  private now = 0;

  /** The contacts of the pair or plane in hand. */
  private count = 0;
  private readonly first = new Int32Array(MAX_CONTACTS);
  /** The other body, or -1 for the world: the floor, or a box. */
  private readonly second = new Int32Array(MAX_CONTACTS);
  /** Where on each it is, in that body's own frame; for the world, where in the world, and how fast that spot is moving. */
  private readonly la = new Float64Array(MAX_CONTACTS * 3);
  private readonly lb = new Float64Array(MAX_CONTACTS * 3);
  private readonly vb = new Float64Array(MAX_CONTACTS * 3);
  /** The way from the first to the second. */
  private readonly cn = new Float64Array(MAX_CONTACTS * 3);
  /** Whether they all push the same way: a flat contact, which is put right as one thing. */
  private flat = false;
  /** The deepest of them, and the fastest they are closing, for the world to judge a sleeper by. */
  deepest = 0;
  closing = 0;
  /** The first of them: which body it is from, and the way from it to the other. */
  from = -1;
  wayX = 0;
  wayY = 0;
  wayZ = 0;

  private readonly cos = new Float64Array(RIM);
  private readonly sin = new Float64Array(RIM);
  /** Somewhere to put a vector without making one. */
  private readonly t = new Float64Array(12);

  constructor(
    private readonly s: DiscState,
    capacity: number,
  ) {
    const n = capacity;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.pq = new Float32Array(n * 4);
    this.nx = new Float32Array(n);
    this.ny = new Float32Array(n);
    this.nz = new Float32Array(n);
    this.im = new Float32Array(n);
    this.ia = new Float32Array(n);
    this.id = new Float32Array(n);
    this.bound = new Float32Array(n);
    this.was = new Float32Array(n);
    this.spun = new Float32Array(n);
    this.struck = new Float32Array(n);
    this.overX = new Float32Array(n);
    this.overY = new Float32Array(n);
    this.overZ = new Float32Array(n);
    this.overA = new Float32Array(n);
    this.overB = new Float32Array(n);
    this.overC = new Float32Array(n);
    this.touched = new Uint8Array(n);
    this.stopped = new Uint8Array(n);
    this.stopX = new Float32Array(n);
    this.stopY = new Float32Array(n);
    this.stopZ = new Float32Array(n);
    this.into = new Float32Array(n);
    this.upX = new Float32Array(n);
    this.upY = new Float32Array(n);
    this.upZ = new Float32Array(n);
    this.atX = new Float32Array(n);
    this.atY = new Float32Array(n);
    this.atZ = new Float32Array(n);
    this.over = new Float32Array(n);
    this.since = new Int32Array(n).fill(-10);
    this.backX = new Float32Array(n);
    this.backY = new Float32Array(n);
    this.backZ = new Float32Array(n);
    this.backedAt = new Int32Array(n).fill(-10);
    this.links = new Uint8Array(n);
    for (let k = 0; k < RIM; k++) {
      this.cos[k] = Math.cos((k / RIM) * Math.PI * 2);
      this.sin[k] = Math.sin((k / RIM) * Math.PI * 2);
    }
  }

  /** A step of the world begun: what a disc was lying on a step ago still counts, and no longer. */
  tick() {
    this.now++;
  }

  /** Whether a push on a disc at `(rx, ry, rz)` from its middle, along `(dx, dy, dz)`, goes down through what it is lying on. */
  private borne(i: number, rx: number, ry: number, rz: number, dx: number, dy: number, dz: number): boolean {
    if (this.since[i] < this.now - 1) return false;
    const ux = this.upX[i],
      uy = this.upY[i],
      uz = this.upZ[i];
    if (dx * ux + dy * uy + dz * uz < 0.5) return false;
    const ex = rx - this.atX[i],
      ey = ry - this.atY[i],
      ez = rz - this.atZ[i];
    const along = ex * ux + ey * uy + ez * uz;
    const px = ex - along * ux,
      py = ey - along * uy,
      pz = ez - along * uz;
    return px * px + py * py + pz * pz < this.over[i] * this.over[i];
  }

  /**
   * Whether a push on a disc at `(rx, ry, rz)` from its middle along
   * `(dx, dy, dz)` is held: borne by what it lies on, or met by what backs
   * it. The way it is held is put in `hold`, and a disc so held gives way
   * only across that, and is not turned.
   */
  private held(
    i: number,
    rx: number,
    ry: number,
    rz: number,
    dx: number,
    dy: number,
    dz: number,
    hold: Float64Array,
  ): boolean {
    if (this.borne(i, rx, ry, rz, dx, dy, dz)) {
      hold[0] = this.upX[i];
      hold[1] = this.upY[i];
      hold[2] = this.upZ[i];
      return true;
    }
    if (this.backedAt[i] < this.now - 1) return false;
    if (dx * this.backX[i] + dy * this.backY[i] + dz * this.backZ[i] < BACKED) return false;
    hold[0] = this.backX[i];
    hold[1] = this.backY[i];
    hold[2] = this.backZ[i];
    return true;
  }

  /** A disc noted as backed, the way `(ux, uy, uz)`, with so many discs between it and the world: the fewest links seen this step are kept. */
  private back(i: number, ux: number, uy: number, uz: number, links: number) {
    if (links > MAX_LINKS) return;
    if (this.backedAt[i] === this.now && this.links[i] <= links) return;
    this.backX[i] = ux;
    this.backY[i] = uy;
    this.backZ[i] = uz;
    this.backedAt[i] = this.now;
    this.links[i] = links;
  }

  /** Whether a disc is lying flat on something firm: the world, or a sleeper, or another that is. */
  private firm(i: number): boolean {
    return this.since[i] >= this.now - 1;
  }

  /**
   * A disc moved by something that is not one of the discs' own contacts,
   * the rock, after the fact: what of the move went beyond stopping the disc
   * coming on is noted, as it is for any push, so being put out of a wall
   * is not being thrown from it.
   */
  put(i: number, dx: number, dy: number, dz: number) {
    const { x, y, z } = this.s;
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (far < 1e-9) return;
    const nx = dx / far,
      ny = dy / far,
      nz = dz / far;
    // how far it had come on against the push, before it: where it was before the push, less where it began
    const came = -(
      (x[i] - dx - this.px[i] - this.overX[i]) * nx +
      (y[i] - dy - this.py[i] - this.overY[i]) * ny +
      (z[i] - dz - this.pz[i] - this.overZ[i]) * nz
    );
    const rest = Math.max(0, far - Math.max(0, came));
    this.overX[i] += nx * rest;
    this.overY[i] += ny * rest;
    this.overZ[i] += nz * rest;
    this.touched[i] = 1;
  }

  /** A disc gone to sleep: what it was lying on it goes on lying on, however long it sleeps. */
  doze(i: number) {
    if (this.since[i] >= this.now - 1) this.since[i] = ASLEEP;
    this.rest(i);
  }

  /** A disc woken: it is lying on what it slept on, as of now, and its step starts from here. */
  rouse(i: number) {
    if (this.since[i] === ASLEEP) this.since[i] = this.now;
    this.rest(i);
  }

  /** A body new in the world: what it weighs and how it resists a turn, from its size; a ball resists none, having none. */
  born(i: number) {
    const { r, h } = this.s;
    const rad = r[i],
      thick = h[i];
    if (thick > 0) {
      const m = rad * rad * thick;
      this.im[i] = 1 / m;
      this.ia[i] = 1 / ((m * rad * rad) / 2);
      this.id[i] = 1 / ((m * (3 * rad * rad + thick * thick)) / 12);
      this.bound[i] = Math.sqrt(rad * rad + (thick / 2) * (thick / 2));
    } else {
      this.im[i] = 1 / ((4 / 3) * rad * rad * rad);
      this.ia[i] = 0;
      this.id[i] = 0;
      this.bound[i] = rad;
    }
    this.since[i] = -10;
    this.backedAt[i] = -10;
    this.rest(i);
  }

  /** A disc taken to be where it is and as it is turned, with no step behind it: new, woken, or put somewhere. */
  rest(i: number) {
    const { x, y, z, q } = this.s;
    this.px[i] = x[i];
    this.py[i] = y[i];
    this.pz[i] = z[i];
    const o = i * 4;
    this.pq[o] = q[o];
    this.pq[o + 1] = q[o + 1];
    this.pq[o + 2] = q[o + 2];
    this.pq[o + 3] = q[o + 3];
    this.was[i] = 0;
    this.spun[i] = 0;
    this.struck[i] = 0;
    this.overX[i] = this.overY[i] = this.overZ[i] = 0;
    this.overA[i] = this.overB[i] = this.overC[i] = 0;
    this.touched[i] = 0;
    this.stopped[i] = 0;
    this.into[i] = 0;
    this.axis(i);
  }

  /** A disc's axis, from its orientation: where its own z looks. */
  private axis(i: number) {
    const q = this.s.q,
      o = i * 4;
    const qx = q[o],
      qy = q[o + 1],
      qz = q[o + 2],
      qw = q[o + 3];
    this.nx[i] = 2 * (qx * qz + qw * qy);
    this.ny[i] = 2 * (qy * qz - qw * qx);
    this.nz[i] = 1 - 2 * (qx * qx + qy * qy);
  }

  /** The start of a disc's step: where it was is kept, gravity speeds it, and it moves on and turns by its spin. */
  begin(i: number) {
    const { x, y, z, vx, vy, vz, wx, wy, wz, step, gravity } = this.s;
    this.rest(i);
    vz[i] -= gravity * step;
    this.was[i] = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    this.spun[i] = Math.sqrt(wx[i] * wx[i] + wy[i] * wy[i] + wz[i] * wz[i]);
    x[i] += vx[i] * step;
    y[i] += vy[i] * step;
    z[i] += vz[i] * step;
    this.turn(i, wx[i] * step, wy[i] * step, wz[i] * step);
  }

  /** A disc turned by a small turn about the world's axes. */
  private turn(i: number, ax: number, ay: number, az: number) {
    if (ax === 0 && ay === 0 && az === 0) return;
    const q = this.s.q,
      o = i * 4;
    const qx = q[o],
      qy = q[o + 1],
      qz = q[o + 2],
      qw = q[o + 3];
    let nx = qx + 0.5 * (ax * qw + ay * qz - az * qy),
      ny = qy + 0.5 * (ay * qw + az * qx - ax * qz),
      nz = qz + 0.5 * (az * qw + ax * qy - ay * qx),
      nw = qw + 0.5 * (-ax * qx - ay * qy - az * qz);
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    nw /= l;
    q[o] = nx;
    q[o + 1] = ny;
    q[o + 2] = nz;
    q[o + 3] = nw;
    this.axis(i);
  }

  /** The end of a disc's step: its speed and spin are how far it got and how far it turned, a little of each lost. */
  finish(i: number) {
    const { x, y, z, vx, vy, vz, wx, wy, wz, q, step } = this.s;
    const o = i * 4;
    // how far it got, less what it was pushed beyond stopping: put apart is not sent apart
    vx[i] = (x[i] - this.px[i] - this.overX[i]) / step;
    vy[i] = (y[i] - this.py[i] - this.overY[i]) / step;
    vz[i] = (z[i] - this.pz[i] - this.overZ[i]) / step;
    // Landed flat on the world, it is going into it no longer. How far it got this step includes its fall to the
    // floor, and read back as its speed that fall is made again the next step: a coin dropped a tier's height
    // landed, and the step after was a fifth of a unit under the floor, its middle below it, where the rock took
    // it for buried in the step and put it out a third of a unit to the side.
    if (this.stopped[i]) {
      const into = vx[i] * this.stopX[i] + vy[i] * this.stopY[i] + vz[i] * this.stopZ[i];
      if (into > 0) {
        vx[i] -= into * this.stopX[i];
        vy[i] -= into * this.stopY[i];
        vz[i] -= into * this.stopZ[i];
      }
    }
    // No faster than it was, or than what struck it: moved is not thrown. Not a hair faster, either: a hair a
    // step is a ratchet, and two coins jittering against each other climb it to a boil.
    const most = Math.max(this.was[i], this.struck[i]),
      speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    if (speed > most) {
      const k = speed > 1e-9 ? most / speed : 0;
      vx[i] *= k;
      vy[i] *= k;
      vz[i] *= k;
    }
    // the turn from how it was to how it is: q times the old one's conjugate, whose vector part is half the angle
    const ax = -this.pq[o],
      ay = -this.pq[o + 1],
      az = -this.pq[o + 2],
      aw = this.pq[o + 3];
    const bx = q[o],
      by = q[o + 1],
      bz = q[o + 2],
      bw = q[o + 3];
    let dx = bw * ax + bx * aw + by * az - bz * ay,
      dy = bw * ay + by * aw + bz * ax - bx * az,
      dz = bw * az + bz * aw + bx * ay - by * ax;
    const dw = bw * aw - bx * ax - by * ay - bz * az;
    if (dw < 0) {
      dx = -dx;
      dy = -dy;
      dz = -dz;
    }
    // how far it turned, less what it was turned beyond stopping
    let sx = (2 * dx - this.overA[i]) / step,
      sy = (2 * dy - this.overB[i]) / step,
      sz = (2 * dz - this.overC[i]) / step;
    // and spinning no faster than it was, or than its speed or what struck it would roll it
    const spin = Math.sqrt(sx * sx + sy * sy + sz * sz),
      mostSpin = Math.min(MAX_SPIN, Math.max(this.spun[i], (2 * most) / this.s.r[i]));
    if (spin > mostSpin) {
      const k = spin > 1e-9 ? mostSpin / spin : 0;
      sx *= k;
      sy *= k;
      sz *= k;
    }
    // a wobble dies away: slowly in the air, and soon against anything, as a coin's ring on a table does
    const keep = this.touched[i] ? 0.96 : 0.995;
    wx[i] = sx * keep;
    wy[i] = sy * keep;
    wz[i] = sz * keep;
  }

  // ---- what touches what ----

  /** Forget the contacts in hand. */
  private clear() {
    this.count = 0;
    this.flat = false;
    this.deepest = 0;
    this.closing = 0;
  }

  /** A vector turned by a body's orientation, or back by it, into `t` at `at`. */
  private rotate(q: Float32Array, o: number, vx: number, vy: number, vz: number, back: boolean, at: number) {
    const s = back ? -1 : 1;
    const qx = q[o] * s,
      qy = q[o + 1] * s,
      qz = q[o + 2] * s,
      qw = q[o + 3];
    const tx = 2 * (qy * vz - qz * vy),
      ty = 2 * (qz * vx - qx * vz),
      tz = 2 * (qx * vy - qy * vx);
    this.t[at] = vx + qw * tx + (qy * tz - qz * ty);
    this.t[at + 1] = vy + qw * ty + (qz * tx - qx * tz);
    this.t[at + 2] = vz + qw * tz + (qx * ty - qy * tx);
  }

  /**
   * A contact noted: `a` on the first body and `b` on the second, both in
   * the world, `n` the way from the first to the second, with the first
   * that far into the second along it. The second may be the world, moving
   * at `v` there.
   */
  private note(
    first: number,
    second: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    nx: number,
    ny: number,
    nz: number,
    vx = 0,
    vy = 0,
    vz = 0,
  ) {
    if (this.count >= MAX_CONTACTS) return;
    const { x, y, z, q } = this.s;
    const k = this.count++,
      o = k * 3;
    this.first[k] = first;
    this.second[k] = second;
    this.rotate(q, first * 4, ax - x[first], ay - y[first], az - z[first], true, 0);
    this.la[o] = this.t[0];
    this.la[o + 1] = this.t[1];
    this.la[o + 2] = this.t[2];
    if (second >= 0 && this.s.h[second] > 0) {
      this.rotate(q, second * 4, bx - x[second], by - y[second], bz - z[second], true, 0);
      this.lb[o] = this.t[0];
      this.lb[o + 1] = this.t[1];
      this.lb[o + 2] = this.t[2];
    } else if (second >= 0) {
      // a ball has no turn: the spot is kept from its middle, and it moves as the ball does
      this.lb[o] = bx - x[second];
      this.lb[o + 1] = by - y[second];
      this.lb[o + 2] = bz - z[second];
    } else {
      this.lb[o] = bx;
      this.lb[o + 1] = by;
      this.lb[o + 2] = bz;
    }
    this.vb[o] = vx;
    this.vb[o + 1] = vy;
    this.vb[o + 2] = vz;
    this.cn[o] = nx;
    this.cn[o + 1] = ny;
    this.cn[o + 2] = nz;
    const depth = (ax - bx) * nx + (ay - by) * ny + (az - bz) * nz;
    if (depth > this.deepest) this.deepest = depth;
  }

  /**
   * What two bodies touch at, one of them a disc at least: noted, to be
   * solved. How many there are; `deepest` and `closing` say how hard.
   */
  pair(i: number, j: number): number {
    this.clear();
    const { x, y, z, vx, vy, vz, h } = this.s;
    const dx = x[j] - x[i],
      dy = y[j] - y[i],
      dz = z[j] - z[i];
    const reach = this.bound[i] + this.bound[j];
    if (dx * dx + dy * dy + dz * dz >= reach * reach) return 0;
    if (h[i] > 0 && h[j] > 0) {
      const dot = this.nx[i] * this.nx[j] + this.ny[i] * this.ny[j] + this.nz[i] * this.nz[j];
      if (dot > PARALLEL || dot < -PARALLEL) this.inPlane(i, j, dx, dy, dz, dot);
      else this.askew(i, j, dx, dy, dz, dot);
    } else if (h[i] > 0) this.ball(i, j);
    else this.ball(j, i);
    if (this.count) {
      // how fast the two are closing, middle to middle along the first contact's way: enough to tell a knock from a lean
      const a = this.first[0] === i ? 1 : -1;
      this.closing = a * ((vx[j] - vx[i]) * this.cn[0] + (vy[j] - vy[i]) * this.cn[1] + (vz[j] - vz[i]) * this.cn[2]);
      this.from = this.first[0];
      this.wayX = this.cn[0];
      this.wayY = this.cn[1];
      this.wayZ = this.cn[2];
    }
    return this.count;
  }

  /** Two discs lying in one plane, near enough: side by side they meet as circles, one on the other as faces. */
  private inPlane(i: number, j: number, dx: number, dy: number, dz: number, dot: number) {
    const { x, y, z, vx, vy, vz, r, h } = this.s;
    const flip = dot >= 0 ? 1 : -1;
    // the axis between the two, looking the way the first's does
    let mx = this.nx[i] + flip * this.nx[j],
      my = this.ny[i] + flip * this.ny[j],
      mz = this.nz[i] + flip * this.nz[j];
    const ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
    mx /= ml;
    my /= ml;
    mz /= ml;
    const along = dx * mx + dy * my + dz * mz;
    let rx = dx - along * mx,
      ry = dy - along * my,
      rz = dz - along * mz;
    const across = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const thick = (h[i] + h[j]) / 2,
      wide = r[i] + r[j];
    // Which side of the first the second lies: the side it is on, unless the two are closing fast along the
    // axis, and then the side it came from. A coin falling a tier's height crosses most of a thickness in a
    // step, and one that has passed the other's middle would else be put out of the far side: through it.
    const axial = (vx[j] - vx[i]) * mx + (vy[j] - vy[i]) * my + (vz[j] - vz[i]) * mz;
    // only if it is no further past the middle than that speed could have carried it in a step or two
    const crossed = Math.abs(along) <= Math.abs(axial) * this.s.step * 2;
    // Dead level, neither is over the other, and the hair they are out by changes sign with every jitter: pushed
    // one way this step and the other the next, two coins in one place stay there. So the later of the two goes
    // over, the way up in the world if the axis has any, and that is the same whichever of them is asked.
    const level = (j > i ? 1 : -1) * (mz > 0.05 ? 1 : mz < -0.05 ? -1 : mx >= 0 ? 1 : -1);
    const lying = along > LEVEL_BAND ? 1 : along < -LEVEL_BAND ? -1 : level;
    const up = crossed && axial > FAST ? -1 : crossed && axial < -FAST ? 1 : lying;
    const sinkFace = thick - along * up,
      sinkSide = wide - across;
    if (sinkFace <= 0 || sinkSide <= 0) return;
    if (across > 1e-6) {
      rx /= across;
      ry /= across;
      rz /= across;
    } else {
      // dead centre: any way across will do, so long as it is across
      const ax = Math.abs(mx) < 0.9 ? 1 : 0,
        ay = ax ? 0 : 1;
      rx = ay * mz;
      ry = -ax * mz;
      rz = ax * my - ay * mx;
      const l = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      rx /= l;
      ry /= l;
      rz /= l;
    }
    // which way they came together: the way they are closing faster for how far in they are, or at rest the shallower
    const closeFace = -up * axial,
      closeSide = -((vx[j] - vx[i]) * rx + (vy[j] - vy[i]) * ry + (vz[j] - vz[i]) * rz);
    // The shallower way out, unless they are closing fast one way and are no deeper that way than that speed
    // could have brought them just now: then that is the way they came together. Deeper than that, the speed is
    // a jitter in a heap and not an arrival, and the long way out it points to is a shove clean through.
    const fresh = this.s.step * 2;
    const face =
      closeFace > FAST && sinkFace <= closeFace * fresh + 0.02
        ? true
        : closeSide > FAST && sinkSide <= closeSide * fresh + 0.02
          ? false
          : sinkFace <= sinkSide;
    if (!face) {
      // rim to rim: across, and a little up or down by how far out of level they are, as rounded rims ride. Dead
      // level is a balance no two real coins keep, so the later of the two is taken to be a hair the higher.
      const ride = BEVEL * (along / thick + (j > i ? LEVEL : -LEVEL));
      let nx = rx + ride * mx,
        ny = ry + ride * my,
        nz = rz + ride * mz;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const lift = Math.max(-h[i] / 2, Math.min(h[i] / 2, along / 2));
      const ax = x[i] + r[i] * rx + lift * mx,
        ay = y[i] + r[i] * ry + lift * my,
        az = z[i] + r[i] * rz + lift * mz;
      this.note(i, j, ax, ay, az, ax - nx * sinkSide, ay - ny * sinkSide, az - nz * sinkSide, nx, ny, nz);
      return;
    }
    // face to face, over the lens the two circles share: its ends along the way across, and its sides
    this.flat = true;
    const x0 = Math.max(-r[i], across - r[j]),
      x1 = Math.min(r[i], across + r[j]);
    const mid = (x0 + x1) / 2,
      half = ((x1 - x0) / 2) * 0.9;
    const side =
      Math.min(
        Math.sqrt(Math.max(0, r[i] * r[i] - mid * mid)),
        Math.sqrt(Math.max(0, r[j] * r[j] - (mid - across) ** 2)),
      ) * 0.9;
    // the way round the axis from the way across
    const sx = my * rz - mz * ry,
      sy = mz * rx - mx * rz,
      sz = mx * ry - my * rx;
    const ni = this.nx[i] * mx + this.ny[i] * my + this.nz[i] * mz,
      nj = this.nx[j] * mx + this.ny[j] * my + this.nz[j] * mz;
    for (let k = 0; k < 4; k++) {
      const u = k === 0 ? mid - half : k === 1 ? mid + half : mid,
        w = k === 2 ? side : k === 3 ? -side : 0;
      const ox = u * rx + w * sx,
        oy = u * ry + w * sy,
        oz = u * rz + w * sz;
      // up the axis from that spot to the first's face toward the second, and to the second's toward the first
      const ta = ((up * h[i]) / 2 - (ox * this.nx[i] + oy * this.ny[i] + oz * this.nz[i])) / ni;
      const ex = ox - dx,
        ey = oy - dy,
        ez = oz - dz;
      const tb = ((-up * flip * h[j]) / 2 - (ex * this.nx[j] + ey * this.ny[j] + ez * this.nz[j])) / nj;
      if ((ta - tb) * up <= 0) continue;
      this.note(
        i,
        j,
        x[i] + ox + ta * mx,
        y[i] + oy + ta * my,
        z[i] + oz + ta * mz,
        x[i] + ox + tb * mx,
        y[i] + oy + tb * my,
        z[i] + oz + tb * mz,
        up * mx,
        up * my,
        up * mz,
      );
    }
  }

  /**
   * Two discs not lying in one plane. There are four ways they can be put
   * apart: out by a face of either, along its axis, or out by the side of
   * either, across it. How far the two overlap along each is how far each
   * reaches along it, less how far apart their middles are along it; if they
   * do not overlap along any one, they do not touch, and the way they are
   * put apart is the one they overlap least along. Then the contacts are
   * the points of one's rim inside the other, every one put out that way.
   *
   * It is settled for the pair, not a point at a time, because a point on a
   * rim has the coin behind it. Judged alone, a point just inside another's
   * side is a hair from out that way, however much of the coin lies over the
   * other's face: so a coin lying all but squarely on another sank through
   * it a hair at a time with nothing pushing back. One just under a face is
   * a hair from out by it, though the coin it is the rim of lies beside the
   * other and not on it: so two side by side slept well into each other.
   * And a coin leaning on another's rim has its own lower rim dip into the
   * other's face, a point that is no part of what holds it up, and put out
   * by the side it was pushed off its perch.
   */
  private askew(i: number, j: number, dx: number, dy: number, dz: number, dot: number) {
    const { r, h } = this.s;
    const nix = this.nx[i],
      niy = this.ny[i],
      niz = this.nz[i];
    const njx = this.nx[j],
      njy = this.ny[j],
      njz = this.nz[j];
    const ti = h[i] / 2,
      tj = h[j] / 2;
    // how far either reaches along the other's axis: its rim's share, and its thickness's
    const sin = Math.sqrt(Math.max(0, 1 - dot * dot)),
      cos = Math.abs(dot);
    const ai = dx * nix + dy * niy + dz * niz,
      aj = dx * njx + dy * njy + dz * njz;
    const faceI = ti + r[j] * sin + tj * cos - Math.abs(ai);
    if (faceI <= 0) return;
    const faceJ = tj + r[i] * sin + ti * cos - Math.abs(aj);
    if (faceJ <= 0) return;
    // across the first's axis toward the second, and how far the second reaches back along that
    let sideI = Infinity,
      sideJ = Infinity;
    let ex = dx - ai * nix,
      ey = dy - ai * niy,
      ez = dz - ai * niz;
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (el > 1e-6) {
      ex /= el;
      ey /= el;
      ez /= el;
      const turned = njx * ex + njy * ey + njz * ez;
      sideI = r[i] + r[j] * Math.sqrt(Math.max(0, 1 - turned * turned)) + tj * Math.abs(turned) - el;
      if (sideI <= 0) return;
    }
    let fx = dx - aj * njx,
      fy = dy - aj * njy,
      fz = dz - aj * njz;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (fl > 1e-6) {
      fx /= fl;
      fy /= fl;
      fz /= fl;
      const turned = nix * fx + niy * fy + niz * fz;
      sideJ = r[j] + r[i] * Math.sqrt(Math.max(0, 1 - turned * turned)) + ti * Math.abs(turned) - fl;
      if (sideJ <= 0) return;
    }
    // The least of the four, and the way apart it is along, from the first to the second.
    const least = Math.min(faceI, faceJ, sideI, sideJ);
    let sx: number, sy: number, sz: number;
    if (least === faceJ) {
      const k = aj >= 0 ? 1 : -1;
      sx = k * njx;
      sy = k * njy;
      sz = k * njz;
    } else if (least === faceI) {
      const k = ai >= 0 ? 1 : -1;
      sx = k * nix;
      sy = k * niy;
      sz = k * niz;
    } else if (least === sideJ) {
      sx = fx;
      sy = fy;
      sz = fz;
    } else {
      sx = ex;
      sy = ey;
      sz = ez;
    }
    // Those four are the ways two coins mostly meet, and not all of them: rim against rim, two leaning coins in
    // a heap meet along none of the four, and overlap along every one while touching nowhere, or a hair. So the
    // way apart is walked downhill from the best of the four to the least overlap near it, which is how far in
    // the two really are; and if that is nothing, they are apart.
    const over = this.nearest(i, j, dx, dy, dz, sx, sy, sz);
    if (over <= 0) return;
    if (least === faceJ) this.rim(i, j, dx, dy, dz, true);
    else if (least === faceI) this.rim(j, i, -dx, -dy, -dz, true);
    else if (least === sideJ) this.rim(i, j, dx, dy, dz, false);
    else this.rim(j, i, -dx, -dy, -dz, false);
    // The rims' points find a rim in a face or a side, and miss what is neither. Where they found nothing, or a
    // good deal less than the two are in by, the two touch at the furthest point of one along the way apart:
    // without it one pair in twenty that overlapped was not seen to, and sank in until a point of a rim happened
    // inside, a tenth of a unit deep and more.
    if (this.deepest < over - SHORT) this.furthest(i, j, over);
  }

  /**
   * The least two discs overlap along any way apart near `(sx, sy, sz)`,
   * from the first to the second: walked downhill from there, a step at a
   * time, each step taken only if it overlaps less. How far two things
   * overlap along a way is how far the first reaches along it and the second
   * back along it, less how far apart their middles are along it; and which
   * way that falls fastest is across the line between the two furthest
   * points. The way found is left in `t` at 3, and nothing or less is apart.
   */
  private nearest(
    i: number,
    j: number,
    dx: number,
    dy: number,
    dz: number,
    sx: number,
    sy: number,
    sz: number,
  ): number {
    const t = this.t;
    let ux = sx,
      uy = sy,
      uz = sz;
    let stride = 1 / (this.s.r[i] + this.s.r[j]);
    let over = this.along(i, j, dx, dy, dz, ux, uy, uz);
    for (let n = 0; n < WALK && over > 0; n++) {
      // the line from the second's furthest point back to the first's, less what of it runs along the way apart
      const wx = t[0],
        wy = t[1],
        wz = t[2];
      const wu = wx * ux + wy * uy + wz * uz;
      let vx = ux - stride * (wx - wu * ux),
        vy = uy - stride * (wy - wu * uy),
        vz = uz - stride * (wz - wu * uz);
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      vx /= vl;
      vy /= vl;
      vz /= vl;
      const tried = this.along(i, j, dx, dy, dz, vx, vy, vz);
      if (tried < over - 1e-5) {
        over = tried;
        ux = vx;
        uy = vy;
        uz = vz;
      } else {
        // no better: the line is put back as it was for the way kept, and the next step is shorter
        t[0] = wx;
        t[1] = wy;
        t[2] = wz;
        stride /= 2;
      }
    }
    t[3] = ux;
    t[4] = uy;
    t[5] = uz;
    return over;
  }

  /**
   * How far two discs overlap along `(ux, uy, uz)`, from the first to the
   * second. The line from the second's furthest point back along it to the
   * first's furthest point along it is left in `t` at 0.
   */
  private along(i: number, j: number, dx: number, dy: number, dz: number, ux: number, uy: number, uz: number): number {
    const t = this.t;
    this.reach(i, ux, uy, uz, 6);
    this.reach(j, -ux, -uy, -uz, 9);
    t[0] = t[6] - t[9] - dx;
    t[1] = t[7] - t[10] - dy;
    t[2] = t[8] - t[11] - dz;
    return t[0] * ux + t[1] * uy + t[2] * uz;
  }

  /** The furthest point of a disc along `(ux, uy, uz)`, from its middle, into `t` at `at`: on its rim that way across, and on the face that looks that way. */
  private reach(i: number, ux: number, uy: number, uz: number, at: number) {
    const { r, h } = this.s;
    const t = this.t;
    const nx = this.nx[i],
      ny = this.ny[i],
      nz = this.nz[i];
    const a = ux * nx + uy * ny + uz * nz;
    const px = ux - a * nx,
      py = uy - a * ny,
      pz = uz - a * nz;
    const pl = Math.sqrt(px * px + py * py + pz * pz);
    // square on to a face, every point of it is as far, and its middle is as good as any; the sum of rounding errors is not
    const k = pl > 1e-4 ? r[i] / pl : 0;
    const thick = a > 1e-4 ? h[i] / 2 : a < -1e-4 ? -h[i] / 2 : 0;
    t[at] = px * k + thick * nx;
    t[at + 1] = py * k + thick * ny;
    t[at + 2] = pz * k + thick * nz;
  }

  /**
   * Two discs touching at the furthest point of one along the way apart
   * left by `nearest`, `over` deep: the one more edge on to that way, whose
   * furthest point is a point of its rim, and not any point of a face.
   */
  private furthest(i: number, j: number, over: number) {
    const { x, y, z } = this.s;
    const t = this.t;
    const ux = t[3],
      uy = t[4],
      uz = t[5];
    const ai = Math.abs(ux * this.nx[i] + uy * this.ny[i] + uz * this.nz[i]),
      aj = Math.abs(ux * this.nx[j] + uy * this.ny[j] + uz * this.nz[j]);
    if (ai <= aj) {
      this.reach(i, ux, uy, uz, 6);
      const px = x[i] + t[6],
        py = y[i] + t[7],
        pz = z[i] + t[8];
      this.note(i, j, px, py, pz, px - ux * over, py - uy * over, pz - uz * over, ux, uy, uz);
    } else {
      this.reach(j, -ux, -uy, -uz, 6);
      const px = x[j] + t[6],
        py = y[j] + t[7],
        pz = z[j] + t[8];
      this.note(j, i, px, py, pz, px + ux * over, py + uy * over, pz + uz * over, -ux, -uy, -uz);
    }
  }

  /**
   * The rim of one disc against the cylinder of another, a point at a time,
   * each one inside put out by a face of the second or by its side, as the
   * pair was judged: a round of points, and the two of the rim that matter
   * most, which a round can straddle. A leaning coin's raised rim is into
   * another's face over a short arc, and with the points either side of it
   * just outside the two were seen to touch one step in six, and slept a
   * tenth of a unit into each other in between.
   */
  private rim(a: number, b: number, dx: number, dy: number, dz: number, face: boolean) {
    const { r, h } = this.s;
    const nax = this.nx[a],
      nay = this.ny[a],
      naz = this.nz[a];
    const nbx = this.nx[b],
      nby = this.ny[b],
      nbz = this.nz[b];
    // two ways across the first's plane
    let ux = -nay,
      uy = nax;
    const uz = 0;
    const ul = Math.sqrt(ux * ux + uy * uy);
    if (ul < 1e-6) {
      ux = 1;
      uy = 0;
    } else {
      ux /= ul;
      uy /= ul;
    }
    const wxx = nay * uz - naz * uy,
      wyy = naz * ux - nax * uz,
      wzz = nax * uy - nay * ux;
    // the face of the second the first's middle is on the side of: a rim dipped past the second's middle is still
    // the rim of a coin lying on it
    const dot = nax * nbx + nay * nby + naz * nbz;
    const out = dx * nbx + dy * nby + dz * nbz <= 0 ? 1 : -1;
    // Which rim of the first: out by a face, the one that is deeper in by it, which is the rim of the first's face
    // that looks the other way; the rim of the face toward the second's middle is as often the shallower, and with
    // only that one tried a leaning coin sank a tenth of a unit into the one it leant on, unseen. Both, if the
    // first is near enough square on that they are about as deep as each other, as a coin standing on another's
    // face is; and both out by the side, where either may be the nearer the second's axis.
    const deeper = out * dot > 0 ? -1 : 1;
    const both = !face || Math.abs(dot) < SQUARE_ON;
    // the way across the first's plane that goes deepest into that face
    let gx = -out * (nbx - dot * nax),
      gy = -out * (nby - dot * nay),
      gz = -out * (nbz - dot * naz);
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
    // and the way across it toward the second's middle
    const toward = dx * nax + dy * nay + dz * naz;
    let cx = dx - toward * nax,
      cy = dy - toward * nay,
      cz = dz - toward * naz;
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (gl > 1e-3) {
      gx *= r[a] / gl;
      gy *= r[a] / gl;
      gz *= r[a] / gl;
    }
    if (cl > 1e-3) {
      cx *= r[a] / cl;
      cy *= r[a] / cl;
      cz *= r[a] / cl;
    }
    for (let pass = 0; pass < (both ? 2 : 1); pass++) {
      const faceA = (pass ? -deeper : deeper) * (h[a] / 2);
      const lx = faceA * nax,
        ly = faceA * nay,
        lz = faceA * naz;
      for (let k = 0; k < RIM; k++)
        this.probe(
          a,
          b,
          dx,
          dy,
          dz,
          r[a] * (this.cos[k] * ux + this.sin[k] * wxx) + lx,
          r[a] * (this.cos[k] * uy + this.sin[k] * wyy) + ly,
          r[a] * (this.cos[k] * uz + this.sin[k] * wzz) + lz,
          out,
          face,
        );
      if (gl > 1e-3) this.probe(a, b, dx, dy, dz, gx + lx, gy + ly, gz + lz, out, face);
      if (cl > 1e-3) this.probe(a, b, dx, dy, dz, cx + lx, cy + ly, cz + lz, out, face);
    }
    // Side by side and level, the rims of the first are level with the second's faces, in or out by a hair: the
    // middle of its edge is well within them.
    if (!face && cl > 1e-3) this.probe(a, b, dx, dy, dz, cx, cy, cz, out, face);
  }

  /**
   * One point of the first, `(ox, oy, oz)` from its middle, against the
   * second's cylinder: if it is inside, a contact, out by the second's face
   * `out` or by its side.
   */
  private probe(
    a: number,
    b: number,
    dx: number,
    dy: number,
    dz: number,
    ox: number,
    oy: number,
    oz: number,
    out: number,
    face: boolean,
  ) {
    const { x, y, z, r, h } = this.s;
    const nbx = this.nx[b],
      nby = this.ny[b],
      nbz = this.nz[b];
    const halfB = h[b] / 2;
    // the point, from the second's middle
    const ex = ox - dx,
      ey = oy - dy,
      ez = oz - dz;
    const along = ex * nbx + ey * nby + ez * nbz;
    if (along >= halfB || along <= -halfB) return;
    let rx = ex - along * nbx,
      ry = ey - along * nby,
      rz = ez - along * nbz;
    const across2 = rx * rx + ry * ry + rz * rz;
    if (across2 >= r[b] * r[b]) return;
    const px = x[a] + ox,
      py = y[a] + oy,
      pz = z[a] + oz;
    if (face) {
      const sink = halfB - out * along;
      const qx = out * nbx,
        qy = out * nby,
        qz = out * nbz;
      this.note(a, b, px, py, pz, px + qx * sink, py + qy * sink, pz + qz * sink, -qx, -qy, -qz);
      return;
    }
    const across = Math.sqrt(across2),
      sink = r[b] - across;
    if (across > 1e-6) {
      rx /= across;
      ry /= across;
      rz /= across;
    } else {
      // on the second's axis: any way across it will do
      const kx = Math.abs(nbx) < 0.9 ? 1 : 0,
        ky = kx ? 0 : 1;
      rx = ky * nbz;
      ry = -kx * nbz;
      rz = kx * nby - ky * nbx;
      const l = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      rx /= l;
      ry /= l;
      rz /= l;
    }
    this.note(a, b, px, py, pz, px + rx * sink, py + ry * sink, pz + rz * sink, -rx, -ry, -rz);
  }

  /** A disc and a ball: the ball against the nearest of the disc to its middle. */
  private ball(d: number, b: number) {
    const { x, y, z, r, h } = this.s;
    const nx = this.nx[d],
      ny = this.ny[d],
      nz = this.nz[d];
    const ex = x[b] - x[d],
      ey = y[b] - y[d],
      ez = z[b] - z[d];
    const along = ex * nx + ey * ny + ez * nz;
    let rx = ex - along * nx,
      ry = ey - along * ny,
      rz = ez - along * nz;
    const across = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (across > 1e-6) {
      rx /= across;
      ry /= across;
      rz /= across;
    } else {
      rx = Math.abs(nx) < 0.9 ? 1 : 0;
      ry = rx ? 0 : 1;
      rz = 0;
    }
    const half = h[d] / 2;
    const ca = Math.max(-half, Math.min(half, along)),
      cr = Math.min(r[d], across);
    // the nearest of the disc to the ball's middle
    const qx = x[d] + ca * nx + cr * rx,
      qy = y[d] + ca * ny + cr * ry,
      qz = z[d] + ca * nz + cr * rz;
    let wx = x[b] - qx,
      wy = y[b] - qy,
      wz = z[b] - qz;
    const gap = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (gap >= r[b]) return;
    if (gap > 1e-6) {
      wx /= gap;
      wy /= gap;
      wz /= gap;
    } else {
      // the ball's middle is inside the disc: out through the nearer face
      const out = along >= 0 ? 1 : -1;
      wx = out * nx;
      wy = out * ny;
      wz = out * nz;
    }
    this.note(d, b, qx, qy, qz, x[b] - wx * r[b], y[b] - wy * r[b], z[b] - wz * r[b], wx, wy, wz);
  }

  /**
   * A disc against a plane of the world's: through `(qx, qy, qz)` facing
   * `(fx, fy, fz)`, moving at `(vx, vy)`. The rim's points nearest the plane
   * are tried, on both faces, so flat on it has four and on edge has two.
   * `floor`, if given, says how high the plane stands under each point
   * instead, for a floor of tiles. How many were found.
   */
  plane(
    i: number,
    qx: number,
    qy: number,
    qz: number,
    fx: number,
    fy: number,
    fz: number,
    vx: number,
    vy: number,
    floor: ((x: number, y: number) => number) | null,
    margin = 0,
  ): number {
    this.clear();
    this.flat = true;
    const { x, y, z, r, h } = this.s;
    const nx = this.nx[i],
      ny = this.ny[i],
      nz = this.nz[i];
    // the way across the disc that goes deepest into the plane
    const fn = fx * nx + fy * ny + fz * nz;
    let ux = -fx + fn * nx,
      uy = -fy + fn * ny,
      uz = -fz + fn * nz;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (ul > 1e-4) {
      ux /= ul;
      uy /= ul;
      uz /= ul;
    } else {
      ux = Math.abs(nx) < 0.9 ? 1 - nx * nx : -ny * nx;
      uy = Math.abs(nx) < 0.9 ? -nx * ny : 1 - ny * ny;
      uz = Math.abs(nx) < 0.9 ? -nx * nz : -ny * nz;
      const l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= l;
      uy /= l;
      uz /= l;
    }
    const wx = ny * uz - nz * uy,
      wy = nz * ux - nx * uz,
      wz = nx * uy - ny * ux;
    const half = h[i] / 2;
    const own = floor ? floor(x[i], y[i]) : 0;
    for (let k = 0; k < 8; k++) {
      const c = k < 2 ? 1 : k < 4 ? -1 : 0,
        s = k < 4 ? 0 : k < 6 ? 1 : -1,
        face = k % 2 ? -half : half;
      const px = x[i] + r[i] * (c * ux + s * wx) + face * nx,
        py = y[i] + r[i] * (c * uy + s * wy) + face * ny,
        pz = z[i] + r[i] * (c * uz + s * wz) + face * nz;
      let sink: number;
      if (floor) {
        const under = floor(px, py);
        // A floor standing well above the disc is a wall to it, a step's face, and the walls are not this one's
        // business. Well above is judged from the disc's middle or the floor under its middle, whichever is the
        // higher: a disc shoved down through its own floor by a pile above is still on that floor, and is put
        // back on it, where judged from its middle alone it would have no floor at all and fall for ever.
        if (under > Math.max(z[i], own) + r[i]) continue;
        sink = under - pz;
      } else sink = (qx - px) * fx + (qy - py) * fy + (qz - pz) * fz;
      if (sink <= -margin) continue;
      this.note(i, -1, px, py, pz, px + fx * sink, py + fy * sink, pz + fz * sink, -fx, -fy, -fz, vx, vy, 0);
    }
    return this.count;
  }

  /**
   * A disc against a lip of the world's floor: the top edge of a step,
   * through `(ex, ey, ez)`, running along `(tx, ty)` on the level, the floor
   * behind it and the drop the way `(ox, oy)`. A coin pushed out over a lip
   * tips, and then nothing of its rim is on the floor: its lower rim hangs
   * beyond the lip and its upper is in the air, and what holds it is the lip
   * against its face. Without this it sank through the lip as it went over,
   * and one propped there by its neighbours slept with the step's corner
   * half way through it. The lip is put out of the coin by the face it came
   * in by or by the rim, whichever is nearer and leads away from the step.
   * How many contacts were found.
   */
  lip(i: number, ex: number, ey: number, ez: number, tx: number, ty: number, ox: number, oy: number): number {
    this.clear();
    const { x, y, z, r, h } = this.s;
    const nx = this.nx[i],
      ny = this.ny[i],
      nz = this.nz[i];
    const half = h[i] / 2;
    // the lip from the disc's middle, and how it runs against the disc's axis
    const dx = ex - x[i],
      dy = ey - y[i],
      dz = ez - z[i];
    const a0 = dx * nx + dy * ny + dz * nz,
      tn = tx * nx + ty * ny,
      dt = dx * tx + dy * ty;
    // where along it the lip comes nearest the axis, and how near
    const across = 1 - tn * tn;
    const s0 = across > 1e-6 ? (a0 * tn - dt) / across : -a0 / tn;
    const am = a0 + s0 * tn;
    const mx = dx + s0 * tx - am * nx,
      my = dy + s0 * ty - am * ny,
      mz = dz - am * nz;
    const rho2 = mx * mx + my * my + mz * mz;
    if (rho2 >= r[i] * r[i]) return 0;
    // the stretch of it inside the disc: within its rim, and between its faces
    const reach = across > 1e-6 ? Math.sqrt((r[i] * r[i] - rho2) / across) : r[i];
    let from = s0 - reach,
      to = s0 + reach;
    if (Math.abs(tn) > 1e-6) {
      const p = (-half - a0) / tn,
        q = (half - a0) / tn;
      from = Math.max(from, Math.min(p, q));
      to = Math.min(to, Math.max(p, q));
    } else if (a0 >= half || a0 <= -half) return 0;
    if (from >= to) return 0;
    // out by a face: the one looking away from the step, up and out over the drop
    const lead = nz + nx * ox + ny * oy;
    const out = lead >= 0 ? 1 : -1;
    const mid = (from + to) / 2;
    const sinkFace = Math.abs(lead) > 0.1 ? half + out * (a0 + mid * tn) : Infinity;
    // out by the rim: away from where the lip is nearest the axis, if that leads away from the step
    const rho = Math.sqrt(rho2);
    let sinkRim = Infinity;
    if (rho > 1e-6 && -(mz + mx * ox + my * oy) / rho > 0.1) sinkRim = r[i] - rho;
    if (sinkFace === Infinity && sinkRim === Infinity) return 0;
    if (sinkRim < sinkFace) {
      const s = Math.max(from, Math.min(to, s0)),
        a = a0 + s * tn;
      const lx = x[i] + dx + s * tx,
        ly = y[i] + dy + s * ty,
        lz = z[i] + dz;
      const qx = mx / rho,
        qy = my / rho,
        qz = mz / rho;
      this.note(
        i,
        -1,
        x[i] + a * nx + r[i] * qx,
        y[i] + a * ny + r[i] * qy,
        z[i] + a * nz + r[i] * qz,
        lx,
        ly,
        lz,
        qx,
        qy,
        qz,
      );
      return this.count;
    }
    // two spots along the stretch, so a coin lying over a lip is held level along it and not balanced on a point
    const span = (to - from) * 0.4;
    for (let k = 0; k < 2; k++) {
      const s = mid + (k ? span : -span),
        a = a0 + s * tn;
      const sink = half + out * a;
      if (sink <= 0) continue;
      const lx = x[i] + dx + s * tx,
        ly = y[i] + dy + s * ty,
        lz = z[i] + dz;
      this.note(
        i,
        -1,
        lx - out * nx * sink,
        ly - out * ny * sink,
        lz - out * nz * sink,
        lx,
        ly,
        lz,
        -out * nx,
        -out * ny,
        -out * nz,
      );
    }
    return this.count;
  }

  // ---- putting it right ----

  /** A body's share in being moved at a spot `(rx, ry, rz)` from its middle along `(nx, ny, nz)`: what it lacks in weight, and in resistance to the turn that would give. */
  private share(
    i: number,
    rx: number,
    ry: number,
    rz: number,
    nx: number,
    ny: number,
    nz: number,
    hold: Float64Array | null = null,
  ): number {
    if (hold) {
      // pressed into what holds it, it gives way only by what of the push runs across that
      const into = nx * hold[0] + ny * hold[1] + nz * hold[2];
      const across = 1 - into * into;
      return across < SQUARELY ? 0 : this.im[i] * across;
    }
    const cx = ry * nz - rz * ny,
      cy = rz * nx - rx * nz,
      cz = rx * ny - ry * nx;
    const along = cx * this.nx[i] + cy * this.ny[i] + cz * this.nz[i];
    // about a diameter, and the difference about the axis
    return this.im[i] + this.id[i] * (cx * cx + cy * cy + cz * cz) + (this.ia[i] - this.id[i]) * along * along;
  }

  /** A body moved and turned by a push of `push` along `(nx, ny, nz)` at a spot `(rx, ry, rz)` from its middle. */
  private shove(
    i: number,
    rx: number,
    ry: number,
    rz: number,
    nx: number,
    ny: number,
    nz: number,
    push: number,
    hold: Float64Array | null = null,
  ) {
    const { x, y, z } = this.s;
    if (hold) {
      // only across what holds it: it cannot be pressed into it
      const into = nx * hold[0] + ny * hold[1] + nz * hold[2];
      if (1 - into * into < SQUARELY) return;
      x[i] += (nx - into * hold[0]) * push * this.im[i];
      y[i] += (ny - into * hold[1]) * push * this.im[i];
      z[i] += (nz - into * hold[2]) * push * this.im[i];
      return;
    }
    x[i] += nx * push * this.im[i];
    y[i] += ny * push * this.im[i];
    z[i] += nz * push * this.im[i];
    if (this.id[i] === 0) return;
    const cx = ry * nz - rz * ny,
      cy = rz * nx - rx * nz,
      cz = rx * ny - ry * nx;
    const along = cx * this.nx[i] + cy * this.ny[i] + cz * this.nz[i];
    const k = (this.ia[i] - this.id[i]) * along;
    this.turn(
      i,
      push * (this.id[i] * cx + k * this.nx[i]),
      push * (this.id[i] * cy + k * this.ny[i]),
      push * (this.id[i] * cz + k * this.nz[i]),
    );
  }

  /** Where the spots of contact `k` are now, from each body's middle, into `t` at 0 and 3; and the second's in the world at 6. */
  private spots(k: number) {
    const { x, y, z, q, h } = this.s;
    const t = this.t,
      o = k * 3;
    const a = this.first[k],
      b = this.second[k];
    this.rotate(q, a * 4, this.la[o], this.la[o + 1], this.la[o + 2], false, 0);
    if (b < 0) {
      t[3] = t[4] = t[5] = 0;
      t[6] = this.lb[o];
      t[7] = this.lb[o + 1];
      t[8] = this.lb[o + 2];
      return;
    }
    if (h[b] > 0) this.rotate(q, b * 4, this.lb[o], this.lb[o + 1], this.lb[o + 2], false, 3);
    else {
      t[3] = this.lb[o];
      t[4] = this.lb[o + 1];
      t[5] = this.lb[o + 2];
    }
    t[6] = x[b] + t[3];
    t[7] = y[b] + t[4];
    t[8] = z[b] + t[5];
  }

  /** How far contact `k` is to be pushed apart this step: how far in it is, less the slop, and no more than the cap and what it closed by. */
  private sink(k: number): number {
    const { x, y, z, vx, vy, vz, step } = this.s;
    const t = this.t,
      o = k * 3;
    const a = this.first[k],
      b = this.second[k];
    const nx = this.cn[o],
      ny = this.cn[o + 1],
      nz = this.cn[o + 2];
    const depth = (x[a] + t[0] - t[6]) * nx + (y[a] + t[1] - t[7]) * ny + (z[a] + t[2] - t[8]) * nz - SLOP;
    // the world is put out of whole: it cannot be kicked, and everything above leans on it
    if (depth <= 0 || b < 0) return depth;
    const bvx = b >= 0 ? vx[b] : this.vb[o],
      bvy = b >= 0 ? vy[b] : this.vb[o + 1],
      bvz = b >= 0 ? vz[b] : this.vb[o + 2];
    const closing = (vx[a] - bvx) * nx + (vy[a] - bvy) * ny + (vz[a] - bvz) * nz;
    return Math.min(depth, MAX_PUSH + Math.max(0, closing) * step);
  }

  /**
   * What of a push goes beyond stopping the two coming together, noted
   * against each: how far the two spots have closed along the push since the
   * step began is the approach, and a push of more than that is the rest.
   */
  private beyond(
    k: number,
    a: number,
    b: number,
    aMoves: boolean,
    bMoves: boolean,
    rax: number,
    ray: number,
    raz: number,
    rbx: number,
    rby: number,
    rbz: number,
    nx: number,
    ny: number,
    nz: number,
    sunk: number,
    push: number,
  ) {
    const { x, y, z, h, vx, vy, vz, step } = this.s;
    const t = this.t,
      o = k * 3;
    // where the first's spot was when the step began, and the second's, and so how far they have closed
    this.rotate(this.pq, a * 4, this.la[o], this.la[o + 1], this.la[o + 2], false, 9);
    let cx = x[a] + rax - (this.px[a] + t[9]),
      cy = y[a] + ray - (this.py[a] + t[10]),
      cz = z[a] + raz - (this.pz[a] + t[11]);
    if (b >= 0 && h[b] > 0) {
      this.rotate(this.pq, b * 4, this.lb[o], this.lb[o + 1], this.lb[o + 2], false, 9);
      cx -= x[b] + rbx - (this.px[b] + t[9]);
      cy -= y[b] + rby - (this.py[b] + t[10]);
      cz -= z[b] + rbz - (this.pz[b] + t[11]);
    } else if (b >= 0) {
      cx -= vx[b] * step;
      cy -= vy[b] * step;
      cz -= vz[b] * step;
    } else {
      cx -= this.vb[o] * step;
      cy -= this.vb[o + 1] * step;
      cz -= this.vb[o + 2] * step;
    }
    // less what either has already been pushed beyond stopping, this step: that was being put, not coming on,
    // and counted as an approach it would make the next push look earned, and the books would not balance
    cx -= this.overX[a];
    cy -= this.overY[a];
    cz -= this.overZ[a];
    if (b >= 0) {
      cx += this.overX[b];
      cy += this.overY[b];
      cz += this.overZ[b];
    }
    const closed = Math.max(0, cx * nx + cy * ny + cz * nz);
    const rest = Math.max(0, sunk - closed) / sunk;
    if (rest <= 0) return;
    if (aMoves) {
      this.overX[a] -= nx * push * this.im[a] * rest;
      this.overY[a] -= ny * push * this.im[a] * rest;
      this.overZ[a] -= nz * push * this.im[a] * rest;
      this.overTurn(a, rax, ray, raz, nx, ny, nz, -push * rest);
    }
    if (bMoves) {
      this.overX[b] += nx * push * this.im[b] * rest;
      this.overY[b] += ny * push * this.im[b] * rest;
      this.overZ[b] += nz * push * this.im[b] * rest;
      this.overTurn(b, rbx, rby, rbz, nx, ny, nz, push * rest);
    }
  }

  /** The turn a push at a spot gives a body, noted as beyond what stopped it. */
  private overTurn(i: number, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number, push: number) {
    if (this.id[i] === 0) return;
    const cx = ry * nz - rz * ny,
      cy = rz * nx - rx * nz,
      cz = rx * ny - ry * nx;
    const along = cx * this.nx[i] + cy * this.ny[i] + cz * this.nz[i];
    const k = (this.ia[i] - this.id[i]) * along;
    this.overA[i] += push * (this.id[i] * cx + k * this.nx[i]);
    this.overB[i] += push * (this.id[i] * cy + k * this.ny[i]);
    this.overC[i] += push * (this.id[i] * cz + k * this.nz[i]);
  }

  /** A body slid by friction: moved, and turned by it unless it is lying flat on something firm. */
  private slip(
    i: number,
    rx: number,
    ry: number,
    rz: number,
    nx: number,
    ny: number,
    nz: number,
    push: number,
    rocks: boolean,
  ) {
    if (rocks) {
      this.shove(i, rx, ry, rz, nx, ny, nz, push);
      return;
    }
    const { x, y, z } = this.s;
    x[i] += nx * push * this.im[i];
    y[i] += ny * push * this.im[i];
    z[i] += nz * push * this.im[i];
    // and turned about the way it lies, which is a coin spinning flat being braked; any other turn would rock it
    const ux = this.upX[i],
      uy = this.upY[i],
      uz = this.upZ[i];
    const spin = ((ry * nz - rz * ny) * ux + (rz * nx - rx * nz) * uy + (rx * ny - ry * nx) * uz) * push;
    const about = ux * this.nx[i] + uy * this.ny[i] + uz * this.nz[i];
    const k = spin * (this.id[i] + (this.ia[i] - this.id[i]) * about * about);
    this.turn(i, k * ux, k * uy, k * uz);
  }

  /**
   * The contacts in hand put right: the two pushed apart along the way
   * between them by how far in they still are, and the slide between them
   * this step taken back, up to what friction allows for that push. A flat
   * contact's points are pushed together, as one thing; any others one after
   * another, each seeing what the last did. `frozen` is a body not to be
   * moved, or -1: a sleeper, which is a wall until it is woken. Without
   * `slides` the two are only put apart, for a contact that is gone over
   * again later in the step and has its friction then.
   */
  solve(frozen: number, slides = true) {
    const { x, y, z, h, vx, vy, vz, onFloor, step } = this.s;
    const t = this.t;
    const together = this.flat && this.count > 1 && this.count <= 4;
    if (together) this.block(frozen);
    // lying flat on the world, three points of it or four: what it lies on, to stop it by when the step is read back
    if (together && this.count >= 3 && this.second[0] < 0) {
      const a = this.first[0];
      this.stopX[a] = this.cn[0];
      this.stopY[a] = this.cn[1];
      this.stopZ[a] = this.cn[2];
      this.stopped[a] = 1;
    }
    for (let k = 0; k < this.count; k++) {
      const a = this.first[k],
        b = this.second[k],
        o = k * 3;
      const nx = this.cn[o],
        ny = this.cn[o + 1],
        nz = this.cn[o + 2];
      const aMoves = a !== frozen,
        bMoves = b >= 0 && b !== frozen;
      this.spots(k);
      let rax = t[0],
        ray = t[1],
        raz = t[2],
        rbx = t[3],
        rby = t[4],
        rbz = t[5];
      // how much the two give way along the push, between them
      const aHold = this.held(a, rax, ray, raz, -nx, -ny, -nz, this.holdA) ? this.holdA : null,
        bHold = b >= 0 && this.held(b, rbx, rby, rbz, nx, ny, nz, this.holdB) ? this.holdB : null;
      const give =
        (aMoves ? this.share(a, rax, ray, raz, nx, ny, nz, aHold) : 0) +
        (bMoves ? this.share(b, rbx, rby, rbz, nx, ny, nz, bHold) : 0);
      let push = 0;
      let sunk: number;
      if (together) {
        push = Math.max(0, this.pushed[k]);
        sunk = this.sunk[k];
      } else {
        sunk = this.sink(k);
        if (sunk > 0 && give > 0) {
          push = sunk / give;
          this.beyond(k, a, b, aMoves, bMoves, rax, ray, raz, rbx, rby, rbz, nx, ny, nz, sunk, push);
          if (aMoves) this.shove(a, rax, ray, raz, nx, ny, nz, -push, aHold);
          if (bMoves) this.shove(b, rbx, rby, rbz, nx, ny, nz, push, bHold);
          // The push has turned them, and the spots with them: looked at again, or the slide is measured from
          // where the spots were, and the turn's share of it goes unseen. For a coin leaning on its foot that is
          // most of it, and a foot whose slide goes unseen creeps out from under the coin a little every step.
          this.spots(k);
          rax = t[0];
          ray = t[1];
          raz = t[2];
          rbx = t[3];
          rby = t[4];
          rbz = t[5];
        }
      }
      // touching, if only within the slop, is still touching: friction holds there whether or not this step pushed
      if (sunk <= -SLOP) continue;
      this.backing(k, a, b, nx, ny, nz);
      this.touched[a] = 1;
      if (sunk > this.into[a]) this.into[a] = sunk;
      if (b >= 0) {
        this.touched[b] = 1;
        if (sunk > this.into[b]) this.into[b] = sunk;
      }
      this.strike(a, b, o);
      // which is on which, for whoever wants to know what is resting
      if (nz < -0.5) onFloor[a] |= b < 0 && (this.vb[o] !== 0 || this.vb[o + 1] !== 0) ? 2 : 1;
      else if (nz > 0.5 && b >= 0) onFloor[b] |= 1;

      if (!slides) continue;
      // the slide between the two spots since the step began, across the way between them
      const disc = b >= 0 && h[b] > 0;
      this.rotate(this.pq, a * 4, this.la[o], this.la[o + 1], this.la[o + 2], false, 6);
      let sx = x[a] + rax - (this.px[a] + t[6]),
        sy = y[a] + ray - (this.py[a] + t[7]),
        sz = z[a] + raz - (this.pz[a] + t[8]);
      if (disc) {
        // a sleeper has not moved since the step began, so taking its motion away takes nothing
        this.rotate(this.pq, b * 4, this.lb[o], this.lb[o + 1], this.lb[o + 2], false, 9);
        sx -= x[b] + rbx - (this.px[b] + t[9]);
        sy -= y[b] + rby - (this.py[b] + t[10]);
        sz -= z[b] + rbz - (this.pz[b] + t[11]);
      } else if (b >= 0) {
        sx -= vx[b] * step;
        sy -= vy[b] * step;
        sz -= vz[b] * step;
      } else {
        sx -= this.vb[o] * step;
        sy -= this.vb[o + 1] * step;
        sz -= this.vb[o + 2] * step;
      }
      // and less what either was pushed beyond stopping: friction answers a slide, not a putting apart
      sx -= this.overX[a];
      sy -= this.overY[a];
      sz -= this.overZ[a];
      if (b >= 0) {
        sx += this.overX[b];
        sy += this.overY[b];
        sz += this.overZ[b];
      }
      const sn = sx * nx + sy * ny + sz * nz;
      sx -= sn * nx;
      sy -= sn * ny;
      sz -= sn * nz;
      const slide = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (slide < 1e-9) continue;
      sx /= slide;
      sy /= slide;
      sz /= slide;
      // what is lying flat on something firm is slid by friction, not rocked by it
      const aRocks = !this.firm(a),
        bRocks = b >= 0 && !this.firm(b);
      const ta = aMoves ? (aRocks ? this.share(a, rax, ray, raz, sx, sy, sz) : this.im[a]) : 0,
        tb = bMoves ? (bRocks ? this.share(b, rbx, rby, rbz, sx, sy, sz) : this.im[b]) : 0;
      if (ta + tb === 0) continue;
      // Friction is held to the push, or to the weight this contact could be bearing if that is more. What this
      // step pushed depends on which contact was put right first: a coin leaning on another's rim with its foot on
      // the floor has the rim take the push and the foot none, and a foot with no friction slides out from under it.
      const bearing = give > 0 ? (Math.abs(nz) * this.s.gravity * step * step) / give / (together ? this.count : 1) : 0;
      const grip = Math.min(slide / (ta + tb), (b < 0 ? this.s.grip : this.s.friction) * Math.max(push, bearing));
      if (aMoves) this.slip(a, rax, ray, raz, sx, sy, sz, -grip, aRocks);
      if (bMoves) this.slip(b, rbx, rby, rbz, sx, sy, sz, grip, bRocks);
    }
  }

  /**
   * What a touch says of backing. Sideways on to a face of the world that is
   * coming on, the first is backed by it. Disc to disc, whichever has its
   * backing beyond it, as the other sees it, backs the other in turn. A face
   * standing still backs nothing, nor does the rock: what is still puts a
   * coin back by itself every step, and a heap held rigid from every wall at
   * once can no longer shuffle its coins out of each other.
   */
  private backing(k: number, a: number, b: number, nx: number, ny: number, nz: number) {
    if (nz > 0.7 || nz < -0.7) return;
    if (b < 0) {
      // how fast the face is coming at the disc: along the way from the world to it
      const o = k * 3;
      if (-(this.vb[o] * nx + this.vb[o + 1] * ny + this.vb[o + 2] * nz) > ADVANCING) this.back(a, nx, ny, nz, 0);
      return;
    }
    if (this.s.h[a] > 0 && this.s.h[b] > 0) {
      const fresh = this.now - 1;
      if (this.backedAt[b] >= fresh && this.backX[b] * nx + this.backY[b] * ny + this.backZ[b] * nz > BACKED)
        this.back(a, nx, ny, nz, this.links[b] + 1);
      if (this.backedAt[a] >= fresh && this.backX[a] * nx + this.backY[a] * ny + this.backZ[a] * nz < -BACKED)
        this.back(b, -nx, -ny, -nz, this.links[a] + 1);
    }
  }

  /** Each of a contact's two noted as struck by the other, at the speed it was going. */
  private strike(a: number, b: number, o: number) {
    const { vx, vy, vz } = this.s;
    const sa = Math.sqrt(vx[a] * vx[a] + vy[a] * vy[a] + vz[a] * vz[a]);
    const sb =
      b >= 0
        ? Math.sqrt(vx[b] * vx[b] + vy[b] * vy[b] + vz[b] * vz[b])
        : Math.sqrt(this.vb[o] * this.vb[o] + this.vb[o + 1] * this.vb[o + 1] + this.vb[o + 2] * this.vb[o + 2]);
    if (sb > this.struck[a]) this.struck[a] = sb;
    if (b >= 0 && sa > this.struck[b]) this.struck[b] = sa;
  }

  /** How hard each point of a flat contact was pushed, for its friction to be held to; and the working of it. */
  private readonly pushed = new Float64Array(4);
  private readonly arm = new Float64Array(4 * 6);
  private readonly sunk = new Float64Array(4);
  private readonly grid = new Float64Array(16);
  private readonly live = new Uint8Array(4);
  private readonly work = new Float64Array(16);
  private readonly rhs = new Float64Array(4);
  private readonly order = new Int32Array(4);
  /** Where each point of a flat contact is, from each body's middle. */
  private readonly spot = new Float64Array(4 * 6);
  /** Whether each body gives way at each point of a flat contact. */
  private readonly gives = new Uint8Array(8);

  /**
   * A flat contact put right as one thing: up to four points pushing the
   * same way, solved together for the pushes that bring every one of them
   * out at once. Solved one after another the first would take most of it
   * every step, and that bias is a turn: a coin lying square on another
   * would tilt, and walk off it. A push that comes out as a pull is a point
   * that was leaving anyway; it is let go, and the rest solved again.
   */
  private block(frozen: number) {
    const t = this.t,
      arm = this.arm;
    const a = this.first[0],
      b = this.second[0];
    const nx = this.cn[0],
      ny = this.cn[1],
      nz = this.cn[2];
    const aMoves = a !== frozen,
      bMoves = b >= 0 && b !== frozen;
    const n = this.count;
    for (let k = 0; k < n; k++) this.pushed[k] = 0;
    if (!aMoves && !bMoves) return;
    for (let k = 0; k < n; k++) {
      this.spots(k);
      this.sunk[k] = this.sink(k);
      this.live[k] = this.sunk[k] > 0 ? 1 : 0;
      // each spot's arm about each body's middle, across the push
      arm[k * 6] = t[1] * nz - t[2] * ny;
      arm[k * 6 + 1] = t[2] * nx - t[0] * nz;
      arm[k * 6 + 2] = t[0] * ny - t[1] * nx;
      arm[k * 6 + 3] = t[4] * nz - t[5] * ny;
      arm[k * 6 + 4] = t[5] * nx - t[3] * nz;
      arm[k * 6 + 5] = t[3] * ny - t[4] * nx;

      this.spot[k * 6] = t[0];
      this.spot[k * 6 + 1] = t[1];
      this.spot[k * 6 + 2] = t[2];
      this.spot[k * 6 + 3] = t[3];
      this.spot[k * 6 + 4] = t[4];
      this.spot[k * 6 + 5] = t[5];
    }
    // A push borne by what a body is lying on neither turns it nor presses it in: it gives nothing. The contact is
    // borne whole or not at all, judged at its middle: borne at some of its points and not at others, the solve
    // turns the body about the ones that are not, which is a coin on the floor rocking under one landing on it.
    let max = 0,
      may = 0,
      maz = 0,
      mbx = 0,
      mby = 0,
      mbz = 0,
      touching = 0;
    for (let k = 0; k < n; k++) {
      if (this.sunk[k] <= -SLOP) continue;
      touching++;
      max += this.spot[k * 6];
      may += this.spot[k * 6 + 1];
      maz += this.spot[k * 6 + 2];
      mbx += this.spot[k * 6 + 3];
      mby += this.spot[k * 6 + 4];
      mbz += this.spot[k * 6 + 5];
    }
    const c = touching || 1;
    const aGives = aMoves && !this.held(a, max / c, may / c, maz / c, -nx, -ny, -nz, this.holdA) ? 1 : 0,
      bGives = bMoves && !this.held(b, mbx / c, mby / c, mbz / c, nx, ny, nz, this.holdB) ? 1 : 0;
    for (let k = 0; k < n; k++) {
      this.gives[k * 2] = aGives;
      this.gives[k * 2 + 1] = bGives;
    }
    this.lies(a, b, frozen, nx, ny, nz, n);
    // how far a push at one spot moves another, through both bodies' weight and their resistance to the turn
    const g = this.grid;
    for (let k = 0; k < n; k++) {
      for (let l = k; l < n; l++) {
        let w = 0;
        if (this.gives[k * 2] && this.gives[l * 2]) w += this.through(a, k * 6, l * 6);
        if (this.gives[k * 2 + 1] && this.gives[l * 2 + 1]) w += this.through(b, k * 6 + 3, l * 6 + 3);
        g[k * 4 + l] = w;
        g[l * 4 + k] = w;
      }
    }
    // a point neither body gives way at cannot be put right by moving either
    for (let k = 0; k < n; k++) if (!this.gives[k * 2] && !this.gives[k * 2 + 1]) this.live[k] = 0;
    for (let round = 0; round < 4; round++) if (!this.pushes(n)) break;
    let sum = 0,
      tax = 0,
      tay = 0,
      taz = 0,
      tbx = 0,
      tby = 0,
      tbz = 0;
    let sumA = 0,
      sumB = 0;
    for (let k = 0; k < n; k++) {
      const p = this.pushed[k];
      if (p <= 0) continue;
      sum += p;
      if (this.gives[k * 2]) {
        sumA += p;
        tax += p * arm[k * 6];
        tay += p * arm[k * 6 + 1];
        taz += p * arm[k * 6 + 2];
      }
      if (this.gives[k * 2 + 1]) {
        sumB += p;
        tbx += p * arm[k * 6 + 3];
        tby += p * arm[k * 6 + 4];
        tbz += p * arm[k * 6 + 5];
      }
    }
    if (sum <= 0) return;
    for (let k = 0; k < n; k++) {
      const p = this.pushed[k];
      if (p <= 0 || this.sunk[k] <= 0) continue;
      this.beyond(
        k,
        a,
        b,
        this.gives[k * 2] === 1,
        this.gives[k * 2 + 1] === 1,
        this.spot[k * 6],
        this.spot[k * 6 + 1],
        this.spot[k * 6 + 2],
        this.spot[k * 6 + 3],
        this.spot[k * 6 + 4],
        this.spot[k * 6 + 5],
        nx,
        ny,
        nz,
        this.sunk[k],
        p,
      );
    }
    if (sumA > 0) this.heave(a, -sumA * nx, -sumA * ny, -sumA * nz, -tax, -tay, -taz);
    if (sumB > 0) this.heave(b, sumB * nx, sumB * ny, sumB * nz, tbx, tby, tbz);
  }

  /**
   * Which of a flat contact's two is lying on the other, noted: three points
   * touching at least, the way between them near enough up and down, and
   * what is underneath firm: the world, a sleeper, or something itself lying
   * on something firm.
   */
  private lies(a: number, b: number, frozen: number, nx: number, ny: number, nz: number, n: number) {
    let touching = 0;
    for (let k = 0; k < n; k++) if (this.sunk[k] > -SLOP) touching++;
    if (touching < 3) return;
    // the first is on the second if the way to it is down; the second on the first if it is up
    const upper = b < 0 || nz < -0.5 ? a : nz > 0.5 ? b : -1;
    if (upper < 0 || (b < 0 && nz > -0.5)) return;
    const lower = upper === a ? b : a;
    if (lower >= 0 && lower !== frozen && !this.firm(lower)) return;
    const o = upper === a ? 0 : 3,
      sign = upper === a ? 1 : -1;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let k = 0; k < n; k++) {
      if (this.sunk[k] <= -SLOP) continue;
      cx += this.spot[k * 6 + o];
      cy += this.spot[k * 6 + o + 1];
      cz += this.spot[k * 6 + o + 2];
    }
    cx /= touching;
    cy /= touching;
    cz /= touching;
    // On the world it is held up to its rim: a coin flat on a floor cannot be tipped by pressing on it anywhere.
    // On another it is held up as far round the middle of where it bears as the nearest of the points.
    let reach = b < 0 ? this.s.r[upper] : Infinity;
    if (b >= 0)
      for (let k = 0; k < n; k++) {
        if (this.sunk[k] <= -SLOP) continue;
        reach = Math.min(
          reach,
          Math.sqrt(
            (this.spot[k * 6 + o] - cx) * (this.spot[k * 6 + o] - cx) +
              (this.spot[k * 6 + o + 1] - cy) * (this.spot[k * 6 + o + 1] - cy) +
              (this.spot[k * 6 + o + 2] - cz) * (this.spot[k * 6 + o + 2] - cz),
          ),
        );
      }
    this.upX[upper] = sign * nx;
    this.upY[upper] = sign * ny;
    this.upZ[upper] = sign * nz;
    this.atX[upper] = cx;
    this.atY[upper] = cy;
    this.atZ[upper] = cz;
    this.over[upper] = reach;
    this.since[upper] = this.now;
  }

  /** What a body gives way by at one arm for a push at another: its weight, and its resistance to the turn. */
  private through(i: number, k: number, l: number): number {
    const arm = this.arm;
    const dot = arm[k] * arm[l] + arm[k + 1] * arm[l + 1] + arm[k + 2] * arm[l + 2];
    const ak = arm[k] * this.nx[i] + arm[k + 1] * this.ny[i] + arm[k + 2] * this.nz[i],
      al = arm[l] * this.nx[i] + arm[l + 1] * this.ny[i] + arm[l + 2] * this.nz[i];
    return this.im[i] + this.id[i] * dot + (this.ia[i] - this.id[i]) * ak * al;
  }

  /** The pushes that bring every live spot out at once, by elimination; whether one came out a pull and was let go. */
  private pushes(n: number): boolean {
    const g = this.grid,
      m = this.work,
      v = this.rhs,
      idx = this.order;
    let c = 0;
    for (let k = 0; k < n; k++) if (this.live[k]) idx[c++] = k;
    if (!c) return false;
    let trace = 0;
    for (let i = 0; i < c; i++) trace += g[idx[i] * 4 + idx[i]];
    for (let i = 0; i < c; i++) {
      for (let j = 0; j < c; j++) m[i * 4 + j] = g[idx[i] * 4 + idx[j]];
      // four spots on one face say the same thing three ways: a hair on the diagonal keeps it solvable
      m[i * 4 + i] += trace * 1e-4;
      v[i] = this.sunk[idx[i]];
    }
    for (let i = 0; i < c; i++) {
      let best = i;
      for (let j = i + 1; j < c; j++) if (Math.abs(m[j * 4 + i]) > Math.abs(m[best * 4 + i])) best = j;
      if (best !== i) {
        for (let j = 0; j < c; j++) {
          const swap = m[i * 4 + j];
          m[i * 4 + j] = m[best * 4 + j];
          m[best * 4 + j] = swap;
        }
        const swap = v[i];
        v[i] = v[best];
        v[best] = swap;
      }
      const pivot = m[i * 4 + i];
      if (Math.abs(pivot) < 1e-12) continue;
      for (let j = i + 1; j < c; j++) {
        const f = m[j * 4 + i] / pivot;
        if (!f) continue;
        for (let l = i; l < c; l++) m[j * 4 + l] -= f * m[i * 4 + l];
        v[j] -= f * v[i];
      }
    }
    for (let i = c - 1; i >= 0; i--) {
      let sum = v[i];
      for (let j = i + 1; j < c; j++) sum -= m[i * 4 + j] * v[j];
      const pivot = m[i * 4 + i];
      v[i] = Math.abs(pivot) < 1e-12 ? 0 : sum / pivot;
    }
    let worst = -1;
    for (let i = 0; i < c; i++) {
      this.pushed[idx[i]] = v[i];
      if (v[i] < 0 && (worst < 0 || v[i] < v[worst])) worst = i;
    }
    if (worst < 0) return false;
    this.live[idx[worst]] = 0;
    this.pushed[idx[worst]] = 0;
    return true;
  }

  /** A body moved by a push and turned by its moment, both already summed. */
  private heave(i: number, px: number, py: number, pz: number, mx: number, my: number, mz: number) {
    const { x, y, z } = this.s;
    x[i] += px * this.im[i];
    y[i] += py * this.im[i];
    z[i] += pz * this.im[i];
    if (this.id[i] === 0) return;
    const along = mx * this.nx[i] + my * this.ny[i] + mz * this.nz[i];
    const k = (this.ia[i] - this.id[i]) * along;
    this.turn(i, this.id[i] * mx + k * this.nx[i], this.id[i] * my + k * this.ny[i], this.id[i] * mz + k * this.nz[i]);
  }
}
