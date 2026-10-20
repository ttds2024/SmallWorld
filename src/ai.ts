import { GAME_TURNS, type Action, type Game } from './rules';

/** How much the AI wants a region it could attack: worth more, cheaper and hurting the rival. */
function appeal(game: Game, region: number): number {
  const state = game.regions[region]!;
  const farmland = game.map.regions[region]!.terrain === 'farmland' ? 1 : 0;
  const rival = state.owner !== null && state.owner !== game.current;
  return (1 + farmland) * 10 - game.cost(region) * 3 + (rival ? (state.declined ? 2 : 4) : 0);
}

/** Open sides of a region: neighbours that are not lakes and not held by the AI's active Humans. */
function exposure(game: Game, region: number): number {
  return game.map.regions[region]!.neighbours.filter((n) => {
    const r = game.regions[n]!;
    return game.map.regions[n]!.terrain !== 'lake' && (r.owner !== game.current || r.declined);
  }).length;
}

/** The AI's next move. Call it again after applying each one until its turn ends. */
export function nextMove(game: Game): Action {
  const hand = game.player.hand;
  if (game.phase === 'conquer') {
    const targets = game.targets();
    const affordable = targets.filter((t) => game.cost(t) <= hand);
    const held = game.activeRegions().length;
    // Out of steam with a spread-out band: decline and come back with fresh Humans.
    if (
      game.conquered === 0 &&
      affordable.length === 0 &&
      held >= 3 &&
      game.turn < GAME_TURNS - 1
    ) {
      return { type: 'decline' };
    }
    if (affordable.length > 0) {
      const best = affordable.reduce((a, b) => (appeal(game, b) > appeal(game, a) ? b : a));
      return { type: 'conquer', region: best };
    }
    // One last try with the reinforcement die, when it can make up the difference.
    const reachable = targets.filter((t) => hand >= 1 && game.cost(t) - hand <= 2);
    if (reachable.length > 0) {
      const cheapest = reachable.reduce((a, b) => (game.cost(b) < game.cost(a) ? b : a));
      return { type: 'conquer', region: cheapest };
    }
    return { type: 'finish' };
  }
  const held = game.activeRegions();
  if (hand > 0 && held.length > 0) {
    // Guard the most exposed region relative to the tokens already on it.
    const weight = (r: number) => (exposure(game, r) + 0.5) / game.regions[r]!.tokens;
    const region = held.reduce((a, b) => (weight(b) > weight(a) ? b : a));
    return { type: 'place', region };
  }
  return { type: 'end' };
}
