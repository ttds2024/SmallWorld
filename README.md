# SmallWorld

**Small Realm**: a web map game inspired by the board game _Small World_ (Days of Wonder), with a
single race, the Humans, against an AI rival over 10 turns. Conquer regions on an interactive map,
roll the reinforcement die for a last attack, go into decline when your band is spread thin, and
finish with the most victory coins.

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
