/**
 * Island terrain after Amit Patel's "Polygonal Map Generation for Games"
 * (http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/,
 * reference code: github.com/amitp/mapgen2): relaxed random points, a Voronoi mesh, a noisy
 * island shape, elevation from the coast, rivers flowing downhill, moisture from fresh water,
 * Whittaker biomes and noisy edges.
 */
import { Delaunay } from 'd3-delaunay';
import { centroid, seededRandom, type Point } from './geometry';

export type Biome =
  | 'OCEAN'
  | 'LAKE'
  | 'MARSH'
  | 'ICE'
  | 'BEACH'
  | 'SNOW'
  | 'TUNDRA'
  | 'BARE'
  | 'SCORCHED'
  | 'TAIGA'
  | 'SHRUBLAND'
  | 'TEMPERATE_DESERT'
  | 'TEMPERATE_RAIN_FOREST'
  | 'TEMPERATE_DECIDUOUS_FOREST'
  | 'GRASSLAND'
  | 'SUBTROPICAL_DESERT'
  | 'TROPICAL_RAIN_FOREST'
  | 'TROPICAL_SEASONAL_FOREST';

/** A Voronoi polygon. */
export interface Cell {
  site: Point;
  /** Corners in order around the polygon (empty for cells on the map's edge). */
  corners: number[];
  /** sides[k] is the cell across the side from corners[k] to corners[k + 1]. */
  sides: number[];
  /** Every neighbouring cell. */
  neighbours: number[];
  /** The polygon, with noisy sides. */
  polygon: Point[];
  border: boolean;
  water: boolean;
  ocean: boolean;
  coast: boolean;
  elevation: number;
  moisture: number;
  biome: Biome;
}

/** A Voronoi vertex, where three cells meet. */
export interface Corner {
  point: Point;
  cells: number[];
  adjacent: number[];
  border: boolean;
  water: boolean;
  ocean: boolean;
  coast: boolean;
  elevation: number;
  moisture: number;
  downslope: number;
  river: number;
}

/** The side two cells share, from corners[0] to corners[1]. */
export interface Edge {
  cells: [number, number];
  corners: [number, number];
  river: number;
  /** The side as drawn, from corners[0] to corners[1]. */
  path: Point[];
}

export interface Terrain {
  width: number;
  height: number;
  cells: Cell[];
  corners: Corner[];
  edges: Edge[];
  /** The edge between two cells, if they touch. */
  edgeBetween(a: number, b: number): Edge | undefined;
}

