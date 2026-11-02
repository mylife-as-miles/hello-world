/**
 * GeneratedTrees — instanced WebGL trees baked offline with super-terrain's procedural
 * tree generator (MIT, © 2026 alightinastorm; see ./assets/CREDITS.md).
 *
 * Assets (./assets): one compact GLB per variant (`wood` + merged `leaves` cards, metres,
 * ground at y=0) and one shared 512² leaf atlas (row = variant, 4 spray tiles per row)
 * rasterised by super-terrain's leaf-spray baker, recoloured onto a soft pastel ramp.
 *
 * Rendering (WebGL, MeshStandardMaterial):
 *  - near trees: one InstancedMesh per variant × {bark, leaves}; alpha-tested leaf cards;
 *    tiny onBeforeCompile wind sway; trunks cast shadows only when quality = 'high'.
 *  - far trees (beyond `farDistance`, default 60 m high / 40 m low): crossed-card impostors
 *    whose texture is rendered once at runtime from the same meshes (1 draw call per variant).
 *  - soft blob contact shadow under every tree (1 draw call) so crowns sit on the ground.
 * React never re-renders per frame; LOD partitions are recomputed in useFrame only when the
 * camera moved. Everything created here is disposed on unmount.
 */
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type TreeQuality = 'low' | 'high';
/** `variant` indexes TREE_VARIANTS (wrapped); `rot` is yaw in radians; `y` (ground height) defaults to 0. */
export interface TreePlacement { x: number; z: number; y?: number; scale: number; rot: number; variant: number }
export interface GeneratedTreesProps {
  quality: TreeQuality;
  placements: ReadonlyArray<TreePlacement>;
  /** Distance (m) beyond which trees switch to impostor cards. Default 60 (high) / 40 (low). */
  farDistance?: number;
  /** Soft blob contact shadows under the crowns. Default true. */
  blobShadows?: boolean;
}

/** Variant order = asset order = atlas row order. */
export const TREE_VARIANTS = ['broadleaf', 'conifer', 'birch', 'blossom'] as const;
export type TreeVariantName = (typeof TREE_VARIANTS)[number];
/** Baked heights in metres at scale 1. */
export const TREE_VARIANT_HEIGHT: Record<TreeVariantName, number> = { broadleaf: 6.2, conifer: 7, birch: 6.6, blossom: 5.2 };

const GLB_URLS: string[] = [
  new URL('./assets/tree-broadleaf.glb', import.meta.url).href,
  new URL('./assets/tree-conifer.glb', import.meta.url).href,
  new URL('./assets/tree-birch.glb', import.meta.url).href,
  new URL('./assets/tree-blossom.glb', import.meta.url).href,
];
const ATLAS_URL = new URL('./assets/leaf-atlas.png', import.meta.url).href;

/** Per-variant bark tint (multiplies the generator's vertex colours) and leaf tint. */
const BARK_TINT = ['#b39a86', '#9a8070', '#f2eee6', '#a88a7a'];
const LEAF_TINT = ['#ffffff', '#ffffff', '#ffffff', '#ffffff'];
const BLOB_RADIUS = [2.6, 2.1, 2.4, 2.7];

interface VariantGeometry { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; box: THREE.Box3 }
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
      return { wood: w, leaves: l, box };
    }));
    const atlas = await atlasPromise;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.needsUpdate = true;
    assetsValue = { variants, atlas };
    return assetsValue;
  })();
  return assetsPromise;
}

/**
 * Shader tweaks via onBeforeCompile:
 *  - wind: sway grows with height² so trunks stay planted; phase varies per instance position.
 *  - keepNormals: double-sided cards keep their authored (outward / upward) normal on the back
 *    face instead of flipping it, so crowns and impostors shade softly from every side.
 */
