# artshape-physics

A world of spheres, for a game with a great many small things rolling about
a floor and being shoved. Stepped at a fixed rate, with sleeping, a spatial
hash, and a grid of rock the bodies are kept out of.

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
  the nearest face, so nothing is pushed through a wall a tile thick.
- **Holes** are where bodies leave the world: as many as the caller gives it,
  each with a rim the floor slopes toward, a wall to the pit, and a depth at
  which what fell is reported and its slot freed.
- **Chance** comes from a function the caller hands in, and the **tuning** —
  gravity, friction, restitution, drag, the sleep window, the hash cell — is
  a record with a coin-sized world as its defaults.

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
  holes: [{ x: 0, y: 0, radius: 5.5, depth: 14 }],
});

const coin = world.spawn(0, 12, -8, 3); // a kind, where, and how high; awake
world.pushers = [blade]; // oriented boxes, from wherever the machines are this frame
world.wakeNear(blade.x, blade.y, 6); // ahead of the blade, so sleepers are ready for it
world.step(1 / 60, (kind, x, y, slot) => bank(kind)); // what fell in, and its slot is free again
```

Everything a body is — `x`, `y`, `z`, velocity, radius `r`, orientation `q`,
`kind`, `alive`, `asleep`, `carried` — is a typed array the caller reads
directly for drawing, indexed by the slot `spawn` returned. `loads` says how
many bodies each owner's pushers were shoving on the last step.

## Checking it

    npm run check     formatting, types, lint, and the tests

The tests build a floor of their own and put things on it: a dropped body
rests at its radius and sleeps; a hole collects once and frees the slot; a
world has as many holes as it is given; the sleep bookkeeping stays straight
while pushers churn a heap; nothing is shoved into or through the rock; a
belt carries and a magnet pulls; chance from a seed gives the same world
twice.

## Licence

MIT — see [LICENSE](LICENSE).
