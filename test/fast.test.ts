/**
 * A fast ball kept out of walls. A ball is moved a step at a time and then
 * looked at, and one that goes further in a step than its radius can end it
 * with its middle in a wall, and be put back and stopped dead, or past the
 * wall altogether. Given a `travel`, a ball goes in pieces no longer than
 * that share of its radius, and is looked at after each. These are the
 * speeds ooergolf shoots at, and headroom above them for a bumper's kick,
 * against the thinnest things a course has: rock a tile thick on tiles 3
 * across and 1 across, a blade half a unit thick, a thin post, and a raised
 * tile of floor a tile wide.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, World, type Bumper, type Grid, type Pusher, type Tuning } from '../src/world';

/** The starting club, the best club, and what the package is to hold at: ooergolf's. */
const TARGETS = [40, 60, 120];
/** A 120 u/s ball off a bumper of up to 2. */
const HEADROOM = [240];
const SPEEDS = [...TARGETS, ...HEADROOM];
/** Ooergolf's ball, and a coin-sized one, which a step takes further past its own radius. */
const RADII = [1, 0.42];
const ANGLES = [0, 30, 60];
/** How many places within a step's travel a ball is started from, so it meets the wall at every phase of a step. */
const PHASES = 5;
const STEP = 1 / 120;
/** Pieces half a ball's radius long, and walls a ball banks off as off one flat wall, as ooergolf is to have them. */
const PIECES: Partial<Tuning> = { travel: 0.5, smoothWalls: true };

const COARSE: Grid = { cols: 40, rows: 40, originX: -60, originY: -60, tile: 3 };
const FINE: Grid = { cols: 60, rows: 60, originX: -30, originY: -30, tile: 1 };

/** A grid with a column of rock one tile thick at column 30, and nothing else. */
function column(grid: Grid): Uint8Array {
  const out = new Uint8Array(grid.cols * grid.rows);
  for (let ty = 0; ty < grid.rows; ty++) out[ty * grid.cols + 30] = 1;
  return out;
}

const worldOn = (grid: Grid, tuning: Partial<Tuning>, over: { solid?: Uint8Array; floor?: Float32Array } = {}) =>
  new World({
    capacity: 4,
    grid,
    solid: over.solid ?? new Uint8Array(grid.cols * grid.rows),
    floor: over.floor,
    radii: RADII,
    random: () => 0.5,
    tuning: { floorDrag: 0, ...tuning },
  });

const tileOf = (w: World, i: number) => {
  const g = w.grid;
  const tx = Math.floor((w.x[i] - g.originX) / g.tile),
    ty = Math.floor((w.y[i] - g.originY) / g.tile);
  return { tx, ty, t: ty * g.cols + tx };
};

/** Every case: a grid, a speed, a ball, an angle and a phase. */
function* cases(speeds: number[]) {
  for (const grid of [COARSE, FINE])
    for (const speed of speeds)
      for (let kind = 0; kind < RADII.length; kind++)
        for (const angle of ANGLES)
          for (let phase = 0; phase < PHASES; phase++) yield { grid, speed, kind, angle, phase };
}

/**
 * A ball sent at the rock column: whether it ever had its middle in a wall
 * tile or ended past the column, and how fast it left it, across and along.
 */
function atRock(grid: Grid, speed: number, kind: number, angle: number, phase: number, tuning: Partial<Tuning>) {
  const w = worldOn(grid, tuning, { solid: column(grid) });
  const face = grid.originX + 30 * grid.tile;
  const a = (angle * Math.PI) / 180,
    vx = speed * Math.cos(a),
    vy = speed * Math.sin(a);
  // far enough back for a few steps' run up, and shifted by a share of a step's travel
  const x = face - RADII[kind] - 3 * vx * STEP - (phase / PHASES) * vx * STEP;
  const i = w.spawn(kind, x, 0, RADII[kind], vx, vy, 0);
  let inRock = false,
    out: { across: number; along: number } | null = null;
  for (let s = 0; s < 60; s++) {
    const before = w.vx[i];
    w.step(STEP, () => {});
    if (w.solid[tileOf(w, i).t]) inRock = true;
    // the first time it turns back: a fast one can cross the grid and come back again in the steps watched
    if (!out && before > 0 && w.vx[i] <= 0) out = { across: -w.vx[i] / vx, along: w.vy[i] / (vy || 1) };
  }
  return { inRock, past: w.x[i] > face, ...(out ?? { across: 0, along: 0 }) };
}