function patchTreeMaterial(material: THREE.Material, key: string, opts: { time?: { value: number }; wind?: number; keepNormals?: boolean }) {
  material.onBeforeCompile = (shader) => {
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
  material.customProgramCacheKey = () => key;
}

// ---------------------------------------------------------------- impostors
const TILE_W = 256, TILE_H = 256;

interface Impostors { target: THREE.WebGLRenderTarget; cards: THREE.BufferGeometry[]; dispose(): void }

/** Renders each variant's unlit albedo, seen from the side, into one atlas (one tile per variant). */
function bakeImpostors(gl: THREE.WebGLRenderer, assets: TreeAssets): Impostors {
  const n = assets.variants.length;
  const target = new THREE.WebGLRenderTarget(TILE_W * n, TILE_H, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, 0, 0.1, 100);
  const temp: THREE.Material[] = [];
  const cards: THREE.BufferGeometry[] = [];
  const prevTarget = gl.getRenderTarget();
  const prevColor = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  const prevAutoClear = gl.autoClear;
  gl.autoClear = false;
  gl.setRenderTarget(target);
  gl.setClearColor('#4f8a3c', 0);
  gl.clear(true, true, true);
  assets.variants.forEach((v, i) => {
    const halfW = Math.max(-v.box.min.x, v.box.max.x, -v.box.min.z, v.box.max.z) * 1.04;
    const top = v.box.max.y * 1.03, bottom = -0.02 * v.box.max.y;
    const bark = new THREE.MeshBasicMaterial({ vertexColors: true, color: BARK_TINT[i] });
    const leaf = new THREE.MeshBasicMaterial({ map: assets.atlas, vertexColors: true, color: LEAF_TINT[i], alphaTest: 0.42, side: THREE.DoubleSide });
    temp.push(bark, leaf);
    scene.clear();
    scene.add(new THREE.Mesh(v.wood, bark), new THREE.Mesh(v.leaves, leaf));
    camera.left = -halfW; camera.right = halfW; camera.top = top; camera.bottom = bottom;
    camera.position.set(0, 0, 50); camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    target.viewport.set(i * TILE_W, 0, TILE_W, TILE_H);
    target.scissor.set(i * TILE_W, 0, TILE_W, TILE_H);
    target.scissorTest = true;
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    // two crossed quads sized like the ortho frustum; normals lean up for soft, even light
    const u0 = i / n, u1 = (i + 1) / n;
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let q = 0; q < 2; q++) {
      const ax = q === 0 ? 1 : 0, az = q === 0 ? 0 : 1;
      const nx = az, nz = -ax;
      const base = q * 4;
      for (const [s, t] of [[-1, 0], [1, 0], [1, 1], [-1, 1]] as const) {
        pos.push(ax * s * halfW, t ? top : bottom, az * s * halfW);
        const l = Math.hypot(nx * 0.45, 0.85, nz * 0.45);
        nor.push((nx * 0.45) / l, 0.85 / l, (nz * 0.45) / l);
        uv.push(s < 0 ? u0 : u1, t);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    cards.push(g);
  });
  target.scissorTest = false;
  target.viewport.set(0, 0, TILE_W * n, TILE_H);
  target.scissor.set(0, 0, TILE_W * n, TILE_H);
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevColor, prevAlpha);
  gl.autoClear = prevAutoClear;
  scene.clear();
  for (const m of temp) m.dispose();
  return { target, cards, dispose() { target.dispose(); for (const c of cards) c.dispose(); } };
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
interface VariantBatch {
  matrices: Float32Array; // 16 per tree, in placement order
  colors: Float32Array; // 3 per tree
  positions: Float32Array; // 3 per tree (LOD distance)
  far: Uint8Array; // current LOD state per tree
  trunks: THREE.InstancedMesh;
  crowns: THREE.InstancedMesh;
  cards: THREE.InstancedMesh;
}
interface BuiltForest { group: THREE.Group; wind: { value: number }; updateLod(camera: THREE.Vector3, farDistance: number, force: boolean): void; dispose(): void }

function buildForest(assets: TreeAssets, impostors: Impostors, placements: ReadonlyArray<TreePlacement>, quality: TreeQuality, blobShadows: boolean): BuiltForest {
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

  const farMaterial = new THREE.MeshStandardMaterial({
    map: impostors.target.texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
    emissiveMap: impostors.target.texture, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.14,
  });
  patchTreeMaterial(farMaterial, 'tree-impostor', { keepNormals: true });
  disposables.push(farMaterial);

  const batches: VariantBatch[] = [];
  byVariant.forEach((list, v) => {
    if (list.length === 0) return;
    const geo = assets.variants[v]!;
    const bark = new THREE.MeshStandardMaterial({ vertexColors: true, color: BARK_TINT[v], roughness: 0.92, metalness: 0 });
    const leaf = new THREE.MeshStandardMaterial({
      map: assets.atlas, vertexColors: true, color: LEAF_TINT[v], alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.8, metalness: 0,
      // a little self-lit albedo reads as soft translucency and keeps crowns pastel in shade
      emissiveMap: assets.atlas, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.18,
    });
    patchTreeMaterial(bark, 'tree-bark', { time: wind, wind: 0.0012 });
    patchTreeMaterial(leaf, 'tree-leaf', { time: wind, wind: 0.0034, keepNormals: true });
    disposables.push(bark, leaf);

    const count = list.length;
    const matrices = new Float32Array(count * 16);
    const colors = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    const trunks = new THREE.InstancedMesh(geo.wood, bark, count);
    const crowns = new THREE.InstancedMesh(geo.leaves, leaf, count);
    const cards = new THREE.InstancedMesh(impostors.cards[v]!, farMaterial, count);
    trunks.name = `tree-${TREE_VARIANTS[v]}-wood`;
    crowns.name = `tree-${TREE_VARIANTS[v]}-leaves`;
    cards.name = `tree-${TREE_VARIANTS[v]}-impostor`;
    list.forEach((p, i) => {
      pos.set(p.x, p.y ?? 0, p.z);
      quat.setFromAxisAngle(up, p.rot || 0);
      scl.setScalar(p.scale > 0 ? p.scale : 1);
      matrix.compose(pos, quat, scl);
      matrix.toArray(matrices, i * 16);
      positions[i * 3] = p.x; positions[i * 3 + 1] = (p.y ?? 0) + 3 * scl.y; positions[i * 3 + 2] = p.z;
      // gentle per-tree value/hue jitter so a stand never looks copy-pasted
      const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      tint.setRGB(1, 1, 1).offsetHSL((r - 0.5) * 0.04, 0, (r - 0.5) * 0.14);
      tint.toArray(colors, i * 3);
      // full set once so bounding spheres cover every tree (stays conservative for subsets)
      trunks.setMatrixAt(i, matrix); crowns.setMatrixAt(i, matrix); cards.setMatrixAt(i, matrix);
      crowns.setColorAt(i, tint); cards.setColorAt(i, tint);
    });
    for (const m of [trunks, crowns, cards]) { m.computeBoundingSphere(); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    trunks.castShadow = quality === 'high';
    trunks.receiveShadow = quality === 'high';
    crowns.castShadow = false; crowns.receiveShadow = false;
    cards.castShadow = false; cards.receiveShadow = false;
    cards.count = 0;
    group.add(trunks, crowns, cards);
    disposables.push(trunks, crowns, cards);
    batches.push({ matrices, colors, positions, far: new Uint8Array(count), trunks, crowns, cards });
  });

  if (blobShadows) {
    const all = byVariant.flatMap((list, v) => list.map((p) => ({ p, v })));
    if (all.length > 0) {
      const tex = makeBlobTexture();
      const mat = new THREE.MeshBasicMaterial({ color: '#2f4a2a', alphaMap: tex, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const plane = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
      const blobs = new THREE.InstancedMesh(plane, mat, all.length);
      blobs.name = 'tree-blob-shadows';
      all.forEach(({ p, v }, i) => {
        const s = (p.scale > 0 ? p.scale : 1) * BLOB_RADIUS[v]!;
        pos.set(p.x, (p.y ?? 0) + 0.04, p.z);
        quat.identity();
        scl.set(s, 1, s * 0.9);
        blobs.setMatrixAt(i, matrix.compose(pos, quat, scl));
      });
      blobs.computeBoundingSphere();
      blobs.renderOrder = -1;
      group.add(blobs);
      disposables.push(tex, mat, plane, blobs);
    }
  }

  return {
    group, wind,
    updateLod(camera, farDistance, force) {
      const nearSq = farDistance * farDistance;
      const farSq = (farDistance + 5) * (farDistance + 5);
      for (const b of batches) {
        let changed = force;
        const count = b.far.length;
        for (let i = 0; i < count; i++) {
          const dx = b.positions[i * 3]! - camera.x, dy = b.positions[i * 3 + 1]! - camera.y, dz = b.positions[i * 3 + 2]! - camera.z;
          const d = dx * dx + dy * dy + dz * dz;
          const state = b.far[i]!;
          const next = d > farSq ? 1 : d < nearSq ? 0 : state; // hysteresis band avoids popping
          if (next !== state) { b.far[i] = next; changed = true; }
        }
        if (!changed) continue;
        let ni = 0, fi = 0;
        const tm = b.trunks.instanceMatrix.array as Float32Array, cm = b.crowns.instanceMatrix.array as Float32Array, fm = b.cards.instanceMatrix.array as Float32Array;
        const cc = b.crowns.instanceColor!.array as Float32Array, fc = b.cards.instanceColor!.array as Float32Array;
        for (let i = 0; i < count; i++) {
          const src = b.matrices.subarray(i * 16, i * 16 + 16);
          const col = b.colors.subarray(i * 3, i * 3 + 3);
          if (b.far[i]) { fm.set(src, fi * 16); fc.set(col, fi * 3); fi++; }
          else { tm.set(src, ni * 16); cm.set(src, ni * 16); cc.set(col, ni * 3); ni++; }
        }
        b.trunks.count = ni; b.crowns.count = ni; b.cards.count = fi;
        b.trunks.instanceMatrix.needsUpdate = true; b.crowns.instanceMatrix.needsUpdate = true; b.cards.instanceMatrix.needsUpdate = true;
        b.crowns.instanceColor!.needsUpdate = true; b.cards.instanceColor!.needsUpdate = true;
      }
    },
    dispose() { for (const d of disposables) d.dispose(); group.clear(); },
  };
}

export function GeneratedTrees({ quality, placements, farDistance, blobShadows = true }: GeneratedTreesProps) {
  const gl = useThree((s) => s.gl);
  const [assets, setAssets] = useState<TreeAssets | null>(assetsValue);
  useEffect(() => {
    let alive = true;
    loadTreeAssets().then((a) => { if (alive) setAssets(a); }).catch((err) => console.warn('[GeneratedTrees] asset load failed', err));
    return () => {
      alive = false;
      // free GPU copies of the shared assets; three re-uploads them if another instance mounts
      if (assetsValue) {
        for (const v of assetsValue.variants) { v.wood.dispose(); v.leaves.dispose(); }
        assetsValue.atlas.dispose();
      }
    };
  }, []);
  // Built inside effects (not memo) so StrictMode / remounts never reuse disposed objects.
  const [impostors, setImpostors] = useState<Impostors | null>(null);
  useEffect(() => {
    if (!assets) return;
    const baked = bakeImpostors(gl, assets);
    setImpostors(baked);
    return () => { baked.dispose(); setImpostors(null); };
  }, [assets, gl]);
  const [built, setBuilt] = useState<BuiltForest | null>(null);
  useEffect(() => {
    if (!assets || !impostors) return;
    const forest = buildForest(assets, impostors, placements, quality, blobShadows);
    setBuilt(forest);
    return () => { forest.dispose(); setBuilt(null); };
  }, [assets, impostors, placements, quality, blobShadows]);

  const far = farDistance ?? (quality === 'high' ? 60 : 40);
  const last = useRef({ x: NaN, y: NaN, z: NaN, built: null as BuiltForest | null, far: NaN });
  useFrame(({ camera }, dt) => {
    if (!built) return;
    built.wind.value += Math.min(dt, 0.1);
    const l = last.current;
    const c = camera.position;
    const fresh = l.built !== built || l.far !== far;
    if (fresh || (c.x - l.x) ** 2 + (c.y - l.y) ** 2 + (c.z - l.z) ** 2 > 1) {
      built.updateLod(c, far, fresh);
      l.x = c.x; l.y = c.y; l.z = c.z; l.built = built; l.far = far;
    }
  });
  return built ? <primitive object={built.group} /> : null;
}

/**
 * Willow Park example stand (park centre ≈ (-15,-15), lawn radius 4.5). Keeps clear of the
 * pond (-15.2,-21.2 r≈3.3), Pond Bench (-11.5,-17.5), Playground (-20,-9 r 2.5) and the
 * park-gate → park-inner footpath. Variants: 0 broadleaf, 1 conifer, 2 birch, 3 blossom.
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
];
