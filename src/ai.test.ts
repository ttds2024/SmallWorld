import { describe, expect, it } from 'vitest';
import { nextMove } from './ai';
import { buildMap } from './map';
import { Game } from './rules';
import { seededRandom } from './geometry';

describe('nextMove', () => {
  it('plays whole games of AI against AI with legal moves only', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = new Game(buildMap(), ['A', 'B'], [true, true], seededRandom(seed));
      let moves = 0;
      while (g.phase !== 'over') {
        expect(g.apply(nextMove(g)).ok).toBe(true);
        expect(++moves).toBeLessThan(2000);
      }
      for (const r of g.regions) expect(r.tokens).toBeGreaterThanOrEqual(r.owner === null ? 0 : 1);
      // Both players actually played.
      expect(Math.min(...g.players.map((p) => p.coins))).toBeGreaterThan(20);
    }
  });

  it('opens on the border', () => {
    const g = new Game(buildMap(), ['A', 'B'], [true, true], seededRandom(1));
    const move = nextMove(g);
    expect(move.type).toBe('conquer');
    if (move.type === 'conquer') expect(g.map.regions[move.region]!.border).toBe(true);
  });
});
