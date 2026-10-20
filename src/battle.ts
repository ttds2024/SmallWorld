/**
 * A siege: the attacker's catapult on the left lobs stones and fireballs at the defenders' castle
 * on the right. Pure simulation, no drawing: the scene in battle-view.ts calls fire() and step().
 */
import { seededRandom } from './geometry';

export type Ammo = 'stone' | 'fireball';

/** The scene, in its own units: 960 × 540, y down. */
export const WIDTH = 960;
export const HEIGHT = 540;
export const GROUND = 470;
/** Where shots leave the catapult's bucket. */
export const LAUNCH = { x: 168, y: 372 };
const GRAVITY = 600;
const MIN_SPEED = 320;
const MAX_SPEED = 900;
const BLOCK_H = 34;
/** Fireballs per siege; they use up shots like stones. */
export const FIREBALLS = 2;

export interface Block {
  x: number;
  /** Top edge now; falls towards `rest` when blocks below it go. */
  y: number;
  rest: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  column: number;
  /** Seconds of fire left, from a fireball. */
  burning: number;
  /** The castle's look: towers get a roof, the keep a gate and a banner. */
  part: 'tower' | 'wall' | 'keep';
}

export interface Shot {
  ammo: Ammo;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export type BattleEvent =
  | { type: 'hit'; x: number; y: number; damage: number; ammo: Ammo }
  | { type: 'burn'; x: number; y: number; damage: number }
  | { type: 'miss'; x: number; y: number }
  | { type: 'crumble'; block: Block }
  | { type: 'won' }
  | { type: 'lost' };

export interface Battle {
  /** The castle's strength: the siege is won when it reaches 0. */
  health: number;
  maxHealth: number;
  /** Damage dealt so far. */
  dealt: number;
  shots: number;
  fireballs: number;
  /** Sideways push on shots, in px/s² (positive: towards the castle). */
  wind: number;
  blocks: Block[];
  shot: Shot | null;
  outcome: 'fighting' | 'won' | 'lost';
  /** The castle stands on a hill. */
  hill: boolean;
  random: () => number;
  burnClock: number;
}

/** Castle strength for an attack that costs `cost` tokens. */
export function castleStrength(cost: number): number {
  return 40 + 20 * Math.max(0, cost - 2);
}

/** Shots for the siege: cost + 3 with enough tokens, fewer when short. */
export function shotsFor(cost: number, hand: number): number {
  return hand >= cost ? cost + 3 : hand + 1;
}

export function createBattle(opts: {
  cost: number;
  hand: number;
  seed: number;
  /** A castle on high ground (mountains) stands higher. */
  hill?: boolean;
}): Battle {
  const random = seededRandom(opts.seed);
  const health = castleStrength(opts.cost);
  const tower = 3 + Math.floor(Math.max(0, opts.cost - 2) / 2);
  const columns: { w: number; height: number; part: Block['part'] }[] = [
    { w: 46, height: tower, part: 'tower' },
    { w: 40, height: 2, part: 'wall' },
    { w: 60, height: tower + 1, part: 'keep' },
    { w: 40, height: 2, part: 'wall' },
    { w: 46, height: tower, part: 'tower' },
  ];
  const count = columns.reduce((s, c) => s + c.height, 0);
  // Blocks only show the damage (cracks, then crumbling); the castle's strength decides the siege.
  const blockHp = Math.max(20, Math.ceil((health * 1.5) / count));
  const base = groundAt(700, opts.hill);
  const blocks: Block[] = [];
  let x = 680;
  columns.forEach((c, column) => {
    for (let k = 0; k < c.height; k++) {
      const y = base - (k + 1) * BLOCK_H;
      blocks.push({
        x,
        y,
        rest: y,
        w: c.w,
        h: BLOCK_H,
        hp: blockHp,
        maxHp: blockHp,
        column,
        burning: 0,
        part: c.part,
      });
    }
    x += c.w;
  });
  return {
    health,
    maxHealth: health,
    dealt: 0,
    shots: shotsFor(opts.cost, opts.hand),
    fireballs: FIREBALLS,
    wind: Math.round((random() * 2 - 1) * 60),
    blocks,
    shot: null,
    outcome: 'fighting',
    hill: !!opts.hill,
    random,
    burnClock: 0,
  };
}

/** Height of the ground at x: a hill under the castle for mountain regions. */
export function groundAt(x: number, hill = false): number {
  if (!hill) return GROUND;
  const t = Math.max(0, Math.min(1, (x - 560) / 120));
  return GROUND - 50 * (t * t * (3 - 2 * t));
}

/** Launch velocity for an angle in degrees (10–80) and power 0..1. */
export function launchVelocity(angle: number, power: number): { vx: number; vy: number } {
  const a = (Math.max(10, Math.min(80, angle)) * Math.PI) / 180;
  const speed = MIN_SPEED + Math.max(0, Math.min(1, power)) * (MAX_SPEED - MIN_SPEED);
  return { vx: Math.cos(a) * speed, vy: -Math.sin(a) * speed };
}

/** Throws a shot, if one is left and none is in the air. */
export function fire(b: Battle, ammo: Ammo, angle: number, power: number): boolean {
  if (b.outcome !== 'fighting' || b.shot || b.shots < 1) return false;
  if (ammo === 'fireball' && b.fireballs < 1) return false;
  b.shots--;
  if (ammo === 'fireball') b.fireballs--;
  b.shot = { ammo, ...LAUNCH, ...launchVelocity(angle, power), r: ammo === 'fireball' ? 11 : 9 };
  return true;
}

/** The first part of a shot's flight, for aiming. */
export function preview(
  b: Battle,
  angle: number,
  power: number,
  seconds = 0.55,
): { x: number; y: number }[] {
  const v = launchVelocity(angle, power);
  const points: { x: number; y: number }[] = [];
  for (let t = 0.05; t <= seconds; t += 0.05) {
    points.push({
      x: LAUNCH.x + v.vx * t + 0.5 * b.wind * t * t,
      y: LAUNCH.y + v.vy * t + 0.5 * GRAVITY * t * t,
    });
  }
  return points;
}

const alive = (b: Battle) => b.blocks.filter((k) => k.hp > 0);

/** Damages the castle through a block; returns the damage dealt (never more than it has left). */
function damage(b: Battle, block: Block, amount: number, events: BattleEvent[]): number {
  const dealt = Math.min(amount, b.health);
  if (dealt <= 0) return 0;
  block.hp -= amount;
  b.health -= dealt;
  b.dealt += dealt;
  if (block.hp <= 0) {
    block.burning = 0;
    events.push({ type: 'crumble', block });
    // Blocks above drop into the gap.
    for (const above of b.blocks) {
      if (above.column === block.column && above.rest < block.rest && above.hp > 0) {
        above.rest += block.h;
      }
    }
  }
  if (b.health <= 0 && b.outcome === 'fighting') {
    b.outcome = 'won';
    b.shot = null;
    events.push({ type: 'won' });
  }
  return dealt;
}

function impact(b: Battle, shot: Shot, block: Block, events: BattleEvent[]): void {
  const speed = Math.hypot(shot.vx, shot.vy);
  const force = Math.max(0.7, Math.min(1.3, speed / 600));
  const base = shot.ammo === 'fireball' ? 26 : 18;
  const amount = Math.round(base * force + (b.random() * 6 - 3));
  const dealt = damage(b, block, amount, events);
  events.push({ type: 'hit', x: shot.x, y: shot.y, damage: dealt, ammo: shot.ammo });
  if (shot.ammo === 'fireball' && b.outcome === 'fighting') {
    // Fireballs splash the two nearest blocks and set the one they strike burning.
    const centre = (k: Block) => Math.hypot(k.x + k.w / 2 - shot.x, k.y + k.h / 2 - shot.y);
    const near = alive(b)
      .filter((k) => k !== block && centre(k) <= 75)
      .sort((p, q) => centre(p) - centre(q))
      .slice(0, 2);
    for (const other of near) {
      const splash = damage(b, other, Math.round(amount * 0.25), events);
      if (splash)
        events.push({ type: 'burn', x: other.x + other.w / 2, y: other.y, damage: splash });
    }
    if (block.hp > 0) block.burning = 1.5;
  }
}

/** Advances the siege by dt seconds; returns what happened. */
export function step(b: Battle, dt: number): BattleEvent[] {
  const events: BattleEvent[] = [];
  // Falling blocks.
  for (const k of b.blocks) if (k.y < k.rest) k.y = Math.min(k.rest, k.y + 420 * dt);

  // The shot in flight, in small steps so it can't pass through a block.
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps && b.shot; i++) {
    const s = b.shot;
    s.vx += b.wind * h;
    s.vy += GRAVITY * h;
    s.x += s.vx * h;
    s.y += s.vy * h;
    const hit = alive(b).find(
      (k) => s.x + s.r > k.x && s.x - s.r < k.x + k.w && s.y + s.r > k.y && s.y - s.r < k.y + k.h,
    );
    if (hit) {
      b.shot = null;
      impact(b, s, hit, events);
    } else if (s.y + s.r >= groundAt(s.x, b.hill) && s.vy > 0) {
      b.shot = null;
      events.push({ type: 'miss', x: s.x, y: s.y });
    } else if (s.x > WIDTH + 60 || s.x < -60) {
      b.shot = null;
      events.push({ type: 'miss', x: s.x, y: s.y });
    }
  }

  // Fires burn 3 damage every half second.
  const burning = alive(b).filter((k) => k.burning > 0);
  if (burning.length && b.outcome === 'fighting') {
    b.burnClock += dt;
    while (b.burnClock >= 0.5 && b.outcome === 'fighting') {
      b.burnClock -= 0.5;
      for (const k of burning) {
        if (k.hp <= 0) continue;
        const dealt = damage(b, k, 3, events);
        if (dealt) events.push({ type: 'burn', x: k.x + k.w / 2, y: k.y, damage: dealt });
      }
    }
    for (const k of burning) k.burning = Math.max(0, k.burning - dt);
  } else b.burnClock = 0;

  // Out of shots, with nothing in the air or burning: the attack is repelled.
  if (
    b.outcome === 'fighting' &&
    b.shots === 0 &&
    !b.shot &&
    !alive(b).some((k) => k.burning > 0)
  ) {
    b.outcome = 'lost';
    events.push({ type: 'lost' });
  }
  return events;
}
