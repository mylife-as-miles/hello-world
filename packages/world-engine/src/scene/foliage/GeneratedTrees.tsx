/**
 * GeneratedTrees — instanced WebGL trees baked offline with super-terrain's procedural
 * tree generator (MIT, © 2026 alightinastorm; see ./assets/CREDITS.md).
 *
 * Assets (./assets): one compact GLB per variant (`wood` + merged `leaves` cards, metres,
 * ground at y=0) and one shared 512² leaf atlas (3 spray tiles per variant, 128² each)
 * rasterised by super-terrain's leaf-spray baker, recoloured onto a soft pastel ramp.
 *
 * Rendering (WebGL, MeshStandardMaterial):
 *  - three distance bands, each one InstancedMesh per variant × material (≤ 5 draws/variant):
 *    near  (high only, < min(45 m, 0.6·far)): full leaf-card crown + trunk shadows;
 *    mid   (< farDistance; default 80 m high / 30 m low): 60 % of the cards, enlarged;
 *    far   impostors (2 crossed side cards + 1 canopy card, 6 tris) rendered once at runtime
 *          from the same meshes.
 *    Alpha-tested leaf cards, tiny onBeforeCompile wind sway, mip-aware alpha.
 *  - soft blob contact shadow under every tree (1 draw call) so crowns sit on the ground.
 * React never re-renders per frame; LOD partitions are recomputed in useFrame only when the
 * camera moved. Everything created here is disposed on unmount.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KitContext } from '../context';

export type TreeQuality = 'low' | 'high';
/** `variant` indexes TREE_VARIANTS (wrapped); `rot` is yaw in radians; `y` (ground height) defaults to 0. */
export interface TreePlacement { x: number; z: number; y?: number; scale: number; rot: number; variant: number }
export interface GeneratedTreesProps {
  quality: TreeQuality;
  placements: ReadonlyArray<TreePlacement>;
  /**
   * Camera distance (m) beyond which trees become impostor cards. Default 80 (high) / 30 (low).
   * On 'high', trees within min(45, 0.6 × farDistance) get the full crown + trunk shadows; the
   * band in between (and everything up to farDistance on 'low') uses a sparse crown.
   */
  farDistance?: number;
  /** Soft blob contact shadows under the crowns. Default true. */
  blobShadows?: boolean;
  /**
   * Budget of non-impostor trees per frame (nearest win). Default 70 (high) / 24 (low); full
   * crowns are further capped at 16 on 'high'. Bounds worst-case triangles for big forests.
   * Blob shadows are drawn within 140 m (high) / 45 m (low) of the camera.
   */
  maxDetailed?: number;
}

/** Variant order = asset order (placement `variant` index). Town kinds: round→broadleaf, pine→conifer. */
export const TREE_VARIANTS = ['broadleaf', 'conifer', 'birch', 'blossom', 'autumn'] as const;
export type TreeVariantName = (typeof TREE_VARIANTS)[number];
/** Placement `variant` index for a variant name. */
export const TREE_VARIANT_INDEX: Record<TreeVariantName, number> = { broadleaf: 0, conifer: 1, birch: 2, blossom: 3, autumn: 4 };
/** Approximate crown-top height in metres at scale 1 (trunk base at y = 0). */
export const TREE_VARIANT_HEIGHT: Record<TreeVariantName, number> = { broadleaf: 7.0, conifer: 7.0, birch: 7.5, blossom: 6.4, autumn: 6.5 };

const GLB_URLS: string[] = [
  new URL('./assets/tree-broadleaf.glb', import.meta.url).href,
  new URL('./assets/tree-conifer.glb', import.meta.url).href,
  new URL('./assets/tree-birch.glb', import.meta.url).href,
  new URL('./assets/tree-blossom.glb', import.meta.url).href,
  new URL('./assets/tree-autumn.glb', import.meta.url).href,
];
const ATLAS_URL = new URL('./assets/leaf-atlas.png', import.meta.url).href;

/** Per-variant bark tint (multiplies the generator's vertex colours) and leaf tint. */
const BARK_TINT = ['#b39a86', '#9a8070', '#f2eee6', '#a88a7a', '#a08470'];
const LEAF_TINT = ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'];
const BLOB_RADIUS = [2.6, 2.1, 2.4, 2.7, 2.5];
/** Impostor tile background (alpha 0): mips blend toward the crown colour, never a foreign hue. */
const IMPOSTOR_BG = ['#7fb04f', '#4f8a5a', '#9cc760', '#f0a8c4', '#f0a050'];

interface VariantGeometry {
  wood: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  /** ~60 % of the leaf cards, each enlarged ×1.22 (mid-distance LOD / quality 'low'). */
  sparse: THREE.BufferGeometry;
  box: THREE.Box3;
}
interface TreeAssets { variants: VariantGeometry[]; atlas: THREE.Texture }

