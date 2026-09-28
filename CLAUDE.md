# artshape-physics: working on it

A world of spheres and coins, stepped at a fixed rate, for games with many
small things rolling about a floor. It ships TypeScript sources, and games
take it in by a git tag (`github:onion2k/artshape-physics#vX.Y.Z`). The
README says what it does; this file says how it is made. The house rules in
`~/.claude/CLAUDE.md` apply too.

Written on 27 September 2026 from what the code and `package.json` do at
v0.3.0 (96e4646), because the house rules want these nouns in place before a
feature lands.

## Who uses it

A change is a change to every game that pins it. Each one must behave
exactly as before unless it opts in to something new, so a new option
defaults to today's behaviour, and the existing tests pass unchanged.

| Game      | Pins   | Uses                                                                          |
| --------- | ------ | ----------------------------------------------------------------------------- |
| pushminer | v0.1.0 | balls, rock, one hole, pushers, belts, the magnet                             |
| coinpush  | v0.3.0 | discs, floor heights, the bottom, pushers                                     |
| ooergolf  | v0.5.1 | balls, rock, floor heights, surfaces, bouncing boxes, belts, a cup with a rim |
| template  | v0.1.0 | `~/projects/artshape-game-template`, what new games start from                |

arena and bearing do not use it. bearing moved to Rapier, because it
needed slopes, before there was terrain; a marble run is steeper than
terrain may be.

## Commands

    npm run check          the full check: check:quick, then the bench (~20 s)
    npm run check:quick    formatting, types, lint, and the tests (~10 s)
    npm test               the tests alone (Vitest, test/), the unchanged gate and the golf fuzzer among them
    npm run test:watch     the tests, again on each save
    npm run bench          a frame's cost in five scenes, held to scripts/bench-baseline.json and a budget (~9.5 s)
    npm run typecheck      tsc, no emit
    npm run lint           eslint, type-aware
    npm run format         prettier, writing

`npm run bench -- --update` writes the bench's baseline again, every scene
of it, and `UNCHANGED_UPDATE=1 npx vitest run test/unchanged.test.ts` the
unchanged gate's hashes. Each is only for a change meant to move it, and
the commit says why. There is no pre-commit hook: run `check:quick` before
a commit.

The gates, one by one:

- **Format:** `prettier --check`. The formatter decides the formatting.
- **Types:** `tsc --noEmit`, strict, with no unused locals or parameters.
- **Lint:** `eslint`, with typescript-eslint's type-checked rules,
  `switch-exhaustiveness-check` and `no-unnecessary-condition`. It is for
  mistakes, not style.
- **Tests:** `vitest run`. Every behaviour the README claims has a test.
  `test/settle.test.ts` counts heaps coming to rest over runs of seeds,
  judged together and each on its own window, in a file of its own so it
  runs beside the rest. A test is allowed 30 s, set in `vitest.config.ts`,
  only so one that never ends is caught: the heaviest take 4 s on a quiet
  machine and 6 on a busy one, and speed is the bench's to hold.
- **Fuzzer:** `test/golf.fuzz.test.ts`, among the tests. A round of golf
  played at random from 24 seeds on a course with everything ooergolf asks
  for, hills among it (a mound, a hollow, a bank as steep as terrain may
  be, a green falling away across the way to the cup, and the cup on the
  flank of a cone as steep as terrain may be, its rim leaning with it),
  each seed twice, each body on its own sleep window and judged together,
  and after every step: the ball's middle never under the ground or in a
  wall, never more than a tenth into a box or a post, nor into the cup's
  rim, looked at all round, nor into the terrain on its own step of the
  floor, never sped up but by gravity or a bumper or a moving
  box, never put to sleep going faster than its `sleepSpeed`, reported at
  most once, every shot ended within 30 s, and none asleep sooner than its
  window lets it: a whole window after it was struck, or judged together,
  on a tick with half of one. With `FUZZ_NO_SLEEP_SPEED=1` it plays without
  the option, and 30 of 500 seeds on their own windows put a ball to sleep
  going at 2.6 to 24 a second (37, at 3 to 12, before the course had
  hills). `FUZZ_SEEDS=1-500 npx vitest run test/golf.fuzz.test.ts` for
  more, about 35 s, whose time allowed grows with the seeds; a failure
  names its seed, shot and step. A course is not to drive a box against a
  wall with less than a ball's width between: the ball is in one or the
  other, and the rock, looked at last, wins. Nor is a moving box to stand
  on a slope, where a ball rolled back against it each time it gets ahead
  is carried round for good. A ball has no top edge of a step to meet, and
  one flown just over a step overlaps its edge by up to two thirds of a
  unit; the rule of the terrain is kept to the ball's own step for that.
