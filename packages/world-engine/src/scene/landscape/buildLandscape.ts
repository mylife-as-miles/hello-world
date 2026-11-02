/**
 * Builds the landscape meshes (WebGL / classic three materials only):
 *  - terrain: ONE log-polar grid mesh from 34 m to 340 m. Cells grow in
 *    proportion to their radius, so the mesh is fine next to the town and
 *    coarse at the horizon — continuous LOD by distance with no T-junction
 *    cracks and a single draw call. Vertex colours carry slope/height/valley
 *    based grass · dirt · rock · alpine · snow · shore blending in the town's
 *    warm palette (identical to the town ground formula at the 36 m seam); a
 *    small onBeforeCompile patch adds per-pixel macro variation + the kit's
 *    snow/wet weather response.
 *  - lake: one flat ellipse at LAKE.level (MeshStandardMaterial, fogged, lit by
 *    the scene lights at night).
 * Everything is built once (no per-frame work).
 */
import * as THREE from 'three';
import { noise2 } from '../batch';
import type { SharedUniforms } from '../kit';
import { forestCover } from './forest';
import { buildRockPlacements } from './rocks';
import { LAKE, LANDSCAPE_FLAT_RADIUS, LANDSCAPE_INNER_RADIUS, LANDSCAPE_OUTER_RADIUS, sampleTerrain } from './terrain';
import { clamp, smoothstep } from './superTerrainNoise';

export interface BuiltLandscape {
  terrain: THREE.BufferGeometry;
  terrainMat: THREE.MeshStandardMaterial;
  lake: THREE.BufferGeometry;
  lakeMat: THREE.MeshStandardMaterial;
  /** All boulders in one instanced draw call. */
  rocks: THREE.InstancedMesh;
  dispose(): void;
}

const col = (hex: string) => new THREE.Color(hex);
// Town ground palette (src/scene/town.ts buildGround) — reproduced exactly so the seam vanishes.
const A = col('#8cc46a'), B = col('#76b05a'), C = col('#a6d27c'), D = col('#bcd07c'), F = col('#7fae78');
// Landscape palette (warm, stylized).
const FOREST_FLOOR = col('#6d9c55');
const LUSH = col('#79b45b');
const MEADOW_WARM = col('#a9c46e');
const ALPINE = col('#a8b07a');
const DIRT = col('#b89f72');
const ROCK = col('#b3a58f');
const ROCK_DARK = col('#918373');
const SNOW = col('#f3f6f8');
const SAND = col('#dcca9c');
const LAKE_BED = col('#7d9a7e');

function smooth(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

export function buildLandscape(quality: 'low' | 'high', weather: SharedUniforms | null): BuiltLandscape {
  const terrain = buildTerrainGeometry(quality);
  const terrainMat = createTerrainMaterial(weather);
  const lake = buildLakeGeometry();
  const lakeMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.9,
    emissive: '#123247', emissiveIntensity: 0.08,
  });
  lakeMat.onBeforeCompile = shader => patchLandscapeFog(shader);
  lakeMat.customProgramCacheKey = () => 'hw-landscape-lake';
  const rocks = buildRocks(quality);
  return {
    terrain, terrainMat, lake, lakeMat, rocks,
    dispose() {
      terrain.dispose(); terrainMat.dispose(); lake.dispose(); lakeMat.dispose();
      rocks.geometry.dispose(); (rocks.material as THREE.Material).dispose(); rocks.dispose();
    },
  };
}

/* -------------------------------------------------------------------- rocks */

const ROCK_TONES = [col('#b9ad9a'), col('#a49a8b'), col('#c3b7a2'), col('#9a9286')];

function buildRocks(quality: 'low' | 'high'): THREE.InstancedMesh {
  // Faceted low-poly boulder: displaced icosahedron, flat shaded (matches the town's stylised rocks).
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise2(x * 1.7 + 3.1, z * 1.7 + y * 2.3, 5);
    const k = 0.78 + n * 0.42;
    p.setXYZ(i, x * k, y * k * (y < 0 ? 0.55 : 1), z * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true });
  mat.onBeforeCompile = shader => patchLandscapeFog(shader);
  mat.customProgramCacheKey = () => 'hw-landscape-rock';
  const placements = buildRockPlacements(quality);
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, placements.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  placements.forEach((r, i) => {
    e.set((r.tone - 0.5) * 0.3, r.rot, (r.squash - 0.75) * 0.4);
    q.setFromEuler(e);
    sc.set(r.scale * (1.1 - r.squash * 0.2), r.scale * r.squash, r.scale);
    pos.set(r.x, r.y, r.z);
    mesh.setMatrixAt(i, m.compose(pos, q, sc));
    mesh.setColorAt(i, c.copy(ROCK_TONES[Math.floor(r.tone * ROCK_TONES.length) % ROCK_TONES.length]!));
  });
  mesh.count = placements.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.name = 'landscape-rocks';
  return mesh;
}