let assetsPromise: Promise<TreeAssets> | null = null;
let assetsValue: TreeAssets | null = null;

function loadTreeAssets(): Promise<TreeAssets> {
  assetsPromise ??= (async () => {
    const loader = new GLTFLoader();
    const atlasPromise = new THREE.TextureLoader().loadAsync(ATLAS_URL);
    const variants = await Promise.all(GLB_URLS.map(async (url) => {
      const gltf = await loader.loadAsync(url);
      let wood: THREE.BufferGeometry | null = null;
      let leaves: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.name.startsWith('wood')) wood = mesh.geometry;
        else if (mesh.name.startsWith('leaves')) leaves = mesh.geometry;
      });
      if (!wood || !leaves) throw new Error(`tree asset ${url} is missing wood/leaves meshes`);
      const w = wood as THREE.BufferGeometry, l = leaves as THREE.BufferGeometry;
      w.computeBoundingBox(); l.computeBoundingBox();
      const box = w.boundingBox!.clone().union(l.boundingBox!);
      return { wood: w, leaves: l, sparse: makeSparseLeaves(l, 0.6, 1.22), box };
    }));
    const atlas = await atlasPromise;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.needsUpdate = true;
    assetsValue = { variants, atlas };
    return assetsValue;
  })().catch((error: unknown) => {
    assetsPromise = null; // allow a later mount to retry
    throw error;
  });
  return assetsPromise;
}

/**
 * Keeps `keep` of the 4-vertex leaf cards (evenly spread) and grows each kept card about its
 * base edge so the crown silhouette survives with far fewer triangles.
 */
function makeSparseLeaves(leaves: THREE.BufferGeometry, keep: number, grow: number): THREE.BufferGeometry {
  const pos = leaves.getAttribute('position') as THREE.BufferAttribute;
  const cards = Math.floor(pos.count / 4);
  const names = ['position', 'normal', 'uv', 'color'] as const;
  const src = names.map((n) => leaves.getAttribute(n) as THREE.BufferAttribute | undefined);
  const kept: number[] = [];
  for (let c = 0; c < cards; c++) if (Math.floor((c + 1) * keep) > Math.floor(c * keep)) kept.push(c);
  const out = new THREE.BufferGeometry();
  names.forEach((name, k) => {
    const a = src[k];
    if (!a) return;
    const size = a.itemSize;
    const data = new Float32Array(kept.length * 4 * size);
    kept.forEach((c, j) => {
      for (let v = 0; v < 4; v++) for (let e = 0; e < size; e++) data[(j * 4 + v) * size + e] = a.getComponent(c * 4 + v, e);
    });
    if (name === 'position') {
      for (let j = 0; j < kept.length; j++) {
        // card corners: 0,1 = base edge, 2,3 = tip edge (see tools/bake-trees.cts)
        const b = j * 12;
        const bx = (data[b]! + data[b + 3]!) / 2, by = (data[b + 1]! + data[b + 4]!) / 2, bz = (data[b + 2]! + data[b + 5]!) / 2;
        for (let v = 0; v < 4; v++) {
          const o = b + v * 3;
          data[o] = bx + (data[o]! - bx) * grow; data[o + 1] = by + (data[o + 1]! - by) * grow; data[o + 2] = bz + (data[o + 2]! - bz) * grow;
        }
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  });
  const index: number[] = [];
  for (let j = 0; j < kept.length; j++) index.push(j * 4, j * 4 + 1, j * 4 + 2, j * 4, j * 4 + 2, j * 4 + 3);
  out.setIndex(index);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Shader tweaks via onBeforeCompile:
 *  - wind: sway grows with height² so trunks stay planted; phase varies per instance position.
 *  - mipAlpha: scales cutout alpha with the sampled mip level (keeps distant crowns dense).
 *  - skyLift: multiplies the indirect (sky/ambient) diffuse — light-dependent, unlike emissive.
 *  - keepNormals: double-sided cards keep their authored (outward / upward) normal on the back
 *    face instead of flipping it, so crowns and impostors shade softly from every side.
 */
interface WeatherUniforms { uSnow: { value: number }; uWet: { value: number } }
function patchTreeMaterial(material: THREE.Material, key: string, opts: { time?: { value: number }; wind?: number; keepNormals?: boolean; skyLift?: number; mipAlpha?: number; weather?: WeatherUniforms; snowScale?: number }) {
  material.onBeforeCompile = (shader) => {
    if (opts.weather) {
      // same look as the town's patchWeather (kit.ts): snow settles on up-facing parts, rain darkens + adds sheen
      shader.uniforms.uSnow = opts.weather.uSnow;
      shader.uniforms.uWet = opts.weather.uWet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vTreeUpW;')
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vec3 tUpN = objectNormal;
        #ifdef USE_INSTANCING
          tUpN = mat3(instanceMatrix) * tUpN;
        #endif
        vTreeUpW = normalize(mat3(modelMatrix) * tUpN).y;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTreeUpW;\nuniform float uSnow;\nuniform float uWet;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        float tSnow = clamp(uSnow * ${(opts.snowScale ?? 1).toFixed(2)}, 0.0, 1.0) * smoothstep(0.1, 0.75, vTreeUpW);
        diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.3 * uWet), vec3(0.92, 0.95, 1.0), tSnow);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, uWet * (1.0 - uSnow));`);
    }
    if (opts.time && opts.wind) {
      shader.uniforms.uTreeWind = opts.time;
      shader.vertexShader = 'uniform float uTreeWind;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 tOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 tOrigin = vec2(0.0);
        #endif
        float tH = max(position.y, 0.0);
        float tPh = uTreeWind * 1.2 + dot(tOrigin, vec2(0.37, 0.23));
        float tBend = ${opts.wind.toFixed(4)} * tH * tH;
        transformed.x += (sin(tPh) + 0.35 * sin(tPh * 2.7 + position.z * 1.7)) * tBend;
        transformed.z += (0.7 * cos(tPh * 0.83) + 0.3 * sin(tPh * 3.1 + position.x * 1.9)) * tBend;`,
      );
    }
    if (opts.mipAlpha) {
      // cutout coverage drops in small mips (thin needles vanish at distance); scale alpha
      // up with the sampled mip level so crowns keep their density far away
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
        {
          vec2 tSize = vec2(textureSize(map, 0));
          vec2 tDx = dFdx(vMapUv * tSize), tDy = dFdy(vMapUv * tSize);
          float tMip = max(0.0, 0.5 * log2(max(dot(tDx, tDx), dot(tDy, tDy))));
          diffuseColor.a *= 1.0 + tMip * ${opts.mipAlpha.toFixed(3)};
        }
        #endif`,
      );
    }
    if (opts.skyLift) {
      // brighter sky/ambient response = soft "translucent" crowns that still darken at night
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= ${opts.skyLift.toFixed(3)};`,
      );
    }
    if (opts.keepNormals) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        #if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
          normal = normalize( vNormal );
        #endif`,
      );
    }
  };
  material.customProgramCacheKey = () => `${key}${opts.weather ? '-weather' : ''}`;
}

