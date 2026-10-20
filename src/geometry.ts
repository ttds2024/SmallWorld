export interface Point {
  x: number;
  y: number;
}

/** A small seeded random generator (mulberry32), so a map always looks the same. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Clips a convex polygon to the half-plane of points at least as close to `a` as to `b`
 * (one Sutherland–Hodgman step).
 */
function clipCloser(polygon: Point[], a: Point, b: Point): Point[] {
  const nx = b.x - a.x;
  const ny = b.y - a.y;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const side = (p: Point) => (p.x - mx) * nx + (p.y - my) * ny;
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

/** The Voronoi cell of each seed inside the rectangle 0..width × 0..height. */
export function voronoiCells(seeds: Point[], width: number, height: number): Point[][] {
  return seeds.map((seed, i) => {
    let cell: Point[] = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
    seeds.forEach((other, j) => {
      if (j !== i) cell = clipCloser(cell, seed, other);
    });
    // Rounded, so the two cells on either side of an edge agree on its end points.
    return cell.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
  });
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * For each cell, the cells it shares an edge with (not just a corner), and whether it touches the
 * edge of the rectangle.
 */
export function cellNeighbours(
  seeds: Point[],
  cells: Point[][],
  width: number,
  height: number,
): { neighbours: number[][]; border: boolean[] } {
  const eps = 1e-6;
  const neighbours = seeds.map(() => new Set<number>());
  const border = seeds.map(() => false);
  cells.forEach((cell, i) => {
    for (let k = 0; k < cell.length; k++) {
      const p = cell[k]!;
      const q = cell[(k + 1) % cell.length]!;
      if (dist(p, q) < 1) continue;
      const onFrame = (f: (pt: Point) => number) => Math.abs(f(p)) < eps && Math.abs(f(q)) < eps;
      if (
        onFrame((pt) => pt.x) ||
        onFrame((pt) => pt.y) ||
        onFrame((pt) => pt.x - width) ||
        onFrame((pt) => pt.y - height)
      ) {
        border[i] = true;
        continue;
      }
      // The midpoint of a shared edge is as close to the other seed as to this one.
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const own = dist(mid, seeds[i]!);
      seeds.forEach((s, j) => {
        if (j !== i && Math.abs(dist(mid, s) - own) < 1e-3 * Math.max(1, own)) {
          neighbours[i]!.add(j);
        }
      });
    }
  });
  return { neighbours: neighbours.map((set) => [...set].sort((a, b) => a - b)), border };
}

/** Area-weighted centre of a polygon. */
export function centroid(polygon: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  area /= 2;
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * Bends the straight edge p→q into a wobbly line, as if drawn by hand. The bend depends only on
 * the two end points, so the two regions sharing an edge get exactly the same line.
 */
function wobble(p: Point, q: Point): Point[] {
  const key = (pt: Point) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
  const forward = key(p) < key(q);
  const [a, b] = forward ? [p, q] : [q, p];
  let hash = 2166136261;
  for (const ch of key(a) + key(b)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const random = seededRandom(hash);
  let line = [a, b];
  for (let level = 0; level < 3; level++) {
    const next: Point[] = [line[0]!];
    for (let i = 0; i < line.length - 1; i++) {
      const s = line[i]!;
      const e = line[i + 1]!;
      const len = dist(s, e);
      const off = (random() - 0.5) * len * 0.35;
      next.push({
        x: (s.x + e.x) / 2 - ((e.y - s.y) / len) * off,
        y: (s.y + e.y) / 2 + ((e.x - s.x) / len) * off,
      });
      next.push(e);
    }
    line = next;
  }
  if (!forward) line.reverse();
  return line.slice(0, -1);
}

/** The outline of a cell with hand-drawn inner edges; edges on the frame stay straight. */
export function roughOutline(cell: Point[], width: number, height: number): Point[] {
  const out: Point[] = [];
  const onFrame = (p: Point, q: Point) =>
    (p.x === q.x && (p.x === 0 || p.x === width)) || (p.y === q.y && (p.y === 0 || p.y === height));
  for (let i = 0; i < cell.length; i++) {
    const p = cell[i]!;
    const q = cell[(i + 1) % cell.length]!;
    if (onFrame(p, q) || dist(p, q) < 1) out.push(p);
    else out.push(...wobble(p, q));
  }
  return out;
}

/** An SVG path for a closed polygon. */
export function pathOf(polygon: Point[]): string {
  return (
    polygon.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + 'Z'
  );
}