describe('a fast ball', () => {
  it('goes in one piece a step unless given a travel', () => {
    expect(DEFAULT_TUNING.travel).toBe(Infinity);
  });

  it('bounces off rock a tile thick by the same figure at every speed and every phase of a step, and never gets into it', () => {
    const wrong: string[] = [];
    for (const { grid, speed, kind, angle, phase } of cases(SPEEDS))
      for (const wallRestitution of [0.1, 0.8]) {
        const r = atRock(grid, speed, kind, angle, phase, { ...PIECES, wallRestitution });
        const at = `${speed} u/s, radius ${RADII[kind]}, ${angle}°, phase ${phase}, tiles ${grid.tile}, e ${wallRestitution}`;
        if (r.inRock) wrong.push(`${at}: its middle in the rock`);
        if (r.past) wrong.push(`${at}: through the rock`);
        if (Math.abs(r.across - wallRestitution) > 0.02 * wallRestitution + 1e-3)
          wrong.push(`${at}: left at ${r.across.toFixed(3)} of its speed across`);
        if (angle && Math.abs(r.along - 1) > 0.02) wrong.push(`${at}: kept ${r.along.toFixed(3)} of its speed along`);
      }
    expect(wrong.slice(0, 8), `${wrong.length} wrong`).toEqual([]);
  });

  it('left in one piece, is stopped dead by the rock in some phases at 120 u/s, and gets past it at the headroom', () => {
    // what the pieces are for, seen as it is without them
    let dead = 0,
      through = 0;
    for (const { grid, speed, kind, angle, phase } of cases([120, 240])) {
      const r = atRock(grid, speed, kind, angle, phase, { wallRestitution: 0.8 });
      if (!r.past && r.across < 0.4) dead++;
      if (r.past) through++;
    }
    expect(dead).toBeGreaterThan(0);
    expect(through).toBeGreaterThan(0);
  });

  it('never passes through a blade half a unit thick, still or coming at it', () => {
    const wrong: string[] = [];
    for (const { grid, speed, kind, angle, phase } of cases(SPEEDS))
      for (const coming of [0, 20, 40]) {
        const w = worldOn(grid, PIECES);
        const a = (angle * Math.PI) / 180,
          vx = speed * Math.cos(a);
        let bx = 0;
        const i = w.spawn(kind, -RADII[kind] - 0.25 - 3 * vx * STEP - (phase / PHASES) * vx * STEP, 0, RADII[kind]);
        w.hit(i, vx, speed * Math.sin(a), 0);
        for (let s = 0; s < 40; s++) {
          bx -= coming * STEP;
          const blade: Pusher = {
            x: bx,
            y: 0,
            z: 1,
            yaw: 0,
            hx: 0.25,
            hy: 20,
            hz: 1,
            vx: -coming,
            vy: 0,
            spin: 0,
            px: bx,
            py: 0,
            owner: 0,
          };
          w.pushers = [blade];
          w.step(STEP, () => {});
        }
        if (w.x[i] > bx)
          wrong.push(`${speed} u/s, radius ${RADII[kind]}, ${angle}°, phase ${phase}, blade at ${coming}: through it`);
      }
    expect(wrong.slice(0, 8), `${wrong.length} wrong`).toEqual([]);
  });

  it('never passes into a thin post, nor through a raised tile of floor a tile wide', () => {
    const wrong: string[] = [];
    const post: Bumper = { x: 0, y: 0, radius: 0.3, top: 3, restitution: 1 };
    for (const { grid, speed, kind, angle, phase } of cases(SPEEDS)) {
      const at = `${speed} u/s, radius ${RADII[kind]}, ${angle}°, phase ${phase}, tiles ${grid.tile}`;
      const a = (angle * Math.PI) / 180,
        vx = speed * Math.cos(a),
        vy = speed * Math.sin(a);
      // at the post, from off to the side by as much as it runs along in its run up, so it meets it square
      const w = worldOn(grid, PIECES);
      w.bumpers = [post];
      const back = post.radius + RADII[kind] + 3 * speed * STEP + (phase / PHASES) * speed * STEP;
      const i = w.spawn(kind, -back * Math.cos(a), -back * Math.sin(a), RADII[kind], vx, vy, 0);
      let nearest = Infinity;
      for (let s = 0; s < 40; s++) {
        w.step(STEP, () => {});
        nearest = Math.min(nearest, Math.hypot(w.x[i], w.y[i]));
      }
      if (nearest < post.radius + RADII[kind] - 0.01) wrong.push(`${at}: ${nearest.toFixed(3)} from the post's axis`);
      // at a tile of floor standing 4 high, one tile wide
      const floor = new Float32Array(grid.cols * grid.rows);
      for (let ty = 0; ty < grid.rows; ty++) floor[ty * grid.cols + 30] = 4;
      const v = worldOn(grid, PIECES, { floor });
      const face = grid.originX + 30 * grid.tile;
      const j = v.spawn(
        kind,
        face - RADII[kind] - 3 * vx * STEP - (phase / PHASES) * vx * STEP,
        0,
        RADII[kind],
        vx,
        vy,
        0,
      );
      for (let s = 0; s < 40; s++) v.step(STEP, () => {});
      if (v.x[j] > face) wrong.push(`${at}: through the raised tile`);
    }
    expect(wrong.slice(0, 8), `${wrong.length} wrong`).toEqual([]);
  });

  it('keeps out of the rock and bounces by its figure at frames of 1/30, 1/60 and 1/144', () => {
    const wrong: string[] = [];
    for (const dt of [1 / 30, 1 / 60, 1 / 144])
      for (const speed of SPEEDS)
        for (let kind = 0; kind < RADII.length; kind++)
          for (let phase = 0; phase < PHASES; phase++) {
            const grid = COARSE;
            const w = worldOn(grid, { ...PIECES, wallRestitution: 0.8 }, { solid: column(grid) });
            const face = grid.originX + 30 * grid.tile;
            const i = w.spawn(
              kind,
              face - RADII[kind] - 3 * speed * dt - (phase / PHASES) * speed * dt,
              0,
              RADII[kind],
            );
            w.hit(i, speed, 0, 0);
            let left = 0;
            for (let f = 0; f < 0.5 / dt; f++) {
              const before = w.vx[i];
              w.step(dt, () => {});
              if (w.solid[tileOf(w, i).t]) wrong.push(`${speed} u/s at 1/${Math.round(1 / dt)}: in the rock`);
              if (before > 0 && w.vx[i] <= 0) left = -w.vx[i] / speed;
            }
            if (w.x[i] > face) wrong.push(`${speed} u/s at 1/${Math.round(1 / dt)}: through`);
            if (Math.abs(left - 0.8) > 0.02 * 0.8)
              wrong.push(`${speed} u/s, radius ${RADII[kind]} at 1/${Math.round(1 / dt)}: left at ${left.toFixed(3)}`);
          }
    expect(wrong.slice(0, 8), `${wrong.length} wrong`).toEqual([]);
  });

  it("is never passed through, at rest, by a windmill blade whose tip moves at up to the blade's own limit", () => {
    // A box is put where it is once a step and its own move is not pieced, so it must move less in a step than
    // its half thickness and a ball's radius: 1.25 units, or 150 u/s, for a ball of radius 1. At 140 it holds.
    const w = worldOn(COARSE, PIECES);
    const i = w.spawn(0, 0, 6, RADII[0]);
    const spin = 140 / 6;
    let struck = 0;
    for (let s = 0; s < 12; s++) {
      const a = spin * s * STEP;
      w.pushers = [
        {
          x: 3.5 * Math.cos(a),
          y: 3.5 * Math.sin(a),
          z: 1,
          yaw: a,
          hx: 3.5,
          hy: 0.25,
          hz: 1,
          vx: 0,
          vy: 0,
          spin,
          px: 0,
          py: 0,
          owner: 0,
        },
      ];
      w.step(STEP, () => {});
      struck = Math.max(struck, Math.hypot(w.vx[i], w.vy[i]));
    }
    // struck off at the speed of the blade where it met it, and not left behind it
    expect(struck).toBeGreaterThan(100);
  });

  it('is slowed, carried and counted once a step in pieces, as in one', () => {
    // A small ball at 60 u/s goes in three pieces at a travel of half its radius. What happens once a step, the
    // floor's drag and roll, a belt, a box's carry and its load, must not happen once a piece.
    const pieced = (travel: number) => {
      const w = new World({
        capacity: 4,
        grid: COARSE,
        solid: new Uint8Array(COARSE.cols * COARSE.rows),
        radii: [0.42],
        random: () => 0.5,
        surfaces: [{ drag: 2, roll: 10 }],
        tuning: { travel },
      });
      // rolling on the floor
      const rolling = w.spawn(0, -50, -40, 0.42, 60, 0, 0);
      // across a belt going the other way
      w.belts = [{ cx: -30, cy: -20, half: 30, width: 4, dx: -1, dy: 0, speed: 9 }];
      const belted = w.spawn(0, -55, -20, 0.42, 60, 0, 0);
      // along the face of a still box, pressed into it
      const box: Pusher = {
        x: 0,
        y: 20,
        z: 1,
        yaw: 0,
        hx: 0.5,
        hy: 30,
        hz: 1,
        vx: 0,
        vy: 0,
        spin: 0,
        px: 0,
        py: 20,
        owner: 0,
      };
      w.pushers = [box];
      const pressed = w.spawn(0, -0.92, -5, 0.42, 1, 60, 0);
      let load = 0;
      for (let s = 0; s < 20; s++) {
        w.step(STEP, () => {});
        load += w.load;
      }
      return { rolled: w.x[rolling], belted: w.vx[belted], carried: w.vy[pressed], load };
    };
    const one = pieced(Infinity),
      many = pieced(0.5);
    expect(many.rolled).toBeCloseTo(one.rolled, 1);
    expect(many.belted / one.belted).toBeCloseTo(1, 2);
    expect(many.carried / one.carried).toBeCloseTo(1, 2);
    expect(many.load).toBe(one.load);
    expect(one.load).toBeGreaterThan(10);
  });
});
