# artshape-physics

A world of spheres and of coins, for a game with a great many small things
rolling about a floor, piling on it and being shoved, or with one ball
struck about a golf course: banked off walls, bounced off posts and boxes,
slowed by grass and sand, and dropped into a cup or run over it. Stepped at
a fixed rate, with sleeping, a spatial hash, and a grid of rock the bodies
are kept out of.

Taken out of [Pushminer](https://github.com/onion2k/miner) in September
2026, where it had been the physics under a few thousand coins pushed about
a cave by a bulldozer, in the way the renderer had already been taken out as
[artshape-render](https://github.com/onion2k/artshape-render). It knows
nothing of that game: a kind of body is a radius, a cave is a grid of solid
tiles, and what falls into a hole is reported through a callback.

## What it does

- **A body is a ball.** A ball pair is one distance, which is what lets a
  few thousand of them be stepped in JavaScript at a hundred and twenty hertz.
  What a body is drawn as is the caller's business; the world carries an
  orientation per body for it — flat when the body rests, tumbling when it
  flies, at whatever tilt it landed with.
- **Or a body is a disc.** A kind given a thickness is a coin: a rigid disc
  with an orientation and a spin of its own, which contacts change through
  where on it they touch. It lies on a face, stacks a thickness apart, leans
  with a rim on the floor and its face on another's edge, stands wedged on
  its rim between two others, tips off a support its middle has passed, and
  goes over a lip of the floor on the lip and not through it. A bed of them
  pushed from behind moves as a bed and buckles into a pile. It is solved by
  position, so nothing bounces, and what it costs is a few times a ball: a
  bed of fifteen hundred being pushed is stepped in about 1.8 milliseconds a
  frame with three hundred awake, and 3.2 with four hundred, and 1.24 on
  average while the pusher is in it. Drawn at its own radius, thickness and orientation,
  a disc at rest is never more than a twentieth of a unit into another.
  `src/disc.ts` says how, and what each part of it is there to stop. Left
  alone, a heap can keep a pair of coins awake for good: squeezed a
  twentieth into each other by the coins lying on them, too far in to
  sleep, read back going at a unit a second while going nowhere, and waking
  what lies on them. Of two hundred heaps of three hundred coins, 14 to 23
  were left so. With `squeezedStill` a coin is read back going only as far
  as it went, and 6 are, and a heap settles with a quarter fewer awake.
- **Bodies sleep.** Only an awake body looks for its neighbours, and it wakes
  what it touches. Sleepers keep their place in a hash of their own from one
  step to the next, so a heap at rest costs nothing, and the pushers and belts
  find the sleepers under them through it.
- **Pushers** are oriented boxes that move through the bodies and shove them —
  a blade, a hull — swept across the step from where they were, so a fast box
  at a slow frame rate does not jump past what it should have hit. Each has an
  owner, and the world counts what each owner is pushing. A box given a
  `restitution` bounces a ball off it, by the speed they meet at, the box's
  own taken in, so a blade coming on throws what it strikes. Its `carry`
  (0.15 unless given) is how much of the way toward the face's own speed a
  ball touching it is brought each step: how a blade carries its load, and
  how a ball glancing off a still box is slowed along it. A box that bounces
  carries along its face only.
- **A fast ball** is moved a step at a time and then looked at, and one
  that goes further in a step than its radius could end it in the rock, and
  be put back and stopped dead, or past a thin wall altogether. Given a
  `travel`, a ball that would go further than that share of its radius in a
  step goes in pieces, each looked at: at half its radius, a ball of radius
  1 at 120 u/s is in two, and at 240 in four. It bounces off the rock by the
  same figure at every speed and every phase of a step, and never passes
  through rock a tile thick, a blade half a unit thick or a thin post, up to
  240 u/s. What happens once a step, the floor's drag, a belt, a box's carry
  and its load, happens once a step however many pieces there are. A box is
  put where it is once a step and is not pieced, so it must move less in a
  step than its half thickness and a ball's radius: 150 u/s for a blade half
  a unit thick against a ball of radius 1.
- **Bumpers** are round posts that never move, each standing from below
  everything up to its top, flat there. A ball meets the side, the top or
  the round edge between, whichever is nearest, and is bounced off the side
  and the edge by the post's restitution, which may be over one, and thrown
  up by the edge if it clips it in flight. The top is a floor to what lands
  on it and bounces as the floor does. A coin is kept out of a post's side
  as out of the rock, and lies on its top as on a box's.
- **Belts** carry what rests on them. A **magnet** pulls what lies near a
  point.
- **The rock** is a grid of solid tiles the caller owns and may rewrite in
  place. A body shoved into a tile goes back out the way it came in, not out
  the nearest face, so nothing is pushed through a wall a tile thick. A ball
  bounces off the rock, and off a floor standing above it, by the tuning's
  `wallRestitution`; off the floor by its `restitution`; and each kind's
  `bounce` scales every restitution it meets. A disc does not bounce. A
  wall is made of tiles, and where the next tile along begins, flush with
  the face a ball meets, its corner used to put the ball out on a slant and
  send it on along the wall faster than it came; with `smoothWalls` a ball
  banks off a wall of tiles as off one flat wall, and meets a corner only
  where one stands out.
- **The floor has heights**, one a tile, flat unless the caller gives them.
  A body rests on the tile under it; a tile whose floor stands above a body's
  middle is a wall to it, so a step is a wall from below and an edge from
  above, and what goes over an edge falls to the tier it lands on. A body
  resting on top of a pusher's box lies flat and is carried with it, which
  is what a sliding platform is. Below the world's **bottom** a body has
  fallen out of it, and is reported like one down a hole, as down none:
  `BOTTOM`.

  So a low wall, one a ball in flight can clear, is a tile of floor standing
  at the wall's height. To a ball rolling beside it, one standing its radius
  or more above the floor is a wall, and bounces it off; one lower is
  climbed at any speed, the ball set on its top. A ball in flight with its
  bottom above the top goes over; with its middle above and its bottom not,
  it is set on the top; with its middle below, it bounces off. Water, or any
  hazard that takes a ball, is a tile of floor far below the bottom: what
  rolls onto it falls and is reported as `BOTTOM`, over the water, and what
  is thrown over it lands beyond. Rock stays as tall as the world.

- **Surfaces**, one byte a tile beside the rock and the floor's heights, say
  what each tile of floor is made of, from a table of them: how hard it
  drags a ball rolling on it, how steadily it slows it (`roll`), and how its
  faces bounce a ball when the tile is a wall to it. Each kind's `drag`
  scales both slowings. A world given no table drags by the tuning's
  `floorDrag` and bounces off walls by its `wallRestitution`. A disc is
  held by the felt and reads none of it. Drag takes off speed as the speed,
  so how far a ball rolls goes as its speed; roll takes off a steady amount,
  so it goes as the square, as a putt dies on a green. For a ball a unit
  across (ooergolf's), how far it rolls and how long it takes:

  | Surface                 | from 10 u/s   | from 20 u/s   | from 30 u/s   | from 40 u/s    |
  | ----------------------- | ------------- | ------------- | ------------- | -------------- |
  | drag 0.8 (ooergolf now) | 11.2 u, 3.0 s | 23.8 u, 4.0 s | 36.4 u, 4.3 s | 49.0 u, 4.7 s  |
  | roll 5                  | 10.0 u, 1.9 s | 40.0 u, 3.9 s | 90.1 u, 5.9 s | 160.1 u, 7.9 s |
  | roll 7.5                | 6.7 u, 1.3 s  | 26.7 u, 2.6 s | 60.1 u, 4.0 s | 106.8 u, 5.3 s |
  | roll 10                 | 5.0 u, 1.0 s  | 20.1 u, 2.0 s | 45.1 u, 3.0 s | 80.1 u, 4.0 s  |
  | roll 12                 | 4.2 u, 0.8 s  | 16.7 u, 1.6 s | 37.6 u, 2.5 s | 66.8 u, 3.3 s  |

- **Holes** are where bodies leave the world: as many as the caller gives it,
  each with a rim the floor slopes toward, a wall to the pit, and a depth at
  which what fell is reported, with which hole it went down, and its slot
  freed. A hole that reaches below the bottom still has what goes down it:
  the body is gone once it passes the bottom, and reported as the hole's.
  Its depth counts from the floor under its middle, so it may be cut in a
  raised floor, and the floor round a body down it is no wall to it. How
  hard the floor slopes toward it, and how far out, are its own `pull` and
  `reach`, 6 and 2.5 unless given.

  A hole given a `rim` is a **cup**: the round edge where it meets the floor
  is a thing a ball meets, and is put out of and bounced off by the rim's
  figure. Nothing says by a figure whether a ball drops. A slow ball partly
  over the edge tips in; one crossing is caught if it has dropped far
  enough by the far side for the rim to meet it low and turn it back, and
  runs over if the rim meets it near its bottom and throws it up; one
  clipping the edge is turned, and may run round it and out. With no pull,
  a rim of 0.3 and a ball of radius 1 rolled through the middle:

  | Cup radius | always holed up to | always runs over from |
  | ---------- | ------------------ | --------------------- |
  | 1.6        | 22 u/s             | 26 u/s                |
  | 2.5        | 30 u/s             | 40 u/s                |
  | 3          | 36 u/s             | 48 u/s                |

  Between the two, either may happen. Off the middle it lips out sooner: in
  a cup of 2.5, a ball on a line 2 off it is holed up to 12 u/s, and turned
  by the rim 20 to 70 degrees and away from 14 to 20. A disc falls into a cup
  as into a hole, and does not meet its rim.

- **Chance** comes from a function the caller hands in, and the **tuning** —
  gravity, friction, restitution, drag, the settling of what is slow, the
  sleep window, whether a body may sleep in the air, the fastest it may be
  going to sleep, whether a squeezed coin is read back going only where it
  went, whether bodies are judged for sleep together, the hash cell — is a
  record with a coin-sized world as its defaults. Sleep goes by how far a
  body has got over a window of steps, and one bouncing, or running round
  the inside of a cup's rim, can be back where it was by the window's end;
  with `sleepInAir` off, a body sleeps only once it lies on something, and a
  ball with a `sleepSpeed` only once it is going slower than that. Without
  one, a golf fuzzer's ball was put to sleep going at up to twelve a second
  in 37 rounds of 500. Each body is judged on a window of its own, and two
  held further into each other than a sleeper lets anything be, by the
  sleepers round them, wake each other the step either sleeps, for ever.
  With `sleepTogether` every body is judged on one tick every window, once
  it has half a window behind it, and those two sleep together: a heap of
  balls left alone comes to rest with none awake, where on their own windows
  thirty-odd of two thousand stay awake. A heap of coins settles with a
  tenth fewer awake, and can still be left with a squeezed pair, which
  `squeezedStill` lets rest.

## Using it

    npm install github:onion2k/artshape-physics

It ships TypeScript sources rather than a build, and expects a bundler that
compiles them, as Vite does.

```ts
import { World } from 'artshape-physics/world';

const world = new World({
  capacity: 4000,
  grid: { cols: 96, rows: 64, originX: -144, originY: -96, tile: 3 },
  solid: rock, // one byte a tile, 1 for rock; rewrite it in place as the map changes
  radii: [0.42, 1.0], // one radius a kind of body
  thickness: [0.24, 0], // and a thickness for a kind that is a disc; none, or left out, and it is a ball
  floor: heights, // one height a tile, for tiers and steps; left out, the floor is flat
  bottom: -6, // below which a body has fallen out of the world
  holes: [{ x: 0, y: 0, radius: 5.5, depth: 14 }],
  bounce: [1, 0.6], // how bouncy each kind is, scaling every restitution it meets; left out, 1
  tuning: { wallRestitution: 0.8, bounceFrom: 2 }, // off a wall by 0.8, and nothing met slower than 2 u/s bounces
});

const coin = world.spawn(0, 12, -8, 3); // a kind, where, and how high; awake
world.pushers = [blade]; // oriented boxes, from wherever the machines are this frame
world.wakeNear(blade.x, blade.y, 6); // ahead of the blade, so sleepers are ready for it
world.hit(ball, 30, 0, 0); // a shot: added to its speed, and it is woken
world.step(1 / 60, (kind, x, y, slot, hole) => bank(kind, hole)); // what left, where, its slot, now free, and which hole, or BOTTOM
```

Everything a body is — `x`, `y`, `z`, velocity, radius `r`, thickness `h`,
orientation `q`, `kind`, `alive`, `asleep`, `carried` — is a typed array the
caller reads directly for drawing, indexed by the slot `spawn` returned.
`hit` adds to a body's speed and wakes it, which is a shot, or anything a
game throws; a dead body or a carried one is left be. A body the game
holds, with `carried[i] = 1`, is not stepped: the game puts it where it
likes, and let go, it falls from there and is judged for sleep on a window
from when it was let go, so it never sleeps where it was let go in the air.
A sleeper is not looked at at all, so one taken up is woken first, or the
world never knows it moved. `loads` says how many bodies each owner's pushers were shoving on the last
step. A disc is put down as it should lie with `setOrientation`, `axis` says
which way its face looks, and `deepest` says how far any two bodies are into
each other, or any two at rest, for a test or a game's own rules.

## Checking it

    npm run check         check:quick, then the bench
    npm run check:quick   formatting, types, lint, and the tests
    npm run bench         what a frame costs, held to a baseline both ways and to a budget

The tests build a floor of their own and put things on it: a dropped body
rests at its radius and sleeps; a hole collects once, says which hole it
was, and frees the slot, even one that reaches below the bottom; a
world has as many holes as it is given; the sleep bookkeeping stays straight
while pushers churn a heap; judged together, nothing sleeps but on a tick
with half a window behind it, and a heap of balls comes to rest with none
awake and none woken again; nothing is shoved into or through the rock; a
belt carries and a magnet pulls; a body rests on the tile under it, falls
from a high tile to a low one, is stopped by a step from below, and is
reported when it falls out of the bottom; a carried body let go falls and
sleeps where it lands, however long it was held; one on a box's top lies flat and
is carried; a ball bounces off a wall, the floor and another by their
figures times its kind's bounce, and a coin never does; chance from a seed
gives the same world twice.

Six scenes, run from seeds, hold the world bit for bit to how v0.3.0 stepped
it, so a game that has not asked for anything new gets nothing new. The
bench holds a frame's cost in a scene for each game that uses the package: a
heap churned, a bed of coins pushed, and a golf ball shot round a course,
alone and sixty-four at once; and in a heap at rest, judged together, which
is to cost next to nothing.

The discs have tests of their own, of what a coin does: lying, stacking,
leaning as put and as dropped, wedged on edge, tipping off an overhang, over
a lip pushed and tipping and propped, never through another or the floor
from a height, a pushed bed piling and never flung aside, heaps from three
seeds coming to rest with nothing at rest more than a twentieth of a unit
into anything, and two coins found as deep in each other as they are.

## Licence

MIT — see [LICENSE](LICENSE).