- **Unchanged:** `test/unchanged.test.ts`, among the tests. Six scenes run
  from seeds with no new option set, every body's state hashed at frames
  60, 300 and 600, and held bit for bit to `test/unchanged.json`, written at
  v0.3.0; and a seventh, of balls and coins on terrain round a cup and a
  hole on level ground, written by v0.6.0's own source before a cup's rim
  could lean. It is what says a game that has not opted in behaves exactly
  as before. Each scene is run twice, so a hash that moves is a change and not
  chance. A Node upgrade that moves it is confirmed on the old commit first.
- **Bench:** `scripts/bench.ts`. Five scenes, one for each game's costly
  part and one of a heap at rest judged together, each run four times fresh
  in a worker, the fastest counted, and held as a multiple of a piece of
  reference arithmetic, so a baseline written on one machine means
  something on another. It fails at 20% slower or faster
  than the baseline, past a slack of a fifth of a microsecond, over a
  scene's budget, or when a scene's runs do not end alike.

The README gives the cost of a coin bed as the bench measures it: about
1.8 ms a frame with three hundred awake, 3.2 with four hundred, and 1.24 on
average while the pusher is in it. The bench times that scene only while
the pusher is in the bed, since the frames either side of it cost next to
nothing and halved the figure. Coinpush's own bench puts its whole machine
at 2.2 to 2.5 ms a frame.

## Layout

- `src/world.ts` is the whole of the thing: `World`, `WorldOptions`,
  `Tuning` and `DEFAULT_TUNING`, `Pusher`, `Belt`, `Hole`, `Grid`. It owns the
  typed arrays a body is kept in, the fixed step, sleeping, the two hashes
  (the awake one, rebuilt each step, and the sleepers', kept from one step to
  the next), ball against ball, the rock, the floor and its heights, holes,
  the bottom, pushers, belts and the magnet.
- `src/terrain.ts` is the terrain's arithmetic: `sample` (the height and
  slope at a point, as the world reads them), `heightAt` and `slopeAt` (the
  same for a game drawing the ground, or a test), and `terrainProblem`
  (why a world will not be made on it, or nothing). It is handed the
  heights and the grid, and knows nothing of bodies.
- `src/disc.ts` is `Discs`, the coins. They are solved by position, and
  nothing about them bounces. It works on the world's arrays, which are
  handed in, and knows nothing of the grid, the sleeping or the hash. The
  world asks it about a pair, a plane, a lip or a disc.
- There is no page and no picture. What a body is drawn as is the game's
  business. The world gives the game typed arrays to read (`x`, `y`, `z`,
  `q`, `alive`, `asleep`, ...), and tells it about bodies that leave the
  world through the `collect` callback on `step`.
- **Content** is the caller's: the grid, `solid` (one byte a tile), `floor`
  and `terrain` (one float a tile each), `holes`, `radii`, `thickness`, the
  `pushers` and `belts` lists, and `tuning`. `solid`, `floor` and `terrain`
  are read every step and may be rewritten in place; the terrain is checked
  only when the world is made.
- **The persisted shape** is `WorldOptions`, `Tuning`, `Pusher`, `Belt` and
  `Hole`, as the games build them in their own `physics.ts`. Nothing is
  saved to disk, but a game's code written against an old shape must still
  compile and behave the same. A new field is optional, and its default is
  today's behaviour.

## Model features

- **Something a game sees:** floor heights and the bottom (567b6a8). It is an
  optional `WorldOptions` field with a default that leaves the world as it
  was, the one place it is read (`floorAt`, `wallAt`), a test in
  `test/world.test.ts` on a grid the test builds for itself, and a
  paragraph in the README. Terrain is the larger shape of it: an optional
  field, a module of its own for the arithmetic, a branch in the ball's
  floor and the coin's, a file of tests, and a test that the field given
  its most ordinary value steps the world exactly as none does.
- **A kind of body:** discs (96e4646). A per-kind array (`thickness`), a
  module of its own that is handed the world's arrays, a branch at every
  path a body can take (integrate, pairs, boxes, rock, floor, holes, bottom,
  sleep), and a test file of its own.
- **A tool that measures:** `World.deepest(resting)`, which says how far any
  two bodies are into each other, and `problems()` in `test/world.test.ts`,
  which checks the sleep bookkeeping between steps. Both are read by tests
  and changed by nothing. For a gate, the bench (`scripts/bench.ts`) and the
  unchanged gate: a scene each for what is held, from a seed, checked to be
  the same work each run, and seen to fail when the thing it holds is
  broken on purpose.

## The test API

