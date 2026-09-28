# artshape-physics v0.4.0: the physics a minigolf game needs

A draft for agreement, written on 27 September 2026 against v0.3.0 (96e4646).
Nothing here is built. The need comes from ooergolf's `DESIGN.md` ("The
physics", "The shot", "The rules", the obstacles table and "The upgrades").
The house rules and this repo's new `CLAUDE.md` say how it is to be done.

## What it is for

In ooergolf a shot gives the ball a speed along the ground and none upward.
From there the ball has to:

- roll and slow by the surface it is on, hard in sand
- bank off walls by a figure
- be knocked about by sliding barriers and windmill blades
- bounce off round bumpers, harder than off a wall
- fly when something throws it, and clear a low wall in flight
- drop into a cup it reaches slowly enough, and run over or lip out of one
  it reaches too fast
- be taken by water, with the game told which hole took it
- never pass through a wall, however hard it is hit

Upgrades give balls different bounce and roll, so bounce and roll go by the
kind of body. Slopes and ramps are left for a later version.

**Every game that pins the package behaves exactly as before unless it opts
in.** Each new field is optional, its default is today's behaviour, and the
30 tests we have now pass unchanged. A new gate proves this bit for bit
(feature 1).

## Where it stands now

Measured on this machine at v0.3.0 with scratch tests (not committed). The
ball has radius 1, the tiles are 3 across and gravity is 70, which are
ooergolf's figures, unless a line says otherwise.

| What                                                    | Now                                                                                                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounce off rock, square on, at 20 u/s                   | leaves at 2.0: restitution 0.1, fixed (`vn * 1.1` in `walls()`)                                                                                                                           |
| Rock, at 120 to 500 u/s                                 | **dead stop** in some phases (one in three at 120, 156 and 240): the ball's middle enters the tile, is put back, and `vx = 0`                                                             |
| Rock one tile thick                                     | held up to 500 u/s; **through at 700**                                                                                                                                                    |
| A still pusher, restitution                             | none: a ball at 20 u/s stops dead against it                                                                                                                                              |
| A still pusher 0.25 half-thick                          | **through at 150 u/s**; at 0.5 half-thick, through at 200 (it tunnels once a step moves the ball more than `hx + r`)                                                                      |
| Roll on the default floor (`floorDrag` 5.5)             | 5 u/s rolls 0.84 u; 20 → 3.7 u; 80 → 15.1 u. Distance is about speed ÷ 5.5                                                                                                                |
| The slow-speed damping                                  | below 1.22 u/s (speed² 1.5), 0.96 a step, 1/120 s: a ball stops within about 0.25 u                                                                                                       |
| A hole of radius 1.6, ball through the middle (no drag) | holed from 2 to 12 u/s, runs over at 20 and above; at 1 u/s it stops short                                                                                                                |
| A hole of radius 2.2, the same                          | holed from 2 to 20 u/s, runs over at 40                                                                                                                                                   |
| The rim pull                                            | 6 u/s² toward any hole within its radius + 2.5                                                                                                                                            |
| A wall made as a raised floor tile                      | at or above the ball's radius, it holds and bounces 0.1; **below the radius, it is climbed at any speed** (the ball is set on top)                                                        |
| A ball in flight, middle at 3.2, over a wall 2 high     | clears it                                                                                                                                                                                 |
| **A hole in a world with a `floor` array**              | **bug**: once it is below the floor, the tiles round it count as rock, and it is shoved sideways as it falls (0.5 u and 1.0 u in the two runs). No game has holes and a floor array today |
| The cost of one golf ball rolling                       | about 0.9 µs a frame                                                                                                                                                                      |
| The cost of a heap of 2000 balls churned by two pushers | 1.75, 1.80 and 1.85 ms a frame (seeds 7, 8, 9), about 480 awake                                                                                                                           |
| Rock one tile thick, at ooergolf's 40, 60 and 120 u/s   | held at all three, in three start phases each. The bounce is 0.1 at 40 and 60, but at 120 **one phase in three stops dead**. The same at 156 and 240                                      |
| A blade 0.5 thick (`hx` 0.25), at 40, 60 and 120 u/s    | held at all three, still and moving at 20 and 40 u/s into the ball, in five phases each. It goes through from 150, which a bumper of 1.3 gives a 120 u/s ball                             |

### Ooergolf's figures

These came from the ooergolf session, measured there and agreed with you
while building the ball and the shot. They are inputs to this spec, not
decisions about the package.

- **Scale:** 1 u is 10 cm. The ball's radius is 1, a tile is 3, and the
  playable course is 66 u square. The game steps at 1/60 s, which is two of
  the physics' fixed steps of 1/120 s.
- **The hardest shot:** the starting club strikes at up to 40 u/s along
  the ground, with no upward speed. Upgrades take it to about 60. The
  package is to hold against tunnelling up to 120 u/s, so a bumper that
  adds speed has room.
- **How a putt dies:** at the default `floorDrag` of 5.5, a ball at 20 u/s
  stops after 3.7 u in 0.83 s, which is useless for golf. The game now sets
  `floorDrag` to 0.8. At that:

  | Speed  | Distance | Time  |
  | ------ | -------- | ----- |
  | 10 u/s | 11 u     | 3.2 s |
  | 20 u/s | 24 u     | 3.8 s |
  | 30 u/s | 36 u     | 4.5 s |
  | 45 u/s | 55 u     | 4.8 s |

  The slowing is exponential, and the 0.96 damping below speed² 1.5 ends
  it. A real ball on a green slows at a nearly steady 0.5 to 1 m/s², which
  is 5 to 10 u/s² here, and then stops. Ooergolf asks for rolling
  resistance as a steady slowing, per surface and per kind, and for the
  slow-speed damping to be tunable. It will retune to whatever this spec
  settles.

- **Walls:** the ball meeting the border stops nearly dead, because the
  bounce is about 0.1. There is no target figure yet, and the game will
  tune it.

What the survey of v0.1.0 said, checked against v0.3.0's `src/world.ts`:

- **Rock bounce:** confirmed (line 1277). `tuning.restitution` is used only
  by the floor (line 1493) and by ball against ball (line 818, and only
  above a closing speed of 1.5).
