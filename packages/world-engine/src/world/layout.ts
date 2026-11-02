/**
 * Neighborhood layout: the single source of truth shared by the Node-safe
 * simulation (navigation, points of interest) and the 3D scene (buildings,
 * paths, props). PURE DATA — must never import three/react/DOM.
 *
 * Coordinates are meters. +X = east, +Z = south, +Y = up. Ground is y = 0.
 * The default "neighborhood" camera looks north (-Z) across the plaza.
 */

export interface Vec2 { x: number; z: number }

export type PoiKind =
  | 'plaza' | 'fountain' | 'stage' | 'cafe' | 'cafe-seat' | 'bench' | 'park'
  | 'playground' | 'home' | 'portal' | 'garden' | 'arcade' | 'lookout';

/** Things a resident can do at a place. The simulation maps these to needs. */
export type Affordance =
  | 'socialize' | 'dance' | 'perform' | 'drink' | 'eat' | 'rest' | 'sit'
  | 'sleep' | 'play' | 'wander' | 'admire' | 'arrive' | 'read' | 'watch';

export interface Seat { x: number; z: number; /** yaw in radians; 0 = facing +Z (south) */ facing: number }

export interface PoiDef {
  id: string;
  name: string;
  /** Contract `location.zone` value used while a resident is here. */
  zone: string;
  kind: PoiKind;
  position: Vec2;
  /** Residents spread within this radius when using the place. */
  radius: number;
  capacity: number;
  affordances: Affordance[];
  /** Nav node that connects this place to the street network. */
  navNode: string;
  seats?: Seat[];
  /** For homes: index used to assign residents. */
  homeIndex?: number;
}

export interface NavNode { id: string; x: number; z: number }

export interface BuildingDef {
  id: string;
  kind: 'house' | 'cafe' | 'arcade';
  name: string;
  position: Vec2;
  /** yaw radians; 0 = front door faces +Z (south). */
  rotation: number;
  width: number;
  depth: number;
  /** Suggested palette index for the renderer. */
  palette: number;
  /** POI id of the place this building hosts. */
  poiId: string;
}

export const WORLD_BOUNDS = { minX: -34, maxX: 34, minZ: -34, maxZ: 34 } as const;
export const PLAZA_RADIUS = 9.5;
export const FOUNTAIN_RADIUS = 2.2;

const PI = Math.PI;

export const NAV_NODES: NavNode[] = [
  // Plaza ring (walkable circle around the fountain)
  { id: 'ring-n', x: 0, z: -6.5 },
  { id: 'ring-ne', x: 4.6, z: -4.6 },
  { id: 'ring-e', x: 6.5, z: 0 },
  { id: 'ring-se', x: 4.6, z: 4.6 },
  { id: 'ring-s', x: 0, z: 6.5 },
  { id: 'ring-sw', x: -4.6, z: 4.6 },
  { id: 'ring-w', x: -6.5, z: 0 },
  { id: 'ring-nw', x: -4.6, z: -4.6 },
  // North avenue to the portal
  { id: 'north-1', x: 0, z: -13 },
  { id: 'portal-gate', x: 0, z: -20 },
  // East street to the café / arcade
  { id: 'east-1', x: 11, z: -1 },
  { id: 'cafe-front', x: 11.5, z: -6.5 },
  { id: 'east-2', x: 15, z: -14 },
  // West lane to the park and western homes
  { id: 'west-1', x: -12, z: 0 },
  { id: 'park-gate', x: -11, z: -9 },
  { id: 'park-inner', x: -16, z: -17 },
  { id: 'west-2', x: -16, z: 6 },
  // South street with the row of homes
  { id: 'south-1', x: 0, z: 12.5 },
  { id: 'street-w', x: -11, z: 13 },
  { id: 'street-e', x: 11, z: 13 },
  { id: 'street-far-e', x: 17, z: 9 },
  { id: 'garden', x: -6, z: 16 },
];

