import { describe, expect, it } from 'vitest';
import { buildMap } from './map';

describe('buildMap', () => {
  const map = buildMap();

  it('has 24 regions with symmetric neighbours', () => {
    expect(map.regions).toHaveLength(24);
    for (const r of map.regions) {
      expect(r.neighbours.length).toBeGreaterThan(1);
      for (const n of r.neighbours) expect(map.regions[n]!.neighbours).toContain(r.id);
    }
  });

  it('connects every land region over land', () => {
    const land = map.regions.filter((r) => r.terrain !== 'lake');
    const seen = new Set([land[0]!.id]);
    const queue = [land[0]!.id];
    while (queue.length) {
      for (const n of map.regions[queue.pop()!]!.neighbours) {
        if (map.regions[n]!.terrain !== 'lake' && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(land.length);
  });

  it('marks the outer ring as the border', () => {
    expect(map.regions[0]!.border).toBe(true);
    expect(map.regions[7]!.border).toBe(false);
    expect(map.regions.filter((r) => r.border).length).toBeGreaterThanOrEqual(14);
  });

  it('places each centre inside the map', () => {
    for (const r of map.regions) {
      expect(r.centre.x).toBeGreaterThan(0);
      expect(r.centre.x).toBeLessThan(map.width);
      expect(r.centre.y).toBeGreaterThan(0);
      expect(r.centre.y).toBeLessThan(map.height);
    }
  });
});
