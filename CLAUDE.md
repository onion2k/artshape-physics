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

| Game      | Pins   | Uses                                                           |
| --------- | ------ | -------------------------------------------------------------- |
| pushminer | v0.1.0 | balls, rock, one hole, pushers, belts, the magnet              |
| coinpush  | v0.3.0 | discs, floor heights, the bottom, pushers                      |
| ooergolf  | v0.1.0 | balls and rock, for now; the golf is on its way                |
| template  | v0.1.0 | `~/projects/artshape-game-template`, what new games start from |

arena and bearing do not use it. bearing moved to Rapier, because it
needed slopes.

## Commands

    npm run check          the full check: check:quick, then the bench (~16 s)
    npm run check:quick    formatting, types, lint, and the tests (~7 s)
    npm test               the tests alone (Vitest, test/), the unchanged gate among them
    npm run test:watch     the tests, again on each save
    npm run bench          a frame's cost in four scenes, held to scripts/bench-baseline.json and a budget (~8.5 s)
    npm run typecheck      tsc, no emit
    npm run lint           eslint, type-aware
    npm run format         prettier, writing

`npm run bench -- --update` writes the bench's baseline again, and
`UNCHANGED_UPDATE=1 npx vitest run test/unchanged.test.ts` the unchanged
gate's hashes. Each is only for a change meant to move it, and the commit
says why. There is no pre-commit hook: run `check:quick` before a commit.

The gates, one by one:

- **Format:** `prettier --check`. The formatter decides the formatting.
- **Types:** `tsc --noEmit`, strict, with no unused locals or parameters.
- **Lint:** `eslint`, with typescript-eslint's type-checked rules,
  `switch-exhaustiveness-check` and `no-unnecessary-condition`. It is for
  mistakes, not style.
- **Tests:** `vitest run`. Every behaviour the README claims has a test.
- **Unchanged:** `test/unchanged.test.ts`, among the tests. Five scenes run
  from seeds with no new option set, every body's state hashed at frames
  60, 300 and 600, and held bit for bit to `test/unchanged.json`, written at
  v0.3.0. It is what says a game that has not opted in behaves exactly as
  before. Each scene is run twice, so a hash that moves is a change and not
  chance. A Node upgrade that moves it is confirmed on the old commit first.
- **Bench:** `scripts/bench.ts`. Four scenes, one for each game's costly
  part, each run four times fresh in a worker, the fastest counted, and held
  as a multiple of a piece of reference arithmetic, so a baseline written on
  one machine means something on another. It fails at 20% slower or faster
  than the baseline, past a slack of a fifth of a microsecond, over a
  scene's budget, or when a scene's runs do not end alike.