The tests use the public `World` and nothing else, except `problems()` and
`stepTogether()`, which cast to an `Innards` interface to read the private
lists, the fixed steps taken (`steps`) and when each body's sleep window
opened (`opened`).

- **Setting up:** `new World({...})` on a grid of the test's own
  (`GRID`, with `solid()` giving a border of rock and whatever else a
  predicate marks), `seeded(n)` for chance, `spawn(kind, x, y, z, vx?, vy?,
vz?)`, `setOrientation`, `hit(i, vx, vy, vz)` (or writing `vx`/`vy`/`vz` and
  then `wake(i)`, as the older tests do),
  `wakeNear`, `wakeAll`, `carried[i] = 1`, and assigning `pushers`,
  `belts`, `magnet` and a `floor` array. `sweeper()` drives a box round a
  circle. `flat()` and `onEdge()` put a disc down. In
  `test/terrain.test.ts`, `terrainOf(fn)` makes a terrain from a height a
  tile, `incline(slope)` an even slope, and `putDown` a ball at rest on
  the ground.
- **Time:** `step(DT, collect)` at `DT = 1/60`, which is two fixed steps of
  1/120. The steps are counted, and nothing waits on a clock.
- **Reading:** the typed arrays, `live`, `count`, `loads`, `load`, `axis(i)`,
  `floorAt(x, y)`, `deepest(resting)`, what `collect` was called with,
  `problems(world)`, `stepTogether(world, dt)`, which steps a frame and says
  what went to sleep off the tick or on a sliver of a window,
  `wokenAgain(world, bodies, steps)`, which counts sleepers woken, looking
  after every fixed step, and `countThickness(world)`, which counts every
  read of a body's thickness from then on, and so how often the world has
  asked whether a body is a disc. `heightAt` and `slopeAt` from
  `src/terrain` read the terrain alone, and `intoGround(w, i)`, in the
  terrain tests and the fuzzer, says how far a ball is into the ground by
  looking at the ground all round under it, not by the world's reckoning;
  `intoRim` does the same for a cup's rim, looking at it all round, and
  `touching` puts a ball down touching the ground at a point, its middle
  its radius off along the ground's normal.

## Edge-case checklist

For anything new, say what it does in each case, and test each one that
applies:

- **Asleep:** the thing meets a sleeper, a sleeper lies against it or on
  it, it wakes what it should and only that, and a body can come to rest
  against it and sleep. Nothing new costs anything for a sleeper that is
  not touched. A thing that can hold a body up marks it `BORNE` when it
  touches it below its middle, or with `sleepInAir` off a body resting on
  it never sleeps. A body that can come back round to where it was in a
  sleep window, running round a rim or between two things, is held awake by
  `sleepSpeed`, and needs a test that it is. Anything that opens a body's
  sleep window says so, and with `sleepTogether` a body is judged only on a
  tick, with half a window behind it. On terrain a ball on ground too
  steep for its surface's roll and drag to hold it is neither settled nor
  put to sleep, unless something else holds it: a new thing a ball can
  rest against marks it `PROPPED`, or a ball against it on a slope never
  sleeps.
- **Carried:** a body with `carried[i]` set is not stepped, and nothing new
  moves it or reports it. Its sleep window is opened afresh each step it is
  held, so let go it is judged from then, and falls before it can sleep. A
  sleeper taken up is not seen by the world until something wakes it.
- **Discs as well as spheres:** every path has a disc branch, or says why it
  does not need one. Discs are solved by position and never bounce. With
  `squeezedStill` a disc is never read back going faster than it went in a
  step, nor spinning faster than it turned, on any path that pushes it; a
  new one joins the scene in `test/squeeze.test.ts` that holds it to that.
  A world with no discs pays nothing for a disc branch: in the walk of
  pairs, whether a world has discs is asked once a step and whether a body
  is one once a body, never of every pair looked at, and `countThickness`
  holds a heap of balls to it.
- **Rock:** against a face, banking along a wall of several tiles (with and
  without `smoothWalls`), at a corner that stands out, into the inside of a
  corner, and shoved in by a box; never left in it.
- **Off the grid:** `wallAt` treats off the grid as a wall, `floorAt` treats
  it as flat at 0, and the hash clamps to its edge cells.
- **Floor heights:** on a raised tile, at a step face from below, at an edge
  from above, and a hole or other thing standing on a tile that is not at 0.
- **Terrain:** on a slope its surface holds, one a twentieth steeper, and
  one only its drag holds; rolling down, breaking across, up and back,
  landing on it; never a wall, a step on it still one, judged from the
  ground under the body; whatever reads the floor (`floorAt`) reading the
  ground; a coin lying and sliding along it; the steepest and the sharpest
  it may be, with nothing more than a tenth into it; a hole cut in it,
  level and sloping; the refusals; and level terrain stepping a world
  exactly as none.
