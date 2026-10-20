import { describe, expect, it } from 'vitest';
import { insideLoops } from './geometry';
import { buildMap, LAND_REGIONS } from './map';

const maps = [1, 200, 400, 600, 800].map((seed) => buildMap(seed));

describe('buildMap', () => {
  it('draws the same island for the same seed', () => {
    const again = buildMap(maps[0]!.seed);
    expect(again.regions.map((r) => r.name)).toEqual(maps[0]!.regions.map((r) => r.name));
    expect(again.art.cells[100]!.polygon).toEqual(maps[0]!.art.cells[100]!.polygon);
  });

  it('makes different islands for different seeds', () => {
    expect(new Set(maps.map((m) => m.seed)).size).toBe(maps.length);
    expect(maps[0]!.regions[0]!.outline).not.toEqual(maps[1]!.regions[0]!.outline);
  });

  for (const map of maps) {
    describe(`island #${map.seed}`, () => {
      const land = map.regions.filter((r) => r.terrain !== 'lake');

      it('has the land regions, with symmetric neighbours', () => {
        expect(land).toHaveLength(LAND_REGIONS);
        for (const r of map.regions) {
          expect(r.neighbours.length).toBeGreaterThan(0);
          for (const n of r.neighbours) expect(map.regions[n]!.neighbours).toContain(r.id);
        }
      });

      it('connects every land region over land', () => {
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

      it('has coastal regions to land on, and Lost Tribes', () => {
        expect(land.filter((r) => r.coast).length).toBeGreaterThanOrEqual(6);
        expect(map.regions.some((r) => r.terrain === 'lake' && r.coast)).toBe(false);
        expect(land.filter((r) => r.lostTribe)).toHaveLength(Math.round(LAND_REGIONS / 3));
      });

      it('puts each region centre inside its outline', () => {
        for (const r of map.regions) {
          expect(r.outline.length).toBeGreaterThan(0);
          expect(insideLoops(r.centre, r.outline)).toBe(true);
        }
      });

      it('gives every region a unique name', () => {
        expect(new Set(map.regions.map((r) => r.name)).size).toBe(map.regions.length);
      });

      it('draws rivers and hill shading', () => {
        expect(map.art.rivers.length).toBeGreaterThan(0);
        expect(map.art.cells.some((c) => c.shade !== 1)).toBe(true);
        expect(map.art.coastline.length).toBeGreaterThan(0);
      });
    });
  }
});