// ---------------------------------------------------------------- impostors
const TILE = 256; // per view; atlas = (TILE × variants) × (TILE × 2): row 0 side view, row 1 top view

interface Impostors { target: THREE.WebGLRenderTarget; cards: THREE.BufferGeometry[]; dispose(): void }

/**
 * Renders each variant's unlit albedo into one atlas — a side view (for two crossed vertical
 * cards) and a top view (for one horizontal canopy card, so elevated cameras still see a full
 * crown) — and builds the matching 3-quad card geometry per variant.
 */
function bakeImpostors(gl: THREE.WebGLRenderer, assets: TreeAssets): Impostors {
  const n = assets.variants.length;
  const options = { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter };
  const target = isWebGPU(gl)
    ? (new THREE.RenderTarget(TILE * n, TILE * 2, options) as THREE.WebGLRenderTarget)
    : new THREE.WebGLRenderTarget(TILE * n, TILE * 2, options);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, 0, 0.1, 200);
  const temp: THREE.Material[] = [];
  const cards: THREE.BufferGeometry[] = [];
  const prevTarget = gl.getRenderTarget();
  const prevColor = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  const prevAutoClear = gl.autoClear;
  gl.autoClear = false;
  gl.setRenderTarget(target);
  gl.setClearColor('#5b8f45', 0);
  gl.clear(true, true, true);
  const renderTile = (col: number, row: number) => {
    target.viewport.set(col * TILE, row * TILE, TILE, TILE);
    target.scissor.set(col * TILE, row * TILE, TILE, TILE);
    target.scissorTest = true;
    gl.setRenderTarget(target);
    gl.setClearColor(IMPOSTOR_BG[col] ?? '#7fb04f', 0);
    gl.clear(true, true, true);
    gl.render(scene, camera);
  };
  assets.variants.forEach((v, i) => {
    const halfW = Math.max(-v.box.min.x, v.box.max.x, -v.box.min.z, v.box.max.z) * 1.04;
    const top = v.box.max.y * 1.03, bottom = -0.02 * v.box.max.y;
    const bark = new THREE.MeshBasicMaterial({ vertexColors: true, color: BARK_TINT[i] });
    const leaf = new THREE.MeshBasicMaterial({ map: assets.atlas, vertexColors: true, color: LEAF_TINT[i], alphaTest: 0.42, side: THREE.DoubleSide });
    temp.push(bark, leaf);
    scene.clear();
    scene.add(new THREE.Mesh(v.wood, bark), new THREE.Mesh(v.leaves, leaf));
    // side view (row 0): camera on +z looking at -z
    camera.left = -halfW; camera.right = halfW; camera.top = top; camera.bottom = bottom;
    camera.up.set(0, 1, 0); camera.position.set(0, 0, 100); camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderTile(i, 0);
    // top view (row 1): camera above looking down, screen-up = -z
    camera.left = -halfW; camera.right = halfW; camera.top = halfW; camera.bottom = -halfW;
    camera.up.set(0, 0, -1); camera.position.set(0, 100, 0); camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderTile(i, 1);

    const u0 = i / n, du = 1 / n;
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    const quad = (verts: Array<[number, number, number, number, number]>, normal: [number, number, number]) => {
      const base = pos.length / 3;
      for (const [x, y, z, uu, vv] of verts) { pos.push(x, y, z); nor.push(...normal); uv.push(uu, vv); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // two crossed vertical cards; normals lean up for soft, even light (back faces keep them)
    const lean = (x: number, z: number): [number, number, number] => { const l = Math.hypot(x * 0.45, 0.85, z * 0.45); return [(x * 0.45) / l, 0.85 / l, (z * 0.45) / l]; };
    quad([[-halfW, bottom, 0, u0, 0], [halfW, bottom, 0, u0 + du, 0], [halfW, top, 0, u0 + du, 0.5], [-halfW, top, 0, u0, 0.5]], lean(0, 1));
    quad([[0, bottom, halfW, u0, 0], [0, bottom, -halfW, u0 + du, 0], [0, top, -halfW, u0 + du, 0.5], [0, top, halfW, u0, 0.5]], lean(1, 0));
    // horizontal canopy card at crown height; invisible edge-on, fills the crown from above
    const cy = v.leaves.boundingBox ? v.leaves.boundingBox.min.y * 0.35 + v.leaves.boundingBox.max.y * 0.65 : top * 0.7;
    quad([[-halfW, cy, halfW, u0, 0.5], [halfW, cy, halfW, u0 + du, 0.5], [halfW, cy, -halfW, u0 + du, 1], [-halfW, cy, -halfW, u0, 1]], [0, 1, 0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    cards.push(g);
  });
  target.scissorTest = false;
  target.viewport.set(0, 0, TILE * n, TILE * 2);
  target.scissor.set(0, 0, TILE * n, TILE * 2);
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevColor, prevAlpha);
  gl.autoClear = prevAutoClear;
  scene.clear();
  for (const m of temp) m.dispose();
  return { target, cards, dispose() { target.dispose(); for (const c of cards) c.dispose(); } };
}

function isWebGPU(gl: unknown): boolean {
  return (gl as { isWebGPURenderer?: boolean }).isWebGPURenderer === true;
}

/**
 * One impostor atlas per renderer, shared by every mounted <GeneratedTrees> (the atlas always
 * holds the full variant set) and released when the last one unmounts. `null` = baking is not
 * possible on this renderer; trees then stay on sparse crowns instead of impostors.
 */
const impostorCache = new Map<object, { impostors: Impostors | null; refs: number }>();
function acquireImpostors(gl: THREE.WebGLRenderer, assets: TreeAssets): Impostors | null {
  let entry = impostorCache.get(gl);
  if (!entry) {
    let impostors: Impostors | null = null;
    if (isWebGPU(gl)) {
      // the tile bake relies on render-target viewport/scissor semantics only verified on WebGL;
      // on the opt-in WebGPU path far trees stay on sparse crowns (correct, just more triangles)
      console.info('[GeneratedTrees] WebGPU renderer: impostors disabled, far trees use sparse crowns');
    } else {
      try { impostors = bakeImpostors(gl, assets); } catch (error) {
        console.info('[GeneratedTrees] impostor bake unavailable on this renderer; far trees use sparse crowns', error);
      }
    }
    entry = { impostors, refs: 0 };
    impostorCache.set(gl, entry);
  }
  entry.refs++;
  return entry.impostors;
}
function releaseImpostors(gl: THREE.WebGLRenderer): void {
  const entry = impostorCache.get(gl);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) { entry.impostors?.dispose(); impostorCache.delete(gl); }
}

/** How leaf/impostor cutouts are resolved. */
type AlphaMode = 'coverage' | 'hash' | 'test';
/** MSAA → alpha-to-coverage (smooth cutout edges); no MSAA → hashed alpha; WebGPU → plain alpha test. */
function pickAlphaMode(gl: THREE.WebGLRenderer): AlphaMode {
  if (isWebGPU(gl)) return 'test';
  try {
    const attributes = gl.getContext().getContextAttributes();
    return attributes?.antialias ? 'coverage' : 'hash';
  } catch { return 'test'; }
}
function alphaParams(mode: AlphaMode, cutoff: number): THREE.MeshStandardMaterialParameters {
  if (mode === 'coverage') return { alphaTest: cutoff, alphaToCoverage: true };
  // hashed alpha keeps edges dithered instead of stair-stepped; opacity > 1 = slightly lower cutoff
  if (mode === 'hash') return { alphaHash: true, alphaTest: 0, opacity: 1.15 };
  return { alphaTest: cutoff };
}

// ---------------------------------------------------------------- blob shadow texture
function makeBlobTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, 1.6);
    const o = (y * size + x) * 4;
    const g = Math.round(a * 255); // alphaMap samples the green channel
    data[o] = g; data[o + 1] = g; data[o + 2] = g; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- forest build