/** Polygons on the map; about 21 px across on a 1000 × 700 map. */
export const POINTS = 1600;
const LLOYD_RELAXATIONS = 2;
/** A polygon is water when at least this share of its corners is. */
const LAKE_THRESHOLD = 0.3;

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Smooth value noise in 0..1, summed over octaves. */
export function fractalNoise(seed: number): (x: number, y: number) => number {
  const lattice = (ix: number, iy: number) => {
    let h = seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = lattice(ix, iy) + (lattice(ix + 1, iy) - lattice(ix, iy)) * sx;
    const bottom = lattice(ix, iy + 1) + (lattice(ix + 1, iy + 1) - lattice(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
  return (x, y) => {
    let sum = 0;
    let total = 0;
    let amp = 1;
    let freq = 1;
    for (let o = 0; o < 6; o++) {
      sum += amp * noise(x * freq + o * 31.7, y * freq - o * 17.3);
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  };
}

/** Whether a point in -1..1 × -1..1 is land: noise above a threshold rising towards the edge. */
function islandShape(seed: number): (q: Point) => boolean {
  const noise = fractalNoise(seed);
  return (q) => {
    const c = 0.5 + (noise(q.x * 1.4 + 50, q.y * 1.4 + 50) - 0.5) * 2.2;
    return c > 0.2 + 0.35 * (q.x * q.x + q.y * q.y);
  };
}

/** The Whittaker-diagram biome of a polygon, as in mapgen2 (plus marshes on wet lowland). */
function biomeOf(c: Cell): Biome {
  const { elevation: e, moisture: m } = c;
  if (c.ocean) return 'OCEAN';
  if (c.water) return e < 0.1 ? 'MARSH' : e > 0.8 ? 'ICE' : 'LAKE';
  if (c.coast) return 'BEACH';
  if (e < 0.12 && m > 0.8) return 'MARSH';
  if (e > 0.8) return m > 0.5 ? 'SNOW' : m > 0.33 ? 'TUNDRA' : m > 0.16 ? 'BARE' : 'SCORCHED';
  if (e > 0.6) return m > 0.66 ? 'TAIGA' : m > 0.33 ? 'SHRUBLAND' : 'TEMPERATE_DESERT';
  if (e > 0.3) {
    if (m > 0.83) return 'TEMPERATE_RAIN_FOREST';
    if (m > 0.5) return 'TEMPERATE_DECIDUOUS_FOREST';
    return m > 0.16 ? 'GRASSLAND' : 'TEMPERATE_DESERT';
  }
  if (m > 0.66) return 'TROPICAL_RAIN_FOREST';
  if (m > 0.33) return 'TROPICAL_SEASONAL_FOREST';
  return m > 0.16 ? 'GRASSLAND' : 'SUBTROPICAL_DESERT';
}

/**
 * A noisy line from A to C inside the quadrilateral A-B-C-D (mapgen2's NoisyEdges): it never
 * leaves the quadrilateral, so neighbouring noisy sides never cross.
 */
function noisyLine(
  random: () => number,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  minLength: number,
): Point[] {
  const out: Point[] = [a];
  const range = (lo: number, hi: number) => lo + (hi - lo) * random();
  const subdivide = (A: Point, B: Point, C: Point, D: Point) => {
    if (!(dist(A, C) >= minLength && dist(B, D) >= minLength)) return;
    const p = range(0.2, 0.8);
    const q = range(0.2, 0.8);
    // As Flash's Point.interpolate(x, y, f): f = 1 gives x.
    const mix = (x: Point, y: Point, f: number) => lerp(y, x, f);
    const E = mix(A, D, p);
    const F = mix(B, C, p);
    const G = mix(A, B, q);
    const I = mix(D, C, q);
    const H = mix(E, F, q);
    const s = 1 - range(-0.4, 0.4);
    const t = 1 - range(-0.4, 0.4);
    subdivide(A, mix(G, B, s), H, mix(E, D, t));
    out.push(H);
    subdivide(H, mix(F, C, s), C, mix(I, D, t));
  };
  subdivide(a, b, c, d);
  out.push(c);
  return out;
}

/** Sets values to their rank, shaped by `shape` (0..1 → 0..1). */
function redistribute(values: number[], set: (i: number, v: number) => void, ids: number[]) {
  const order = [...ids].sort((a, b) => values[a]! - values[b]!);
  order.forEach((id, i) => set(id, i / Math.max(1, order.length - 1)));
}

export function generateTerrain(seed: number, width: number, height: number): Terrain {
  const random = seededRandom(seed);

  // Points, spread out by Lloyd relaxation.
  let points: Point[] = Array.from({ length: POINTS }, () => ({
    x: random() * width,
    y: random() * height,
  }));
  for (let k = 0; k < LLOYD_RELAXATIONS; k++) {
    const voronoi = Delaunay.from(
      points,
      (p) => p.x,
      (p) => p.y,
    ).voronoi([0, 0, width, height]);
    points = points.map((p, i) => {
      const poly = voronoi.cellPolygon(i);
      return poly ? centroid(poly.slice(0, -1).map(([x, y]) => ({ x: x!, y: y! }))) : p;
    });
  }
  const delaunay = Delaunay.from(
    points,
    (p) => p.x,
    (p) => p.y,
  );
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  const { triangles, halfedges, inedges } = delaunay;
  const next = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);
  const outside = (p: Point) => p.x < 0 || p.y < 0 || p.x > width || p.y > height;

  // Corners: the circumcentres of the Delaunay triangles.
  const corners: Corner[] = [];
  for (let t = 0; t < triangles.length / 3; t++) {
    const point = { x: voronoi.circumcenters[2 * t]!, y: voronoi.circumcenters[2 * t + 1]! };
    const adjacent: number[] = [];
    for (let e = 3 * t; e < 3 * t + 3; e++) {
      if (halfedges[e]! >= 0) adjacent.push(Math.floor(halfedges[e]! / 3));
    }
    corners.push({
      point,
      cells: [triangles[3 * t]!, triangles[3 * t + 1]!, triangles[3 * t + 2]!],
      adjacent,
      border: outside(point) || adjacent.length < 3,
      water: false,
      ocean: false,
      coast: false,
      elevation: 0,
      moisture: 0,
      downslope: t,
      river: 0,
    });
  }

  // Cells: walk around each point to list its corners in order.
  const cells: Cell[] = points.map((site, i) => {
    const cornerList: number[] = [];
    const sides: number[] = [];
    let border = false;
    const start = inedges[i]!;
    let e = start;
    if (e === -1) border = true;
    else {
      do {
        cornerList.push(Math.floor(e / 3));
        const out = next(e);
        sides.push(triangles[next(out)]!);
        e = halfedges[out]!;
      } while (e !== -1 && e !== start);
      if (e === -1) border = true;
    }
    if (cornerList.some((c) => corners[c]!.border)) border = true;
    return {
      site,
      corners: border ? [] : cornerList,
      sides: border ? [] : sides,
      neighbours: [...delaunay.neighbors(i)],
      polygon: [],
      border,
      water: false,
      ocean: false,
      coast: false,
      elevation: 0,
      moisture: 0,
      biome: 'OCEAN',
    };
  });
  for (const c of corners) if (c.cells.some((i) => cells[i]!.border)) c.border = true;

  // Edges between pairs of cells.
  const edges: Edge[] = [];
  const byCells = new Map<number, number>();
  const byCorners = new Map<number, number>();
  const pairKey = (a: number, b: number, n: number) => Math.min(a, b) * n + Math.max(a, b);
  for (let e = 0; e < halfedges.length; e++) {
    const h = halfedges[e]!;
    if (h < e) continue;
    const a = triangles[e]!;
    const b = triangles[next(e)]!;
    const edge: Edge = {
      cells: [a, b],
      corners: [Math.floor(e / 3), Math.floor(h / 3)],
      river: 0,
      path: [],
    };
    byCells.set(pairKey(a, b, POINTS), edges.length);
    byCorners.set(pairKey(edge.corners[0], edge.corners[1], corners.length), edges.length);
    edges.push(edge);
  }
  const edgeBetween = (a: number, b: number) => {
    const i = byCells.get(pairKey(a, b, POINTS));
    return i === undefined ? undefined : edges[i];
  };
  const edgeOfCorners = (a: number, b: number) =>
    edges[byCorners.get(pairKey(a, b, corners.length))!];

  // Island shape decides water at the corners; polygons follow.
  const inside = islandShape(seed);
  for (const c of corners) {
    c.water =
      c.border || !inside({ x: 2 * (c.point.x / width - 0.5), y: 2 * (c.point.y / height - 0.5) });
  }

  // Elevation: distance from the map edge, climbing only over land (mapgen2).
  const queue: number[] = [];
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]!;
    c.elevation = c.border ? 0 : Infinity;
    if (c.border) queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const q = corners[queue[head]!]!;
    for (const s of q.adjacent) {
      const r = corners[s]!;
      const elevation = q.elevation + 0.01 + (!q.water && !r.water ? 1 : 0);
      if (elevation < r.elevation) {
        r.elevation = elevation;
        queue.push(s);
      }
    }
  }

  // Ocean is the water connected to the map's edge; other water is lakes.
  const oceanQueue: number[] = [];
  cells.forEach((p, i) => {
    if (p.border) {
      p.ocean = p.water = true;
      oceanQueue.push(i);
    } else {
      const wet = p.corners.filter((c) => corners[c]!.water).length;
      p.water = wet >= p.corners.length * LAKE_THRESHOLD;
    }
  });
  for (let head = 0; head < oceanQueue.length; head++) {
    for (const n of cells[oceanQueue[head]!]!.neighbours) {
      const r = cells[n]!;
      if (r.water && !r.ocean) {
        r.ocean = true;
        oceanQueue.push(n);
      }
    }
  }
  for (const p of cells) {
    const ocean = p.neighbours.some((n) => cells[n]!.ocean);
    const land = p.neighbours.some((n) => !cells[n]!.water);
    p.coast = ocean && land;
  }
  for (const q of corners) {
    const ocean = q.cells.filter((i) => cells[i]!.ocean).length;
    const land = q.cells.filter((i) => !cells[i]!.water).length;
    q.ocean = ocean === q.cells.length;
    q.coast = ocean > 0 && land > 0;
    q.water = q.border || (land !== q.cells.length && !q.coast);
  }

  // Low ground is common, high ground rare: land elevation X gets frequency (1 - X).
  const landCorners = corners.flatMap((q, i) => (q.ocean || q.coast ? [] : [i]));
  const scale = 1.1;
  redistribute(
    corners.map((q) => q.elevation),
    (i, y) => (corners[i]!.elevation = Math.min(1, Math.sqrt(scale) - Math.sqrt(scale * (1 - y)))),
    landCorners,
  );
  for (const q of corners) if (q.ocean || q.coast) q.elevation = 0;
  for (const p of cells) {
    p.elevation = p.corners.length
      ? p.corners.reduce((s, c) => s + corners[c]!.elevation, 0) / p.corners.length
      : 0;
  }

  // Rivers run downhill from random high corners to the coast.
  corners.forEach((q, i) => {
    q.downslope = q.adjacent.reduce(
      (r, s) => (corners[s]!.elevation <= corners[r]!.elevation ? s : r),
      i,
    );
  });
  for (let k = 0; k < POINTS / 6; k++) {
    let i = Math.floor(random() * corners.length);
    const start = corners[i]!;
    if (start.ocean || start.elevation < 0.3 || start.elevation > 0.9) continue;
    for (let steps = 0; !corners[i]!.coast && steps < 500; steps++) {
      const q = corners[i]!;
      if (q.downslope === i) break;
      edgeOfCorners(i, q.downslope)!.river++;
      q.river++;
      corners[q.downslope]!.river++;
      i = q.downslope;
    }
  }

  // Moisture spreads from fresh water (rivers, lakes) and is set to 1 by the sea.
  const wetQueue: number[] = [];
  corners.forEach((q, i) => {
    if ((q.water || q.river > 0) && !q.ocean) {
      q.moisture = q.river > 0 ? Math.min(3, 0.2 * q.river) : 1;
      wetQueue.push(i);
    } else q.moisture = 0;
  });
  for (let head = 0; head < wetQueue.length; head++) {
    const q = corners[wetQueue[head]!]!;
    for (const s of q.adjacent) {
      const moisture = q.moisture * 0.9;
      if (moisture > corners[s]!.moisture) {
        corners[s]!.moisture = moisture;
        wetQueue.push(s);
      }
    }
  }
  for (const q of corners) if (q.ocean || q.coast) q.moisture = 1;
  redistribute(
    corners.map((q) => q.moisture),
    (i, v) => (corners[i]!.moisture = v),
    landCorners,
  );
  for (const p of cells) {
    p.moisture = p.corners.length
      ? p.corners.reduce((s, c) => s + corners[c]!.moisture, 0) / p.corners.length
      : 1;
    p.biome = biomeOf(p);
  }

  // Noisy edges: each side wanders inside the quadrilateral of its corners and cell sites.
  for (const edge of edges) {
    const [d0, d1] = edge.cells.map((i) => cells[i]!);
    const [v0, v1] = edge.corners.map((i) => corners[i]!.point);
    if (d0!.border || d1!.border || (d0!.ocean && d1!.ocean)) {
      edge.path = [v0!, v1!];
      continue;
    }
    let minLength = 10;
    if (d0!.biome !== d1!.biome) minLength = 3;
    if (d0!.coast || d1!.coast || d0!.water !== d1!.water || edge.river > 0) minLength = 1.5;
    const mid = lerp(v0!, v1!, 0.5);
    const f = 0.5;
    const half0 = noisyLine(
      random,
      v0!,
      lerp(v0!, d0!.site, f),
      mid,
      lerp(v0!, d1!.site, f),
      minLength,
    );
    const half1 = noisyLine(
      random,
      v1!,
      lerp(v1!, d1!.site, f),
      mid,
      lerp(v1!, d0!.site, f),
      minLength,
    );
    edge.path = [...half0, ...half1.reverse().slice(1)];
  }

  // Polygons from the noisy sides; cells on the map's edge keep their clipped shape.
  cells.forEach((p, i) => {
    if (p.border) {
      const poly = voronoi.cellPolygon(i);
      p.polygon = poly ? poly.slice(0, -1).map(([x, y]) => ({ x: x!, y: y! })) : [];
      return;
    }
    const outline: Point[] = [];
    p.corners.forEach((c, k) => {
      const edge = edgeBetween(i, p.sides[k]!)!;
      const path = edge.corners[0] === c ? edge.path : [...edge.path].reverse();
      outline.push(...path.slice(0, -1));
    });
    p.polygon = outline;
  });

  return { width, height, cells, corners, edges, edgeBetween };
}
