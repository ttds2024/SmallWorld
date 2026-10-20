/**
 * The siege scene: your catapult on the left, the defenders' castle on the right. Drag back from
 * the catapult (or use the arrow keys) to aim, release (or Fire) to throw a stone or a fireball.
 */
import {
  createBattle,
  fire,
  GROUND,
  groundAt,
  HEIGHT,
  LAUNCH,
  preview,
  step,
  WIDTH,
  type Ammo,
  type Battle,
  type BattleEvent,
  type Block,
} from './battle';
import { seededRandom } from './geometry';
import type { Terrain } from './map';

export interface SiegeInfo {
  region: string;
  terrain: Terrain;
  /** Who holds the castle, e.g. "Rival Humans (3 tokens)". */
  defender: string;
  /** Colour of the defenders' banners and roofs. */
  colour: string;
  cost: number;
  hand: number;
  seed: number;
}

export type SiegeResult = 'won' | 'lost' | 'retreat';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  colour: string;
  gravity: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  colour: string;
  size: number;
  life: number;
}

const PIVOT = { x: 150, y: 422 };
const ARM = Math.hypot(LAUNCH.x - PIVOT.x, LAUNCH.y - PIVOT.y);
const ARM_RELEASE = Math.atan2(LAUNCH.y - PIVOT.y, LAUNCH.x - PIVOT.x);
const ARM_LOADED = Math.PI + 0.18;
const YOU = '#2563eb';

const SKIES: Record<Terrain, [string, string]> = {
  farmland: ['#7fb8e8', '#f6e3b4'],
  forest: ['#79aee0', '#d9ecd0'],
  hills: ['#80b9ea', '#e3f0d0'],
  swamp: ['#8c9fa8', '#cfd6c4'],
  mountain: ['#6d9fd6', '#e6eef6'],
  lake: ['#7fb8e8', '#e0eef8'],
};