/** LOD band per tree: 0 = near (full crown, trunk shadows on high), 1 = mid (sparse crown), 2 = impostor. */
type Band = 0 | 1 | 2;
interface VariantBatch {
  matrices: Float32Array; // 16 per tree, in placement order
  colors: Float32Array; // 3 per tree
  positions: Float32Array; // 3 per tree (LOD distance)
  band: Uint8Array; // current band per tree
  prev: Uint8Array; // band before this update (change detection)
  meshes: [trunksNear: THREE.InstancedMesh, crownsNear: THREE.InstancedMesh, trunksMid: THREE.InstancedMesh, crownsMid: THREE.InstancedMesh, cards: THREE.InstancedMesh | null];
}
/**
 * Tree counts per band plus what the forest submits this frame (upper bound before frustum
 * culling): draw calls / triangles of the main pass, and of the shadow pass (near trunks, high).
 */
interface LodStats { near: number; mid: number; far: number; calls: number; tris: number; shadowCalls: number; shadowTris: number }
const trianglesOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
interface BuiltForest {
  group: THREE.Group;
  wind: { value: number };
  /**
   * Re-partitions trees by camera distance, then enforces budgets: at most `maxNear` full
   * crowns and `maxDetailed` non-impostor trees (nearest win); blob shadows only within
   * `blobDistance`. Returns per-band counts.
   */
  updateLod(camera: THREE.Vector3, nearDistance: number, farDistance: number, maxNear: number, maxDetailed: number, blobDistance: number, force: boolean): LodStats;
  dispose(): void;
}

