import { seededRandom, type Point } from './geometry';
import { generateTerrain, type Biome, type Terrain as Mesh } from './mapgen';

export type Terrain = 'farmland' | 'forest' | 'hills' | 'swamp' | 'mountain' | 'lake';

export interface Region {
  id: number;
  name: string;
  terrain: Terrain;
  /** Starts with a Lost Tribe token on it. */
  lostTribe: boolean;
  /** Touches the sea: a band can land here. */
  coast: boolean;
  neighbours: number[];
  /** Closed loops around the region (more than one when it has holes). */
  outline: Point[][];
  /** Where its tokens and name go: the point deepest inside the region. */
  centre: Point;
}

/** How the map is drawn: the terrain polygons, rivers and coastline. */
export interface MapArt {
  cells: {
    polygon: Point[];
    biome: Biome;
    /** Hill shading: above 1 lighter, below darker. */
    shade: number;
    /** Sea next to land, drawn lighter. */
    shallow: boolean;
    region: number | null;
  }[];
  rivers: { path: Point[]; width: number }[];
  coastline: Point[][];
}

export interface GameMap {
  seed: number;
  width: number;
  height: number;
  regions: Region[];
  art: MapArt;
}

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 700;
/** Land regions on a map, as on a two-player Small World board. */
export const LAND_REGIONS = 22;
/** Lakes this many polygons or larger become their own (unconquerable) regions. */
const LAKE_REGION_CELLS = 4;

/** How each biome counts towards a region's terrain. */
const BIOME_TERRAIN: Record<Biome, Terrain | null> = {
  OCEAN: null,
  LAKE: 'swamp',
  MARSH: 'swamp',
  ICE: 'mountain',
  BEACH: 'farmland',
  SNOW: 'mountain',
  TUNDRA: 'mountain',
  BARE: 'mountain',
  SCORCHED: 'mountain',
  TAIGA: 'hills',
  SHRUBLAND: 'hills',
  TEMPERATE_DESERT: 'hills',
  TEMPERATE_RAIN_FOREST: 'forest',
  TEMPERATE_DECIDUOUS_FOREST: 'forest',
  GRASSLAND: 'farmland',
  SUBTROPICAL_DESERT: 'farmland',
  TROPICAL_RAIN_FOREST: 'forest',
  TROPICAL_SEASONAL_FOREST: 'forest',
};

