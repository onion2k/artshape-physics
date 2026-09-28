/**
 * The ground's hills: a height a tile, at the tile's middle, smoothed into
 * ground a ball can roll over. The floor's heights are steps, flat on each
 * tile and a wall where they change; a fairway or a green is neither, and a
 * ball on it has to feel its slope and never meet an edge that is not there.
 *
 * The heights are smoothed as a uniform cubic B-spline, with the tile
 * middles as its points. The ground it makes is smooth in its slope and in
 * its curve, so a ball rolling over a seam between tiles is neither kinked
 * nor jolted; it never rises above the highest height given nor falls below
 * the lowest, so there are no ripples beside a sudden change; and a run of
 * equal heights is exactly flat. The price is that a height given is not
 * met exactly unless its neighbours share it: a lone raised tile is a mound
 * four ninths as high. Beyond the grid's edge the edge tiles' heights run on.
 *
 * This knows nothing of balls, the rock or the steps: it is handed the
 * heights and the grid, and says how high and how steep the terrain is at a
 * point, and whether a world could keep a ball on it. A game drawing the
 * ground reads it through the same functions, so what it draws is what the
 * world rolls on.
 */
import type { Grid, Hole } from './world';

/** A height as a message shows it: a Float32Array's 1.6 is 1.600000023841858 printed whole. */
const shown = (n: number) => +n.toFixed(4);

/**
 * The terrain's height at a point, and its slope along x and along y, into
 * `out`: the one reading of it the world makes, so it is made once a look
 * and not three times. Each height is taken less the height of the tile
 * middle the point lies after, so a run of equal heights sums to exactly
 * nothing, and is exactly flat: summed whole, the weights' rounding would
 * leave it a hair out of level, and a hair is a slope. Where the sixteen
 * middles round the point are all at one height, as most of a course is,
 * that is the height, and the smoothing is not worked out at all: a golf
 * course with hills on it cost a third more a frame than one without, and
 * most of that was working out ground that was flat.
 */
