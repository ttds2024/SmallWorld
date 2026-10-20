# Small Realm — design decisions

A fan-made map game inspired by the board game _Small World_ (Days of Wonder), with a single race:
the Humans. The page is `index.html`; the code is in `src/`.

## The map

Every game is played on a freshly drawn island (`Island #seed` in the top bar; **Another island**
on the start screen draws a new one). The terrain follows Amit Patel's
[Polygonal Map Generation for Games](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/)
and its reference code, [mapgen2](https://github.com/amitp/mapgen2) (`src/mapgen.ts`):

1. **Polygons:** 1,600 random points, spread out by 2 rounds of Lloyd relaxation, give a Voronoi
   mesh (with [d3-delaunay](https://github.com/d3/d3-delaunay)): cells, the corners where three
   cells meet, and the edges between them.
2. **Island shape:** fractal noise against a threshold that rises towards the map's edge
   (`noise > 0.2 + 0.35·r²`) decides which corners are water; a cell with 30% or more water
   corners is water. Water connected to the map's edge is ocean, the rest lakes.
3. **Elevation:** distance from the map's edge, climbing only over land (so lakes sit low), then
   redistributed so that low ground is common and peaks rare (mapgen2's formula, scale 1.1).
4. **Rivers:** from random corners between 0.3 and 0.9 elevation, downhill to the sea; the more
   rivers share an edge, the wider it is drawn.
5. **Moisture:** from rivers and lakes, decaying by 10% per step, and 1 by the sea; then spread
   evenly over the land.
6. **Biomes:** the Whittaker table from elevation and moisture (snow, tundra, taiga, forests,
   grassland, deserts…), plus marsh on wet lowland, beach on the coast. Colours are mapgen2's; cells
   are lightly hill-shaded with light from the north-west.
7. **Noisy edges:** each polygon side wanders inside the quadrilateral of its two corners and two
   cell centres, so neighbouring sides never cross; coast, rivers and biome changes get the finest
   detail.

The game's regions are built on top (`src/map.ts`):

- Play happens on the main island; smaller islands are scenery. Lakes of 4+ cells become lake
  regions (unconquerable); smaller ponds belong to the land around them.
- 22 land regions grow from evenly spread seeds (k-means over the land) in a weighted flood fill
  that costs more uphill and much more across a river, so borders tend to follow rivers and
  ridges.
- A region's terrain is the one most of its cells have (biomes map to farmland, forest, hills,
  mountain or swamp); mountain and swamp win from 30% of its cells.
- Regions on the sea are coastal: a band with no regions lands there. A third of the land starts
  under Lost Tribes. Names are made from parts that fit the terrain (Oakfield, Stormcrag, Greyfen).
- An island that makes a poor board (main island too small or too big, more than 3 lakes, land
  split by a lake, a region under 14 cells, fewer than 6 coastal regions) is skipped for the next
  seed.

## Rules

Two players, you and the AI Rival, both Humans, take 10 turns each; you go first. Everyone starts
with 5 coins; the most coins at the end wins.

- **A band** is 10 Humans tokens. At the start of each turn every region keeps 1 token and the
  rest go to hand.
- **Conquering** costs 2 tokens, +1 per token in the region (a Lost Tribe counts as 1), +1 on a
  mountain. A band with no regions lands on any coastal region; after that, conquests must touch
  its regions. You can't attack your own regions, active or in decline.
- **Final conquest:** short of tokens (but with at least 1), you may roll the reinforcement die
  (0, 0, 0, 1, 2, 3). Success or not, conquering ends for the turn.
- **Losses:** the defender loses 1 token; the rest are spread over their regions (one at a time
  onto the weakest) at the end of the attacker's turn, or wait in hand if they hold nothing. Lost
  Tribes and Humans in decline are wiped out.
- **Abandon:** before the first conquest of a turn, a region's tokens can be taken back to hand.
- **Redeploy:** click a region to add a token, right-click (or the − button) to take one back;
  each region keeps at least 1. Tokens left in hand at the end of the turn are spread out
  automatically.
- **Scoring** at the end of each turn: 1 coin per region (active or in decline), +1 per farmland
  held by active Humans (the Humans' race power).
- **Decline** replaces the turn's conquests: each region keeps 1 token in decline and scores (no
  farmland bonus); an older band in decline leaves the map. The next turn a fresh band of 10
  lands on the coast.

Differences from the board game: one race, no special-power badges (the badge's tokens are folded
into the band's 10), no race-picking coins, and lost tokens are redeployed automatically.

## Battles

With **Fight battles** on (the default; the toggle under the actions, remembered in local
storage), each of your attacks is a siege (`src/battle.ts` simulates it, `src/battle-view.ts` draws
it on a canvas). The Rival's attacks still resolve by the plain rules, instantly.

- **The scene:** your catapult on the left under your blue banner, the defenders' castle on the
  right under theirs (red for the Rival, brown for a Lost Tribe, grey for Humans in decline or an
  empty keep). The backdrop follows the region's terrain (fields, forest, hills, swamp; mountain
  castles stand on a hill). Wind, shown at the top, pushes every shot a little.
- **Aiming:** drag back from the catapult and let go, like a slingshot; the first part of the
  flight is dotted, and the last shot's path stays faint. Or ←/→ for power, ↑/↓ for the angle
  (10°–80°), Space to fire, 1/2 for the ammo.
- **Castle strength:** 40, +20 per token above 2 that the attack costs (defenders, mountain).
  Taller towers for stronger castles.
- **Shots:** cost + 3 with enough tokens. **Fireballs** (2 per siege, each uses a shot) hit
  harder (about 35 against 16 for a stone), splash the two nearest blocks and set the struck one
  burning. Faster shots hit harder.
- **Damage:** every hit shows its damage over the castle (orange for fire); the HUD shows the
  castle's strength left, the damage dealt so far, the shots left and the wind. Blocks crack, then
  crumble, and the ones above drop into the gap.
- **Win:** strength 0: the castle falls, your banner goes up on the rubble and the region is
  taken as usual (the attack's tokens move in).
- **Lose:** the shots run out first: "Driven back!" — you keep your tokens but your conquests end
  for the turn (like a failed final roll). **Retreat** mid-siege counts as a loss; **Call off the
  attack** before the first shot costs nothing.
- **Short of tokens:** instead of rolling the reinforcement die you storm the castle with only
  tokens + 1 shots; a win takes the region with all your tokens and ends your conquests.

## The Rival

`src/ai.ts` plays one move at a time, ~0.65 s apart so you can follow it:

- It goes into decline when it holds 3+ regions, can't afford any attack, and the game isn't almost
  over.
- It attacks the affordable target with the best appeal: value (farmland counts double), minus
  cost, plus a bonus for hitting the player.
- With nothing affordable, it tries the reinforcement die on the cheapest target it needs at most 2
  extra for.
- It puts spare tokens on its most exposed regions (open neighbours per token).

## Interface

- Glowing (dashed) regions are legal targets, with a sword badge showing the cost; a red dashed
  badge means you are short and the attack would need the die (the region card asks first).
- Owned regions are tinted blue (you) or red (Rival); tokens in decline are grey with a dashed rim;
  Lost Tribes are brown.
- The side panel shows the phase, your hand, the actions (Stop conquering / End turn / Go into
  decline), the hovered or selected region, and a chronicle of every move. Phones stack the panel
  under the map and enlarge labels and tokens.
- Your best score is kept in local storage.