- **Pushers:** confirmed as infinite mass with no restitution (line 1397).
  They also pull the ball 15% of the way toward the face's own velocity
  every step it touches (line 1404). For a ball glancing off a still
  barrier, that is friction.
- **Rock height:** confirmed to have none (`wallAt`, line 1205). Floor
  tiles have heights, and a raised floor tile is already a wall with a
  height.
- **Drag:** confirmed as one `floorDrag` for the whole world, plus the 0.96
  damping. Discs have the same damping (line 926) and do not use
  `floorDrag` at all.
- **Spin:** confirmed to be only for drawing, for spheres.
- **Holes:** confirmed. `collect` gets `(kind, x, y, i)`, and the bottom is
  reported the same way. The hole code assumes the floor is at 0: it tests
  `z < 0` for the pit wall and `-depth + 3` for collection.
- **Tunnelling:** nothing stops it, as measured above. A pusher's own
  motion is swept across the frame's lag, but a body's motion is not.
- **Impulses:** there is no API for one. The tests write `vx` and call
  `wake(i)`.

Who uses the package, from each `package.json`: pushminer v0.1.0,
coinpush v0.3.0, ooergolf v0.1.0, and the game template v0.1.0. arena and
bearing do not use it (bearing moved to Rapier).

## The API in one place

Everything new is optional. Every default is exactly what happens today.

```ts
interface Tuning {
  // ...as now, plus:
  /** The restitution of a wall: rock, or a floor tile standing above a body. */
  wallRestitution: number; // 0.1, which is what `vn * 1.1` is now
  /** The least closing speed that bounces off the floor, a wall, a box or a bumper; slower, it just stops. */
  bounceFrom: number; // 0: everything bounces, as now
  /** The slow-speed damping: below `settleBelow` (a speed, squared), speed is multiplied by `settle` each step. */
  settle: number; // 0.96
  settleBelow: number; // 1.5
  /** The most of its radius a ball may move between looks at what it could hit. */
  travel: number; // Infinity: one look a step, as now
  /** Whether a body may sleep with nothing under it. (As built, after commit 5: see below.) */
  sleepInAir: boolean; // true, as now
}

interface WorldOptions {
  // ...as now, plus:
  /** By kind: how bouncy the kind is, multiplying every restitution it meets. */
  bounce?: readonly number[]; // 1 for every kind
  /** By kind: how hard the floor slows it, multiplying the surface's drag and roll. */
  drag?: readonly number[]; // 1 for every kind
  /** Which surface each tile is, one byte a tile, row by row; read every step. */
  surface?: Uint8Array; // every tile surface 0
  /** What each surface does; a surface with no entry drags by `floorDrag` and bounces by `wallRestitution`. */
  surfaces?: readonly Surface[];
}

interface Surface {
  drag: number; // per second, as `floorDrag`
  roll?: number; // a steady slowing, in u/s²; 0
  bounce?: number; // the restitution of this tile's faces when it is a wall; `wallRestitution`
}

interface Pusher {
  // ...as now, plus:
  restitution?: number; // 0
  carry?: number; // 0.15: how much of the face's own velocity a touching body takes up each step
}

interface Hole {
  // ...as now, plus:
  pull?: number; // 6 u/s², the rim pull
  reach?: number; // 2.5 u beyond the radius
  rim?: number; // the rim's restitution; left out, the hole has no rim (today's pit)
}

interface Bumper {
  x: number;
  y: number;
  radius: number;
  top: number; // a post from below everything up to this height, flat on top
  restitution: number;
}

class World {
  bumpers: Bumper[]; // [], read every step, like pushers and belts
  /** Add to a body's velocity, and wake it. Ignored for a dead or carried body. */
  hit(i: number, vx: number, vy: number, vz: number): void;
  step(dt: number, collect: (kind: number, x: number, y: number, i: number, hole: number) => void): void;
}
export const BOTTOM = -1; // `hole` for a body that fell out of the bottom
```

A game that passes a four-argument `collect` still compiles, and a
`Pusher` or `Hole` literal written against v0.3.0 is still one.

