/** Landscape: terrain ring, valley lake and forest placements around the neighborhood. */
export { Landscape, type LandscapeProps } from './Landscape';
export {
  terrainHeightAt, terrainSlopeAt, sampleTerrain, isLakeWater, lakeDistance,
  LAKE, LANDSCAPE_FLAT_RADIUS, LANDSCAPE_BLEND_WIDTH, LANDSCAPE_INNER_RADIUS, LANDSCAPE_OUTER_RADIUS,
  type TerrainSample,
} from './terrain';
export {
  buildForestPlacements, getForestPlacements, forestCover, FOREST_VARIANTS,
  type ForestPlacement, type ForestOptions, type ForestVariantName,
} from './forest';
export { buildRockPlacements, type RockPlacement } from './rocks';
import { getForestPlacements } from './forest';

/** Default forest (high quality) on gentle slopes outside 38.5 m, y = terrainHeightAt. Generated once at import. */
export const FOREST_PLACEMENTS = getForestPlacements('high');
/** Deterministic subset for quality 'low' (all stems < 70 m, every other stem beyond). */
export const FOREST_PLACEMENTS_LOW = getForestPlacements('low');
