import { AccountView } from './account-view';
import { nextMove } from './ai';
import { castleStrength, shotsFor } from './battle';
import { openSiege } from './battle-view';
import { lineOf, pathOf, type Point } from './geometry';
import { buildMap, randomSeed, type GameMap, type Terrain } from './map';
import type { Biome } from './mapgen';
import { Game, GAME_TURNS, type Action, type Outcome, type PlayerId } from './rules';

const SVG = 'http://www.w3.org/2000/svg';
const BEST_KEY = 'smallrealm.best';
const BATTLES_KEY = 'smallrealm.battles';
/** Pause between the rival's moves, so you can follow them. */
const AI_STEP_MS = 650;
const AI_PLACE_MS = 140;

const TERRAIN_NAMES: Record<Terrain, string> = {
  farmland: 'Farmland',
  forest: 'Forest',
  hills: 'Hills',
  swamp: 'Swamp',
  mountain: 'Mountain',
  lake: 'Lake',
};

/** Biome colours from mapgen2. */
const BIOME_COLOURS: Record<Biome, string> = {
  OCEAN: '#44447a',
  LAKE: '#336699',
  MARSH: '#2f6666',
  ICE: '#99ffff',
  BEACH: '#a09077',
  SNOW: '#ffffff',
  TUNDRA: '#bbbbaa',
  BARE: '#888888',
  SCORCHED: '#555555',
  TAIGA: '#99aa77',
  SHRUBLAND: '#889977',
  TEMPERATE_DESERT: '#c9d29b',
  TEMPERATE_RAIN_FOREST: '#448855',
  TEMPERATE_DECIDUOUS_FOREST: '#679459',
  GRASSLAND: '#88aa55',
  SUBTROPICAL_DESERT: '#d2b98b',
  TROPICAL_RAIN_FOREST: '#337755',
  TROPICAL_SEASONAL_FOREST: '#559944',
};
const SHALLOW_SEA = '#52548c';

