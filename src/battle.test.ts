import { describe, expect, it } from 'vitest';
import {
  castleStrength,
  createBattle,
  fire,
  FIREBALLS,
  launchVelocity,
  shotsFor,
  step,
  type Battle,
  type BattleEvent,
} from './battle';

/** Runs the siege until the shot in the air lands and fires go out. */
function settle(b: Battle): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (let t = 0; t < 10 && (b.shot || b.blocks.some((k) => k.burning > 0)); t += 1 / 60) {
    events.push(...step(b, 1 / 60));
  }
  events.push(...step(b, 1 / 60));
  return events;
}

/** An angle and power that hit the middle of this castle with no wind. */
function aimAtCastle(b: Battle): { angle: number; power: number } {
  for (let angle = 20; angle <= 70; angle += 2) {
    for (let power = 0.2; power <= 1; power += 0.01) {
      const trial = structuredClone({ ...b, random: undefined });
      const copy: Battle = { ...trial, random: () => 0.5, wind: 0, shot: null };
      fire(copy, 'stone', angle, power);
      const hit = settle(copy).find((e) => e.type === 'hit');
      if (hit && hit.type === 'hit' && hit.x > 740 && hit.x < 800) return { angle, power };
    }
  }
  throw new Error('castle out of reach');
}

describe('siege setup', () => {
  it('scales the castle and the shots with the cost', () => {
    expect(castleStrength(2)).toBe(40);
    expect(castleStrength(5)).toBe(100);
    expect(shotsFor(3, 10)).toBe(6);
    expect(shotsFor(4, 2)).toBe(3);
    const big = createBattle({ cost: 7, hand: 10, seed: 3 });
    const small = createBattle({ cost: 2, hand: 10, seed: 3 });
    expect(big.blocks.length).toBeGreaterThan(small.blocks.length);
    expect(big.health).toBe(castleStrength(7));
    expect(small.fireballs).toBe(FIREBALLS);
    expect(Math.abs(small.wind)).toBeLessThanOrEqual(60);
  });

  it('throws faster with more power, and steeper with a higher angle', () => {
    const low = launchVelocity(30, 0.5);
    const high = launchVelocity(60, 0.5);
    expect(-high.vy / high.vx).toBeGreaterThan(-low.vy / low.vx);
    expect(Math.hypot(launchVelocity(45, 1).vx, launchVelocity(45, 1).vy)).toBeGreaterThan(
      Math.hypot(launchVelocity(45, 0.2).vx, launchVelocity(45, 0.2).vy),
    );
  });
});

describe('shooting', () => {
  for (const hill of [false, true]) {
    it(`can reach the castle${hill ? ' on a hill' : ''} and damages it`, () => {
      const b = createBattle({ cost: 2, hand: 10, seed: 1, hill });
      b.wind = 0;
      const { angle, power } = aimAtCastle(b);
      expect(fire(b, 'stone', angle, power)).toBe(true);
      const hit = settle(b).find((e) => e.type === 'hit');
      // A stone deals 18 × (0.7–1.3) ± 3, whatever the block it strikes has left.
      expect(hit && hit.type === 'hit' && hit.damage).toBeGreaterThanOrEqual(9);
      expect(b.dealt).toBeGreaterThan(0);
      expect(b.health).toBe(b.maxHealth - b.dealt);
    });
  }

  it('deals nothing when the shot falls short', () => {
    const b = createBattle({ cost: 2, hand: 10, seed: 1 });
    b.wind = 0;
    fire(b, 'stone', 45, 0);
    const events = settle(b);
    expect(events.some((e) => e.type === 'miss')).toBe(true);
    expect(b.dealt).toBe(0);
  });

  it('hits harder with fireballs, which splash and burn', () => {
    const stone = createBattle({ cost: 6, hand: 10, seed: 2 });
    const fireball = createBattle({ cost: 6, hand: 10, seed: 2 });
    for (const b of [stone, fireball]) b.wind = 0;
    const { angle, power } = aimAtCastle(stone);
    fire(stone, 'stone', angle, power);
    fire(fireball, 'fireball', angle, power);
    settle(stone);
    const events = settle(fireball);
    expect(fireball.dealt).toBeGreaterThan(stone.dealt);
    expect(events.some((e) => e.type === 'burn')).toBe(true);
    expect(fireball.fireballs).toBe(FIREBALLS - 1);
  });

  it('allows one shot in the air at a time, and only the fireballs there are', () => {
    const b = createBattle({ cost: 2, hand: 10, seed: 1 });
    expect(fire(b, 'fireball', 45, 0.5)).toBe(true);
    expect(fire(b, 'stone', 45, 0.5)).toBe(false);
    settle(b);
    b.fireballs = 0;
    expect(fire(b, 'fireball', 45, 0.5)).toBe(false);
  });
});

describe('outcome', () => {
  it('is won when the castle has taken enough damage', () => {
    const b = createBattle({ cost: 2, hand: 10, seed: 1 });
    b.wind = 0;
    const { angle, power } = aimAtCastle(b);
    let won = false;
    for (let i = 0; i < 5 && !won; i++) {
      if (!fire(b, 'fireball', angle, power)) fire(b, 'stone', angle, power);
      won = settle(b).some((e) => e.type === 'won');
    }
    expect(won).toBe(true);
    expect(b.outcome).toBe('won');
    expect(b.health).toBe(0);
    expect(b.dealt).toBe(b.maxHealth);
  });

  it('is lost when the shots run out first', () => {
    const b = createBattle({ cost: 3, hand: 1, seed: 1 });
    expect(b.shots).toBe(2);
    fire(b, 'stone', 45, 0);
    settle(b);
    expect(b.outcome).toBe('fighting');
    fire(b, 'stone', 45, 0);
    expect(settle(b).some((e) => e.type === 'lost')).toBe(true);
    expect(fire(b, 'stone', 45, 0.5)).toBe(false);
  });
});
