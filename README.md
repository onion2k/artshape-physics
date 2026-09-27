# artshape-physics

A world of spheres and of coins, for a game with a great many small things
rolling about a floor, piling on it and being shoved. Stepped at a fixed
rate, with sleeping, a spatial hash, and a grid of rock the bodies are kept
out of.

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
  machine of fifteen hundred with a few hundred awake is stepped in under two
  milliseconds a frame. Drawn at its own radius, thickness and orientation,
  a disc at rest is never more than a twentieth of a unit into another.
  `src/disc.ts` says how, and what each part of it is there to stop.
- **Bodies sleep.** Only an awake body looks for its neighbours, and it wakes
  what it touches. Sleepers keep their place in a hash of their own from one
  step to the next, so a heap at rest costs nothing, and the pushers and belts
  find the sleepers under them through it.
- **Pushers** are oriented boxes that move through the bodies and shove them —
  a blade, a hull — swept across the step from where they were, so a fast box
  at a slow frame rate does not jump past what it should have hit. Each has an
  owner, and the world counts what each owner is pushing.
- **Belts** carry what rests on them. A **magnet** pulls what lies near a
  point.
- **The rock** is a grid of solid tiles the caller owns and may rewrite in
  place. A body shoved into a tile goes back out the way it came in, not out
  the nearest face, so nothing is pushed through a wall a tile thick. A ball
  bounces off the rock, and off a floor standing above it, by the tuning's
  `wallRestitution`; off the floor by its `restitution`; and each kind's
  `bounce` scales every restitution it meets. A disc does not bounce.
- **The floor has heights**, one a tile, flat unless the caller gives them.
  A body rests on the tile under it; a tile whose floor stands above a body's
  middle is a wall to it, so a step is a wall from below and an edge from
  above, and what goes over an edge falls to the tier it lands on. A body
  resting on top of a pusher's box lies flat and is carried with it, which
  is what a sliding platform is. Below the world's **bottom** a body has
  fallen out of it, and is reported like one down a hole, as down none:
  `BOTTOM`.
- **Holes** are where bodies leave the world: as many as the caller gives it,
  each with a rim the floor slopes toward, a wall to the pit, and a depth at
  which what fell is reported, with which hole it went down, and its slot
  freed. A hole that reaches below the bottom still has what goes down it:
  the body is gone once it passes the bottom, and reported as the hole's.
- **Chance** comes from a function the caller hands in, and the **tuning** —
  gravity, friction, restitution, drag, the settling of what is slow, the
  sleep window, whether a body may sleep in the air, the hash cell — is a
  record with a coin-sized world as its defaults. Sleep goes by how far a
  body has got over a window of steps, and one bouncing can be back where it
  was by the window's end; with `sleepInAir` off, a body sleeps only once it
  lies on something.

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
game throws; a dead body or a carried one is left be. `loads` says how many bodies each owner's pushers were shoving on the last
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
while pushers churn a heap; nothing is shoved into or through the rock; a
belt carries and a magnet pulls; a body rests on the tile under it, falls
from a high tile to a low one, is stopped by a step from below, and is
reported when it falls out of the bottom; one on a box's top lies flat and
is carried; a ball bounces off a wall, the floor and another by their
figures times its kind's bounce, and a coin never does; chance from a seed
gives the same world twice.

Six scenes, run from seeds, hold the world bit for bit to how v0.3.0 stepped
it, so a game that has not asked for anything new gets nothing new. The
bench holds a frame's cost in a scene for each game that uses the package: a
heap churned, a bed of coins pushed, and a golf ball shot round a course,
alone and sixty-four at once.

The discs have tests of their own, of what a coin does: lying, stacking,
leaning as put and as dropped, wedged on edge, tipping off an overhang, over
a lip pushed and tipping and propped, never through another or the floor
from a height, a pushed bed piling and never flung aside, heaps from three
seeds coming to rest with nothing at rest more than a twentieth of a unit
into anything, and two coins found as deep in each other as they are.

## Licence

MIT — see [LICENSE](LICENSE).