export const NAV_EDGES: Array<[string, string]> = [
  ['ring-n', 'ring-ne'], ['ring-ne', 'ring-e'], ['ring-e', 'ring-se'], ['ring-se', 'ring-s'],
  ['ring-s', 'ring-sw'], ['ring-sw', 'ring-w'], ['ring-w', 'ring-nw'], ['ring-nw', 'ring-n'],
  ['ring-n', 'north-1'], ['north-1', 'portal-gate'],
  ['ring-e', 'east-1'], ['ring-ne', 'cafe-front'], ['east-1', 'cafe-front'], ['cafe-front', 'east-2'], ['north-1', 'east-2'],
  ['ring-w', 'west-1'], ['ring-nw', 'park-gate'], ['west-1', 'park-gate'], ['park-gate', 'park-inner'], ['north-1', 'park-inner'],
  ['west-1', 'west-2'], ['west-2', 'street-w'],
  ['ring-s', 'south-1'], ['south-1', 'street-w'], ['south-1', 'street-e'], ['street-e', 'street-far-e'], ['east-1', 'street-far-e'],
  ['street-w', 'garden'], ['garden', 'south-1'],
];

export const POIS: PoiDef[] = [
  { id: 'plaza', name: 'Town Plaza', zone: 'plaza', kind: 'plaza', position: { x: 0, z: 0 }, radius: 7, capacity: 24,
    affordances: ['socialize', 'wander', 'watch', 'admire'], navNode: 'ring-s' },
  { id: 'fountain', name: 'Wishing Fountain', zone: 'plaza', kind: 'fountain', position: { x: 0, z: 0 }, radius: 3.4, capacity: 8,
    affordances: ['admire', 'socialize', 'rest'], navNode: 'ring-n' },
  { id: 'stage', name: 'Dance Stage', zone: 'stage', kind: 'stage', position: { x: 7.5, z: 7 }, radius: 2.6, capacity: 8,
    affordances: ['dance', 'perform', 'watch'], navNode: 'ring-se' },
  { id: 'cafe', name: 'Sunbeam Café', zone: 'cafe', kind: 'cafe', position: { x: 12.5, z: -6.5 }, radius: 3.2, capacity: 8,
    affordances: ['drink', 'eat', 'socialize', 'sit'], navNode: 'cafe-front',
    seats: [
      { x: 9.6, z: -9.2, facing: PI * 0.5 }, { x: 11.4, z: -9.2, facing: -PI * 0.5 },
      { x: 9.6, z: -4.0, facing: PI * 0.5 }, { x: 11.4, z: -4.0, facing: -PI * 0.5 },
    ] },
  { id: 'bench-plaza-w', name: 'Plaza Bench', zone: 'plaza', kind: 'bench', position: { x: -7.6, z: 3.4 }, radius: 1, capacity: 2,
    affordances: ['rest', 'sit', 'socialize', 'watch'], navNode: 'ring-sw',
    seats: [{ x: -7.9, z: 2.9, facing: PI * 0.62 }, { x: -7.3, z: 3.9, facing: PI * 0.62 }] },
  { id: 'bench-plaza-e', name: 'Stage Bench', zone: 'plaza', kind: 'bench', position: { x: 3.2, z: 8.6 }, radius: 1, capacity: 2,
    affordances: ['rest', 'sit', 'watch'], navNode: 'ring-s',
    seats: [{ x: 2.6, z: 8.7, facing: PI }, { x: 3.8, z: 8.5, facing: PI }] },
  { id: 'park', name: 'Willow Park', zone: 'park', kind: 'park', position: { x: -15, z: -15 }, radius: 4.5, capacity: 12,
    affordances: ['wander', 'play', 'rest', 'read', 'socialize'], navNode: 'park-inner' },
  { id: 'bench-park', name: 'Pond Bench', zone: 'park', kind: 'bench', position: { x: -11.5, z: -17.5 }, radius: 1, capacity: 2,
    affordances: ['rest', 'sit', 'read', 'socialize'], navNode: 'park-inner',
    seats: [{ x: -12.1, z: -17.6, facing: -PI * 0.75 }, { x: -11.0, z: -17.3, facing: -PI * 0.75 }] },
  { id: 'playground', name: 'Playground', zone: 'park', kind: 'playground', position: { x: -20, z: -9 }, radius: 2.5, capacity: 6,
    affordances: ['play'], navNode: 'park-gate' },
  { id: 'arcade', name: 'Pixel Arcade', zone: 'arcade', kind: 'arcade', position: { x: 17.5, z: -16.5 }, radius: 2.4, capacity: 6,
    affordances: ['play', 'socialize'], navNode: 'east-2' },
  { id: 'garden', name: 'Community Garden', zone: 'garden', kind: 'garden', position: { x: -6, z: 19 }, radius: 2.6, capacity: 5,
    affordances: ['admire', 'rest', 'wander'], navNode: 'garden' },
  { id: 'portal', name: 'Raid Portal', zone: 'portal', kind: 'portal', position: { x: 0, z: -24 }, radius: 3, capacity: 30,
    affordances: ['arrive', 'admire', 'watch'], navNode: 'portal-gate' },
  // Homes (residents are assigned by homeIndex = hash(id) % HOME_COUNT)
  { id: 'home-1', name: 'Maple House', zone: 'home', kind: 'home', position: { x: -17.6, z: 3.2 }, radius: 0.8, capacity: 6,
    affordances: ['sleep', 'rest'], navNode: 'west-2', homeIndex: 0 },
  { id: 'home-2', name: 'Fern Cottage', zone: 'home', kind: 'home', position: { x: -11, z: 16.4 }, radius: 0.8, capacity: 6,
    affordances: ['sleep', 'rest'], navNode: 'street-w', homeIndex: 1 },
  { id: 'home-3', name: 'Cedar Loft', zone: 'home', kind: 'home', position: { x: 0.5, z: 16.6 }, radius: 0.8, capacity: 6,
    affordances: ['sleep', 'rest'], navNode: 'south-1', homeIndex: 2 },
  { id: 'home-4', name: 'Juniper Place', zone: 'home', kind: 'home', position: { x: 11.5, z: 16.4 }, radius: 0.8, capacity: 6,
    affordances: ['sleep', 'rest'], navNode: 'street-e', homeIndex: 3 },
  { id: 'home-5', name: 'Birch House', zone: 'home', kind: 'home', position: { x: 19.6, z: 6.6 }, radius: 0.8, capacity: 6,
    affordances: ['sleep', 'rest'], navNode: 'street-far-e', homeIndex: 4 },
];

