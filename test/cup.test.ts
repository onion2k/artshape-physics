/**
 * The cup: a hole given a rim. The rim is the round edge where the hole
 * meets the floor, and a ball meets it as it meets any edge, and is put out
 * of it and bounced off it. Nothing decides by a figure whether a ball drops:
 * a slow one partly over the edge tips in, one crossing is caught if it has
 * dropped far enough by the far side for the rim to meet it low and turn it
 * back, and runs over if the rim meets it near its bottom and throws it up
 * and on; one clipping the edge is turned, and may run round it and out. How
 * deep a hole is counts from the floor under its middle, so a cup can stand
 * on a raised green.
 */
import { describe, expect, it } from 'vitest';
import { World, type Grid, type Hole, type Tuning, type WorldOptions } from '../src/world';

const DT = 1 / 60;
const GRID: Grid = { cols: 40, rows: 20, originX: -60, originY: -30, tile: 3 };
const R = 1;
/** Ooergolf's ball in a cup two and a half times its radius, as a real cup is to a real ball. */
const CUP: Hole = { x: 0, y: 0, radius: 2.5, depth: 4, rim: 0.3, pull: 0 };
const TUNING: Partial<Tuning> = { floorDrag: 0, travel: 0.5, sleepInAir: false, bounceFrom: 2 };

const world = (over: Partial<WorldOptions> = {}) =>
  new World({
    capacity: 8,
    grid: GRID,
    solid: new Uint8Array(GRID.cols * GRID.rows),
    radii: [R],
    holes: [CUP],
    random: () => 0.5,
    ...over,
    tuning: { ...TUNING, ...over.tuning },
  });

/**
 * A ball rolled at the cup from 8 back along x, off its middle by `offset`:
 * whether it was holed, and if not, how it left it, read as it gets clear of
 * the cup, before anything else it meets can turn it.
 */
function putt(speed: number, offset = 0, over: Partial<WorldOptions> = {}) {
  const w = world(over);
  const level = over.floor ? over.floor[0] : 0;
  const i = w.spawn(0, -8, offset, level + R, speed, 0, 0);
  let holed = -2,
    highest = 0;
  const clear = CUP.radius + R + 1;
  for (let f = 0; f < 240 && w.alive[i]; f++) {
    w.step(DT, (_k, _x, _y, _i, hole) => (holed = hole));
    if (!w.alive[i]) break;
    if (Math.hypot(w.x[i], w.y[i]) < CUP.radius + R) highest = Math.max(highest, w.z[i] - level - R);
    if (w.x[i] > clear || Math.hypot(w.x[i], w.y[i]) > 8.5) break;
  }
  const turned = w.alive[i] ? (Math.abs(Math.atan2(w.vy[i], w.vx[i])) * 180) / Math.PI : 0;
  return { holed: holed === 0, highest, turned, x: w.x[i], y: w.y[i], z: w.z[i] };
}

const SPEEDS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 40, 60, 80, 120];