/* ------------------------------------------------------------------ terrain */

export function buildTerrainGeometry(quality: 'low' | 'high'): THREE.BufferGeometry {
  const N = quality === 'high' ? 384 : 256; // angular segments
  const k = quality === 'high' ? 1.45 : 1.6; // radial / angular cell aspect
  const dTheta = (Math.PI * 2) / N;
  const radii: number[] = [];
  for (let r = LANDSCAPE_INNER_RADIUS; ; r *= 1 + k * dTheta) {
    radii.push(Math.min(r, LANDSCAPE_OUTER_RADIUS));
    if (r >= LANDSCAPE_OUTER_RADIUS) break;
  }
  const R = radii.length;
  const count = R * N;
  const pos = new Float32Array(count * 3);
  const massifA = new Float32Array(count), valleyA = new Float32Array(count), lakeA = new Float32Array(count);
  for (let i = 0; i < R; i++) {
    const r = radii[i]!;
    // Half-cell twist on alternate rings → near-equilateral triangles, less grid look.
    const twist = (i & 1) * 0.5 * dTheta;
    for (let j = 0; j < N; j++) {
      const a = j * dTheta + twist;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = sampleTerrain(x, z);
      const v = i * N + j;
      pos[v * 3] = x; pos[v * 3 + 1] = s.height; pos[v * 3 + 2] = z;
      massifA[v] = s.massif; valleyA[v] = s.valley; lakeA[v] = s.lakeD;
    }
  }
  const index = new Uint32Array((R - 1) * N * 6);
  let o = 0;
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      const a = i * N + j, b = i * N + j1, c = (i + 1) * N + j, d = (i + 1) * N + j1;
      // Counter-clockwise seen from above (+Y): a → c → b, b → c → d.
      if (i & 1) { index[o++] = a; index[o++] = c; index[o++] = d; index[o++] = a; index[o++] = d; index[o++] = b; }
      else { index[o++] = a; index[o++] = c; index[o++] = b; index[o++] = b; index[o++] = c; index[o++] = d; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  // Make sure the normals face up (winding sanity).
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  if (nrm.getY(0) < 0) {
    for (let t = 0; t < index.length; t += 3) { const tmp = index[t + 1]!; index[t + 1] = index[t + 2]!; index[t + 2] = tmp; }
    g.index!.needsUpdate = true;
    g.computeVertexNormals();
  }

  // Vertex colours.
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3]!, h = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    const r = Math.hypot(x, z);
    const ny = nrm.getY(v);
    // 1. Town ground formula (exact) — continuous across the seam.
    const n1 = noise2(x * 0.06, z * 0.06, 3), n2 = noise2(x * 0.21, z * 0.21, 7);
    c.copy(A).lerp(B, n1).lerp(C, Math.max(0, n2 - 0.45) * 1.2);
    if (n1 > 0.7) c.lerp(D, (n1 - 0.7) * 1.5);
    c.lerp(F, smooth(46, 120, r) * 0.5);
    // 2. Landscape layers, faded in just outside the seam.
    const w = smoothstep(LANDSCAPE_FLAT_RADIUS + 1, LANDSCAPE_FLAT_RADIUS + 16, r);
    if (w <= 0) { colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b; continue; }
    const slope = 1 - ny; // 0 flat … ~0.3 at 45°
    const massif = massifA[v]!, valley = valleyA[v]!, lakeD = lakeA[v]!;
    const alpine = smoothstep(24, 50, h);
    // warm sunlit meadow patches on open low ground
    const warm = clamp(noise2(x * 0.018, z * 0.018, 41) * 1.6 - 0.7, 0, 1) * (1 - alpine);
    c.lerp(MEADOW_WARM, warm * 0.45 * w);
    // forest floor where the stand field is thick (matches FOREST placements)
    const fc = clamp(forestCover(x, z), 0, 1);
    c.lerp(FOREST_FLOOR, smoothstep(0.35, 0.9, fc) * 0.4 * w * (1 - alpine));
    c.lerp(LUSH, valley * 0.45 * w);
    c.lerp(ALPINE, alpine * 0.6 * w);
    // slope: dirt on banks, rock on faces (strata-like banding by height)
    const dirt = smoothstep(0.1, 0.2, slope) * (1 - smoothstep(0.26, 0.36, slope));
    c.lerp(DIRT, dirt * 0.45 * w);
    const rockAmt = clamp(smoothstep(0.22, 0.38, slope) + smoothstep(50, 76, h) * 0.5 * massif, 0, 1);
    if (rockAmt > 0) {
      const band = Math.sin(h * 0.85 + noise2(x * 0.05, z * 0.05, 9) * 3) * 0.5 + 0.5;
      tmp.copy(ROCK).lerp(ROCK_DARK, band * 0.55);
      c.lerp(tmp, rockAmt * w);
    }
    // snow caps on the highest gentle ground
    const snow = smoothstep(74, 86, h) * smoothstep(0.62, 0.82, ny);
    if (snow > 0) c.lerp(SNOW, snow * 0.92);
    // lake shore sand + submerged bed
    if (lakeD < 2) {
      const dh = h - LAKE.level;
      const sand = (1 - smoothstep(0.15, 0.6, dh)) * (1 - smoothstep(1.5, 2, lakeD));
      c.lerp(SAND, sand * 0.85);
      if (dh < -0.3) c.lerp(LAKE_BED, smoothstep(-0.3, -1.4, dh) * 0.6);
    }
    colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}

