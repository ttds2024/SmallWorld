import { describe, expect, it } from 'vitest';
import { buildMap } from './map';
import { Game, GAME_TURNS, HUMAN_TOKENS, START_COINS } from './rules';

const map = buildMap();
const byName = (name: string) => map.regions.find((r) => r.name === name)!.id;
const OAKMERE = byName('Oakmere'); // forest, border
const GRIMSPIRE = byName('Grimspire'); // mountain, border
const HEARTHVALE = byName('Hearthvale'); // farmland, border
const STONEBARROW = byName('Stonebarrow'); // hills, Lost Tribe, inland

/** A game where the reinforcement die always shows `face`'s index. */
const game = (dieIndex = 0) => new Game(map, ['A', 'B'], [false, false], () => dieIndex / 6);

describe('Game', () => {
  it('starts with fresh Humans in hand and coins', () => {
    const g = game();
    expect(g.player.hand).toBe(HUMAN_TOKENS);
    expect(g.players[0].coins).toBe(START_COINS);
    expect(g.regions[STONEBARROW]!.lostTribe).toBe(true);
  });

  it('enters from the border, then expands to neighbours', () => {
    const g = game();
    expect(g.canAttack(STONEBARROW)).toBe(false);
    expect(g.canAttack(OAKMERE)).toBe(true);
    expect(g.apply({ type: 'conquer', region: OAKMERE }).ok).toBe(true);
    expect(g.regions[OAKMERE]).toMatchObject({ owner: 0, tokens: 2 });
    expect(g.player.hand).toBe(HUMAN_TOKENS - 2);
    expect(map.regions[OAKMERE]!.neighbours).not.toContain(byName('Bogmarsh'));
    expect(g.canAttack(byName('Bogmarsh'))).toBe(false);
  });

  it('charges +1 per defending token and +1 for mountains', () => {
    const g = game();
    expect(g.cost(OAKMERE)).toBe(2);
    expect(g.cost(GRIMSPIRE)).toBe(3);
    expect(g.cost(STONEBARROW)).toBe(3);
  });

  it('never lets anyone conquer a lake', () => {
    const g = game();
    g.apply({ type: 'conquer', region: OAKMERE });
    for (const r of map.regions) if (r.terrain === 'lake') expect(g.canAttack(r.id)).toBe(false);
  });

  it('rolls the die for a final conquest and stops conquering', () => {
    const g = game(5); // rolls 3
    g.player.hand = 1;
    const out = g.apply({ type: 'conquer', region: GRIMSPIRE });
    expect(out.roll).toBe(3);
    expect(g.regions[GRIMSPIRE]).toMatchObject({ owner: 0, tokens: 1 });
    expect(g.phase).toBe('redeploy');
    expect(g.player.hand).toBe(0);
  });

  it('keeps the tokens when the final roll falls short', () => {
    const g = game(0); // rolls 0
    g.player.hand = 1;
    g.apply({ type: 'conquer', region: OAKMERE });
    expect(g.regions[OAKMERE]!.owner).toBe(null);
    expect(g.player.hand).toBe(1);
    expect(g.phase).toBe('redeploy');
  });

  it('scores regions and farmland, and readies troops next turn', () => {
    const g = game();
    g.apply({ type: 'conquer', region: HEARTHVALE });
    g.apply({ type: 'conquer', region: OAKMERE });
    g.apply({ type: 'finish' });
    expect(g.income(0)).toBe(3);
    g.apply({ type: 'end' });
    expect(g.players[0].coins).toBe(START_COINS + 3);
    expect(g.players[0].hand).toBe(0);
    expect(g.regions[HEARTHVALE]!.tokens + g.regions[OAKMERE]!.tokens).toBe(HUMAN_TOKENS);
    expect(g.current).toBe(1);
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    expect(g.current).toBe(0);
    expect(g.turn).toBe(2);
    expect(g.player.hand).toBe(HUMAN_TOKENS - 2);
  });

  it('kills one defender and gives the rest back to their owner', () => {
    const g = game();
    g.apply({ type: 'conquer', region: OAKMERE });
    g.apply({ type: 'finish' });
    g.apply({ type: 'place', region: OAKMERE });
    g.apply({ type: 'place', region: OAKMERE }); // 4 on Oakmere, 6 left
    g.apply({ type: 'take', region: OAKMERE });
    expect(g.regions[OAKMERE]!.tokens).toBe(3);
    g.apply({ type: 'end' }); // the remaining 7 are spread over Oakmere
    expect(g.regions[OAKMERE]!.tokens).toBe(10);
    // B attacks with 12 tokens worth of hand.
    g.player.hand = 12;
    g.apply({ type: 'conquer', region: OAKMERE });
    expect(g.regions[OAKMERE]).toMatchObject({ owner: 1, tokens: 12 });
    expect(g.players[0].returning).toBe(9);
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    // A holds nothing, so the survivors wait in hand.
    expect(g.players[0].hand).toBe(9);
  });

  it('goes into decline: one token per region, then a fresh band', () => {
    const g = game();
    g.apply({ type: 'conquer', region: OAKMERE });
    g.apply({ type: 'conquer', region: HEARTHVALE });
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    expect(g.apply({ type: 'decline' }).scored).toBe(2); // no farmland bonus in decline
    expect(g.regions[OAKMERE]).toMatchObject({ owner: 0, tokens: 1, declined: true });
    expect(g.players[0].active).toBe(false);
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    expect(g.player.hand).toBe(HUMAN_TOKENS);
    // The new band enters from the border again and cannot attack its own declined regions.
    expect(g.canAttack(OAKMERE)).toBe(false);
    expect(g.canAttack(GRIMSPIRE)).toBe(true);
  });

  it('abandons a region only before the first conquest', () => {
    const g = game();
    g.apply({ type: 'conquer', region: OAKMERE });
    expect(g.apply({ type: 'abandon', region: OAKMERE }).ok).toBe(false);
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    g.apply({ type: 'finish' });
    g.apply({ type: 'end' });
    expect(g.apply({ type: 'abandon', region: OAKMERE }).ok).toBe(true);
    expect(g.regions[OAKMERE]!.owner).toBe(null);
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