function buildForest(
  assets: TreeAssets, impostors: Impostors | null, placements: ReadonlyArray<TreePlacement>, quality: TreeQuality,
  blobShadows: boolean, alphaMode: AlphaMode, weather: WeatherUniforms,
): BuiltForest {
  const group = new THREE.Group();
  group.name = 'generated-trees';
  const wind = { value: 0 };
  const disposables: Array<{ dispose(): void }> = [];
  const n = assets.variants.length;
  const byVariant: TreePlacement[][] = assets.variants.map(() => []);
  for (const p of placements) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    byVariant[(((Math.round(p.variant) || 0) % n) + n) % n]!.push(p);
  }

  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  let farMaterial: THREE.MeshStandardMaterial | null = null;
  if (impostors) {
    farMaterial = new THREE.MeshStandardMaterial({
      map: impostors.target.texture, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, ...alphaParams(alphaMode, 0.5),
    });
    patchTreeMaterial(farMaterial, 'tree-impostor', { keepNormals: true, skyLift: 1.5, mipAlpha: 0.2, weather, snowScale: 0.8 });
    disposables.push(farMaterial);
  }

  const batches: VariantBatch[] = [];
  byVariant.forEach((list, v) => {
    if (list.length === 0) return;
    const geo = assets.variants[v]!;
    const bark = new THREE.MeshStandardMaterial({ vertexColors: true, color: BARK_TINT[v], roughness: 0.92, metalness: 0 });
    const leaf = new THREE.MeshStandardMaterial({
      map: assets.atlas, vertexColors: true, color: LEAF_TINT[v], side: THREE.DoubleSide,
      roughness: 0.8, metalness: 0, ...alphaParams(alphaMode, 0.42),
    });
    patchTreeMaterial(bark, 'tree-bark', { time: wind, wind: 0.0012, weather, snowScale: 0.5 });
    patchTreeMaterial(leaf, 'tree-leaf', { time: wind, wind: 0.0034, keepNormals: true, skyLift: 1.55, mipAlpha: 0.25, weather, snowScale: 0.85 });
    disposables.push(bark, leaf);

    const count = list.length;
    const matrices = new Float32Array(count * 16);
    const colors = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    const meshes: VariantBatch['meshes'] = [
      new THREE.InstancedMesh(geo.wood, bark, count),
      new THREE.InstancedMesh(geo.leaves, leaf, count),
      new THREE.InstancedMesh(geo.wood, bark, count),
      new THREE.InstancedMesh(geo.sparse, leaf, count),
      impostors && farMaterial ? new THREE.InstancedMesh(impostors.cards[v]!, farMaterial, count) : null,
    ];
    const label = TREE_VARIANTS[v] ?? `v${v}`;
    ['wood-near', 'leaves-near', 'wood-mid', 'leaves-mid', 'impostor'].forEach((suffix, k) => { const m = meshes[k]; if (m) m.name = `tree-${label}-${suffix}`; });
    const live = meshes.filter((m): m is THREE.InstancedMesh => m !== null);
    list.forEach((p, i) => {
      const k = p.scale > 0 ? p.scale : 1;
      pos.set(p.x, (p.y ?? 0) - 0.06 * k, p.z); // sink a little so root flares never float on slopes
      quat.setFromAxisAngle(up, p.rot || 0);
      scl.setScalar(k);
      matrix.compose(pos, quat, scl);
      matrix.toArray(matrices, i * 16);
      positions[i * 3] = p.x; positions[i * 3 + 1] = (p.y ?? 0) + 3 * k; positions[i * 3 + 2] = p.z;
      // gentle per-tree value/hue jitter so a stand never looks copy-pasted
      const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      tint.setRGB(1, 1, 1).offsetHSL((r - 0.5) * 0.04, 0, (r - 0.5) * 0.14);
      tint.toArray(colors, i * 3);
      // full set once so bounding spheres cover every tree (stays conservative for subsets)
      for (const m of live) { m.setMatrixAt(i, matrix); m.setColorAt(i, tint); }
    });
    for (const m of live) {
      m.computeBoundingSphere();
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = false; m.receiveShadow = false;
      m.count = 0;
    }
    meshes[0].castShadow = quality === 'high';
    meshes[0].receiveShadow = quality === 'high';
    group.add(...live);
    disposables.push(...live);
    batches.push({ matrices, colors, positions, band: new Uint8Array(count).fill(255), prev: new Uint8Array(count), meshes });
  });

  // blob contact shadows: one instanced mesh, compacted to the trees within blobDistance
  let blobs: THREE.InstancedMesh | null = null;
  let blobMatrices = new Float32Array(0);
  let blobPositions = new Float32Array(0);
  let blobOn = new Uint8Array(0);
  if (blobShadows) {
    const all = byVariant.flatMap((list, v) => list.map((p) => ({ p, v })));
    if (all.length > 0) {
      const tex = makeBlobTexture();
      const mat = new THREE.MeshBasicMaterial({ color: '#2f4a2a', alphaMap: tex, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const plane = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
      blobs = new THREE.InstancedMesh(plane, mat, all.length);
      blobs.name = 'tree-blob-shadows';
      blobMatrices = new Float32Array(all.length * 16);
      blobPositions = new Float32Array(all.length * 3);
      blobOn = new Uint8Array(all.length).fill(255);
      all.forEach(({ p, v }, i) => {
        const s = (p.scale > 0 ? p.scale : 1) * BLOB_RADIUS[v]!;
        pos.set(p.x, (p.y ?? 0) + 0.04, p.z);
        quat.identity();
        scl.set(s, 1, s * 0.9);
        matrix.compose(pos, quat, scl);
        matrix.toArray(blobMatrices, i * 16);
        blobs!.setMatrixAt(i, matrix);
        blobPositions[i * 3] = p.x; blobPositions[i * 3 + 1] = p.y ?? 0; blobPositions[i * 3 + 2] = p.z;
      });
      blobs.computeBoundingSphere();
      blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      blobs.renderOrder = -1;
      group.add(blobs);
      disposables.push(tex, mat, plane, blobs);
    }
  }

  const HYST = 4; // metres of hysteresis so trees on a band edge do not flicker
  const hasImpostors = impostors !== null;
  return {
    group, wind,
    updateLod(camera, nearDistance, farDistance, maxNear, maxDetailed, blobDistance, force) {
      const stats: LodStats = { near: 0, mid: 0, far: 0, calls: 0, tris: 0, shadowCalls: 0, shadowTris: 0 };
      // without impostors (renderer could not bake them) everything past the near band stays sparse
      const farD = hasImpostors ? farDistance : Infinity;
      const budget = hasImpostors ? maxDetailed : Infinity;
      const detailed: number[] = []; // flat [distance, batch, index] triples of non-impostor trees
      let nearCount = 0;
      batches.forEach((b, bi) => {
        b.prev.set(b.band);
        const count = b.band.length;
        for (let i = 0; i < count; i++) {
          const dx = b.positions[i * 3]! - camera.x, dy = b.positions[i * 3 + 1]! - camera.y, dz = b.positions[i * 3 + 2]! - camera.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const prev = b.band[i]!;
          const strict: Band = d < nearDistance ? 0 : d < farD ? 1 : 2;
          let next: Band = strict;
          if (!force && prev !== 255 && prev !== strict) {
            // only leave the current band once clearly past its edge
            const edgeLow = prev === 0 ? -Infinity : prev === 1 ? nearDistance : farD;
            const edgeHigh = prev === 0 ? nearDistance : prev === 1 ? farD : Infinity;
            if (d > edgeLow - HYST && d < edgeHigh + HYST) next = prev as Band;
          }
          b.band[i] = next;
          if (next < 2) { detailed.push(d, bi, i); if (next === 0) nearCount++; }
        }
      });
      // budgets: keep the nearest trees detailed, demote the rest (full → sparse → impostor)
      const detailedCount = detailed.length / 3;
      if (detailedCount > budget || nearCount > maxNear) {
        const order = Array.from({ length: detailedCount }, (_, k) => k).sort((x, y) => detailed[x * 3]! - detailed[y * 3]!);
        let keptNear = 0;
        order.forEach((k, rank) => {
          const b = batches[detailed[k * 3 + 1]!]!, i = detailed[k * 3 + 2]!;
          if (rank >= budget) { b.band[i] = 2; return; }
          if (b.band[i] === 0) { if (keptNear < maxNear) keptNear++; else b.band[i] = 1; }
        });
      }
      for (const b of batches) {
        const count = b.band.length;
        let changed = force;
        for (let i = 0; i < count && !changed; i++) if (b.band[i] !== b.prev[i]) changed = true;
        if (changed) {
          const cursor = [0, 0, 0, 0, 0];
          const put = (k: number, i: number) => {
            const m = b.meshes[k];
            if (!m) return;
            (m.instanceMatrix.array as Float32Array).set(b.matrices.subarray(i * 16, i * 16 + 16), cursor[k]! * 16);
            (m.instanceColor!.array as Float32Array).set(b.colors.subarray(i * 3, i * 3 + 3), cursor[k]! * 3);
            cursor[k]!++;
          };
          for (let i = 0; i < count; i++) {
            const band = b.band[i]!;
            if (band === 0) { put(0, i); put(1, i); } else if (band === 1) { put(2, i); put(3, i); } else put(4, i);
          }
          b.meshes.forEach((m, k) => {
            if (!m) return;
            m.count = cursor[k]!;
            m.instanceMatrix.needsUpdate = true;
            m.instanceColor!.needsUpdate = true;
          });
        }
        stats.near += b.meshes[0].count; stats.mid += b.meshes[2].count; stats.far += b.meshes[4]?.count ?? 0;
      }
      if (blobs) {
        let changed = force;
        const total = blobOn.length;
        for (let i = 0; i < total; i++) {
          const dx = blobPositions[i * 3]! - camera.x, dy = blobPositions[i * 3 + 1]! - camera.y, dz = blobPositions[i * 3 + 2]! - camera.z;
          const on = dx * dx + dy * dy + dz * dz < blobDistance * blobDistance ? 1 : 0;
          if (on !== blobOn[i]) { blobOn[i] = on; changed = true; }
        }
        if (changed) {
          const arr = blobs.instanceMatrix.array as Float32Array;
          let c = 0;
          for (let i = 0; i < total; i++) if (blobOn[i]) arr.set(blobMatrices.subarray(i * 16, i * 16 + 16), (c++) * 16);
          blobs.count = c;
          blobs.instanceMatrix.needsUpdate = true;
        }
      }
      for (const b of batches) for (const m of b.meshes) {
        if (!m || m.count === 0) continue;
        stats.calls++; stats.tris += m.count * trianglesOf(m.geometry);
        if (m.castShadow) { stats.shadowCalls++; stats.shadowTris += m.count * trianglesOf(m.geometry); }
      }
      if (blobs && blobs.count > 0) { stats.calls++; stats.tris += blobs.count * 2; }
      return stats;
    },
    dispose() { for (const d of disposables) d.dispose(); group.clear(); },
  };
}

/** Content signature so a new-but-equal placements array (inline literal) does not rebuild. */
function placementsKey(placements: ReadonlyArray<TreePlacement>): string {
  let h = 2166136261;
  for (const p of placements) {
    for (const v of [p.x, p.z, p.y ?? 0, p.scale, p.rot, p.variant]) {
      h ^= Math.round(v * 1000);
      h = Math.imul(h, 16777619);
    }
  }
  return `${placements.length}:${h >>> 0}`;
}

export function GeneratedTrees({ quality, placements, farDistance, blobShadows = true, maxDetailed }: GeneratedTreesProps) {
  const gl = useThree((s) => s.gl);
  const key = placementsKey(placements);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content on purpose
  const stablePlacements = useMemo(() => placements, [key]);
  const [assets, setAssets] = useState<TreeAssets | null>(assetsValue);
  useEffect(() => {
    let alive = true;
    loadTreeAssets().then((a) => { if (alive) setAssets(a); }).catch((err) => console.warn('[GeneratedTrees] asset load failed', err));
    return () => {
      alive = false;
      // free GPU copies of the shared assets; three re-uploads them if another instance mounts
      if (assetsValue) {
        for (const v of assetsValue.variants) { v.wood.dispose(); v.leaves.dispose(); v.sparse.dispose(); }
        assetsValue.atlas.dispose();
      }
    };
  }, []);
  // Built inside effects (not memo) so StrictMode / remounts never reuse disposed objects.
  const [impostors, setImpostors] = useState<Impostors | null | undefined>(undefined);
  useEffect(() => {
    if (!assets) return;
    setImpostors(acquireImpostors(gl, assets)); // shared per renderer, ref-counted
    return () => { releaseImpostors(gl); setImpostors(undefined); };
  }, [assets, gl]);
  // town weather (snow / rain) when mounted inside WorldScene's kit; inert elsewhere
  const kit = useContext(KitContext);
  const fallbackWeather = useMemo<WeatherUniforms>(() => ({ uSnow: { value: 0 }, uWet: { value: 0 } }), []);
  const weather: WeatherUniforms = kit?.uniforms ?? fallbackWeather;
  const alphaMode = useMemo(() => pickAlphaMode(gl), [gl]);
  const [built, setBuilt] = useState<BuiltForest | null>(null);
  useEffect(() => {
    if (!assets || impostors === undefined) return;
    const forest = buildForest(assets, impostors, stablePlacements, quality, blobShadows, alphaMode, weather);
    setBuilt(forest);
    return () => { forest.dispose(); setBuilt(null); };
  }, [assets, impostors, stablePlacements, quality, blobShadows, alphaMode, weather]);

  const far = farDistance ?? (quality === 'high' ? 80 : 30);
  // full crowns + trunk shadows only close up on 'high'; 'low' never draws the full crown
  const near = quality === 'high' ? Math.min(45, far * 0.6) : 0;
  const maxNear = quality === 'high' ? 16 : 0;
  const maxDet = maxDetailed ?? (quality === 'high' ? 70 : 24);
  const blobDistance = quality === 'high' ? 140 : 45;
  const last = useRef({ x: NaN, y: NaN, z: NaN, built: null as BuiltForest | null, key: '', eye: new THREE.Vector3() });
  useFrame(({ camera }, dt) => {
    if (!built) return;
    built.wind.value += Math.min(dt, 0.1);
    const l = last.current;
    // camera in the forest group's local space (works when mounted under a transformed parent)
    const c = built.group.worldToLocal(camera.getWorldPosition(l.eye));
    const settings = `${far}|${near}|${maxDet}|${blobDistance}`;
    const fresh = l.built !== built || l.key !== settings;
    if (fresh || (c.x - l.x) ** 2 + (c.y - l.y) ** 2 + (c.z - l.z) ** 2 > 1) {
      const stats = built.updateLod(c, near, far, maxNear, maxDet, blobDistance, fresh);
      built.group.userData.lod = stats; // band counts + submitted calls/tris, handy for debugging/HUDs
      if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__generatedTreesLod = stats;
      l.x = c.x; l.y = c.y; l.z = c.z; l.built = built; l.key = settings;
    }
  });
  return built ? <primitive object={built.group} /> : null;
}

/**
 * Willow Park example stand (park centre ≈ (-15,-15), lawn radius 4.5). Keeps clear of the
 * pond (-15.2,-21.2 r≈3.3), Pond Bench (-11.5,-17.5), Playground (-20,-9 r 2.5) and the
 * park-gate → park-inner footpath. Variants: 0 broadleaf, 1 conifer, 2 birch, 3 blossom, 4 autumn.
 */
export const PARK_TREE_PLACEMENTS: ReadonlyArray<TreePlacement> = [
  { x: -21.6, z: -14.2, scale: 1.0, rot: 0.4, variant: 0 },
  { x: -22.8, z: -19.6, scale: 0.9, rot: 2.1, variant: 1 },
  { x: -19.9, z: -25.0, scale: 0.85, rot: 4.0, variant: 2 },
  { x: -15.0, z: -27.2, scale: 1.05, rot: 1.2, variant: 0 },
  { x: -10.2, z: -23.8, scale: 0.8, rot: 5.1, variant: 3 },
  { x: -7.6, z: -18.6, scale: 0.75, rot: 3.3, variant: 2 },
  { x: -7.8, z: -14.2, scale: 0.7, rot: 0.9, variant: 3 },
  { x: -24.4, z: -9.8, scale: 0.95, rot: 2.6, variant: 1 },
  { x: -25.6, z: -15.4, scale: 1.1, rot: 5.6, variant: 1 },
  { x: -18.6, z: -4.6, scale: 0.7, rot: 1.7, variant: 3 },
  { x: -12.6, z: -29.0, scale: 0.95, rot: 3.9, variant: 2 },
  { x: -26.0, z: -22.6, scale: 1.0, rot: 0.2, variant: 0 },
  { x: -18.4, z: -29.6, scale: 0.9, rot: 2.9, variant: 4 },
  { x: -27.4, z: -11.0, scale: 0.85, rot: 4.4, variant: 4 },
];