The README gives the cost of a coin machine ("fifteen hundred with a few
hundred awake ... under two milliseconds a frame"). The bench's coin bed
does not bear that out while the bed is being pushed: about 260 awake cost
2.1 ms a frame, and 350 to 420 awake cost 3.35 ms. Coinpush's own bench
puts its machine at 2.35 to 2.54 ms a frame. The figure is to be corrected
in the README.

## Layout

- `src/world.ts` is the whole of the thing: `World`, `WorldOptions`,
  `Tuning` and `DEFAULT_TUNING`, `Pusher`, `Belt`, `Hole`, `Grid`. It owns the
  typed arrays a body is kept in, the fixed step, sleeping, the two hashes
  (the awake one, rebuilt each step, and the sleepers', kept from one step to
  the next), ball against ball, the rock, the floor and its heights, holes,
  the bottom, pushers, belts and the magnet.
- `src/disc.ts` is `Discs`, the coins. They are solved by position, and
  nothing about them bounces. It works on the world's arrays, which are
  handed in, and knows nothing of the grid, the sleeping or the hash. The
  world asks it about a pair, a plane, a lip or a disc.
- There is no page and no picture. What a body is drawn as is the game's
  business. The world gives the game typed arrays to read (`x`, `y`, `z`,
  `q`, `alive`, `asleep`, ...), and tells it about bodies that leave the
  world through the `collect` callback on `step`.
- **Content** is the caller's: the grid, `solid` (one byte a tile), `floor`
  (one float a tile), `holes`, `radii`, `thickness`, the `pushers` and
  `belts` lists, and `tuning`. `solid` and `floor` are read every step and
  may be rewritten in place.
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
  paragraph in the README.
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

The tests use the public `World` and nothing else, except `problems()`,
which casts to an `Innards` interface to read the private lists.

- **Setting up:** `new World({...})` on a grid of the test's own
  (`GRID`, with `solid()` giving a border of rock and whatever else a
  predicate marks), `seeded(n)` for chance, `spawn(kind, x, y, z, vx?, vy?,
vz?)`, `setOrientation`, writing `vx`/`vy`/`vz` and then `wake(i)`,
  `wakeNear`, `wakeAll`, `carried[i] = 1`, and assigning `pushers`,
  `belts`, `magnet` and a `floor` array. `sweeper()` drives a box round a
  circle. `flat()` and `onEdge()` put a disc down.
- **Time:** `step(DT, collect)` at `DT = 1/60`, which is two fixed steps of
  1/120. The steps are counted, and nothing waits on a clock.
- **Reading:** the typed arrays, `live`, `count`, `loads`, `load`, `axis(i)`,
  `floorAt(x, y)`, `deepest(resting)`, what `collect` was called with, and
  `problems(world)`.

## Edge-case checklist

For anything new, say what it does in each case, and test each one that
applies:

- **Asleep:** the thing meets a sleeper, a sleeper lies against it or on
  it, it wakes what it should and only that, and a body can come to rest
  against it and sleep. Nothing new costs anything for a sleeper that is
  not touched.
- **Carried:** a body with `carried[i]` set is not stepped, and nothing new
  moves it or reports it.
- **Discs as well as spheres:** every path has a disc branch, or says why it
  does not need one. Discs are solved by position and never bounce.
- **Off the grid:** `wallAt` treats off the grid as a wall, `floorAt` treats
  it as flat at 0, and the hash clamps to its edge cells.
- **Floor heights:** on a raised tile, at a step face from below, at an edge
  from above, and a hole or other thing standing on a tile that is not at 0.
- **The bottom:** a body that falls out is reported once, through `collect`,
  and its slot is freed.
- **At capacity:** `spawn` returns -1, a freed slot is used again first, and
  the cost holds with thousands of bodies in the hash.
- **Holes:** over one, beside one, at the rim, and more than one hole.
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

| Gate      | Holds the package to                    | Baseline and tolerance                                         |
| --------- | --------------------------------------- | -------------------------------------------------------------- |
| Format    | prettier's formatting                   | none: pass or fail                                             |
| Types     | strict TypeScript                       | none: pass or fail                                             |
| Lint      | the type-aware rules                    | none: pass or fail                                             |
| Tests     | every behaviour the README claims       | 30 tests at v0.3.0                                             |
| Unchanged | every game's world as v0.3.0 stepped it | `test/unchanged.json`, bit for bit                             |
| Bench     | what a frame costs, in four scenes      | `scripts/bench-baseline.json`, ±20% both ways, 0.0002 ms slack |

The bench's budgets, in milliseconds a frame on the fastest run, and its
baselines as written (on an M4 Pro, Node 23.4.0):

| Scene                                            | Stands for            | Budget | Baseline |
| ------------------------------------------------ | --------------------- | ------ | -------- |
| a heap of 2000 balls churned by two pushers      | pushminer             | 3      | 1.87     |
| a bed of 1500 discs, a few hundred awake, pushed | coinpush              | 2      | 0.66     |
| one ball shot round a golf course                | ooergolf              | 0.1    | 0.0017   |
| 64 balls on that course at 120 u/s               | ooergolf, at capacity | 1      | 0.031    |

The tolerance is the measured wobble with room to spare: over three runs
no scene moved by more than 7%. The golf scenes grow as the golf features
land, and each baseline is written again then, saying why.

## Releasing

Bump `version` in `package.json`, commit, and tag `vX.Y.Z`. Each game then
moves up in its own repo by changing its pin, with its own checks green.
Commit, tag and push only when asked.

## Style

Comments are full sentences in the house voice, saying why and not what.
Each file's header says what the file is for. Names are plain: a body, a
kind, a tile, a pusher, a hole.