/* ------------------------------------------------------------------ material */

export function createTerrainMaterial(weather: SharedUniforms | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0, // = kit.ground (town ground) for an invisible seam
    // Coplanar overlap with the flat town ground (34–36 m, y = 0): the landscape wins.
    // Constant units only (no slope factor) so draped district streets never lose to it.
    polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2,
  });
  const uSnow = weather?.uSnow ?? { value: 0 };
  const uWet = weather?.uWet ?? { value: 0 };
  mat.onBeforeCompile = shader => {
    shader.uniforms.uSnow = uSnow;
    shader.uniforms.uWet = uWet;
    shader.uniforms.uLsFlat = { value: LANDSCAPE_FLAT_RADIUS };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLsWorld;\nvarying float vUpW;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
  vUpW = normalize(mat3(modelMatrix) * objectNormal).y;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  vLsWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLsWorld;
varying float vUpW;
uniform float uSnow;
uniform float uWet;
uniform float uLsFlat;
float lsHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lsNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lsHash(i), lsHash(i + vec2(1.0, 0.0)), u.x), mix(lsHash(i + vec2(0.0, 1.0)), lsHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float lsR = length(vLsWorld.xz);
    float lsIn = smoothstep(uLsFlat + 1.0, uLsFlat + 10.0, lsR);
    float lsN = lsNoise(vLsWorld.xz * 0.13) * 0.6 + lsNoise(vLsWorld.xz * 0.47 + 17.0) * 0.4;
    diffuseColor.rgb *= mix(1.0, 0.88 + 0.24 * lsN, lsIn);
    float lsSnow = clamp(uSnow, 0.0, 1.0) * smoothstep(0.3, 0.85, vUpW);
    diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.3 * uWet), vec3(0.92, 0.95, 1.0), lsSnow);
  }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.32, uWet * smoothstep(0.5, 0.9, vUpW) * (1.0 - uSnow));`);
  };
  const weatherAndDetail = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => { weatherAndDetail(shader, renderer); patchLandscapeFog(shader); };
  mat.customProgramCacheKey = () => 'hw-landscape-terrain';
  return mat;
}

/**
 * Aerial perspective for the far range: the scene's linear fog (≈ 70 → 230 m)
 * would swallow everything past ~200 m, so the landscape stretches its fog
 * ramp and caps it, leaving the far ridges as hazy silhouettes that close the
 * horizon. Near the town (< 100 m) the difference is negligible, so the seam
 * with the town ground stays invisible.
 */
const FOG_STRETCH = 1.65;
const FOG_MAX = 0.86;
export function patchLandscapeFog(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogNear + ( fogFar - fogNear ) * ${FOG_STRETCH.toFixed(2)}, vFogDepth );
  #endif
  // Cap the haze for the ridges, but let the very edge of the world dissolve fully.
  float lsFogCap = mix( ${FOG_MAX.toFixed(2)}, 1.0, smoothstep( 250.0, 345.0, vFogDepth ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( fogFactor, lsFogCap ) );
#endif`);
}

/* --------------------------------------------------------------------- lake */

const LAKE_DEEP = col('#2c78a0');
const LAKE_SHALLOW = col('#76c3d3');

function buildLakeGeometry(): THREE.BufferGeometry {
  // Unit disc (with radial rings for a deep → shallow colour gradient) scaled to the
  // ellipse, slightly larger than the shoreline — the shore terrain hides the rim.
  const g = new THREE.RingGeometry(0, 1, 72, 6);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const c = Math.cos(LAKE.rot), s = Math.sin(LAKE.rot);
  const k = new THREE.Color();
  const EXT = 1.32;
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), vz = p.getZ(i);
    const d = Math.hypot(ux, vz) * EXT; // ≈ lakeDistance (before the rim noise)
    k.copy(LAKE_DEEP).lerp(LAKE_SHALLOW, smoothstep(0.35, 1.0, d));
    colors[i * 3] = k.r; colors[i * 3 + 1] = k.g; colors[i * 3 + 2] = k.b;
    const u = ux * LAKE.rx * EXT, v = vz * LAKE.rz * EXT;
    // inverse of lakeDistance's rotation
    p.setXYZ(i, LAKE.x + u * c + v * s, 0, LAKE.z - u * s + v * c);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