describe('a cup', () => {
  it('catches a ball through its middle up to a speed, and throws it up and over from a faster one', () => {
    const results = SPEEDS.map((speed) => ({ speed, ...putt(speed) }));
    // the slowest that gets there at all, and from it: holed, then a band where either may happen, then over
    const reaching = results.filter((r) => r.holed || r.x > 0);
    const firstMissed = reaching.findIndex((r) => !r.holed),
      lastHoled = reaching.map((r) => r.holed).lastIndexOf(true);
    // holed at every speed up to the fastest before the first miss, and over at every speed after the last holed
    const cCatch = reaching[firstMissed - 1].speed,
      cOver = reaching[lastHoled + 1].speed;
    expect(firstMissed).toBeGreaterThan(0);
    expect(cCatch).toBeLessThan(cOver);
    for (const r of reaching.filter((q) => q.speed >= cOver)) {
      expect(r.holed, `${r.speed} u/s`).toBe(false);
      // on over the far side, and not turned back
      expect(r.x, `${r.speed} u/s`).toBeGreaterThan(CUP.radius + R);
    }
    // one that has dropped far enough to meet the far rim below its middle, but not far enough to be turned back,
    // is thrown up off it; much faster, it barely dips, and glides over
    expect(Math.max(...reaching.filter((q) => !q.holed && q.x > 0).map((q) => q.highest))).toBeGreaterThan(0.5);
    for (const r of reaching.filter((q) => q.speed <= cCatch)) expect(r.holed, `${r.speed} u/s`).toBe(true);
  });

  it('turns a ball clipping its edge, and lips some out and drops others', () => {
    const off = 0.8 * CUP.radius;
    const results = [2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 40].map((speed) => ({ speed, ...putt(speed, off) }));
    expect(results.some((r) => r.holed)).toBe(true);
    // a lip-out: not holed, and turned by the rim by twenty degrees or more
    expect(results.some((r) => !r.holed && r.turned >= 20)).toBe(true);
  });

  it('tips in a ball at rest partly over its edge, and leaves one beside it be, with no pull', () => {
    const at = (d: number) => {
      const w = world();
      const i = w.spawn(0, -d, 0, R);
      let holed = false;
      for (let f = 0; f < 240 && w.alive[i]; f++) w.step(DT, () => (holed = true));
      return { holed, asleep: w.alive[i] ? w.asleep[i] : 0, x: w.alive[i] ? w.x[i] : 0 };
    };
    expect(at(CUP.radius - 0.1).holed).toBe(true);
    const beside = at(CUP.radius + 0.1);
    expect(beside.holed).toBe(false);
    expect(beside.asleep).toBe(1);
    expect(beside.x).toBeCloseTo(-(CUP.radius + 0.1), 2);
  });

  it('stands on a raised green: its depth from the floor under it, and a ball rolled past it stays on the green', () => {
    const floor = new Float32Array(GRID.cols * GRID.rows).fill(2);
    // the same cup, raised: holed at the same speeds, thrown as high off its rim
    for (const speed of [4, 20, 30, 40, 60]) {
      const flat = putt(speed),
        raised = putt(speed, 0, { floor });
      expect(raised.holed, `${speed} u/s`).toBe(flat.holed);
      expect(raised.highest, `${speed} u/s`).toBeCloseTo(flat.highest, 2);
    }
    expect(putt(4, 0, { floor }).holed).toBe(true);
    const past = putt(4, CUP.radius + R + 0.5, { floor });
    expect(past.holed).toBe(false);
    expect(past.z).toBeCloseTo(2 + R, 2);
  });

  it('drops a ball into a cup the same in a world with a floor as in one without', () => {
    const path = (floor?: Float32Array) => {
      const w = world({ floor, tuning: { travel: Infinity } });
      const i = w.spawn(0, -3, 0.3, R, 3, 0, 0);
      const out: number[] = [];
      for (let f = 0; f < 120 && w.alive[i]; f++) {
        w.step(DT, () => {});
        if (w.alive[i]) out.push(w.x[i], w.y[i], w.z[i]);
      }
      return out;
    };
    const flat = path(),
      tiled = path(new Float32Array(GRID.cols * GRID.rows));
    expect(tiled.length).toBe(flat.length);
    for (let k = 0; k < flat.length; k++) expect(Math.abs(tiled[k] - flat[k]), `at ${k}`).toBeLessThan(1e-6);
  });

  it('takes a ball that lands in it from the air, and throws off or in one that lands on the rim, never through it', () => {
    const drop = (x: number) => {
      const w = world();
      const i = w.spawn(0, x, 0, 6, 0, 0, 0);
      let holed = false,
        nearest = Infinity;
      for (let f = 0; f < 240 && w.alive[i]; f++) {
        w.step(DT, () => (holed = true));
        if (!w.alive[i]) break;
        // how near the ball's middle came to the rim, the circle of the cup's edge at the floor
        const d = Math.hypot(w.x[i], w.y[i]);
        nearest = Math.min(nearest, Math.hypot(d - CUP.radius, w.z[i]));
      }
      return { holed, nearest };
    };
    expect(drop(0).holed).toBe(true);
    for (const x of [-CUP.radius - 0.4, -CUP.radius, -CUP.radius + 0.4])
      expect(drop(x).nearest).toBeGreaterThan(R - 0.02);
  });

  it('says which of two cups took a ball, and pulls toward a hole by its own figures', () => {
    const two = world({ holes: [CUP, { ...CUP, x: 20 }] });
    two.spawn(0, 20, 0, 3);
    two.spawn(0, 0, 0, 3);
    const holes: number[] = [];
    for (let f = 0; f < 120; f++) two.step(DT, (_k, _x, _y, _i, hole) => holes.push(hole));
    expect(holes.sort()).toEqual([0, 1]);
    // a hole with no rim pulls as holes always have, from its radius and 2.5 beyond, unless told otherwise
    const pulled = (hole: Partial<Hole>) => {
      const w = world({ holes: [{ x: 0, y: 0, radius: 2.5, depth: 4, ...hole }] });
      const i = w.spawn(0, -4.5, 0, R);
      for (let f = 0; f < 60; f++) w.step(DT, () => {});
      return w.alive[i] ? w.x[i] : 0;
    };
    expect(pulled({})).toBeGreaterThan(-4.5 + 0.05);
    expect(pulled({ pull: 0 })).toBeCloseTo(-4.5, 3);
    expect(pulled({ reach: 1 })).toBeCloseTo(-4.5, 3);
  });

  it("throws a ball higher off a bouncier rim, and the ball's bounce scales it", () => {
    const rose = (rim: number, bounce = 1) => putt(40, 0, { holes: [{ ...CUP, rim }], bounce: [bounce] }).highest;
    expect(rose(0.8)).toBeGreaterThan(rose(0) + 0.5);
    expect(rose(0.8, 0.5)).toBeLessThan(rose(0.8) - 0.3);
  });
});

