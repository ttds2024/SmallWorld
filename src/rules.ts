import type { GameMap, Region } from './map';

/** Turns in a game, as in the two-player game. */
export const GAME_TURNS = 10;
/** Tokens in a fresh band of Humans (5 for the race plus 5 for its badge). */
export const HUMAN_TOKENS = 10;
/** Coins each player starts with. */
export const START_COINS = 5;
/** Faces of the reinforcement die. */
export const DIE_FACES = [0, 0, 0, 1, 2, 3] as const;

export type PlayerId = 0 | 1;

export interface Player {
  name: string;
  ai: boolean;
  coins: number;
  /** Active Humans tokens in hand, not on the map. */
  hand: number;
  /** Has an active band of Humans (false before the first turn and after going into decline). */
  active: boolean;
  /** Survivors of a lost region, waiting to be put back at the end of the attacker's turn. */
  returning: number;
}

export interface RegionState {
  owner: PlayerId | null;
  tokens: number;
  /** The owner's tokens here are Humans in decline. */
  declined: boolean;
  /** A Lost Tribe still holds the region. */
  lostTribe: boolean;
}

export type Phase = 'conquer' | 'redeploy' | 'over';

export type Action =
  | { type: 'conquer'; region: number }
  | { type: 'abandon'; region: number }
  | { type: 'decline' }
  | { type: 'finish' }
  | { type: 'place'; region: number }
  | { type: 'take'; region: number }
  | { type: 'end' };

/** What happened, for the log and the view. */
export interface Outcome {
  ok: boolean;
  message: string;
  /** The reinforcement die, when it was rolled. */
  roll?: number;
  /** Coins scored, when a turn ended. */
  scored?: number;
}

export class Game {
  readonly regions: RegionState[];
  readonly players: [Player, Player];
  turn = 1;
  current: PlayerId = 0;
  phase: Phase = 'conquer';
  /** Regions conquered so far this turn. */
  conquered = 0;
  readonly log: string[] = [];

  constructor(
    readonly map: GameMap,
    names: [string, string] = ['Your Humans', 'Rival Humans'],
    ai: [boolean, boolean] = [false, true],
    private readonly random: () => number = Math.random,
  ) {
    this.regions = map.regions.map((r) => ({
      owner: null,
      tokens: r.lostTribe ? 1 : 0,
      declined: false,
      lostTribe: r.lostTribe,
    }));
    const player = (i: 0 | 1): Player => ({
      name: names[i],
      ai: ai[i],
      coins: START_COINS,
      hand: 0,
      active: false,
      returning: 0,
    });
    this.players = [player(0), player(1)];
    this.beginTurn();
  }

  get player(): Player {
    return this.players[this.current];
  }

  /** Regions held by a player's active Humans. */
  activeRegions(id: PlayerId = this.current): number[] {
    return this.regions.flatMap((r, i) => (r.owner === id && !r.declined ? [i] : []));
  }

  /** Regions held by a player's Humans in decline. */
  declinedRegions(id: PlayerId): number[] {
    return this.regions.flatMap((r, i) => (r.owner === id && r.declined ? [i] : []));
  }

  /** Tokens needed to conquer a region: 2, +1 per token on it, +1 for a mountain. */
  cost(region: number): number {
    const r = this.regions[region]!;
    const mountain = this.map.regions[region]!.terrain === 'mountain' ? 1 : 0;
    return 2 + r.tokens + mountain;
  }

  /**
   * Whether the current player may attack the region: not a lake, not their own, and next to their
   * active Humans, or on the coast while they hold nothing with them (a new band lands from the sea).
   */
  canAttack(region: number): boolean {
    if (this.phase !== 'conquer' || !this.player.active) return false;
    const info: Region = this.map.regions[region]!;
    const state = this.regions[region]!;
    if (info.terrain === 'lake' || state.owner === this.current) return false;
    const held = this.activeRegions();
    if (held.length === 0) return info.coast;
    return info.neighbours.some((n) => held.includes(n));
  }

  /** Regions the current player may attack now. */
  targets(): number[] {
    return this.regions.flatMap((_, i) => (this.canAttack(i) ? [i] : []));
  }

  /** Coins a player would score now: 1 per region, +1 per farmland held by active Humans. */
  income(id: PlayerId): number {
    const farms = this.activeRegions(id).filter(
      (i) => this.map.regions[i]!.terrain === 'farmland',
    ).length;
    return this.activeRegions(id).length + this.declinedRegions(id).length + farms;
  }

  apply(action: Action): Outcome {
    if (this.phase === 'over') return fail('The game is over.');
    switch (action.type) {
      case 'conquer':
        return this.conquer(action.region);
      case 'abandon':
        return this.abandon(action.region);
      case 'decline':
        return this.decline();
      case 'finish':
        if (this.phase !== 'conquer') return fail('Not conquering now.');
        this.phase = 'redeploy';
        return { ok: true, message: `${this.player.name} stop conquering.` };
      case 'place':
        return this.place(action.region);
      case 'take':
        return this.take(action.region);
      case 'end':
        return this.endTurn();
    }
  }

  private beginTurn(): void {
    const p = this.player;
    this.phase = 'conquer';
    this.conquered = 0;
    if (!p.active) {
      p.active = true;
      p.hand += HUMAN_TOKENS;
      this.note(`${p.name} gather a fresh band of ${HUMAN_TOKENS} tokens.`);
    } else {
      // Ready the troops: every region keeps one token, the rest go to hand.
      for (const i of this.activeRegions()) {
        const r = this.regions[i]!;
        p.hand += r.tokens - 1;
        r.tokens = 1;
      }
    }
  }