export const HOME_COUNT = POIS.filter(p => p.kind === 'home').length;

/** Buildings rendered by the scene. Door is on the local +Z face. */
export const BUILDINGS: BuildingDef[] = [
  { id: 'b-cafe', kind: 'cafe', name: 'Sunbeam Café', position: { x: 16.5, z: -6.5 }, rotation: -PI / 2, width: 7, depth: 5.5, palette: 0, poiId: 'cafe' },
  { id: 'b-arcade', kind: 'arcade', name: 'Pixel Arcade', position: { x: 20.5, z: -19 }, rotation: -PI * 0.28, width: 5.5, depth: 4.5, palette: 1, poiId: 'arcade' },
  { id: 'b-home-1', kind: 'house', name: 'Maple House', position: { x: -21.5, z: 3.2 }, rotation: PI / 2, width: 6, depth: 5.5, palette: 2, poiId: 'home-1' },
  { id: 'b-home-2', kind: 'house', name: 'Fern Cottage', position: { x: -11, z: 20.2 }, rotation: PI, width: 5.5, depth: 5, palette: 3, poiId: 'home-2' },
  { id: 'b-home-3', kind: 'house', name: 'Cedar Loft', position: { x: 0.5, z: 20.6 }, rotation: PI, width: 6.5, depth: 5.5, palette: 4, poiId: 'home-3' },
  { id: 'b-home-4', kind: 'house', name: 'Juniper Place', position: { x: 11.5, z: 20.2 }, rotation: PI, width: 5.5, depth: 5, palette: 5, poiId: 'home-4' },
  { id: 'b-home-5', kind: 'house', name: 'Birch House', position: { x: 23.4, z: 6.6 }, rotation: -PI / 2, width: 6, depth: 5.5, palette: 6, poiId: 'home-5' },
];