/** A colour made lighter (shade > 1) or darker (< 1). */
function shaded(hex: string, shade: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v * shade)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(n >> 16)}${channel((n >> 8) & 255)}${channel(n & 255)}`;
}

/** A small drawing of the terrain on a light disc, centred on (x, y). */
function terrainIcon(terrain: Terrain, x: number, y: number): string {
  const at = `transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(0.7)"`;
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle class="icon-bg" r="14"/></g>${terrainGlyph(terrain, at)}`;
}

function terrainGlyph(terrain: Terrain, at: string): string {
  switch (terrain) {
    case 'farmland':
      return `<g ${at} class="icon wheat"><path d="M-10 10V-6M0 10V-10M10 10V-6"/><path d="M-10-6l-4-4M-10-6l4-4M0-10l-4-4M0-10l4-4M10-6l-4-4M10-6l4-4M-10 0l-4-4M-10 0l4-4M0-4l-4-4M0-4l4-4M10 0l-4-4M10 0l4-4"/></g>`;
    case 'forest':
      return `<g ${at} class="icon trees"><path d="M-12 8l7-18 7 18z"/><path d="M0 10l8-22 8 22z" transform="translate(-4 0)"/><path d="M6 8l6-15 6 15z"/></g>`;
    case 'hills':
      return `<g ${at} class="icon hills"><path d="M-18 8q9-16 18 0M-4 8q10-20 20 0"/></g>`;
    case 'swamp':
      return `<g ${at} class="icon reeds"><path d="M-8 9q-2-10 -6-16M0 9V-11M8 9q2-10 6-16"/><ellipse cx="0" cy="10" rx="16" ry="3"/></g>`;
    case 'mountain':
      return `<g ${at} class="icon peaks"><path d="M-20 10l12-20 8 11 6-9 14 18z"/><path class="snow" d="M-12-3l4-7 4 6zM5-3l1-5 4 5z"/></g>`;
    case 'lake':
      return `<g ${at} class="icon waves"><path d="M-16-2q4-4 8 0t8 0 8 0 8 0M-12 6q4-4 8 0t8 0 8 0"/></g>`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Whether your attacks are fought as sieges (on unless turned off). */
function readBattles(): boolean {
  try {
    return localStorage.getItem(BATTLES_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveBattles(on: boolean): void {
  try {
    localStorage.setItem(BATTLES_KEY, on ? 'on' : 'off');
  } catch {
    // Not kept in private windows; the toggle still works for this visit.
  }
}

function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // Private windows may refuse storage; the record just isn't kept.
  }
}

export class GameView {
  private map!: GameMap;
  private game!: Game;
  private selected: number | null = null;
  /** A target the player clicked without enough tokens: asks before rolling the die. */
  private pendingRoll: number | null = null;
  /** Your attacks are fought as sieges. */
  private battles = readBattles();
  private aiTimer = 0;
  private lastOwners: (PlayerId | null)[] = [];

  private readonly svg: SVGSVGElement;
  /** Owner tints, under the region borders. */
  private readonly tints: SVGGElement;
  /** Tokens and cost badges, on top. */
  private readonly dynamic: SVGGElement;
  private paths: SVGPathElement[] = [];

  private readonly $ = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;

  constructor(private readonly root: HTMLElement) {
    this.svg = this.$<HTMLElement>('#map') as unknown as SVGSVGElement;
    this.tints = document.createElementNS(SVG, 'g');
    this.dynamic = document.createElementNS(SVG, 'g');
    this.dynamic.setAttribute('class', 'dynamic');
    this.bindControls();
    this.newGame();
    this.openDialog('#start');
    // After the start dialog, so a sign-in error coming back from the server shows on top.
    new AccountView(this.root, {
      open: (sel) => this.openDialog(sel),
      close: () => this.closeDialogs(),
    });
  }

  // ----- Setup -----

  /** Draws the island: terrain, rivers and coast, then the regions' borders and labels. */
  private drawTerrain(): void {
    const { width, height, regions, art } = this.map;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // Polygons of the same (shaded) colour share one path.
    const byColour = new Map<string, string[]>();
    for (const cell of art.cells) {
      const base = cell.shallow ? SHALLOW_SEA : BIOME_COLOURS[cell.biome];
      const colour = shaded(base, Math.round(cell.shade * 20) / 20);
      const list = byColour.get(colour) ?? [];
      list.push(pathOf([cell.polygon]));
      byColour.set(colour, list);
    }
    const terrain = [...byColour]
      .map(([colour, d]) => `<path fill="${colour}" stroke="${colour}" d="${d.join('')}"/>`)
      .join('');
    const rivers = art.rivers
      .map(
        (r) => `<path class="river" stroke-width="${r.width.toFixed(1)}" d="${lineOf(r.path)}"/>`,
      )
      .join('');
    const coast = pathOf(art.coastline);
    const ground = document.createElementNS(SVG, 'g');
    ground.setAttribute('class', 'ground');
    ground.innerHTML =
      `<g class="terrain">${terrain}</g>` +
      `<path class="surf" d="${coast}"/><path class="shore" d="${coast}"/>${rivers}`;

    const borders = document.createElementNS(SVG, 'g');
    this.paths = regions.map((r) => {
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', pathOf(r.outline));
      path.setAttribute('class', `region${r.terrain === 'lake' ? ' lake' : ''}`);
      path.dataset.id = String(r.id);
      borders.append(path);
      return path;
    });

    const labels: string[] = [];
    for (const r of regions) {
      labels.push(terrainIcon(r.terrain, r.centre.x, r.centre.y - 30));
      labels.push(
        `<text class="name" x="${r.centre.x.toFixed(1)}" y="${(r.centre.y - 4).toFixed(1)}">${r.name}</text>`,
      );
    }
    const frame = `<rect class="frame" x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="6"/>`;
    const deco = document.createElementNS(SVG, 'g');
    deco.setAttribute('class', 'deco');
    deco.innerHTML = labels.join('') + frame;
    this.svg.replaceChildren(ground, this.tints, borders, deco, this.dynamic);
    this.$('#map-seed').textContent = `Island #${this.map.seed}`;
  }

  private bindControls(): void {
    this.svg.addEventListener('click', (e) => {
      const id = this.regionAt(e);
      if (id !== null) this.clickRegion(id);
    });
    this.svg.addEventListener('contextmenu', (e) => {
      const id = this.regionAt(e);
      if (id === null || !this.playerTurn() || this.game.phase !== 'redeploy') return;
      e.preventDefault();
      this.act({ type: 'take', region: id });
    });
    this.svg.addEventListener('pointerover', (e) => {
      const id = this.regionAt(e);
      if (id !== null && this.selected === null) this.renderCard(id);
    });
    this.svg.addEventListener('pointerleave', () => {
      if (this.selected === null) this.renderCard(null);
    });
    this.$('#decline').addEventListener('click', () => this.act({ type: 'decline' }));
    this.$('#finish').addEventListener('click', () => this.act({ type: 'finish' }));
    this.$('#end').addEventListener('click', () => this.act({ type: 'end' }));
    const battles = this.$<HTMLInputElement>('#battles');
    battles.checked = this.battles;
    battles.addEventListener('change', () => {
      this.battles = battles.checked;
      saveBattles(this.battles);
      this.render();
    });
    this.$('#rules-open').addEventListener('click', () => this.openDialog('#rules'));
    this.$('#new-game').addEventListener('click', () => {
      this.newGame();
      this.openDialog('#start');
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((b) =>
      b.addEventListener('click', () => {
        this.closeDialogs();
        this.toast('Turn 1 — land on any coastal region');
      }),
    );
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-close]')
      .forEach((b) => b.addEventListener('click', () => this.closeDialogs()));
    this.$('#reroll').addEventListener('click', () => this.newGame());
    this.$('#again').addEventListener('click', () => {
      this.newGame();
      this.closeDialogs();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.selected = null;
        this.pendingRoll = null;
        this.render();
      }
    });
  }

  private regionAt(e: Event): number | null {
    const target = (e.target as Element).closest('[data-id]') as SVGElement | null;
    return target ? Number(target.dataset.id) : null;
  }

  /** A new game on a freshly drawn island. */
  private newGame(): void {
    window.clearTimeout(this.aiTimer);
    this.map = buildMap(randomSeed());
    this.drawTerrain();
    this.game = new Game(this.map);
    this.selected = null;
    this.pendingRoll = null;
    this.lastOwners = this.game.regions.map((r) => r.owner);
    this.$('#log').replaceChildren();
    this.render();
  }

  // ----- Playing -----

  private playerTurn(): boolean {
    return this.game.phase !== 'over' && !this.game.player.ai;
  }

  private clickRegion(id: number): void {
    const g = this.game;
    this.pendingRoll = null;
    if (this.playerTurn()) {
      const r = g.regions[id]!;
      if (g.phase === 'conquer' && g.canAttack(id)) {
        if (g.player.hand >= g.cost(id)) {
          this.selected = null;
          this.attack(id);
          return;
        }
        if (g.player.hand >= 1) this.pendingRoll = id;
      } else if (g.phase === 'redeploy' && r.owner === g.current && !r.declined) {
        this.selected = id;
        this.act({ type: 'place', region: id });
        return;
      }
    }
    this.selected = this.selected === id && this.pendingRoll === null ? null : id;
    this.render();
  }

  /** Attacks a region: as a siege when battles are on, else by the plain rules. */
  private attack(id: number): void {
    const g = this.game;
    if (!this.battles) {
      this.act({ type: 'conquer', region: id });
      return;
    }
    const r = g.regions[id]!;
    const info = this.map.regions[id]!;
    const tokens = `${r.tokens} token${r.tokens === 1 ? '' : 's'}`;
    const defender = r.lostTribe
      ? 'a Lost Tribe'
      : r.owner === null
        ? 'no one: an empty keep'
        : r.declined
          ? `${g.players[r.owner].name} in decline`
          : `${g.players[r.owner].name} (${tokens})`;
    const colour = r.lostTribe
      ? '#6d5a43'
      : r.owner === null
        ? '#8a8378'
        : r.declined
          ? '#8d8578'
          : r.owner === 0
            ? '#2563eb'
            : '#c2412d';
    this.pendingRoll = null;
    this.selected = null;
    this.render();
    openSiege(
      this.root,
      {
        region: info.name,
        terrain: info.terrain,
        defender,
        colour,
        cost: g.cost(id),
        hand: g.player.hand,
        seed: Math.floor(Math.random() * 1e9),
      },
      (result) => {
        if (result === 'retreat') return;
        const out = this.game.apply({ type: 'conquer', region: id, battle: result });
        if (out.ok) this.toast(out.message, result === 'lost' ? 'warn' : '');
        else this.report(out);
        this.afterMove();
      },
    );
  }

  private act(action: Action): void {
    if (!this.playerTurn()) return;
    const out = this.game.apply(action);
    this.report(out);
    if (action.type === 'conquer' || action.type === 'abandon') this.selected = null;
    if (action.type === 'end' || action.type === 'decline') this.selected = null;
    this.pendingRoll = null;
    this.afterMove();
  }

  /** Shows what a move did: the die, the coins, failures. */
  private report(out: Outcome): void {
    if (!out.ok) {
      this.toast(out.message, 'warn');
      return;
    }
    if (out.roll !== undefined) this.showDie(out.roll, out.message);
    else if (out.scored !== undefined) this.toast(out.message, 'coin');
  }

  private afterMove(): void {
    this.render();
    if (this.game.phase === 'over') {
      window.setTimeout(() => this.gameOver(), 500);
    } else if (this.game.player.ai) {
      this.aiTimer = window.setTimeout(() => this.aiStep(), AI_STEP_MS);
    }
  }

  private aiStep(): void {
    const move = nextMove(this.game);
    const wasAI = this.game.current;
    const out = this.game.apply(move);
    this.report(out);
    this.render();
    if (this.game.phase === 'over') {
      window.setTimeout(() => this.gameOver(), 500);
      return;
    }
    if (this.game.current === wasAI) {
      const delay = move.type === 'place' ? AI_PLACE_MS : AI_STEP_MS;
      this.aiTimer = window.setTimeout(() => this.aiStep(), delay);
    } else {
      this.toast(`Turn ${this.game.turn} of ${GAME_TURNS} — your move`);
    }
  }

  private gameOver(): void {
    const [you, rival] = this.game.players;
    const winner = this.game.winner();
    const best = readBest();
    if (you.coins > best) saveBest(you.coins);
    this.$('#over-title').textContent =
      winner === 0 ? 'Victory!' : winner === 1 ? 'The Rival wins' : 'A tie!';
    this.$('#over-score').textContent = `You ${you.coins} coins — Rival ${rival.coins} coins`;
    this.$('#over-best').textContent =
      you.coins > best ? 'A new best score!' : `Your best: ${best} coins`;
    this.openDialog('#over');
  }

  // ----- Rendering -----

  private render(): void {
    this.renderMap();
    this.renderBar();
    this.renderPanel();
    this.renderCard(this.pendingRoll ?? this.selected);
    this.renderLog();
  }

  private renderMap(): void {
    const g = this.game;
    const mine = this.playerTurn();
    const targets = new Set(mine && g.phase === 'conquer' ? g.targets() : []);
    const parts: string[] = [];
    const tints: string[] = [];
    this.paths.forEach((path, id) => {
      const r = g.regions[id]!;
      const own = r.owner !== null && !r.declined && r.owner === g.current;
      path.classList.toggle('target', targets.has(id));
      path.classList.toggle('selected', this.selected === id || this.pendingRoll === id);
      path.classList.toggle('deployable', mine && g.phase === 'redeploy' && own);
      const info = this.map.regions[id]!;
      if (r.owner !== null) {
        tints.push(
          `<path class="tint p${r.owner}${r.declined ? ' declined' : ''}" d="${path.getAttribute('d')}"/>`,
        );
      }
      if (targets.has(id)) {
        const affordable = g.player.hand >= g.cost(id);
        parts.push(this.costBadge(info.centre, g.cost(id), affordable, r.tokens > 0));
      }
    });
    g.regions.forEach((r, id) => {
      if (r.tokens === 0) return;
      const fresh = r.owner !== this.lastOwners[id];
      parts.push(this.token(this.map.regions[id]!.centre, r, fresh, id));
    });
    this.lastOwners = g.regions.map((r) => r.owner);
    this.tints.innerHTML = tints.join('');
    this.dynamic.innerHTML = parts.join('');
  }

  private token(centre: Point, r: Game['regions'][number], fresh: boolean, id: number): string {
    const x = centre.x.toFixed(1);
    const y = (centre.y + 24).toFixed(1);
    const kind = r.lostTribe ? 'tribe' : `p${r.owner}${r.declined ? ' declined' : ''}`;
    const stack = r.tokens > 1 ? `<circle class="disc under" cx="3" cy="4" r="17"/>` : '';
    const label = r.lostTribe ? 'Lost Tribe' : r.declined ? 'In decline' : '';
    const person = `<path class="person" d="M0-10a4 4 0 1 1 0 .1zM-7 6q0-9 7-9t7 9z"/>`;
    return `<g class="token ${kind}${fresh ? ' pop' : ''}" data-id="${id}" transform="translate(${x} ${y})">
      <title>${label || `${r.tokens} token${r.tokens === 1 ? '' : 's'}`}</title>
      <g class="token-body">${stack}<circle class="disc" r="17"/>${person}
      <circle class="count-bg" cx="15" cy="-13" r="9"/><text class="count" x="15" y="-9">${r.tokens}</text></g></g>`;
  }

  private costBadge(centre: Point, cost: number, affordable: boolean, occupied: boolean): string {
    const x = centre.x.toFixed(1);
    const y = (centre.y + 24).toFixed(1);
    // Beside the defenders' token when there is one; the offset lives in CSS so phones can scale it.
    const kind = `cost${affordable ? '' : ' short'}${occupied ? ' beside' : ''}`;
    return `<g class="${kind}" transform="translate(${x} ${y})"><g class="cost-body">
      <rect x="-17" y="-12" width="34" height="24" rx="12"/>
      <path class="sword" d="M-10 6l9-9M-9 1l4 4M-3-5l3-3 2 0 0 2-3 3"/>
      <text x="7" y="5">${cost}</text></g></g>`;
  }

  private renderBar(): void {
    const g = this.game;
    const pips = this.$('#turns');
    pips.replaceChildren();
    for (let t = 1; t <= GAME_TURNS; t++) {
      const pip = el('span', t < g.turn ? 'pip done' : t === g.turn ? 'pip now' : 'pip', String(t));
      pips.append(pip);
    }
    g.players.forEach((p, i) => {
      const card = this.$(`#player-${i}`);
      card.classList.toggle('active', g.current === i && g.phase !== 'over');
      card.querySelector('.coins')!.textContent = String(p.coins);
      const held = g.activeRegions(i as PlayerId).length;
      const declined = g.declinedRegions(i as PlayerId).length;
      card.querySelector('.meta')!.textContent =
        (declined
          ? `${held} active · ${declined} in decline`
          : `${held} region${held === 1 ? '' : 's'}`) + ` · +${g.income(i as PlayerId)}/turn`;
    });
  }

  private renderPanel(): void {
    const g = this.game;
    const mine = this.playerTurn();
    const status = this.$('#status');
    const hint = this.$('#hint');
    const hand = this.$('#hand');
    const decline = this.$<HTMLButtonElement>('#decline');
    const finish = this.$<HTMLButtonElement>('#finish');
    const end = this.$<HTMLButtonElement>('#end');
    this.root.dataset.phase = mine ? g.phase : 'waiting';

    if (g.phase === 'over') {
      status.textContent = 'Game over';
      hint.textContent = 'Start a new game to play again.';
    } else if (!mine) {
      status.textContent = `Rival's turn`;
      hint.textContent = 'The rival Humans are on the march…';
    } else if (g.phase === 'conquer') {
      status.textContent = `Turn ${g.turn}: conquer`;
      hint.textContent =
        g.activeRegions().length === 0
          ? 'Land on the island: click a glowing coastal region. The badge shows the tokens it costs.'
          : 'Click a glowing region next to yours to conquer it. Short of tokens? Your last attack can roll the reinforcement die.';
    } else {
      status.textContent = `Turn ${g.turn}: redeploy`;
      hint.textContent =
        g.activeRegions().length === 0
          ? 'You hold no regions; your tokens wait in hand for next turn.'
          : 'Click your regions to add a token from your hand; right-click (or −) to take one back. Leftover tokens are spread out when you end the turn.';
    }

    hand.replaceChildren();
    const count = mine ? g.player.hand : 0;
    this.$('#hand-count').textContent = mine ? String(count) : '–';
    for (let i = 0; i < Math.min(count, 16); i++) hand.append(el('span', 'chip'));

    decline.hidden = !(mine && g.phase === 'conquer');
    decline.disabled = g.conquered > 0 || g.activeRegions().length === 0;
    finish.hidden = !(mine && g.phase === 'conquer');
    end.hidden = !(mine && g.phase === 'redeploy');
  }

  private renderCard(id: number | null): void {
    const card = this.$('#card');
    card.replaceChildren();
    if (id === null) {
      card.append(el('p', 'muted', 'Hover or tap a region to see it.'));
      return;
    }
    const g = this.game;
    const info = this.map.regions[id]!;
    const r = g.regions[id]!;
    const head = el('div', 'card-head');
    head.append(
      el('b', '', info.name),
      el('span', `tag t-${info.terrain}`, TERRAIN_NAMES[info.terrain]),
    );
    card.append(head);

    const lines: string[] = [];
    if (info.terrain === 'lake') lines.push('Water: no one can conquer it.');
    else if (r.lostTribe) lines.push('Held by a Lost Tribe (1 token).');
    else if (r.owner === null) lines.push('Empty.');
    else {
      const who = r.owner === 0 ? 'Your' : 'Rival';
      lines.push(
        `${who} Humans${r.declined ? ' in decline' : ''}: ${r.tokens} token${r.tokens === 1 ? '' : 's'}.`,
      );
    }
    if (info.terrain === 'mountain') lines.push('Mountain: +1 to conquer.');
    if (info.terrain === 'farmland') lines.push('Farmland: Humans earn +1 coin here.');
    if (info.coast) lines.push('On the coast: a new band can land here.');
    for (const line of lines) card.append(el('p', '', line));

    if (!this.playerTurn()) return;
    const actions = el('div', 'card-actions');
    if (g.phase === 'conquer' && g.canAttack(id)) {
      const cost = g.cost(id);
      if (g.player.hand >= cost) {
        const b = el(
          'button',
          'btn primary',
          this.battles ? `Lay siege (${cost} tokens)` : `Conquer (${cost} tokens)`,
        );
        b.addEventListener('click', () => this.attack(id));
        actions.append(b);
        if (this.battles) {
          card.append(
            el(
              'p',
              'muted',
              `Castle strength ${castleStrength(cost)}, ${shotsFor(cost, g.player.hand)} shots.`,
            ),
          );
        }
      } else if (g.player.hand >= 1 && this.battles) {
        card.append(
          el(
            'p',
            'warn',
            `Costs ${cost}, you have ${g.player.hand}: storm the castle (strength ${castleStrength(cost)}) with only ${shotsFor(cost, g.player.hand)} shots. Win or lose, this ends your conquests.`,
          ),
        );
        const b = el('button', 'btn primary', '🔥 Storm the castle');
        b.addEventListener('click', () => this.attack(id));
        actions.append(b);
      } else if (g.player.hand >= 1) {
        const need = cost - g.player.hand;
        card.append(
          el(
            'p',
            'warn',
            `Costs ${cost}, you have ${g.player.hand}. Roll the die (0,0,0,1,2,3) and you need ${need} or more. Either way, this ends your conquests.`,
          ),
        );
        const b = el('button', 'btn primary', '🎲 Roll and attack');
        b.addEventListener('click', () => this.act({ type: 'conquer', region: id }));
        actions.append(b);
      }
    }
    if (r.owner === g.current && !r.declined) {
      if (g.phase === 'conquer' && g.conquered === 0) {
        const b = el('button', 'btn', 'Abandon region');
        b.title = 'Take all its tokens back into your hand';
        b.addEventListener('click', () => this.act({ type: 'abandon', region: id }));
        actions.append(b);
      }
      if (g.phase === 'redeploy') {
        const minus = el('button', 'btn', '− token');
        minus.disabled = r.tokens < 2;
        minus.addEventListener('click', () => this.act({ type: 'take', region: id }));
        const plus = el('button', 'btn', '+ token');
        plus.disabled = g.player.hand < 1;
        plus.addEventListener('click', () => this.act({ type: 'place', region: id }));
        actions.append(minus, plus);
      }
    }
    if (actions.childElementCount) card.append(actions);
  }

  private renderLog(): void {
    const log = this.$('#log');
    const lines = this.game.log;
    while (log.childElementCount < lines.length) {
      const line = lines[log.childElementCount]!;
      const item = el('li', '', line);
      if (line.startsWith(this.game.players[1].name)) item.className = 'rival';
      else if (line.startsWith(this.game.players[0].name)) item.className = 'you';
      log.prepend(item);
    }
  }

  // ----- Feedback -----

  private toast(text: string, kind = ''): void {
    const box = this.$('#toasts');
    const t = el('div', `toast ${kind}`, text);
    box.append(t);
    window.setTimeout(() => t.remove(), 2600);
    while (box.childElementCount > 3) box.firstElementChild!.remove();
  }

  private showDie(roll: number, message: string): void {
    const die = this.$('#die');
    die.querySelector('.face')!.textContent = String(roll);
    die.querySelector('.text')!.textContent = message;
    die.classList.remove('show');
    void die.offsetWidth; // restarts the animation
    die.classList.add('show');
  }

  private openDialog(sel: string): void {
    this.closeDialogs();
    this.$(sel).hidden = false;
    this.$('#overlay').hidden = false;
  }

  private closeDialogs(): void {
    this.$('#overlay').hidden = true;
    this.root.querySelectorAll<HTMLElement>('.dialog').forEach((d) => (d.hidden = true));
  }
}