  private conquer(region: number): Outcome {
    if (!this.canAttack(region)) return fail('You cannot attack that region.');
    const p = this.player;
    if (p.hand < 1) return fail('No tokens left in hand.');
    const name = this.map.regions[region]!.name;
    const cost = this.cost(region);
    let roll: number | undefined;
    if (p.hand < cost) {
      // Final conquest: the reinforcement die makes up the difference, or it fails.
      roll = DIE_FACES[Math.floor(this.random() * DIE_FACES.length)]!;
      this.phase = 'redeploy';
      if (p.hand + roll < cost) {
        const message = `${p.name} roll ${roll} and fail to take ${name}.`;
        this.note(message);
        return { ok: true, message, roll };
      }
    }
    const used = Math.min(cost, p.hand);
    const defender = this.defeat(region);
    p.hand -= used;
    Object.assign(this.regions[region]!, {
      owner: this.current,
      tokens: used,
      declined: false,
      lostTribe: false,
    });
    this.conquered++;
    const rolled = roll === undefined ? '' : ` with a roll of ${roll}`;
    const message = `${p.name} take ${name}${defender}${rolled}.`;
    this.note(message);
    return { ok: true, message, roll };
  }

  /** Clears a conquered region's defenders; returns " from …" for the log. */
  private defeat(region: number): string {
    const r = this.regions[region]!;
    if (r.lostTribe) return ' from a Lost Tribe';
    if (r.owner === null) return '';
    const owner = this.players[r.owner];
    if (r.declined) return ` from ${owner.name} in decline`;
    // One token is lost; the others go back to the owner.
    owner.returning += r.tokens - 1;
    return ` from ${owner.name}`;
  }

  private abandon(region: number): Outcome {
    const r = this.regions[region]!;
    if (this.phase !== 'conquer' || this.conquered > 0) {
      return fail('Regions can only be abandoned before the first conquest.');
    }
    if (r.owner !== this.current || r.declined) return fail('Not your active region.');
    this.player.hand += r.tokens;
    Object.assign(r, { owner: null, tokens: 0, declined: false });
    const message = `${this.player.name} abandon ${this.map.regions[region]!.name}.`;
    this.note(message);
    return { ok: true, message };
  }

  private decline(): Outcome {
    if (this.phase !== 'conquer' || this.conquered > 0) {
      return fail('You can only go into decline instead of conquering.');
    }
    const held = this.activeRegions();
    if (held.length === 0) return fail('You hold no regions to go into decline with.');
    // Only one race can be in decline: the old one leaves the map.
    for (const i of this.declinedRegions(this.current)) {
      Object.assign(this.regions[i]!, { owner: null, tokens: 0, declined: false });
    }
    for (const i of held) Object.assign(this.regions[i]!, { tokens: 1, declined: true });
    this.player.hand = 0;
    this.player.active = false;
    this.note(`${this.player.name} go into decline.`);
    return this.endTurn();
  }

  private place(region: number): Outcome {
    const r = this.regions[region]!;
    if (this.phase !== 'redeploy') return fail('Finish conquering first.');
    if (r.owner !== this.current || r.declined) return fail('Not your active region.');
    if (this.player.hand < 1) return fail('No tokens left in hand.');
    this.player.hand--;
    r.tokens++;
    return { ok: true, message: '' };
  }

  private take(region: number): Outcome {
    const r = this.regions[region]!;
    if (this.phase !== 'redeploy') return fail('Finish conquering first.');
    if (r.owner !== this.current || r.declined) return fail('Not your active region.');
    if (r.tokens < 2) return fail('Each region keeps at least one token.');
    r.tokens--;
    this.player.hand++;
    return { ok: true, message: '' };
  }

  /** Puts tokens on the regions with the fewest tokens, one at a time. */
  private spread(id: PlayerId, count: number): number {
    const held = this.activeRegions(id);
    if (held.length === 0) return count;
    for (let k = 0; k < count; k++) {
      const weakest = held.reduce((a, b) =>
        this.regions[b]!.tokens < this.regions[a]!.tokens ? b : a,
      );
      this.regions[weakest]!.tokens++;
    }
    return 0;
  }

  private endTurn(): Outcome {
    const p = this.player;
    // Tokens still in hand are spread over the player's regions.
    p.hand = this.spread(this.current, p.hand);
    const scored = this.income(this.current);
    p.coins += scored;
    const message = `${p.name} score ${scored} coin${scored === 1 ? '' : 's'}.`;
    this.note(message);
    // The other player puts back the survivors of the regions they lost.
    const other = this.players[(1 - this.current) as PlayerId];
    if (other.returning > 0) {
      other.hand += this.spread((1 - this.current) as PlayerId, other.returning);
      other.returning = 0;
    }
    if (this.current === 1) this.turn++;
    if (this.turn > GAME_TURNS) {
      this.turn = GAME_TURNS;
      this.phase = 'over';
      this.note('The game is over.');
    } else {
      this.current = (1 - this.current) as PlayerId;
      this.beginTurn();
    }
    return { ok: true, message, scored };
  }

  /** The winner, or null for a tie. Only meaningful once the game is over. */
  winner(): PlayerId | null {
    const [a, b] = this.players;
    return a.coins === b.coins ? null : a.coins > b.coins ? 0 : 1;
  }

  private note(line: string): void {
    this.log.push(line);
  }
}

function fail(message: string): Outcome {
  return { ok: false, message };
}