export function sample(terrain: Float32Array, grid: Grid, px: number, py: number, out: Float64Array): void {
  const { cols, rows, tile } = grid;
  const u = (px - grid.originX) / tile - 0.5,
    v = (py - grid.originY) / tile - 0.5;
  const kx = Math.floor(u),
    ky = Math.floor(v);
  // the columns and rows of the middles round the point, the edge ones running on past the grid
  const lastX = cols - 1,
    lastY = rows - 1;
  const c0 = kx - 1 < 0 ? 0 : kx - 1 > lastX ? lastX : kx - 1,
    c1 = kx < 0 ? 0 : kx > lastX ? lastX : kx,
    c2 = kx + 1 < 0 ? 0 : kx + 1 > lastX ? lastX : kx + 1,
    c3 = kx + 2 < 0 ? 0 : kx + 2 > lastX ? lastX : kx + 2;
  const r0 = (ky - 1 < 0 ? 0 : ky - 1 > lastY ? lastY : ky - 1) * cols,
    r1 = (ky < 0 ? 0 : ky > lastY ? lastY : ky) * cols,
    r2 = (ky + 1 < 0 ? 0 : ky + 1 > lastY ? lastY : ky + 1) * cols,
    r3 = (ky + 2 < 0 ? 0 : ky + 2 > lastY ? lastY : ky + 2) * cols;
  const base = terrain[r1 + c1];
  const e00 = terrain[r0 + c0] - base,
    e01 = terrain[r0 + c1] - base,
    e02 = terrain[r0 + c2] - base,
    e03 = terrain[r0 + c3] - base,
    e10 = terrain[r1 + c0] - base,
    e12 = terrain[r1 + c2] - base,
    e13 = terrain[r1 + c3] - base,
    e20 = terrain[r2 + c0] - base,
    e21 = terrain[r2 + c1] - base,
    e22 = terrain[r2 + c2] - base,
    e23 = terrain[r2 + c3] - base,
    e30 = terrain[r3 + c0] - base,
    e31 = terrain[r3 + c1] - base,
    e32 = terrain[r3 + c2] - base,
    e33 = terrain[r3 + c3] - base;
  if (
    e00 === 0 &&
    e01 === 0 &&
    e02 === 0 &&
    e03 === 0 &&
    e10 === 0 &&
    e12 === 0 &&
    e13 === 0 &&
    e20 === 0 &&
    e21 === 0 &&
    e22 === 0 &&
    e23 === 0 &&
    e30 === 0 &&
    e31 === 0 &&
    e32 === 0 &&
    e33 === 0
  ) {
    out[0] = base;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  const s = u - kx,
    t = v - ky;
  // the four weights along x, of the middles before, at, after and after that, and how fast each changes
  const s2 = s * s,
    s3 = s2 * s,
    ms = 1 - s;
  const a0 = (ms * ms * ms) / 6,
    a1 = (3 * s3 - 6 * s2 + 4) / 6,
    a2 = (-3 * s3 + 3 * s2 + 3 * s + 1) / 6,
    a3 = s3 / 6;
  const da0 = (-ms * ms) / 2,
    da1 = (3 * s2 - 4 * s) / 2,
    da2 = (-3 * s2 + 2 * s + 1) / 2,
    da3 = s2 / 2;
  // and along y
  const t2 = t * t,
    t3 = t2 * t,
    mt = 1 - t;
  const b0 = (mt * mt * mt) / 6,
    b1 = (3 * t3 - 6 * t2 + 4) / 6,
    b2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6,
    b3 = t3 / 6;
  const db0 = (-mt * mt) / 2,
    db1 = (3 * t2 - 4 * t) / 2,
    db2 = (-3 * t2 + 2 * t + 1) / 2,
    db3 = t2 / 2;
  // each row along x, and how fast it rises along x; the one the point lies after is its own base, and nothing
  const along0 = a0 * e00 + a1 * e01 + a2 * e02 + a3 * e03,
    along1 = a0 * e10 + a2 * e12 + a3 * e13,
    along2 = a0 * e20 + a1 * e21 + a2 * e22 + a3 * e23,
    along3 = a0 * e30 + a1 * e31 + a2 * e32 + a3 * e33;
  const rise0 = da0 * e00 + da1 * e01 + da2 * e02 + da3 * e03,
    rise1 = da0 * e10 + da2 * e12 + da3 * e13,
    rise2 = da0 * e20 + da1 * e21 + da2 * e22 + da3 * e23,
    rise3 = da0 * e30 + da1 * e31 + da2 * e32 + da3 * e33;
  out[0] = base + (b0 * along0 + b1 * along1 + b2 * along2 + b3 * along3);
  out[1] = (b0 * rise0 + b1 * rise1 + b2 * rise2 + b3 * rise3) / tile;
  out[2] = (db0 * along0 + db1 * along1 + db2 * along2 + db3 * along3) / tile;
}

const scratch = new Float64Array(3);

/** How high the terrain rises at a point: for a game drawing the ground, and for a test. */
export function heightAt(terrain: Float32Array, grid: Grid, x: number, y: number): number {
  sample(terrain, grid, x, y, scratch);
  return scratch[0];
}

/** How steeply the terrain rises at a point, along x and along y: units up for each unit across. */
export function slopeAt(terrain: Float32Array, grid: Grid, x: number, y: number): [number, number] {
  sample(terrain, grid, x, y, scratch);
  return [scratch[1], scratch[2]];
}

/**
 * What is wrong with a terrain for a world, or nothing. A world will not
 * be made on a terrain it cannot keep a ball on, and says why, naming the
 * tile: a ball is kept on the ground by its slope under the ball's middle,
 * which is near enough the slope where it touches only on ground no
 * steeper than one in two, and curved no more sharply than the ball, so
 * the steepest the tiles may rise from one to the next is half a tile, and
 * a tile may be no narrower than the biggest ball. Every tile counts, the
 * rock's too, since each shapes the ground two tiles round it. A hole may
 * be cut in any ground this allows: its rim is its edge where it meets the
 * ground, and leans with it. `holes` was for the level ground a cup's rim
 * once needed, and is kept so a game written against v0.6.0 still builds.
 */
export function terrainProblem(
  terrain: Float32Array,
  grid: Grid,
  biggest: number,
  _holes: readonly Hole[] = [],
): string | null {
  const { cols, rows, tile } = grid;
  if (terrain.length !== cols * rows)
    return `The terrain has ${terrain.length} heights, and the grid ${cols * rows} tiles: it is one height a tile.`;
  if (tile < 2 * biggest)
    return `The tiles, ${tile} across, are narrower than the biggest ball, ${2 * biggest} across: a ball can sit in no hollow they make.`;
  const steepest = tile / 2;
  for (let ty = 0; ty < rows; ty++)
    for (let tx = 0; tx < cols; tx++) {
      const h = terrain[ty * cols + tx];
      for (const [nx, ny] of [
        [tx + 1, ty],
        [tx, ty + 1],
      ]) {
        if (nx >= cols || ny >= rows) continue;
        const rise = terrain[ny * cols + nx] - h;
        if (Math.abs(rise) > steepest)
          return `The terrain at tile ${tx}, ${ty} is ${shown(Math.abs(rise))} ${rise > 0 ? 'below' : 'above'} tile ${nx}, ${ny}: tiles side by side may differ by at most half a tile, ${steepest}.`;
      }
    }
  return null;
}
