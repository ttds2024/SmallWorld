import { describe, expect, it } from 'vitest';
import { buildMap, type GameMap, type Region } from './map';
import { Game, GAME_TURNS, HUMAN_TOKENS, START_COINS } from './rules';

/** The first island with every kind of region these tests need. */
function setup() {
  for (let seed = 1; ; seed++) {
    const map: GameMap = buildMap(seed);
    const find = (test: (r: Region) => boolean) => map.regions.find(test)?.id;
    const open = (r: Region) => r.coast && !r.lostTribe && r.terrain !== 'lake';
    const farm = find((r) => open(r) && r.terrain === 'farmland');
    if (farm === undefined) continue;
    const shore = find(
      (r) =>
        open(r) &&
        r.terrain !== 'farmland' &&
        r.terrain !== 'mountain' &&
        r.neighbours.includes(farm),
    );
    const tribal = find((r) => r.coast && r.lostTribe && r.terrain !== 'mountain');
    const inland = find((r) => !r.coast && r.lostTribe && r.terrain !== 'mountain');
    const mountain = find((r) => r.terrain === 'mountain');
    if ([shore, tribal, inland, mountain].includes(undefined)) continue;
    const far = find(
      (r) => r.terrain !== 'lake' && r.id !== shore && !r.neighbours.includes(shore!),
    );
    if (far === undefined) continue;
    return { map, farm, shore: shore!, tribal: tribal!, inland: inland!, mountain: mountain!, far };
  }
}

const {
  map,
  farm: FARM, // coastal farmland
  shore: SHORE, // coastal forest, hills or swamp next to FARM
  tribal: COAST_TRIBE, // coastal Lost Tribe
  inland: INLAND_TRIBE, // inland Lost Tribe
  mountain,
  far, // not next to SHORE
} = setup();

/** A game where the reinforcement die always shows `face`'s index. */
const game = (dieIndex = 0) => new Game(map, ['A', 'B'], [false, false], () => dieIndex / 6);

describe('Game', () => {
  it('starts with fresh Humans in hand and coins', () => {
    const g = game();
    expect(g.player.hand).toBe(HUMAN_TOKENS);
    expect(g.players[0].coins).toBe(START_COINS);
    expect(g.regions[INLAND_TRIBE]!.lostTribe).toBe(true);
  });

  it('lands on the coast, then expands to neighbours', () => {
    const g = game();
    expect(g.canAttack(INLAND_TRIBE)).toBe(false);
    expect(g.canAttack(SHORE)).toBe(true);
    expect(g.apply({ type: 'conquer', region: SHORE }).ok).toBe(true);
    expect(g.regions[SHORE]).toMatchObject({ owner: 0, tokens: 2 });
    expect(g.player.hand).toBe(HUMAN_TOKENS - 2);
    expect(g.canAttack(far)).toBe(false);
  });

  it('charges +1 per defending token and +1 for mountains', () => {
    const g = game();
    expect(g.cost(SHORE)).toBe(2);
    expect(g.cost(COAST_TRIBE)).toBe(3);
    expect(g.cost(INLAND_TRIBE)).toBe(3);
    expect(g.cost(mountain)).toBe(map.regions[mountain]!.lostTribe ? 4 : 3);
  });

  it('never lets anyone conquer a lake', () => {
    const g = game();
    g.apply({ type: 'conquer', region: SHORE });
    for (const r of map.regions) if (r.terrain === 'lake') expect(g.canAttack(r.id)).toBe(false);
  });

  it('rolls the die for a final conquest and stops conquering', () => {
    const g = game(5); // rolls 3
    g.player.hand = 1;
    const out = g.apply({ type: 'conquer', region: COAST_TRIBE });
    expect(out.roll).toBe(3);
    expect(g.regions[COAST_TRIBE]).toMatchObject({ owner: 0, tokens: 1 });
    expect(g.phase).toBe('redeploy');
    expect(g.player.hand).toBe(0);
  });

  it('keeps the tokens when the final roll falls short', () => {
    const g = game(0); // rolls 0
    g.player.hand = 1;
    g.apply({ type: 'conquer', region: SHORE });
    expect(g.regions[SHORE]!.owner).toBe(null);
    expect(g.player.hand).toBe(1);
    expect(g.phase).toBe('redeploy');
  });

  it('scores regions and farmland, and readies troops next turn', () => {
    const g = game();
    g.apply({ type: 'conquer', region: FARM });
    g.apply({ type: 'conquer', region: SHORE });
    g.apply({ type: 'finish' });
    expect(g.income(0)).toBe(3);
    g.apply({ type: 'end' });
    expect(g.players[0].coins).toBe(START_COINS + 3);
    expect(g.players[0].hand).toBe(0);
    expect(g.regions[FARM]!.tokens + g.regions[SHORE]!.tokens).toBe(HUMAN_TOKENS);
    expect(g.current).toBe(1);
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    expect(g.current).toBe(0);
    expect(g.turn).toBe(2);
    expect(g.player.hand).toBe(HUMAN_TOKENS - 2);
  });

  it('kills one defender and gives the rest back to their owner', () => {
    const g = game();
    g.apply({ type: 'conquer', region: SHORE });
    g.apply({ type: 'finish' });
    g.apply({ type: 'place', region: SHORE });
    g.apply({ type: 'place', region: SHORE }); // 4 on Oakmere, 6 left
    g.apply({ type: 'take', region: SHORE });
    expect(g.regions[SHORE]!.tokens).toBe(3);
    g.apply({ type: 'end' }); // the remaining 7 are spread over Oakmere
    expect(g.regions[SHORE]!.tokens).toBe(10);
    // B attacks with 12 tokens worth of hand.
    g.player.hand = 12;
    g.apply({ type: 'conquer', region: SHORE });
    expect(g.regions[SHORE]).toMatchObject({ owner: 1, tokens: 12 });
    expect(g.players[0].returning).toBe(9);
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    // A holds nothing, so the survivors wait in hand.
    expect(g.players[0].hand).toBe(9);
  });

  it('goes into decline: one token per region, then a fresh band', () => {
    const g = game();
    g.apply({ type: 'conquer', region: SHORE });
    g.apply({ type: 'conquer', region: FARM });
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    expect(g.apply({ type: 'decline' }).scored).toBe(2); // no farmland bonus in decline
    expect(g.regions[SHORE]).toMatchObject({ owner: 0, tokens: 1, declined: true });
    expect(g.players[0].active).toBe(false);
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    expect(g.player.hand).toBe(HUMAN_TOKENS);
    // The new band lands on the coast again and cannot attack its own declined regions.
    expect(g.canAttack(SHORE)).toBe(false);
    expect(g.canAttack(COAST_TRIBE)).toBe(true);
  });

  it('abandons a region only before the first conquest', () => {
    const g = game();
    g.apply({ type: 'conquer', region: SHORE });
    expect(g.apply({ type: 'abandon', region: SHORE }).ok).toBe(false);
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    expect(g.apply({ type: 'abandon', region: SHORE }).ok).toBe(true);
    expect(g.regions[SHORE]!.owner).toBe(null);
    expect(g.player.hand).toBe(HUMAN_TOKENS);
  });

  it('ends after the last turn', () => {
    const g = game();
    for (let i = 0; i < GAME_TURNS * 2; i++) {
      g.apply({ type: 'finish' });
      g.apply({ type: 'end' });
    }
    expect(g.phase).toBe('over');
    expect(g.winner()).toBe(null);
    expect(g.apply({ type: 'finish' }).ok).toBe(false);
  });
});