- **Surfaces:** on each surface of a table, a surface the table has no
  entry for (the tuning's figures), a world given no table, and off the
  grid, which is surface 0.
- **The bottom:** a body that falls out is reported once, through `collect`,
  and its slot is freed.
- **At capacity:** `spawn` returns -1, a freed slot is used again first, and
  the cost holds with thousands of bodies in the hash.
- **Holes:** over one, beside one, at the rim, and more than one hole; a
  hole cut in a raised floor; and a cup's rim: tipping in, caught, run over,
  lipped out, landed on from the air. On terrain, each of those on every
  side of a cup on a slope, uphill, downhill and across, on the steepest
  ground there may be; a ball over the hole by where it touches the ground;
  a ball down the pit below the ground over it, held by the pit's wall under
  the uphill edge, and no step round it a wall to it.
- **Pushers:** still, moving, turning (`spin`), swept by the frame's lag, a
  body on the top of one, and the load count.
- **Frame length:** `step(dt)` with dt of 1/30, 1/60 and 1/144. The
  accumulator runs at most 4 fixed steps a frame.
- **Determinism:** the same seed and the same inputs give the same world,
  bit for bit. Chance only ever comes from `random`, and bodies are always
  visited in slot order.
- **A fast body against a thin thing:** a wall one tile thick, the thinnest
  pusher, and the fastest a body is meant to go, which must not pass through.
- **Unchanged by default:** a world built without the new option behaves
  exactly as it did before, and so does every game that pins it.

## Gates and baselines

| Gate      | Holds the package to                                                                | Baseline and tolerance                                                                                                                |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Format    | prettier's formatting                                                               | none: pass or fail                                                                                                                    |
| Types     | strict TypeScript                                                                   | none: pass or fail                                                                                                                    |
| Lint      | the type-aware rules                                                                | none: pass or fail                                                                                                                    |
| Tests     | every behaviour the README claims                                                   | 189 at v0.7.0 (178 at v0.6.0, 143 at v0.5.1, 142 at v0.5.0, 131 at v0.4.3, 127 at v0.4.2, 123 at v0.4.1, 120 at v0.4.0, 30 at v0.3.0) |
| Unchanged | every game's world as v0.3.0 stepped it, and terrain round level cups as v0.6.0 did | `test/unchanged.json`, bit for bit                                                                                                    |
| Fuzzer    | the rules a golf ball keeps, struck at random                                       | 24 seeds of 12 shots, each both ways, every rule on every step                                                                        |
| Bench     | what a frame costs, in five scenes                                                  | `scripts/bench-baseline.json`, ±20% both ways, 0.0002 ms slack                                                                        |

The bench's budgets, in milliseconds a frame on the fastest run, and its
baselines as written (on an M4 Pro, Node 23.4.0):

| Scene                                                | Stands for            | Budget | Baseline |
| ---------------------------------------------------- | --------------------- | ------ | -------- |
| a heap of 2000 balls churned by two pushers          | pushminer             | 3      | 1.65     |
| a bed of 1500 discs, timed while the pusher is in it | coinpush              | 4      | 1.24     |
| one ball shot round a golf course                    | ooergolf              | 0.1    | 0.0019   |
| 64 balls on that course at 120 u/s                   | ooergolf, at capacity | 1      | 0.058    |
| a heap of 2000 balls at rest, judged together        | pushminer, at rest    | 0.01   | 0.0006   |

The tolerance is the measured wobble with room to spare: over three runs
no scene moved by more than 7%. The golf scenes grow as the golf features
land, and each baseline is written again then, saying why. The churned
heap's was written again at v0.5.1, when a world with no discs was given
back the sixth of a frame it had cost since v0.3.0. The golf scenes' were
written again when terrain landed and the course was given hills: 64
balls cost a third more, nearly all of it reading the ground, as the
course with its terrain flat at nothing measured. They were written again
when a cup's rim could lean and the course's cup was put on a slope: the
round is timed over 3600 frames, since its twelve shots take 3520 now,
and 64 balls end with 58 awake where they ended with 60, at a cost within
the wobble of what it was.

## Releasing

Bump `version` in `package.json`, commit, and tag `vX.Y.Z`. Each game then
moves up in its own repo by changing its pin, with its own checks green.
Commit, tag and push only when asked.

## Style

Comments are full sentences in the house voice, saying why and not what.
Each file's header says what the file is for. Names are plain: a body, a
kind, a tile, a pusher, a hole.