describe('a ball running round inside a rim', () => {
  // ooergolf's own cup, and a ball as its fuzzer found it: in the cup's mouth, held up by the rim and going round
  // it at ten a second, a lap about as long as the sleep window, so it is back where it was each time the window closes
  const golf = (tuning: Partial<Tuning>) =>
    new World({
      capacity: 4,
      grid: GRID,
      solid: new Uint8Array(GRID.cols * GRID.rows),
      radii: [R],
      holes: [{ x: 0, y: 0, radius: 1.45, depth: 6, rim: 0.3, pull: 0 }],
      random: () => 0.5,
      tuning: { floorDrag: 0, travel: 0.5, sleepInAir: false, smoothWalls: true, ...tuning },
    });
  const round = (tuning: Partial<Tuning>) => {
    const w = golf(tuning);
    const i = w.spawn(0, 0.125, 0.547, 0.458, -10.7, 1.14, -1.61);
    let holed = false,
      sleptGoing = 0;
    for (let f = 0; f < 120 && w.alive[i]; f++) {
      const going = Math.hypot(w.vx[i], w.vy[i], w.vz[i]);
      w.step(DT, () => (holed = true));
      if (w.alive[i] && w.asleep[i]) sleptGoing = Math.max(sleptGoing, going);
    }
    return { holed, sleptGoing };
  };

  it('is put to sleep a lap in, going as it was, when sleep is judged only by where it has got to, as it always was', () => {
    const { holed, sleptGoing } = round({});
    expect(holed).toBe(false);
    expect(sleptGoing, 'asleep from about ten a second').toBeGreaterThan(5);
  });

  it('is never put to sleep going faster than sleepSpeed, and drops into the cup', () => {
    const { holed, sleptGoing } = round({ sleepSpeed: 2 });
    expect(sleptGoing, 'never asleep from faster than sleepSpeed').toBe(0);
    expect(holed, 'down the cup, as it goes once it slows').toBe(true);
  });

  it('with sleepSpeed set, a ball rolled to a stop on the floor still sleeps where it lies, as soon as it did without', () => {
    const settles = (tuning: Partial<Tuning>) => {
      const w = golf({ ...tuning, floorDrag: 5.5 });
      const i = w.spawn(0, -15, 8, R, 6, 0, 0);
      for (let f = 1; f < 600; f++) {
        w.step(DT, () => undefined);
        if (w.asleep[i]) return { f, x: w.x[i] };
      }
      return { f: Infinity, x: NaN };
    };
    expect(settles({ sleepSpeed: 2 })).toEqual(settles({}));
  });
});

describe('a coin and a cup', () => {
  const coins = (over: Partial<WorldOptions> = {}) =>
    new World({
      capacity: 8,
      grid: GRID,
      solid: new Uint8Array(GRID.cols * GRID.rows),
      radii: [0.42],
      thickness: [0.24],
      holes: [CUP],
      random: () => 0.5,
      ...over,
      tuning: { cell: 1.2, ...over.tuning },
    });

  it('falls into a hole on a raised floor, and is taken at its depth from that floor', () => {
    const floor = new Float32Array(GRID.cols * GRID.rows).fill(20);
    const w = coins({ floor });
    const i = w.spawn(0, 0, 0, 20.2);
    w.setOrientation(i, 0, 0, 0, 1);
    let taken = -1;
    // from 20 down to 19 is under a fifth of a second; to below 0, as it was taken before, near a second
    for (let f = 0; f < 60 && taken < 0; f++) w.step(DT, (_k, _x, _y, _i, hole) => (taken = hole === 0 ? f : taken));
    expect(taken).toBeGreaterThanOrEqual(0);
    expect(taken).toBeLessThan(20);
  });

  it('does not meet the rim: a coin slid over the edge goes as it would over a hole with none', () => {
    const slide = (rim?: number) => {
      const w = coins({ holes: [{ ...CUP, rim }] });
      const i = w.spawn(0, -3.2, 0.5, 0.12);
      w.setOrientation(i, 0, 0, 0, 1);
      w.hit(i, 4, 0, 0);
      const out: number[] = [];
      for (let f = 0; f < 60 && w.alive[i]; f++) {
        w.step(DT, () => {});
        out.push(w.x[i], w.y[i], w.z[i]);
      }
      return out;
    };
    expect(slide(0.9)).toEqual(slide());
  });
});