const NAME_START = [
  'Ash',
  'Bar',
  'Bel',
  'Black',
  'Bright',
  'Cold',
  'Dun',
  'Elder',
  'Elm',
  'Ember',
  'Fair',
  'Fox',
  'Gold',
  'Green',
  'Grey',
  'High',
  'Hollow',
  'Iron',
  'Kings',
  'Long',
  'Mar',
  'Mist',
  'Moon',
  'Oak',
  'Raven',
  'Red',
  'Rose',
  'Silver',
  'Stone',
  'Storm',
  'Thorn',
  'West',
  'White',
  'Wolf',
  'Wyn',
];
const NAME_END: Record<Terrain, string[]> = {
  farmland: ['field', 'ford', 'ham', 'stead', 'acre', 'vale', 'mead', 'wick', 'barrow'],
  forest: ['wood', 'shaw', 'grove', 'holt', 'hurst', 'glade', 'weald'],
  hills: ['moor', 'down', 'ridge', 'fell', 'hill', 'knoll', 'brae'],
  mountain: ['peak', 'crag', 'spire', 'horn', 'tor', 'mount', 'fang'],
  swamp: ['fen', 'mire', 'marsh', 'bog', 'moss', 'carr', 'slough'],
  lake: ['mere', 'water', 'lake', 'pool', 'tarn', 'loch'],
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** A small binary min-heap of [cost, cell, region]. */
class Heap {
  private readonly items: [number, number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: [number, number, number]): void {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }

  pop(): [number, number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (l + 1 < a.length && a[l + 1]![0] < a[m]![0]) m = l + 1;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Groups of cells connected through cells that pass `keep`, largest first. */
function components(mesh: Mesh, keep: (i: number) => boolean): number[][] {
  const seen = new Set<number>();
  const groups: number[][] = [];
  mesh.cells.forEach((_, start) => {
    if (seen.has(start) || !keep(start)) return;
    const group = [start];
    seen.add(start);
    for (let k = 0; k < group.length; k++) {
      for (const n of mesh.cells[group[k]!]!.neighbours) {
        if (!seen.has(n) && keep(n)) {
          seen.add(n);
          group.push(n);
        }
      }
    }
    groups.push(group);
  });
  return groups.sort((a, b) => b.length - a.length);
}

/**
 * Splits the main island into territories: the region of each cell (lakes after the land), or
 * null for cells off the board. Returns null when this terrain makes a poor board.
 */
function territories(mesh: Mesh, random: () => number): (number | null)[] | null {
  const { cells } = mesh;
  // Play happens on the main island; smaller islands are scenery.
  const mainland = components(mesh, (i) => !cells[i]!.ocean)[0] ?? [];
  if (mainland.length < 650 || mainland.length > 1150) return null;
  const onMainland = new Set(mainland);
  // Big lakes become regions; ponds belong to the land around them.
  const lakes = components(mesh, (i) => onMainland.has(i) && cells[i]!.water).filter(
    (group) => group.length >= LAKE_REGION_CELLS,
  );
  if (lakes.length > 3) return null;
  const lakeCells = new Set(lakes.flat());
  const land = mainland.filter((i) => !lakeCells.has(i));

  // Seeds spread evenly: k-means over the land, from farthest-point starts.
  const sites = land.map((i) => cells[i]!.site);
  const centres: Point[] = [sites[Math.floor(random() * sites.length)]!];
  while (centres.length < LAND_REGIONS) {
    let best = sites[0]!;
    let bestD = -1;
    for (const s of sites) {
      const d = Math.min(...centres.map((c) => dist(c, s)));
      if (d > bestD) [best, bestD] = [s, d];
    }
    centres.push(best);
  }
  for (let iter = 0; iter < 10; iter++) {
    const sum = centres.map(() => ({ x: 0, y: 0, n: 0 }));
    for (const s of sites) {
      let k = 0;
      centres.forEach((c, j) => {
        if (dist(c, s) < dist(centres[k]!, s)) k = j;
      });
      sum[k]!.x += s.x;
      sum[k]!.y += s.y;
      sum[k]!.n++;
    }
    sum.forEach((s, j) => {
      if (s.n) centres[j] = { x: s.x / s.n, y: s.y / s.n };
    });
  }
  const seeds: number[] = [];
  for (const c of centres) {
    const free = land.filter((i) => !seeds.includes(i));
    seeds.push(free.reduce((a, b) => (dist(cells[b]!.site, c) < dist(cells[a]!.site, c) ? b : a)));
  }

  // Territories grow from the seeds; rivers and steep slopes make natural borders.
  const owner: (number | null)[] = cells.map(() => null);
  const isLand = new Set(land);
  const heap = new Heap();
  seeds.forEach((cell, region) => heap.push([0, cell, region]));
  while (heap.size) {
    const [cost, cell, region] = heap.pop();
    if (owner[cell] !== null) continue;
    owner[cell] = region;
    const here = cells[cell]!;
    for (const n of here.neighbours) {
      if (!isLand.has(n) || owner[n] !== null) continue;
      const there = cells[n]!;
      const river = mesh.edgeBetween(cell, n)?.river ? 60 : 0;
      const climb = 1 + 4 * Math.abs(here.elevation - there.elevation);
      heap.push([cost + dist(here.site, there.site) * climb + river, n, region]);
    }
  }
  const sizes = seeds.map((_, r) => owner.filter((o) => o === r).length);
  if (Math.min(...sizes) < 14) return null;
  lakes.forEach((group, k) => group.forEach((i) => (owner[i] = LAND_REGIONS + k)));
  return owner;
}

/** Closed loops around a set of cells, following their noisy sides. */
function outlineOf(mesh: Mesh, inside: (i: number) => boolean, members: number[]): Point[][] {
  // Boundary sides, by the corner they start from.
  const sides = new Map<number, { to: number; path: Point[] }[]>();
  for (const i of members) {
    const cell = mesh.cells[i]!;
    cell.corners.forEach((c, k) => {
      const n = cell.sides[k]!;
      if (inside(n)) return;
      const edge = mesh.edgeBetween(i, n)!;
      const path = edge.corners[0] === c ? edge.path : [...edge.path].reverse();
      const to = cell.corners[(k + 1) % cell.corners.length]!;
      sides.set(c, [...(sides.get(c) ?? []), { to, path }]);
    });
  }
  const loops: Point[][] = [];
  for (const start of [...sides.keys()]) {
    while (sides.get(start)?.length) {
      const loop: Point[] = [];
      let at = start;
      do {
        const side = sides.get(at)?.pop();
        if (!side) break;
        loop.push(...side.path.slice(0, -1));
        at = side.to;
      } while (at !== start);
      loops.push(loop);
    }
  }
  return loops;
}

/** The cell deepest inside a region (most steps from its border), nearest its middle. */
function deepestCell(mesh: Mesh, members: number[], inside: (i: number) => boolean): number {
  const depth = new Map<number, number>();
  const queue: number[] = [];
  for (const i of members) {
    if (mesh.cells[i]!.neighbours.some((n) => !inside(n))) {
      depth.set(i, 0);
      queue.push(i);
    }
  }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!;
    for (const n of mesh.cells[i]!.neighbours) {
      if (inside(n) && !depth.has(n)) {
        depth.set(n, depth.get(i)! + 1);
        queue.push(n);
      }
    }
  }
  const mean = { x: 0, y: 0 };
  for (const i of members) {
    mean.x += mesh.cells[i]!.site.x / members.length;
    mean.y += mesh.cells[i]!.site.y / members.length;
  }
  const score = (i: number) => (depth.get(i) ?? 0) * 1000 - dist(mesh.cells[i]!.site, mean);
  return members.reduce((a, b) => (score(b) > score(a) ? b : a));
}

/** Hill shading with light from the north-west: brighter on slopes that face it. */
function shading(mesh: Mesh, i: number): number {
  const cell = mesh.cells[i]!;
  const pts = cell.corners.map((c) => mesh.corners[c]!);
  if (cell.water || pts.length < 3) return 1;
  // Least-squares plane z = a·x + b·y through the corners.
  const mean = (f: (q: (typeof pts)[number]) => number) =>
    pts.reduce((s, q) => s + f(q), 0) / pts.length;
  const mx = mean((q) => q.point.x);
  const my = mean((q) => q.point.y);
  const mz = mean((q) => q.elevation);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  for (const q of pts) {
    const x = q.point.x - mx;
    const y = q.point.y - my;
    const z = (q.elevation - mz) * 120;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxz += x * z;
    syz += y * z;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9) return 1;
  const a = (sxz * syy - syz * sxy) / det;
  const b = (syz * sxx - sxz * sxy) / det;
  return Math.max(0.85, Math.min(1.12, 1 - 0.35 * (a + b) * Math.SQRT1_2));
}

function buildFromSeed(seed: number): GameMap | null {
  const mesh = generateTerrain(seed, MAP_WIDTH, MAP_HEIGHT);
  const random = seededRandom(seed ^ 0x5bd1e995);
  const owner = territories(mesh, random);
  if (!owner) return null;
  const count = Math.max(...owner.map((o) => o ?? -1)) + 1;
  const members = Array.from({ length: count }, (_, r) =>
    owner.flatMap((o, i) => (o === r ? [i] : [])),
  );

  const usedNames = new Set<string>();
  const regions: Region[] = members.map((cellsOf, id) => {
    const inside = (i: number) => owner[i] === id;
    let terrain: Terrain = 'lake';
    if (id < LAND_REGIONS) {
      // The terrain most of its polygons have; mountains and swamps count from 30%.
      const tally: Record<Terrain, number> = {
        farmland: 0,
        forest: 0,
        hills: 0,
        swamp: 0,
        mountain: 0,
        lake: 0,
      };
      for (const i of cellsOf) {
        const t = BIOME_TERRAIN[mesh.cells[i]!.biome];
        if (t) tally[t]++;
      }
      if (tally.mountain >= 0.3 * cellsOf.length) terrain = 'mountain';
      else if (tally.swamp >= 0.3 * cellsOf.length) terrain = 'swamp';
      else {
        terrain = (['farmland', 'forest', 'hills'] as const).reduce((a, b) =>
          tally[b] > tally[a] ? b : a,
        );
      }
    }
    let name = '';
    for (let tries = 0; !name || usedNames.has(name); tries++) {
      const ends = NAME_END[terrain];
      name =
        NAME_START[Math.floor(random() * NAME_START.length)]! +
        ends[Math.floor(random() * ends.length)]!;
      if (tries > 50) name += ` ${tries}`;
    }
    usedNames.add(name);
    const neighbours = new Set<number>();
    for (const i of cellsOf) {
      for (const n of mesh.cells[i]!.neighbours) {
        const o = owner[n];
        if (o !== null && o !== undefined && o !== id) neighbours.add(o);
      }
    }
    return {
      id,
      name,
      terrain,
      lostTribe: false,
      coast:
        terrain !== 'lake' &&
        cellsOf.some((i) => mesh.cells[i]!.neighbours.some((n) => mesh.cells[n]!.ocean)),
      neighbours: [...neighbours].sort((a, b) => a - b),
      outline: outlineOf(mesh, inside, cellsOf),
      centre: mesh.cells[deepestCell(mesh, cellsOf, inside)]!.site,
    };
  });

  // The board must hang together over land, with places to land from the sea.
  const land = regions.filter((r) => r.terrain !== 'lake');
  const reached = new Set([0]);
  const queue = [0];
  for (let k = 0; k < queue.length; k++) {
    for (const n of regions[queue[k]!]!.neighbours) {
      if (regions[n]!.terrain !== 'lake' && !reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  }
  if (reached.size !== land.length || land.filter((r) => r.coast).length < 6) return null;

  // About a third of the land starts under Lost Tribes.
  const candidates = land.map((r) => r.id);
  for (let k = 0; k < Math.round(land.length / 3); k++) {
    const pick = candidates.splice(Math.floor(random() * candidates.length), 1)[0]!;
    regions[pick]!.lostTribe = true;
  }

  const art: MapArt = {
    cells: mesh.cells.map((c, i) => ({
      polygon: c.polygon,
      biome: c.biome,
      shade: shading(mesh, i),
      shallow: c.ocean && c.coast,
      region: owner[i] ?? null,
    })),
    rivers: mesh.edges
      .filter((e) => e.river > 0 && !e.cells.some((i) => mesh.cells[i]!.ocean))
      .map((e) => ({ path: e.path, width: Math.min(7, 1.2 + Math.sqrt(e.river)) })),
    coastline: outlineOf(
      mesh,
      (i) => !mesh.cells[i]!.ocean,
      mesh.cells.flatMap((c, i) => (c.ocean ? [] : [i])),
    ),
  };
  return { seed, width: MAP_WIDTH, height: MAP_HEIGHT, regions, art };
}

/**
 * A playable island for `seed`. When that terrain makes a poor board (too small or too big,
 * split up, too many lakes), the following seeds are tried; `seed` on the result says which.
 */
export function buildMap(seed: number): GameMap {
  for (let s = seed; ; s++) {
    const map = buildFromSeed(s);
    if (map) return map;
  }
}

/** A random map seed. */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 99999);
}