**How bounce figures combine:** the figure of the thing hit (a tile's
surface, a pusher, a bumper, the rim, or the floor's `restitution`) times
the kind's `bounce`. Ball against ball is `restitution` times the mean of
the two kinds' `bounce`. With every factor at its default of 1, each sum
comes out bit for bit as it does now. `1 + 0.1 === 1.1` in doubles, and the
unchanged gate checks it rather than trusting it.

## The features, in the order they land

Each is one commit, with every test green. A refactor that a feature needs
is a commit of its own, before it.

### 1. The gates: unchanged and bench

This is a tool. It lands first so that everything after it is measured.

**What:**

- **The unchanged gate.** `test/unchanged.test.ts` runs five scenes (six
  from commit 5's time, when coins driven into the rock were added) from
  fixed seeds, with no new option set (as built: the spec had four, and a
  fifth was needed for coins in a hole, which no other scene reached):
  - a heap of 900 balls churned by two sweepers beside a hole, topped up as
    they fall in
  - balls shoved into a wall one tile thick, and thrown at it at 60, 300
    and 700 u/s
  - balls on tiers, with a belt over the edge to the bottom, a magnet, a
    box that carries, a carried body, and frames of uneven length
  - a bed of 290 coins and balls pushed over a step and a drop
  - coins pushed down a hole on a flat floor

  It hashes every body's arrays (FNV-1a over the bytes of `x y z vx vy vz
wx wy wz r h q alive asleep carried kind`, what has left the world, and the
  loads) at frames 60, 300 and 600. Each scene is run twice, to show it is
  the same from its seed, and the hashes are compared with
  `test/unchanged.json`. That file is written once, at v0.3.0, before any
  source changes. From then on every commit must match it bit for bit.

- **The bench.** `scripts/bench.ts` has the same shape as ooergolf's: each
  scene run 4 times in a worker, the fastest run counted, and the time held
  relative to a fixed piece of reference arithmetic. The baseline goes in
  `scripts/bench-baseline.json` and is held both ways. The scenes:

  | Scene                                                  | Stands for                             | Budget |
  | ------------------------------------------------------ | -------------------------------------- | ------ |
  | a heap of 2000 balls churned by two pushers            | pushminer                              | 3 ms   |
  | a bed of 1500 discs, timed while the pusher is in it   | coinpush (its own bench: 2.35–2.54 ms) | 4 ms   |
  | one ball shot round a golf course at each target speed | ooergolf                               | 0.1 ms |
  | 64 balls on that course at 120 u/s                     | ooergolf at `BODY_CAPACITY`            | 1 ms   |

  The golf scenes arrive with the features they use. Until then they are
  the balls, rock and pushers there are. Each feature that changes the
  course adds to it and re-baselines, deliberately, saying why.

- **Scripts:**
  - `npm run bench` runs the bench.
  - `npm run check` becomes the quick check plus the bench.
  - `check:quick` is today's `check`.
  - esbuild comes in as a dev dependency to run the script, as it does in
    ooergolf.

**Acceptance:**

1. `unchanged` passes at v0.3.0. Mutated so that `vn * 1.1` is
   `vn * 1.1000001`, it fails in the rock scene. Mutated so that the 0.96
   is 0.9600001, it fails in every scene.
2. The bench runs the same scene twice on one seed and gets the same
   awake and live counts. On three runs its relative figure varies by less
   than the tolerance. That wobble is measured and written into the file,
   and it is the tolerance: 20% both ways. The slack is a fifth of a
   microsecond, not ooergolf's 0.05 ms, which is thirty times a one-ball
   frame and would have hidden the golf scenes entirely (as built: the
   wobble measured was 7% at most).
3. A change that makes frames dearer fails the bench. As built, the 0.99
   damping this criterion first named does not: a ball damped harder sleeps
   sooner, since sleep goes by distance, and the heap came out 1% faster.
   What was checked instead: bodies kept awake twice as long
   (`sleepSteps` 80) fail the coin bed at +61%, and the rock looked at
   twice a step, which is what a second piece of a fast ball costs, fails
   the 64-ball scene at +20%. The one-ball scene moves only 6% under that,
   because one ball's frame is mostly what a step costs whatever is in it.
   It is held by its budget, and its figure is read before and after
   feature 10 rather than trusted to fail.

**Edge cases:** determinism is the point of the unchanged gate. Its limit is
that bit-identity rests on V8's `Math` functions. If a Node upgrade moves
the hash, it is recorded again on purpose: the old commit is checked out
to confirm the move comes from Node, and the commit says so.

**Discs:** the disc bed is in both gates.

**Performance:** the bench takes 8.5 s, and `check` takes 16 s (as built;
it was estimated at about 10 s more).

### 2. Which hole took the ball

**What:** `collect` gets a fifth argument, `hole`: the hole's index in
`holes`, or `BOTTOM` (-1) for a body that fell out of the bottom. This is
for spheres and discs alike.

**Acceptance:**

1. In a world with two holes and a bottom, a ball down hole 1, a ball down
   hole 0 and one off the edge are reported with 1, 0 and -1. It fails
   today: there is no fifth argument.
2. The same for discs.
3. Each body is reported once, and its slot is freed and used again first.

**Edge cases:**

- A body over two overlapping holes is reported by the first in the list,
  as it falls now.
- A hole that reaches below the bottom (as built: this was not in the
  spec). v0.3.0 looked at the bottom before the holes, so what went down a
  hole deeper than the bottom was reported as out of the bottom, which
  would tell the cup from nothing. The holes are now looked at first, and a
  body over one is gone once it passes the bottom, as the hole's. It changes
  only a world with both holes and a bottom, which no game has, the same
  rule as open question 10.
- At capacity: a freed slot is used again.
- A carried body is never reported.

**Discs:** `discFloor` passes the index too.

**Performance:** none.

### 3. A hit: add to a velocity, and wake

**What:** `hit(i, vx, vy, vz)` adds to the body's velocity and wakes it:
the shot, and anything a game throws. It is ignored for a dead or carried
body.

**Acceptance:**

1. A sleeping ball that is hit moves off at the speed given. The run is bit
   for bit the same as writing `vx` after calling `wake(i)`, as the tests
   do now.
2. A sleeping disc that is hit slides off. Its step starts from where it
   lay (`rouse`), so it is not flung.
3. A dead body and a carried body are unchanged.

It fails today because there is no such method.

**Edge cases:** asleep, carried, dead, disc.

**Performance:** none.

### 4. The slow-speed damping, tunable

**What:** `settle` (0.96) and `settleBelow` (1.5, a speed squared) take the
place of the two literals. Spheres and discs both read them, from the two
places the literals are now (lines 589 and 926). This is how a putt dies
near the cup: at the defaults, anything under 1.22 u/s stops within about a
quarter of a unit. With `roll` (feature 9), it decides whether a putt dies
at the lip or drops: the steady slowing brings the ball down to
`settleBelow`, and the damping takes the last quarter unit. Ooergolf asked
for this.

**Acceptance:**

1. With `settle: 1`, a ball rolled at 1 u/s on a floor with no drag goes
   more than 4 u in 5 s. It fails today: it stops within 0.3 u.
2. With `settleBelow: 0.25`, a ball rolled at 0.8 u/s goes further than it
   does at the default.
3. The unchanged gate is still green.

**Edge cases:**

- Sleep is judged by drift, not speed. With `settle` at 1, a ball still
  sleeps once it drifts less than `sleepDrift` over a window, so a slow
  roll can end in sleep while still moving. This is tested and written
  down.
- Discs read the same figures.

**Performance:** none.

### 5. Bounce by a figure, and by kind

**What:**

- `wallRestitution` sets how rock and step faces bounce.
- The kind's `bounce` multiplies every restitution the kind meets: walls,
  the floor, and ball against ball.
- `bounceFrom` stops slow touches from bouncing. (As built: the reason
  first given, that a bouncy ball could not otherwise come to rest on the
  floor, was wrong. Gravity draws a ball into the floor at 0.58 u/s a step,
  and bounced back at less than that it stays on it, and sleep ends what
  hopping there is. Where it matters is a restitution of one or more, as a
  bumper's or a bouncy kind's on a bouncy floor: a ball rolling at 20 u/s on
  a floor it meets at 1.08 skims it, undragged, and rolls 35.4 units to a
  dead floor's 23.8; with `bounceFrom: 2` it rolls 23.8.)

**Acceptance:**

1. With `wallRestitution: 0.8`, a ball at 20 u/s square on to rock leaves
   at 16 ± 0.3. (Ooergolf finds its border stops the ball nearly dead now;
   the figure is the game's to tune.) At 45° it keeps its speed along the
   wall and leaves with 0.8 of its speed across it; at a restitution of 1 it
   leaves at 45° ± 1°. (As built: this said 45° at 0.8, which is only so at
   1.) It fails today, when it leaves at 2.0.
2. A kind with `bounce: 0.5` against the same wall leaves at 8 ± 0.3.
3. Dropped from 6 u onto the floor with `restitution: 0.6`, a ball of
   `bounce` 1 rises about 2 u, and one of 0.5 a quarter as high. A ball
   rolling on a floor it meets at more than 1 rolls as on a dead floor with
   `bounceFrom: 2`, and skims it without.
4. The same holds at a raised floor tile's face, which is a wall and uses
   the same figure.
5. The unchanged gate is still green.

**Edge cases:**

- Asleep: bouncing never wakes a sleeper that it would not wake today.
- Floor heights: step faces bounce the same as rock.
- Off the grid: counts as a wall, so it bounces by `wallRestitution`.
- Ball against ball: `restitution` times the mean `bounce`. The closing
  speed of 1.5 below which nothing bounces stays as it is.

**Discs:** discs never bounce. They are solved by position, and `bounce`
does not apply to them. This is tested: a disc kind given `bounce: 2`
behaves bit for bit as with 1. (As built: v0.3.0 gave a disc's speed into
the rock the same tenth over as a ball's, and nothing ever read it, since a
disc's speed is read back from where it got when its step ends. The rock
now leaves a disc's speed alone, and a sixth scene of the unchanged gate,
recorded from v0.3.0's own source, shows coins against the rock step bit
for bit as they did.)

**Performance:** one multiply per contact. The bench should show nothing.

### 5b. A body kept from sleeping in the air (as built)

Not in the spec as agreed; found by feature 5's tests and agreed after.
Sleep is judged by how far a body is from where it was a window of steps
before, so a ball bouncing can be back at that height when the window
closes, and sleep in the air, and hang there: 7 drops in 20 at a floor
restitution of 0.6, 17 at 0.8, all 20 at 0.9. A coin tossed so that it is
in the air as its window closes hangs too. v0.3.0 has it; its restitution
of 0.08 all but hides it.

`sleepInAir` (true, as it always was) set false holds a body to having
touched something below its middle, however steeply, in the step it would
sleep. The mark is `BORNE`, beside the floor's 1 and a moving box's 2; the
floor, a box, another ball, a sleeper leant on and the coin solver each set
it. Held instead to the floor's own reckoning, a contact within sixty
degrees of straight down, a big ball nested among small ones never slept.
With it off, no drop hangs, and heaps of balls and of coins settle exactly
as with it on, over three seeds each. On by default it would move one of the
unchanged gate's six scenes, so it is opted into; ooergolf sets it.

The bumpers (feature 8) and the cup's rim (feature 11) hold a ball up, and
each must mark it `BORNE`.

### 6. Walls with a height, and water, from the floor's heights

**What:** no new field. A wall a ball in flight can clear is a floor tile
standing at the wall's height. v0.3.0 already does this, and feature 5
gives it its bounce. Water, or any hazard that takes the ball, is a floor
tile far below the `bottom`: a ball that rolls onto it drops, and is
reported with `BOTTOM` and the x and y over the water. The game tells water
from off the course by its own tiles at that x and y. Rock stays infinitely
tall, as the outer bound of a course. See open questions 2 and 3.

**Acceptance** (these hold today apart from the bounce figure, so each is
mutation-checked rather than seen failing; as built, a tile standing the
ball's radius exactly is a wall, since gravity sinks the ball a hair each
step before the rock is looked at, and one at nine tenths of it is climbed,
at 2, 5 and 20 u/s):

1. A ball rolling at 20 u/s into a raised tile of height ≥ its radius
   bounces off by `wallRestitution`.
2. A ball in flight whose bottom is above the top passes over.
3. A ball whose middle is above the top but whose bottom is not is set on
   top. This is documented: it is how v0.3.0 treats a step.
4. A tile lower than a ball's radius is climbed at any speed. This is
   documented, and it answers ooergolf's hole-7 question for now.
5. A ball rolled onto a water tile (floor -30, bottom -6) is reported once
   with `BOTTOM` over the water. A ball thrown over the water lands beyond
   it.

**Edge cases:**

- Floor heights, the bottom, off the grid.
- The discs' lips at step edges are unchanged.

**Performance:** none. It adds tests and the README only.

### 7. Pushers that bounce

**What:** each pusher gets its own `restitution`. The bounce is worked in
the pusher's own frame, from the closing speed relative to the face's
velocity at the point of contact, spin included:
`v += n · (1 + e·bounce[kind]) · (pvn − vn)` when `vn < pvn`. With `e = 0`
that is today's formula exactly. `carry` makes today's 15% face drag a
figure a game can set: a windmill blade can grip, a barrier can let the
ball glance. (As built: carry brought the whole of a ball's speed toward
the face's, so a ball bounced at 0.8 left at 0.85 of that, 13.6 and not 16;
and at 144 frames a second the box, moved a frame at a time, caught up with
a ball it had just bounced, between steps, and carry drew it back, 15 to
14.25. A box that bounces now carries along its face only. A box that does
not, which is every box a game has now, carries as it did.)

**Why per pusher:** a windmill blade and a sliding barrier are different
obstacles. The ball's own kind still scales the figure through `bounce`,
the same rule as everywhere else, so the answer to "per pusher or per kind"
is both.

**Acceptance:**

1. A still box with `restitution: 0.8`: a ball at 20 u/s leaves at
   16 ± 0.3. It fails today (measured: 0).
2. A box moving at 10 u/s into a ball at rest, `restitution: 0.5`: the ball
   leaves at 15 ± 0.5. Today it leaves at 10.
3. A blade turning with `spin`: a ball struck at twice the distance from
   the pivot leaves faster than one struck at the distance.
4. `carry: 0`: a ball glancing off a still box at 30° keeps its speed along
   the face to 1%.
5. A ball resting on top of a box with `restitution: 0.8` and
   `bounceFrom: 2` lies still, is carried, and sleeps. The existing
   platform test still passes.
6. The unchanged gate is still green.

**Edge cases:**

- Asleep: a sleeper is woken as now.
- Carried: untouched.
- The top of the box is included.
- The load count is unchanged.
- A thin plate over a ball still sends it out on the side the plate moves
  toward.
- Frame lengths 1/30, 1/60 and 1/144, with the lag sweep.

**Discs:** unchanged. `discBox` is by position and does not bounce. A disc
against a box with `restitution` set behaves bit for bit as without it.

**Performance:** a few multiplies a contact. The bench's heap scene should
not move.

### 8. Bumpers

As built, four things differ from what follows. A post's top bounces as the
floor does, not at the post's figure: at 1.3, a ball dropped on it came back
faster each time, 21, 31, 33, 37 u/s, which bounceFrom cannot stop. A coin
meets a post's side as rock, put out by where its middle is, not as a plane
through its solver: a coin a box shoved against a post was backed by the box
and driven through the post. The glancing bounce is held to the law it
follows, the speed across the way out of the post reversed and scaled and
the speed along it kept, to within a hundredth; the angle is held to 2° at
5 u/s, since at 20 u/s a ball is found up to a sixth of a unit into the post
and the way out is several degrees off the ideal one. Sixteen posts under a
churned heap, 830 awake, cost 6 to 10% of its frame over three seeds, some
of it the balls striking them, so they are not binned by tile; a world with
none does not look.

**What:** `world.bumpers`, a list of round posts that do not move. Each
stands from below everything up to `top`, flat on top, and bounces by its
`restitution` times the kind's `bounce`. The restitution may be above 1,
which is how a bumper bounces harder than a wall (open question 5). A ball
meets the nearest point of the post: its side, its top, or the edge
between them. The edge throws a ball that clips it upward.

**Why a list of its own, not a round kind of pusher:**

- A pusher is kinematic. It is swept across the frame's lag, it has an
  owner and a load count, it carries what is on it, it wakes sleepers ahead
  of it through the sleepers' hash, and discs meet it through the face
  planes of a box.
- A round pusher would touch every one of those paths, and give a disc a
  shape `disc.ts` has no contact for.
- A bumper does none of that: it never moves, so it never wakes anything
  and is never swept.
- Kept apart, it is a circle test per awake ball, and the pushers are left
  alone.

If moving round things are wanted later, they can come as a round kind of
pusher then.

**Acceptance:**

1. A ball at 20 u/s square on to a bumper of `restitution: 1.3` leaves at
   26 ± 0.5. Off-centre, it leaves along the reflection about the line from
   the bumper's middle, to 1°. It fails today: bumpers do not exist.
2. A ball in flight whose bottom is above `top` passes over. One whose
   middle is above `top` lands on the top and rolls off it.
3. A ball rolled gently against a bumper (`bounceFrom: 2`) comes to rest
   against it and sleeps. Nothing is left more than 0.01 u inside it.
4. A heap of 200 balls poured on a bumper leaves none inside it at rest.

**Edge cases:**

- Asleep: a sleeper against a bumper stays asleep, and costs nothing.
- Carried: untouched.
- Off the grid: a bumper there still works.
- Floor heights: a bumper on a raised tile gives its `top` in world height.
- Rock: a ball squeezed between a bumper and rock ends out of both. The
  rock goes last, as now.
- Determinism: bumpers are visited in list order.

**Discs:** a disc meets a bumper as the plane tangent to the post at the
point nearest its middle, the same way `discBox` meets a box face, and it
does not bounce. Tested: a disc pushed into a bumper comes out, and at rest
is no more than 0.05 u into it.

**Performance:** it costs the number of awake bodies times the number of
bumpers, with a bounding-box test first. With no bumpers it costs nothing.
The bench's golf scene gets 8 bumpers. There is also a scene of 16 bumpers
under 500 awake balls. If that costs more than 10% of the heap scene,
bumpers are binned by tile.

### 9. Surfaces: drag, roll and bounce by tile, and drag by kind

As built: off the grid is surface 0, and a tile whose byte has no entry in
the table, or a world given no table, takes the tuning's figures. Roll never
takes a ball past standing still: slower than a step of it, the ball stops
dead. The table of distances and times is in the README, measured, and its
row for ooergolf's present drag of 0.8 matches the game's own figures.

**What:** a surface byte per tile, beside `solid` and `floor`, indexes the
`surfaces` table. A ball on the floor is slowed by the drag of the surface
under its middle, times its kind's `drag`. `roll` is a steady slowing on
top of that, in u/s², which never takes the speed below 0. A wall is
bounced off by the `bounce` of the tile it is pushed out of. A tile out of
range, or off the grid, uses the defaults.

**Why a byte per tile rather than regions:** ooergolf's course is already
"a grid of tiles, each with a surface and a height". A byte has the same
shape as `solid` and `floor`, is read in O(1) from the tile index the
floor code already works out, and can be rewritten in place. Regions would
give round bunkers finer than a tile, but at a search per contact. A
bunker is drawn round and costs the ball by the tile, and at tiles 3
across that is fine for minigolf. Regions can come later if a course needs
them.

**Why `roll`:** linear drag makes the distance rolled go with the speed.
Measured: about speed ÷ 5.5 at the default, and 11, 24, 36 and 55 u from
10, 20, 30 and 45 u/s at ooergolf's 0.8. A real green slows a ball at a
nearly steady 5 to 10 u/s² at ooergolf's scale. The distance then goes with
the square of the speed (`v² ÷ 2·roll`), and a putt dies the way a player
expects. `roll` sits beside `drag` rather than replacing it:

- A green is mostly `roll`.
- Sand is heavy `drag`, which kills a fast ball quickly.
- A surface can have both.

The kind's `drag` factor scales both, so an upgrade ball that rolls further
does so on every surface. Both are figures, and the game's feature tunes
them against the autopilot (open question 6).

One thing for ooergolf to know when it tunes: with distance going as the
square of the speed, the starting club's 40 u/s stays on the 66 u course
only if `roll` is at least 40² ÷ (2 × 66) ≈ 12 u/s². At 7.5 u/s² it would
roll 107 u. That is the game's to settle, and the table in the README
gives it the distances.

**Acceptance:**

1. A ball rolled at 20 u/s on surface A (drag 2) goes twice as far as on
   surface B (drag 4), ± 5%. It fails today: there is only one drag.
2. With drag 0, a ball at 10, 20 and 40 u/s rolls `v² ÷ 2·roll`, ± 5%, at
   `roll` 5, 7.5 and 10, which are ooergolf's real-green range (the damping
   takes the last 1.2 u/s). It fails today: there is no `roll`. The table
   of distances and times goes in the README.
3. A kind with `drag: 2` rolls half as far as one with 1, ± 5%, under
   `drag` alone and under `roll` alone.
4. A ball rolled from grass into a sand tile stops within the sand when its
   speed would carry it only that far.
5. A wall tile with `bounce: 0.9` returns a ball at 0.9 × its approach
   speed, ± 2%.
6. `surface` rewritten in place takes effect on the next step.
7. The unchanged gate is still green.

**Edge cases:**

- Asleep: no cost.
- Off the grid: defaults.
- Floor heights: the surface of the tile under the ball, at any height.
- On top of a box: the box's `carry` decides, not the tile under it.
- A belt on sand: the belt as now, and the drag as well.
- At capacity: one byte read per floor contact.

**Discs:** unchanged. Discs are held by `grip` and never read `floorDrag`,
so they do not read surfaces either, and this is written down. A per-surface
grip for coins could come later.

**Performance:** one byte and a table read per floor contact. The heap
scene should not move by more than its wobble.

### 10. A fast ball kept out of walls

This is two commits.

**Refactor first.** The per-body sphere pass (pushers, bumpers, belt,
magnet, rock, floor and holes) is split into the contacts, which can be
looked at more than once in a step (pushers, bumpers, rock, rim), and the
rest, which happens once a step (belt, magnet, drag, damping, sleep, spin).
Nothing moves. The unchanged gate proves it.

**Then the feature. The method:** a sphere is stepped in pieces by its
speed. It is not swept against the grid and the boxes.

- A sphere whose step would carry it further than `travel × r` is moved in
  `n = ceil(|v| · step ÷ (travel · r))` equal pieces.
- After each piece its contacts are looked at: rock, pushers, bumpers, the
  rim. A bounce in one piece turns the rest of the step.
- Drag, damping, sleep and the rest are done once a step, as now.
- `n` is capped at 64. At the cap the pieces grow, and the cap is where the
  guarantee ends.
- With `travel = Infinity`, the default, `n = 1`, and the code path is
  today's.

**Why pieces and not a swept test:**

- A swept test needs a ray against tiles made fat by the radius, rounded at
  their corners, and against moving boxes turned by `spin`, and against
  posts and the rim. Each is a new piece of geometry that can be wrong, and
  a second way to meet each thing, beside the first.
- Pieces use the contacts that already exist, so a fast ball bounces off a
  wall exactly as a slow one does.
- They cost only the balls that are fast, and in proportion to how fast.
- With a piece no longer than the radius, nothing thicker than zero can be
  passed through, since the ball must touch a face before its middle
  reaches the thing's midline. Half the radius leaves a margin.

**The target speed** is a parameter of the tests: `TARGETS = [40, 60,
120]` u/s. These are ooergolf's starting club, its best club, and the
limit it asked the package to hold. `HEADROOM = [240]` is run as well: a
120 u/s ball off a bumper of restitution up to 2. A game that shoots
harder adds a target. At 240 u/s the ball moves 2 u a step, which is 4
pieces at `travel: 0.5` and radius 1.

**What this changes, measured.** At ooergolf's own 40, 60 and 120 u/s,
today's code already holds a one-tile rock wall and a blade 0.5 thick
(`hx` 0.25), with the blade still or moving into the ball at 40 u/s. So
"not through" cannot be seen failing at the targets. What fails there
is:

- **The bounce at 120:** one start phase in three stops dead against rock
  instead of bouncing, because the ball's middle gets into the tile and
  is put back with its speed zeroed. With `wallRestitution` tuned up by
  feature 5, that is a shot that stops dead one time in three.
- **The headroom:** from 150 u/s the blade is passed. A 120 u/s ball off a
  1.3 bumper is going 156.

Pieces are still the method, and these are the tests seen failing.

**Acceptance.** For every target and the headroom, with ball radii 1 and
0.42, `travel: 0.5`, at angles of 0°, 30° and 60°, and in at least 5 start
phases each:

1. It bounces off rock one tile thick by the same figure in every phase
   and at every speed, ± 2%, with `wallRestitution` at 0.1 and at 0.8. It
   fails today at 120: one phase in three leaves at 0.
2. It never passes through rock one tile thick, on ooergolf's tiles 3
   across and on tiles 1 across, and its middle is never in a wall tile
   after any step. This holds today at the targets, so it is
   mutation-checked, and the headroom run is seen failing.
3. It never passes through a blade 0.5 thick (`hx` 0.25), still, or moving
   into the ball at 20 and 40 u/s. This holds today at the targets and
   fails at the headroom (through from 150).
4. It never passes through a bumper of radius 0.3, or a raised floor tile
   one tile wide.
5. Frame lengths of 1/30, 1/60 and 1/144 all hold.
6. A windmill blade whose tip moves at up to 150 u/s never passes through
   a ball at rest. The pieces go by the ball's speed, not the box's. A box
   is placed once a step, so its own step must be under `hx + r`. This is
   a documented limit, and tested at the limit.
7. The unchanged gate is still green with `travel` left out.

**The property test** (the house's fuzzer, for a package with no page):

- `test/golf.fuzz.test.ts` shoots a ball from 24 seeds, in `check`, and
  from `FUZZ_SEEDS=1-500` on request.
- Each shot has a random direction and a speed up to 120, on a course with
  rock, raised walls, a barrier, a windmill, bumpers, sand, water and a
  cup.
- The invariants, after every step:
  - The ball's middle is never in a wall tile.
  - It is never more than 0.1 u into a box or a post.
  - Its speed never grows except at a bumper or a moving box.
  - It is reported at most once.
  - Every shot ends asleep or reported within 30 s.
- A failure prints its seed.

**Edge cases:**

- Asleep: a fast ball meets a sleeper through the pairs once a step. It is
  not pieced against other bodies, which is fine for one golf ball and is
  written down as a limit.
- Carried: untouched.
- Floor heights and the bottom are looked at each piece.
- Off the grid is a wall.
- At capacity: see performance.
- Determinism: pieces are counted from the velocity alone, in the same
  order every run.

**Discs:** spheres only. Discs are unchanged. They are solved by position
and have `MAX_PUSH` and their own landing passes. Pieces for coins would be
a change of their own.

**Performance:** the cost goes with speed. With radius 1 and `travel`
0.5, a ball at 40 u/s needs 1 piece a step, so it costs nothing more. At
60 it needs 1, at 120 it needs 2, and at 240 it needs 4. Each piece is a
look at 8 tiles, the pushers, the bumpers and the rim. Estimated at under
5 µs a frame for one ball, and to be measured. The bench's
golf-at-capacity scene (64 balls at 120 u/s) is held to 1 ms. A game with
`travel` left out pays nothing, and the heap and disc scenes should not
move.

### 11. The cup

**What:** a hole given a `rim` is a cup:

- There is no floor inside its radius, as now.
- **The rim** is the circle of the hole's radius at the hole's level. A
  ball within its radius of that circle is pushed out along the way from
  the nearest point of the circle to its middle, and bounces by
  `rim × bounce`, with `bounceFrom`.
- **The pit wall** below the level holds a ball that has dropped far
  enough, as now.
- **The level** is the floor under the hole's middle, not 0. For every
  game today that is 0.
- **The rim pull** is `pull` and `reach`. A cup sets `pull: 0`: a ball
  partly over the edge tips in because the rim is round, not because it is
  pulled.
- **The tiles the hole cuts** are not a wall to a body below the level
  inside the hole's radius. This fixes the bug measured above.

**The rule, and what decides catch or lip-out.** Nothing is scripted. A
ball over the cup falls. By the time it reaches the far rim it has dropped
a distance set by gravity and how long it took to cross the cup. If it has
dropped far enough, the far rim meets it low. The push is mostly
horizontal and back, and the pit wall holds it: it is holed. If it is
still high, the rim meets it near its bottom. The push is mostly upward,
and it is thrown up and on: it runs over. A ball whose line clips the edge
off-centre meets the rim at a slant and is turned. It may run round the
lip and out, or drop.

So the speed at which a cup catches is set by:

- the cup's radius against the ball's
- gravity
- the rim's restitution
- the ball's `bounce`, so a bouncier ball lips out more, which is what an
  upgrade should mean

The feature writes a table into the README: for cups of radius 1.6, 2.5
and 3 with a ball of radius 1, the fastest speed through the middle that
is always holed, and the slowest that always runs over. Ooergolf picks its
cup from that table (open question 1).

**Acceptance:**

1. Through the middle, a cup of radius 2.5 with `rim: 0.3`: every speed
   from the slowest that reaches it up to `C_catch` is holed, once, with
   its index. Every speed from `C_over` up to 120 runs over, and rises off
   the far rim above its resting height. `C_catch < C_over`, both
   measured and written in the test. It fails today: nothing throws a
   ball up at the rim.
2. The same cup, on a line 0.8 × radius off centre: across 2 to 40 u/s at
   least one speed is holed, and at least one is turned by 20° or more by
   the rim and not holed (a lip-out). It fails today: nothing turns a
   ball at a hole but the pull.
3. With `pull: 0`, a ball at rest with its middle 0.1 inside the radius
   tips in and is holed. One at rest with its middle 0.1 outside stays
   and sleeps. The second fails today: the pull draws it in from up to
   2.5 beyond.
4. A cup on a raised tile at height 2: a ball rolled into it is holed at
   `2 − depth + 3`. One rolled past it stays on the tier.
5. A ball dropping into a cup in a world with a `floor` array follows the
   same path as in one without, to 1e-6. It fails today (measured: 0.5 u
   and 1.0 u apart).
6. A ball in flight landing in the cup is holed. One landing on the rim is
   thrown off or in, and never passes through the rim.
7. A hole without `rim` is unchanged. The unchanged gate is still green.

**Edge cases:**

- Asleep: a ball can sleep at the rim's edge only outside the radius.
- Carried: untouched.
- Floor heights: the level of a raised cup.
- The bottom: a cup deeper than the bottom still reports the hole, not
  `BOTTOM`, because feature 2 looks at the holes first. (This line said "as
  now"; v0.3.0 looked at the bottom first.)
- More than one hole.
- A fast ball: the rim is looked at in each piece (feature 10), so a fast
  ball cannot miss the far rim between steps.
- Determinism.

**Discs:** a disc over a cup falls into it as it does into a hole now, and
`discFloor` gets the same level rule and the same fix for tiles below the
level. Discs do not meet the rim: a rim contact for a coin would be a
circle against a disc's own rim, a new shape in `disc.ts`, and no game
wants coins in cups. This is written down.

**Performance:** a circle test per hole per ball on the floor, as now,
plus the rim when near. The fix removes a ring search (`outOfRock`) that
runs every step while a ball falls in a hole in a world with floor
heights.

### 12. The release

**What:**

- The README says what is new, with the cup table.
- `CLAUDE.md` gains the new gates and baselines.
- `package.json` goes to **0.4.0**: new features, and nothing a game has to
  change.
- Each game is checked against it. In a throwaway copy of each of
  pushminer, coinpush and ooergolf (never the user's checkout), the
  dependency is pointed at this commit and `npm run check` is run. Each
  must be green with no change to the game.

**Acceptance:** all three games are green on 0.4.0 unchanged, the full
check here is green, and the bench is within its baselines.

Tag and push only when asked. Ooergolf moves from v0.1.0 to v0.4.0 in its
own feature, as its DESIGN.md says.

## The order, in one place

| #   | Commit                                                              | Kind        |
| --- | ------------------------------------------------------------------- | ----------- |
| 1   | The unchanged gate and the bench                                    | tool        |
| 2   | `collect` says which hole                                           | feature     |
| 3   | `hit`                                                               | feature     |
| 4   | The slow-speed damping, tunable                                     | feature     |
| 5   | Walls and the floor bounce by a figure, and by kind                 | feature     |
| 5b  | A body kept from sleeping in the air, opted into (as built)         | feature     |
| 6   | Walls with a height and water, from floor heights: tests and README | docs, tests |
| 7   | Pushers that bounce, and `carry`                                    | feature     |
| 8   | Bumpers                                                             | feature     |
| 9   | Surfaces, and drag by kind                                          | feature     |
| 10a | The sphere's contacts split from the once-a-step part               | refactor    |
| 10b | A fast ball stepped in pieces                                       | feature     |
| 11  | The cup                                                             | feature     |
| 12  | README, CLAUDE.md, 0.4.0, and the games checked                     | release     |

Each commit has every test green, and the unchanged gate matches bit for
bit. The bench is run before and after each, and a figure that moves is
explained, with more seeds checked, before a baseline is written again.

## The definition of done, as it falls here

1. **Tests first:** each numbered criterion above is a test, seen failing
   before its change, except in feature 6, which is mutation-checked.
2. **The checklist:** each feature's edge cases above.
3. **The full check:** `npm run check`, with the bench in it from feature 1.
4. **The end-to-end test:** there is no page. The end to end here is the
   property test's course, which uses every feature at once through the
   public `World`, and each game's own check at release.
5. **The fuzzer:** the property test and its invariants, from feature 10.
6. **Performance:** the bench before and after every commit.
7. **Looked at:** the package draws nothing, so there are no pictures to
   hold. The paths of the bank, bumper, windmill and cup shots are written
   as SVG by the bench's golf scene on request (`--trace`). They are looked
   at for each feature that changes them, as a check on the instrument, not
   as a gate.
8. **Mutation checks:** for each new test, the change is put back and the
   test must fail.
9. **Not verified** is said plainly in each report.

## Open questions, each with a recommendation

1. **The cup: a physical rim, or a scripted speed to catch at?**
   Recommended: the physical rim, with `pull: 0`. Catch and lip-out then
   come out of the ball's speed, its line and its bounce, and an upgrade
   ball changes them as it should. A scripted `catchSpeed` is easier to
   tune but ignores the line and the ball, and gives no lip-outs. If the
   measured catch speeds turn out unplayable at any sensible cup size, a
   `catchSpeed` can be added on top in a later version.
2. **Water: a floor tile below the bottom, or a surface that takes the
   ball?** Recommended: below the bottom. It needs nothing new, the ball
   sinks through the drawn water as it falls, and the game tells water
   from off the course by its own tiles at the reported x and y (both cost
   a stroke). A `takes` surface would report water without a fall, at the
   cost of a third way out of the world.
3. **Walls with a height: floor tiles, or rock given a height?**
   Recommended: floor tiles, which v0.3.0 already has, so rock stays the
   infinitely tall outer bound, and coinpush's step walls and lips stay as
   they are. A `rockTop` array would do the same thing through a second
   route. The catch is that a wall lower than the ball's radius is climbed
   at any speed. Recommended: keep that for this version and say so. It
   answers ooergolf's hole-7 question (a step under the radius is climbed,
   and one at or over it is a wall). Revisit it with slopes.
4. **How bounce figures combine:** recommended, the thing's figure times the
   kind's, with no cap. It is one rule everywhere, and the defaults stay
   bit for bit. The game keeps its balls' `bounce` at or under 1.
5. **A bumper bounces harder by restitution above 1, or by a kick?**
   Recommended: restitution, allowed above 1, with `bounceFrom` so a ball
   can still come to rest against one. A kick (a fixed speed added) makes
   a gentle touch fling the ball, which suits pinball more than golf.
6. **`roll`, a steady slowing, beside linear drag or instead of it?**
   Ooergolf asked for it, per surface and per kind. Recommended: beside
   it, per surface, with the kind's one `drag` factor scaling both. A green
   is mostly `roll` and sand is mostly `drag`. It costs one subtraction,
   and without it the distance a putt rolls goes with speed, not speed
   squared, which feels wrong on a green (ooergolf's 0.8 drag gives 24 u
   from 20 u/s and 55 u from 45). The alternative is a separate per-kind
   `roll` factor, for a ball that rolls further on the green but no
   further in sand. I'd leave that out until an upgrade needs it. The game
   sets the figures against its autopilot.
7. **Pieces switched on by one `travel` for the world, or by kind?**
   Recommended: one figure for the world, because only a ball that is
   actually fast pays for it. Coins left at the default pay nothing either
   way.
8. **The speed to hold at:** ooergolf has set it. Test at 40, 60 and 120
   u/s, as it asked, plus 240 as headroom for a bumper of up to 2.
   Recommended: keep pieces in this version even though the targets alone
   do not tunnel today. The bounce at 120 is a dead stop one time in three,
   and the headroom goes through a blade. Pieces cost a 40 u/s ball
   nothing. The alternative is to fix only the dead stop, by reflecting
   instead of zeroing when the middle is put back. That is cheaper, but it
   leaves the headroom unguarded and changes a path pushminer's coins use,
   so it would need an opt-in of its own anyway.
9. **`carry` on pushers:** recommended, expose it with today's 0.15 as the
   default. It decides how a ball glances off a barrier as much as
   restitution does.
10. **The hole-and-floor fix:** it changes behaviour only in a world with
    both holes and a `floor` array, and no game has both. Recommended: fix
    it for every hole, not only cups, as a bug fix without an opt-in.
11. **The version:** recommended, 0.4.0. The alternative, 1.0.0, would
    promise a stable API that slopes will want to change.
12. **The bench in `check`:** recommended. `check` becomes `check:quick`
    plus the bench, about 10 s more, to be measured. The alternative keeps
    it out of `check` and runs it by hand, which the house rules count as
    a gate nobody runs.

## Not verified

- The costs of pieces, bumpers and the rim are estimates until feature 1's
  bench measures them.
- The cup's catch and over speeds for a physical rim are predicted, not
  measured. The figures above are for today's hole with no rim.
- That V8 gives the same bits on the other machines the games are checked
  on is assumed. The unchanged gate is checked on this one only.