const GRASS: Record<Terrain, string> = {
  farmland: '#a7b24f',
  forest: '#4f7d3a',
  hills: '#7aa04a',
  swamp: '#5f6f48',
  mountain: '#7d8a5a',
  lake: '#6f9a4a',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** Opens the siege over `host`; `done` gets the result once the player closes it. */
export function openSiege(host: HTMLElement, info: SiegeInfo, done: (r: SiegeResult) => void) {
  const battle = createBattle({
    cost: info.cost,
    hand: info.hand,
    seed: info.seed,
    hill: info.terrain === 'mountain',
  });
  new SiegeScene(host, info, battle, done);
}

class SiegeScene {
  private readonly overlay: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private ammo: Ammo = 'stone';
  private angle = 45;
  private power = 0.6;
  private aiming = false;
  private arm = ARM_LOADED;
  /** Seconds since the last throw, for the arm's swing and reload. */
  private sinceThrow = 99;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private shake = 0;
  private time = 0;
  private last = 0;
  private frame = 0;
  private fired = 0;
  private ended = 0;
  private lastPath: { x: number; y: number }[] = [];
  private readonly scenery: (() => void)[] = [];
  private readonly ui: Record<string, HTMLElement> = {};
  private readonly onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    host: HTMLElement,
    private readonly info: SiegeInfo,
    private readonly b: Battle,
    private readonly done: (r: SiegeResult) => void,
  ) {
    this.overlay = el('div', 'siege');
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', `Siege of ${info.region}`);
    const box = el('div', 'siege-box');
    const head = el('div', 'siege-head');
    const title = el('div', 'siege-title');
    title.append(
      el('b', '', `Siege of ${info.region}`),
      el('span', '', `held by ${info.defender}`),
    );
    this.ui.retreat = el('button', 'btn', 'Call off the attack');
    this.ui.retreat.addEventListener('click', () => this.retreat());
    head.append(title, this.ui.retreat);

    this.canvas = el('canvas', 'siege-canvas');
    this.canvas.setAttribute(
      'aria-label',
      'Your catapult on the left, the castle on the right. Drag back from the catapult to aim and release to fire.',
    );
    this.ctx = this.canvas.getContext('2d')!;
    const stage = el('div', 'siege-stage');
    this.ui.banner = el('div', 'siege-banner');
    this.ui.banner.hidden = true;
    stage.append(this.canvas, this.ui.banner);

    const hud = el('div', 'siege-hud');
    const health = el('div', 'siege-health');
    this.ui.healthText = el('span', 'siege-health-text');
    this.ui.healthBar = el('i');
    const bar = el('div', 'siege-bar');
    bar.append(this.ui.healthBar);
    health.append(el('span', 'siege-label', 'Castle'), bar, this.ui.healthText);
    this.ui.dealt = el('b', 'siege-dealt', '0');
    const dealt = el('div', 'siege-stat');
    dealt.append(el('span', 'siege-label', 'Damage dealt'), this.ui.dealt);
    this.ui.shots = el('b', '', '0');
    const shots = el('div', 'siege-stat');
    shots.append(el('span', 'siege-label', 'Shots left'), this.ui.shots);
    this.ui.wind = el('b', '', '');
    const wind = el('div', 'siege-stat');
    wind.append(el('span', 'siege-label', 'Wind'), this.ui.wind);
    hud.append(health, dealt, shots, wind);

    const controls = el('div', 'siege-controls');
    this.ui.stone = el('button', 'btn ammo', '🪨 Stone');
    this.ui.fireball = el('button', 'btn ammo', '🔥 Fireball');
    this.ui.stone.addEventListener('click', () => this.choose('stone'));
    this.ui.fireball.addEventListener('click', () => this.choose('fireball'));
    this.ui.aim = el('span', 'siege-aim');
    this.ui.fire = el('button', 'btn primary', 'Fire!');
    this.ui.fire.addEventListener('click', () => this.shoot());
    this.ui.next = el('button', 'btn primary big', '');
    this.ui.next.hidden = true;
    this.ui.next.addEventListener('click', () => this.close());
    controls.append(this.ui.stone, this.ui.fireball, this.ui.aim, this.ui.fire, this.ui.next);
    const tip = el(
      'p',
      'siege-tip',
      'Drag back from the catapult and let go to fire (or ←/→ power, ↑/↓ angle, Space to fire, 1/2 for ammo). Fireballs hit harder, splash and set the walls burning.',
    );

    box.append(head, stage, hud, controls, tip);
    this.overlay.append(box);
    host.append(this.overlay);

    this.canvas.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.canvas.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    this.canvas.addEventListener('pointerup', (e) => this.pointer(e, 'up'));
    this.canvas.addEventListener('pointercancel', () => (this.aiming = false));
    document.addEventListener('keydown', this.onKey);
    this.buildScenery();
    this.updateHud();
    this.ui.fire.focus();
    this.frame = requestAnimationFrame((t) => this.loop(t));
  }

  // ----- Input -----

  private toScene(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * WIDTH,
      y: ((e.clientY - r.top) / r.height) * HEIGHT,
    };
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move' | 'up'): void {
    if (this.b.outcome !== 'fighting') return;
    const p = this.toScene(e);
    if (kind === 'down') {
      if (this.b.shot || this.b.shots < 1) return;
      this.aiming = true;
      this.canvas.setPointerCapture(e.pointerId);
    }
    if (!this.aiming) return;
    // Pull back from the bucket: the shot flies the other way.
    const dx = LAUNCH.x - p.x;
    const dy = LAUNCH.y - p.y;
    if (Math.hypot(dx, dy) > 8) {
      this.angle = Math.round(Math.max(10, Math.min(80, (Math.atan2(-dy, dx) * 180) / Math.PI)));
      this.power = Math.max(0, Math.min(1, Math.hypot(dx, dy) / 170));
    }
    if (kind === 'up') {
      this.aiming = false;
      this.shoot();
    }
    this.updateHud();
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.b.outcome === 'fighting') this.retreat();
      else this.close();
      return;
    }
    if (this.b.outcome !== 'fighting') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.close();
      }
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowUp: () => (this.angle = Math.min(80, this.angle + 1)),
      ArrowDown: () => (this.angle = Math.max(10, this.angle - 1)),
      ArrowRight: () => (this.power = Math.min(1, this.power + 0.02)),
      ArrowLeft: () => (this.power = Math.max(0, this.power - 0.02)),
      ' ': () => this.shoot(),
      Enter: () => this.shoot(),
      '1': () => this.choose('stone'),
      '2': () => this.choose('fireball'),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
      this.updateHud();
    }
  }

  private choose(ammo: Ammo): void {
    if (ammo === 'fireball' && this.b.fireballs < 1) return;
    this.ammo = ammo;
    this.updateHud();
  }

  private shoot(): void {
    if (!fire(this.b, this.ammo, this.angle, this.power)) return;
    this.fired++;
    this.sinceThrow = 0;
    this.lastPath = [];
    if (this.ammo === 'fireball' && this.b.fireballs < 1) this.ammo = 'stone';
    this.updateHud();
  }

  private retreat(): void {
    this.finish(this.fired ? 'lost' : 'retreat');
  }

  private close(): void {
    this.finish(this.b.outcome === 'won' ? 'won' : 'lost');
  }

  private finish(result: SiegeResult): void {
    cancelAnimationFrame(this.frame);
    document.removeEventListener('keydown', this.onKey);
    this.overlay.remove();
    this.done(result);
  }

  // ----- HUD -----

  private updateHud(): void {
    const b = this.b;
    const share = b.health / b.maxHealth;
    this.ui.healthBar!.style.width = `${share * 100}%`;
    this.ui.healthBar!.classList.toggle('low', share < 0.35);
    this.ui.healthText!.textContent = `${b.health} / ${b.maxHealth}`;
    this.ui.dealt!.textContent = String(b.dealt);
    this.ui.shots!.textContent = String(b.shots);
    const arrow = b.wind === 0 ? '·' : b.wind > 0 ? '→' : '←';
    this.ui.wind!.textContent = `${arrow} ${Math.abs(b.wind)}`;
    this.ui.stone!.classList.toggle('chosen', this.ammo === 'stone');
    this.ui.fireball!.classList.toggle('chosen', this.ammo === 'fireball');
    this.ui.fireball!.textContent = `🔥 Fireball ×${b.fireballs}`;
    (this.ui.fireball as HTMLButtonElement).disabled = b.fireballs < 1 || b.outcome !== 'fighting';
    (this.ui.stone as HTMLButtonElement).disabled = b.outcome !== 'fighting';
    (this.ui.fire as HTMLButtonElement).disabled =
      !!b.shot || b.shots < 1 || b.outcome !== 'fighting';
    this.ui.aim!.textContent = `Angle ${this.angle}° · Power ${Math.round(this.power * 100)}%`;
    this.ui.retreat!.textContent = this.fired ? 'Retreat' : 'Call off the attack';
    this.ui.retreat!.title = this.fired
      ? 'Give up the siege: the attack fails and ends your conquests'
      : 'Go back to the map; nothing is lost';
    (this.ui.retreat as HTMLButtonElement).disabled = b.outcome !== 'fighting';
  }

  private showResult(): void {
    const won = this.b.outcome === 'won';
    const banner = this.ui.banner!;
    banner.hidden = false;
    banner.className = `siege-banner ${won ? 'won' : 'lost'}`;
    banner.replaceChildren(
      el('b', '', won ? 'The castle falls!' : 'Driven back!'),
      el(
        'span',
        '',
        won
          ? `${this.b.dealt} damage dealt — ${this.info.region} is yours.`
          : `${this.b.dealt} of ${this.b.maxHealth} damage dealt — the walls held.`,
      ),
    );
    this.ui.next!.hidden = false;
    this.ui.next!.textContent = won ? `Take ${this.info.region}` : 'Back to the map';
    for (const k of ['fire', 'stone', 'fireball', 'aim']) this.ui[k]!.hidden = true;
    this.ui.next!.focus();
  }

  // ----- Simulation -----

  private loop(t: number): void {
    const dt = Math.min(0.05, this.last ? (t - this.last) / 1000 : 0);
    this.last = t;
    this.time += dt;
    this.sinceThrow += dt;
    const before = this.b.outcome;
    for (const e of step(this.b, dt)) this.event(e);
    if (before === 'fighting' && this.b.outcome !== 'fighting') {
      this.ended = this.time;
      window.setTimeout(() => this.showResult(), this.b.outcome === 'won' ? 900 : 500);
    }
    this.updateParticles(dt);
    this.updateHud();
    this.draw();
    this.frame = requestAnimationFrame((n) => this.loop(n));
  }

  private event(e: BattleEvent): void {
    switch (e.type) {
      case 'hit': {
        const fireball = e.ammo === 'fireball';
        this.floaters.push({
          x: e.x,
          y: e.y - 10,
          text: e.damage ? `−${e.damage}` : '0',
          colour: fireball ? '#ffb347' : '#ffffff',
          size: fireball ? 30 : 26,
          life: 1.3,
        });
        this.burst(e.x, e.y, 14, ['#8d8273', '#b5ab9b', '#6d655a'], 260, 3, 5);
        if (fireball) this.burst(e.x, e.y, 26, ['#ffcf4a', '#ff8a1f', '#ff4d1a'], 320, 2, 4, 0);
        this.shake = fireball ? 9 : 6;
        break;
      }
      case 'burn':
        this.floaters.push({
          x: e.x + (Math.random() - 0.5) * 16,
          y: e.y,
          text: `−${e.damage}`,
          colour: '#ff9a3c',
          size: 18,
          life: 0.9,
        });
        break;
      case 'miss':
        this.burst(e.x, Math.min(e.y, GROUND), 12, ['#b9a37c', '#9c8763', '#d6c7a5'], 150, 3, 6);
        this.floaters.push({
          x: e.x,
          y: e.y - 20,
          text: 'Miss',
          colour: '#f3ead8',
          size: 18,
          life: 0.8,
        });
        break;
      case 'crumble':
        this.crumble(e.block);
        break;
      case 'won':
        // Everything left comes down.
        for (const k of this.b.blocks) if (k.hp > 0) this.crumble(k);
        this.shake = 14;
        break;
      case 'lost':
        break;
    }
  }

  private crumble(k: Block): void {
    this.burst(
      k.x + k.w / 2,
      k.y + k.h / 2,
      18,
      ['#8d8273', '#a59b8b', '#6d655a', '#c9bfae'],
      220,
      3,
      7,
    );
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: k.x + Math.random() * k.w,
        y: k.y + Math.random() * k.h,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 30,
        life: 1.6,
        max: 1.6,
        size: 12 + Math.random() * 14,
        colour: 'rgba(200,190,170,0.5)',
        gravity: -10,
      });
    }
  }

  private burst(
    x: number,
    y: number,
    n: number,
    colours: string[],
    speed: number,
    min: number,
    max: number,
    gravity = 700,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      const life = 0.5 + Math.random() * 0.6;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.4,
        life,
        max: life,
        size: min + Math.random() * (max - min),
        colour: colours[i % colours.length]!,
        gravity,
      });
    }
  }

  private updateParticles(dt: number): void {
    const shot = this.b.shot;
    if (shot?.ammo === 'fireball') {
      for (let i = 0; i < 3; i++) {
        this.particles.push({
          x: shot.x + (Math.random() - 0.5) * 8,
          y: shot.y + (Math.random() - 0.5) * 8,
          vx: -shot.vx * 0.1 + (Math.random() - 0.5) * 30,
          vy: -shot.vy * 0.1 - 20,
          life: 0.45,
          max: 0.45,
          size: 4 + Math.random() * 5,
          colour: ['#ffd25a', '#ff8a1f', '#ff5a1f'][i]!,
          gravity: -60,
        });
      }
    }
    for (const k of this.b.blocks) {
      if (k.burning > 0 && k.hp > 0 && Math.random() < 0.7) {
        this.particles.push({
          x: k.x + Math.random() * k.w,
          y: k.y + k.h * (0.2 + Math.random() * 0.6),
          vx: (Math.random() - 0.5) * 20,
          vy: -50 - Math.random() * 40,
          life: 0.6,
          max: 0.6,
          size: 4 + Math.random() * 6,
          colour: Math.random() < 0.5 ? '#ff9a2a' : '#ffd25a',
          gravity: -40,
        });
      }
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity > 0 && p.y > GROUND) {
        p.y = GROUND;
        p.vy *= -0.3;
        p.vx *= 0.6;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 40 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    this.shake = Math.max(0, this.shake - 30 * dt);
    // The arm swings up when throwing, then winds back to load.
    if (this.sinceThrow < 0.15)
      this.arm = ARM_LOADED + (ARM_RELEASE + 2 * Math.PI - ARM_LOADED) * (this.sinceThrow / 0.15);
    else if (this.sinceThrow < 0.7) this.arm = ARM_RELEASE;
    else {
      const t = Math.min(1, (this.sinceThrow - 0.7) / 0.4);
      this.arm = ARM_RELEASE + 2 * Math.PI + (ARM_LOADED - ARM_RELEASE - 2 * Math.PI) * t;
    }
  }

  // ----- Drawing -----

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round((w * HEIGHT) / WIDTH);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private draw(): void {
    this.resize();
    const c = this.ctx;
    const s = this.canvas.width / WIDTH;
    c.setTransform(s, 0, 0, s, 0, 0);
    const shake = this.shake;
    c.save();
    if (shake) c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    for (const paint of this.scenery) paint();
    this.drawCastle();
    this.drawCatapult();
    this.drawAim();
    this.drawShot();
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.colour;
      c.beginPath();
      c.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
    for (const f of this.floaters) {
      c.globalAlpha = Math.min(1, f.life * 2);
      c.font = `900 ${f.size}px Nunito, sans-serif`;
      c.textAlign = 'center';
      c.lineWidth = 5;
      c.strokeStyle = 'rgba(30,20,10,0.85)';
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.colour;
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;
    this.drawWind();
  }

  /** The backdrop: sky, sun, clouds, distant land and the terrain's details. */
  private buildScenery(): void {
    const c = this.ctx;
    const t = this.info.terrain;
    const hill = this.b.hill;
    const rnd = seededRandom(this.info.seed);
    const [top, bottom] = SKIES[t];
    this.scenery.push(() => {
      const sky = c.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, top);
      sky.addColorStop(1, bottom);
      c.fillStyle = sky;
      c.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);
      c.fillStyle = 'rgba(255, 244, 200, 0.9)';
      c.beginPath();
      c.arc(820, 90, 34, 0, Math.PI * 2);
      c.fill();
    });
    const clouds = Array.from({ length: 5 }, () => ({
      x: rnd() * WIDTH,
      y: 40 + rnd() * 120,
      s: 0.6 + rnd() * 0.8,
    }));
    this.scenery.push(() => {
      c.fillStyle = 'rgba(255,255,255,0.8)';
      for (const cl of clouds) {
        const x =
          ((((cl.x + this.time * this.b.wind * 0.3) % (WIDTH + 200)) + WIDTH + 200) %
            (WIDTH + 200)) -
          100;
        for (const [dx, dy, r] of [
          [0, 0, 22],
          [24, -8, 26],
          [50, 0, 20],
          [26, 6, 22],
        ] as const) {
          c.beginPath();
          c.arc(x + dx * cl.s, cl.y + dy * cl.s, r * cl.s, 0, Math.PI * 2);
          c.fill();
        }
      }
    });
    // Distant land.
    const far = Array.from({ length: 9 }, (_, i) => ({ x: i * 130 - 40, h: 40 + rnd() * 70 }));
    this.scenery.push(() => {
      if (t === 'mountain') {
        c.fillStyle = '#8f9aab';
        c.beginPath();
        c.moveTo(-20, GROUND - 60);
        far.forEach((m, i) => {
          c.lineTo(m.x + 65, GROUND - 120 - m.h * 1.6);
          c.lineTo(m.x + 130, GROUND - 60 - (i % 2) * 20);
        });
        c.lineTo(WIDTH + 20, GROUND);
        c.lineTo(-20, GROUND);
        c.fill();
        c.fillStyle = '#f4f7fb';
        far.forEach((m) => {
          const px = m.x + 65;
          const py = GROUND - 120 - m.h * 1.6;
          c.beginPath();
          c.moveTo(px, py);
          c.lineTo(px - 18, py + 26);
          c.lineTo(px + 18, py + 26);
          c.fill();
        });
      } else {
        c.fillStyle = t === 'swamp' ? '#7d8c78' : '#9fbf86';
        c.beginPath();
        c.moveTo(-20, GROUND);
        far.forEach((m) =>
          c.quadraticCurveTo(m.x + 65, GROUND - m.h * 1.5, m.x + 130, GROUND - 30),
        );
        c.lineTo(WIDTH + 20, GROUND);
        c.fill();
      }
    });
    // Terrain details behind the field.
    const details = Array.from({ length: 16 }, () => ({ x: rnd() * WIDTH, s: 0.7 + rnd() * 0.6 }));
    this.scenery.push(() => {
      for (const d of details) {
        if (d.x > 600 && d.x < 930) continue;
        const y = GROUND - 2;
        if (t === 'forest' || t === 'hills') {
          c.fillStyle = t === 'forest' ? '#2f5a2a' : '#4d7a35';
          c.beginPath();
          c.moveTo(d.x, y - 70 * d.s);
          c.lineTo(d.x - 20 * d.s, y);
          c.lineTo(d.x + 20 * d.s, y);
          c.fill();
          c.fillStyle = '#5a3d22';
          c.fillRect(d.x - 3, y - 6, 6, 6);
        } else if (t === 'farmland') {
          c.fillStyle = '#d9b44a';
          c.beginPath();
          c.ellipse(d.x, y - 10 * d.s, 16 * d.s, 12 * d.s, 0, Math.PI, 0);
          c.fill();
        } else if (t === 'swamp') {
          c.strokeStyle = '#3d4b2e';
          c.lineWidth = 2;
          for (let k = -1; k <= 1; k++) {
            c.beginPath();
            c.moveTo(d.x + k * 5, y);
            c.quadraticCurveTo(d.x + k * 9, y - 20 * d.s, d.x + k * 12, y - 34 * d.s);
            c.stroke();
          }
        } else if (t === 'mountain') {
          c.fillStyle = '#7b7266';
          c.beginPath();
          c.ellipse(d.x, y, 14 * d.s, 9 * d.s, 0, Math.PI, 0);
          c.fill();
        }
      }
    });
    // The field, with the castle's hill.
    this.scenery.push(() => {
      c.fillStyle = GRASS[t];
      c.beginPath();
      c.moveTo(-20, HEIGHT + 20);
      for (let x = -20; x <= WIDTH + 20; x += 10) c.lineTo(x, groundAt(x, hill));
      c.lineTo(WIDTH + 20, HEIGHT + 20);
      c.fill();
      c.fillStyle = t === 'swamp' ? '#4a5a3a' : '#6b5232';
      c.fillRect(-20, GROUND + 26, WIDTH + 40, HEIGHT);
      if (t === 'swamp') {
        c.fillStyle = 'rgba(80, 110, 100, 0.7)';
        for (const px of [260, 470, 580]) {
          c.beginPath();
          c.ellipse(px, GROUND + 12, 50, 7, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
      if (t === 'farmland') {
        c.strokeStyle = 'rgba(120, 95, 30, 0.35)';
        c.lineWidth = 3;
        for (let k = 0; k < 4; k++) {
          c.beginPath();
          c.moveTo(-20, GROUND + 6 + k * 6);
          c.lineTo(WIDTH + 20, GROUND + 6 + k * 6);
          c.stroke();
        }
      }
    });
  }

  private drawCatapult(): void {
    const c = this.ctx;
    const wood = '#7a4f2a';
    const dark = '#4f3218';
    // Wheels and base.
    c.fillStyle = dark;
    for (const x of [112, 196]) {
      c.beginPath();
      c.arc(x, GROUND - 12, 13, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#a77a46';
      c.beginPath();
      c.arc(x, GROUND - 12, 5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = dark;
    }
    c.fillStyle = wood;
    c.fillRect(96, GROUND - 34, 120, 14);
    // A-frame up to the pivot.
    c.strokeStyle = wood;
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(118, GROUND - 28);
    c.lineTo(PIVOT.x, PIVOT.y);
    c.lineTo(184, GROUND - 28);
    c.stroke();
    // Stop bar the arm hits.
    c.strokeStyle = dark;
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(PIVOT.x + 6, PIVOT.y - 6);
    c.lineTo(PIVOT.x + 26, PIVOT.y - 44);
    c.stroke();
    // Arm and bucket.
    const pull = this.aiming ? -0.25 * this.power : 0;
    const a = this.arm + pull;
    const bx = PIVOT.x + Math.cos(a) * ARM;
    const by = PIVOT.y + Math.sin(a) * ARM;
    c.strokeStyle = '#8d5c31';
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(PIVOT.x - Math.cos(a) * 16, PIVOT.y - Math.sin(a) * 16);
    c.lineTo(bx, by);
    c.stroke();
    c.fillStyle = dark;
    c.beginPath();
    c.arc(bx, by, 10, 0, Math.PI * 2);
    c.fill();
    // Loaded ammo sits in the bucket.
    if (this.sinceThrow > 1.1 && this.b.outcome === 'fighting' && this.b.shots > 0) {
      this.drawAmmo(this.ammo, bx, by - 4, this.ammo === 'fireball' ? 10 : 8);
    }
    c.fillStyle = '#c99a5b';
    c.beginPath();
    c.arc(PIVOT.x, PIVOT.y, 5, 0, Math.PI * 2);
    c.fill();
    // Your banner.
    c.strokeStyle = dark;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(210, GROUND - 34);
    c.lineTo(210, GROUND - 100);
    c.stroke();
    c.fillStyle = YOU;
    c.beginPath();
    c.moveTo(211, GROUND - 100);
    c.lineTo(242, GROUND - 92 + Math.sin(this.time * 4) * 3);
    c.lineTo(211, GROUND - 82);
    c.fill();
  }

  private drawAmmo(ammo: Ammo, x: number, y: number, r: number): void {
    const c = this.ctx;
    if (ammo === 'fireball') {
      const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r * 1.6);
      g.addColorStop(0, '#fff6b0');
      g.addColorStop(0.4, '#ffb030');
      g.addColorStop(1, 'rgba(255, 70, 20, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r * 1.6, 0, Math.PI * 2);
      c.fill();
    } else {
      const g = c.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r);
      g.addColorStop(0, '#c9c2b6');
      g.addColorStop(1, '#6e665b');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }

  private drawShot(): void {
    const s = this.b.shot;
    if (!s) return;
    this.lastPath.push({ x: s.x, y: s.y });
    this.drawAmmo(s.ammo, s.x, s.y, s.r);
  }

  private drawAim(): void {
    const c = this.ctx;
    // Faint dots where the last shot went.
    c.fillStyle = 'rgba(255,255,255,0.45)';
    this.lastPath.forEach((p, i) => {
      if (i % 3) return;
      c.beginPath();
      c.arc(p.x, p.y, 2, 0, Math.PI * 2);
      c.fill();
    });
    if (this.b.outcome !== 'fighting' || this.b.shot || this.b.shots < 1) return;
    // The first part of the next shot's flight.
    preview(this.b, this.angle, this.power).forEach((p, i) => {
      c.fillStyle = `rgba(255, 250, 220, ${0.9 - i * 0.07})`;
      c.beginPath();
      c.arc(p.x, p.y, 3.5 - i * 0.2, 0, Math.PI * 2);
      c.fill();
    });
  }

  private drawCastle(): void {
    const c = this.ctx;
    const b = this.b;
    const fallen = b.outcome === 'won' ? Math.min(1, (this.time - this.ended) / 0.9) : 0;
    const tops = new Map<number, Block>();
    for (const k of b.blocks) {
      if (k.hp <= 0) continue;
      const top = tops.get(k.column);
      if (!top || k.y < top.y) tops.set(k.column, k);
    }
    if (fallen < 1) {
      c.save();
      c.globalAlpha = 1 - fallen;
      c.translate(0, fallen * 60);
      for (const k of b.blocks) {
        if (k.hp <= 0) continue;
        this.drawBlock(k, tops.get(k.column) === k);
      }
      c.restore();
    }
    // Rubble where blocks fell.
    c.fillStyle = '#8a8070';
    for (const k of b.blocks) {
      if (k.hp > 0 && b.outcome !== 'won') continue;
      const x = k.x + ((k.column * 37 + k.rest) % 13);
      c.beginPath();
      c.ellipse(x + k.w / 2, groundAt(x, b.hill) - 2, k.w / 2.6, 7, 0, Math.PI, 0);
      c.fill();
    }
    if (b.outcome === 'won' && fallen >= 1) {
      // Your banner over the ruins.
      const x = 785;
      const y = groundAt(x, b.hill) - 14;
      c.strokeStyle = '#4f3218';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x, y - 70);
      c.stroke();
      c.fillStyle = YOU;
      c.beginPath();
      c.moveTo(x + 1, y - 70);
      c.lineTo(x + 36, y - 60 + Math.sin(this.time * 4) * 3);
      c.lineTo(x + 1, y - 50);
      c.fill();
    }
  }

  private drawBlock(k: Block, top: boolean): void {
    const c = this.ctx;
    const tone = 160 + ((k.column * 23 + Math.round(k.rest)) % 20);
    c.fillStyle = `rgb(${tone}, ${tone - 8}, ${tone - 22})`;
    c.fillRect(k.x, k.y, k.w, k.h);
    // Mortar lines.
    c.strokeStyle = 'rgba(70, 60, 45, 0.45)';
    c.lineWidth = 1.5;
    c.strokeRect(k.x + 0.75, k.y + 0.75, k.w - 1.5, k.h - 1.5);
    c.beginPath();
    c.moveTo(k.x, k.y + k.h / 2);
    c.lineTo(k.x + k.w, k.y + k.h / 2);
    const off = Math.round(k.rest / k.h) % 2 ? k.w / 3 : (2 * k.w) / 3;
    c.moveTo(k.x + off, k.y);
    c.lineTo(k.x + off, k.y + k.h / 2);
    c.moveTo(k.x + k.w - off, k.y + k.h / 2);
    c.lineTo(k.x + k.w - off, k.y + k.h);
    c.stroke();
    // Windows and the gate.
    c.fillStyle = '#3a2e22';
    if (k.part === 'keep' && k.y + k.h >= groundAt(k.x, this.b.hill) - 1) {
      c.beginPath();
      c.moveTo(k.x + k.w / 2 - 12, k.y + k.h);
      c.lineTo(k.x + k.w / 2 - 12, k.y + 14);
      c.arc(k.x + k.w / 2, k.y + 14, 12, Math.PI, 0);
      c.lineTo(k.x + k.w / 2 + 12, k.y + k.h);
      c.fill();
    } else if (k.part !== 'wall' && Math.round(k.rest / k.h) % 2) {
      c.fillRect(k.x + k.w / 2 - 3, k.y + 9, 6, 15);
    }
    // Cracks as it weakens.
    const wear = 1 - k.hp / k.maxHp;
    if (wear > 0.3) {
      c.strokeStyle = 'rgba(40, 30, 20, 0.7)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(k.x + k.w * 0.3, k.y + 2);
      c.lineTo(k.x + k.w * 0.45, k.y + k.h * 0.4);
      c.lineTo(k.x + k.w * 0.35, k.y + k.h * 0.7);
      if (wear > 0.6) {
        c.moveTo(k.x + k.w * 0.45, k.y + k.h * 0.4);
        c.lineTo(k.x + k.w * 0.75, k.y + k.h * 0.55);
        c.lineTo(k.x + k.w * 0.7, k.y + k.h - 2);
      }
      c.stroke();
    }
    if (k.burning > 0) {
      c.fillStyle = 'rgba(40, 20, 10, 0.25)';
      c.fillRect(k.x, k.y, k.w, k.h);
    }
    if (!top) return;
    if (k.part === 'tower') {
      // Pointed roof.
      c.fillStyle = this.info.colour;
      c.beginPath();
      c.moveTo(k.x - 5, k.y);
      c.lineTo(k.x + k.w / 2, k.y - 40);
      c.lineTo(k.x + k.w + 5, k.y);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.stroke();
    } else {
      // Battlements.
      c.fillStyle = `rgb(${tone}, ${tone - 8}, ${tone - 22})`;
      const n = Math.max(2, Math.round(k.w / 14));
      const w = k.w / (2 * n - 1);
      for (let i = 0; i < n; i++) c.fillRect(k.x + i * 2 * w, k.y - 10, w, 10);
      if (k.part === 'keep') {
        // The defenders' banner.
        const x = k.x + k.w / 2;
        c.strokeStyle = '#4f3218';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(x, k.y - 10);
        c.lineTo(x, k.y - 66);
        c.stroke();
        c.fillStyle = this.info.colour;
        c.beginPath();
        c.moveTo(x + 1, k.y - 66);
        c.lineTo(x + 32, k.y - 57 + Math.sin(this.time * 4 + 1) * 3);
        c.lineTo(x + 1, k.y - 46);
        c.fill();
      }
    }
  }

  private drawWind(): void {
    const c = this.ctx;
    const w = this.b.wind;
    if (!w) return;
    const x = WIDTH / 2;
    const y = 30;
    const len = 18 + (Math.abs(w) / 60) * 40;
    const dir = Math.sign(w);
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x - (dir * len) / 2, y);
    c.lineTo(x + (dir * len) / 2, y);
    c.stroke();
    c.beginPath();
    c.moveTo(x + (dir * len) / 2 + dir * 8, y);
    c.lineTo(x + (dir * len) / 2 - dir * 2, y - 6);
    c.lineTo(x + (dir * len) / 2 - dir * 2, y + 6);
    c.fill();
    c.font = '800 13px Nunito, sans-serif';
    c.textAlign = 'center';
    c.fillText('wind', x, y + 20);
  }
}