/** Sidewalk segments for rendering: every nav edge is a paved path. */
export const PATH_SEGMENTS: Array<[Vec2, Vec2]> = NAV_EDGES.map(([a, b]) => {
  const na = NAV_NODES.find(n => n.id === a)!;
  const nb = NAV_NODES.find(n => n.id === b)!;
  return [{ x: na.x, z: na.z }, { x: nb.x, z: nb.z }];
});

export const SPAWN_POINT: Vec2 = { x: 0, z: -21.5 };

export function getPoi(id: string): PoiDef | undefined {
  return POIS.find(p => p.id === id);
}

export function getNavNode(id: string): NavNode | undefined {
  return NAV_NODES.find(n => n.id === id);
}

/** Nearest seat (within maxDistance) to a point, with its owning POI. */
export function findSeatNear(x: number, z: number, maxDistance = 0.6): { poi: PoiDef; seat: Seat } | null {
  let best: { poi: PoiDef; seat: Seat; d: number } | null = null;
  for (const poi of POIS) {
    for (const seat of poi.seats ?? []) {
      const d = Math.hypot(seat.x - x, seat.z - z);
      if (d <= maxDistance && (!best || d < best.d)) best = { poi, seat, d };
    }
  }
  return best ? { poi: best.poi, seat: best.seat } : null;
}

/** Shortest path over the nav graph (A*). Returns node positions including both ends. */
export function findNavPath(fromNode: string, toNode: string): Vec2[] {
  if (fromNode === toNode) {
    const n = getNavNode(fromNode);
    return n ? [{ x: n.x, z: n.z }] : [];
  }
  const adj = NAV_ADJ;
  const goal = getNavNode(toNode);
  if (!goal || !getNavNode(fromNode)) return [];
  const open = new Set<string>([fromNode]);
  const came = new Map<string, string>();
  const g = new Map<string, number>([[fromNode, 0]]);
  const f = new Map<string, number>([[fromNode, dist(getNavNode(fromNode)!, goal)]]);
  while (open.size) {
    let current = '';
    let bestF = Infinity;
    for (const id of open) { const v = f.get(id) ?? Infinity; if (v < bestF || (v === bestF && id < current)) { bestF = v; current = id; } }
    if (current === toNode) {
      const out: Vec2[] = [];
      let c: string | undefined = current;
      while (c) { const n = getNavNode(c)!; out.unshift({ x: n.x, z: n.z }); c = came.get(c); }
      return out;
    }
    open.delete(current);
    const cn = getNavNode(current)!;
    for (const nb of adj.get(current) ?? []) {
      const nn = getNavNode(nb)!;
      const tentative = (g.get(current) ?? Infinity) + dist(cn, nn);
      if (tentative < (g.get(nb) ?? Infinity)) {
        came.set(nb, current);
        g.set(nb, tentative);
        f.set(nb, tentative + dist(nn, goal));
        open.add(nb);
      }
    }
  }
  return [];
}

/** Nearest nav node to an arbitrary point. */
export function nearestNavNode(x: number, z: number): NavNode {
  let best = NAV_NODES[0]!;
  let bd = Infinity;
  for (const n of NAV_NODES) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
  return best;
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }) { return Math.hypot(a.x - b.x, a.z - b.z); }

const NAV_ADJ: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [a, b] of NAV_EDGES) {
    if (!m.has(a)) m.set(a, []);
    if (!m.has(b)) m.set(b, []);
    m.get(a)!.push(b);
    m.get(b)!.push(a);
  }
  return m;
})();
