# SmallWorld

**Small Realm**: a web map game inspired by the board game _Small World_ (Days of Wonder), with a
single race, the Humans, against an AI rival over 10 turns. Conquer regions on an interactive map,
roll the reinforcement die for a last attack, go into decline when your band is spread thin, and
finish with the most victory coins.

Every game is played on a freshly generated island, made the way Amit Patel's
[Polygonal Map Generation for Games](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/)
describes: Voronoi polygons, elevation, rivers, moisture and biomes, with noisy coastlines.

Your attacks are fought as sieges: aim a catapult at the defenders' castle and bring it down with
stones and fireballs before your shots run out (or turn **Fight battles** off for the plain rules).

See [docs/DESIGN.md](docs/DESIGN.md) for the rules and design decisions.

## Development

```sh
npm install
npm run dev      # start the dev server
npm run check    # typecheck, lint, format check, unit tests
npm run build    # production build in dist/
```

## Deploying

The **Deploy to GitHub Pages** workflow builds and publishes the game on every push to `main`
(at `https://ttds2024.github.io/SmallWorld/`).

The game was first built inside [WordFall](https://github.com/ttds2024/WordFall) (`smallworld/`).
