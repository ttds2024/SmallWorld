# Small Realm — design decisions

A fan-made map game inspired by the board game _Small World_ (Days of Wonder), with a single race:
the Humans. The page is `index.html`; the code is in `src/`.

## The map

- 24 regions: Voronoi cells around hand-placed points (`src/map.ts`), with wobbly
  hand-drawn inner borders. A border's wobble depends only on its two end points, so both sides
  draw the same line.
- Terrains: farmland (6), forest, hills, swamp, mountain and two lakes. 8 regions start with a Lost
  Tribe token. Regions touching the frame are the map's edge.
- Neighbours share an edge, not just a corner. Lakes can't be conquered, so the map is crossed on
  land.

## Rules

Two players, you and the AI Rival, both Humans, take 10 turns each; you go first. Everyone starts
with 5 coins; the most coins at the end wins.

- **A band** is 10 Humans tokens. At the start of each turn every region keeps 1 token and the
  rest go to hand.
- **Conquering** costs 2 tokens, +1 per token in the region (a Lost Tribe counts as 1), +1 on a
  mountain. A band with no regions enters from the edge; after that, conquests must touch its
  regions. You can't attack your own regions, active or in decline.
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
  enters from the edge.

Differences from the board game: one race, no special-power badges (the badge's tokens are folded
into the band's 10), no race-picking coins, and lost tokens are redeployed automatically.

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
