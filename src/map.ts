import { cellNeighbours, centroid, roughOutline, voronoiCells, type Point } from './geometry';

export type Terrain = 'farmland' | 'forest' | 'hills' | 'swamp' | 'mountain' | 'lake';

export interface Region {
  id: number;
  name: string;
  terrain: Terrain;
  /** Starts with a Lost Tribe token on it. */
  lostTribe: boolean;
  /** Touches the edge of the map: a race can enter the map here. */
  border: boolean;
  neighbours: number[];
  outline: Point[];
  centre: Point;
}

export interface GameMap {
  width: number;
  height: number;
  regions: Region[];
}

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 700;

/** [x, y, terrain, Lost Tribe, name] for each region, laid out on a rough 6 × 4 grid. */
const LAYOUT: [number, number, Terrain, boolean, string][] = [
  [85, 90, 'forest', false, 'Oakmere'],
  [255, 70, 'mountain', false, 'Grimspire'],
  [420, 120, 'farmland', true, 'Goldfield'],
  [590, 75, 'swamp', false, 'Mirefen'],
  [760, 125, 'hills', true, 'Windmoor'],
  [915, 80, 'farmland', false, 'Barleyholt'],
  [120, 275, 'farmland', false, 'Hearthvale'],
  [290, 250, 'hills', true, 'Stonebarrow'],
  [455, 315, 'lake', false, 'Silvermere'],
  [610, 235, 'forest', true, 'Deepwood'],
  [775, 290, 'mountain', false, 'Iron Peak'],
  [935, 255, 'swamp', false, 'Bogmarsh'],
  [70, 455, 'hills', false, 'Thornhill'],
  [240, 430, 'swamp', true, 'Reedwater'],
  [405, 480, 'forest', false, 'Elderglen'],
  [570, 430, 'mountain', true, 'Dragontooth'],
  [730, 470, 'farmland', false, 'Meadowbrook'],
  [905, 435, 'forest', true, 'Pinecrest'],
  [110, 625, 'mountain', false, 'Frostcrag'],
  [280, 630, 'farmland', false, 'Millbrook'],
  [455, 615, 'hills', true, 'Foxden'],
  [625, 640, 'swamp', false, 'Murkhollow'],
  [790, 630, 'farmland', false, 'Sunreach'],
  [935, 620, 'lake', false, 'Saltwash'],
];

/** Builds the game map: one Voronoi cell per layout point. */
export function buildMap(): GameMap {
  const seeds = LAYOUT.map(([x, y]) => ({ x, y }));
  const cells = voronoiCells(seeds, MAP_WIDTH, MAP_HEIGHT);
  const { neighbours, border } = cellNeighbours(seeds, cells, MAP_WIDTH, MAP_HEIGHT);
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    regions: LAYOUT.map(([, , terrain, lostTribe, name], id) => ({
      id,
      name,
      terrain,
      lostTribe,
      border: border[id]!,
      neighbours: neighbours[id]!,
      outline: roughOutline(cells[id]!, MAP_WIDTH, MAP_HEIGHT),
      centre: centroid(cells[id]!),
    })),
  };
}
