/**
 * Shared, reference-counted materials for Townie avatars. Many residents share
 * skin tones / outfit colours, so materials are keyed by (colour, finish).
 */
import * as THREE from 'three';

export type Finish = 'skin' | 'cloth' | 'knit' | 'denim' | 'hair' | 'coil' | 'leather' | 'rubber' | 'metal' | 'plastic' | 'lens' | 'shade' | 'eye' | 'mouth' | 'teeth' | 'dark' | 'glow' | 'gem' | 'baked';

/**
 * Per-finish surface response [roughness, metalness, emissive strength (x albedo)] — the same numbers `make()` uses,
 * so parts merged into ONE 'baked' mesh (per-vertex `pbr` attribute) shade like their separate-material originals.
 */
export const FINISH_PBR: Record<Exclude<Finish, 'baked' | 'lens'>, [number, number, number]> = {
  skin: [0.56, 0, 0.07], cloth: [0.84, 0, 0], knit: [0.95, 0, 0], denim: [0.9, 0, 0], hair: [0.46, 0, 0.04], coil: [0.9, 0, 0.05],
  leather: [0.4, 0, 0], rubber: [0.78, 0, 0], metal: [0.28, 0.75, 0.12], plastic: [0.32, 0, 0], gem: [0.1, 0.1, 0.25],
  shade: [0.06, 0.35, 0], eye: [0.2, 0, 0], mouth: [0.65, 0, 0], teeth: [0.3, 0, 0.1], dark: [0.5, 0, 0], glow: [1, 0, 1],
};

/**
 * Shared material for merged ("baked") Townie meshes: white albedo x vertex colour, with roughness / metalness /
 * emissive read per vertex from the `pbr` attribute (see FINISH_PBR). One material + one draw call for a whole avatar
 * while skin, cloth, hair, leather and metal keep their own response.
 */
function bakedMaterial(): THREE.MeshStandardMaterial {
  // roughness 0.72 is only the fallback where onBeforeCompile is ignored (WebGPU node materials): an average of the
  // fabric/skin/hair finishes instead of fully matte. WebGL reads the per-vertex value below.
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 pbr;\nvarying vec3 vPbr;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n\tvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbr;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * vPbr.z;');
  };
  m.customProgramCacheKey = () => 'townie-baked-pbr-1';
  return m;
}

interface Entry { mat: THREE.Material; refs: number }
const cache = new Map<string, Entry>();

function make(color: string, finish: Finish): THREE.Material {
  const c = new THREE.Color(color);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, ...p });
  switch (finish) {
    case 'skin': return std({ roughness: 0.56, emissive: c.clone().multiplyScalar(0.07) });
    case 'cloth': return std({ roughness: 0.84, side: THREE.DoubleSide });
    case 'knit': return std({ roughness: 0.95, side: THREE.DoubleSide });
    case 'denim': return std({ roughness: 0.9, side: THREE.DoubleSide });
    case 'hair': return std({ roughness: 0.46, side: THREE.DoubleSide, emissive: c.clone().multiplyScalar(0.04) });
    case 'coil': return std({ roughness: 0.9, side: THREE.DoubleSide, emissive: c.clone().multiplyScalar(0.05) });
    case 'leather': return std({ roughness: 0.4 });
    case 'rubber': return std({ roughness: 0.78 });
    case 'metal': return std({ roughness: 0.28, metalness: 0.75, emissive: c.clone().multiplyScalar(0.12) });
    case 'plastic': return std({ roughness: 0.32 });
    case 'gem': return std({ roughness: 0.1, metalness: 0.1, emissive: c.clone().multiplyScalar(0.25) });
    case 'lens': return new THREE.MeshStandardMaterial({ color: c, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
    case 'shade': return std({ roughness: 0.06, metalness: 0.35 });
    case 'eye': return std({ roughness: 0.2 });
    case 'mouth': return std({ roughness: 0.65 });
    case 'teeth': return std({ roughness: 0.3, emissive: c.clone().multiplyScalar(0.1) });
    case 'dark': return std({ roughness: 0.5 });
    case 'glow': return new THREE.MeshBasicMaterial({ color: c, vertexColors: true, toneMapped: false });
    case 'baked': return bakedMaterial();
  }
}

export function acquireMaterial(color: string, finish: Finish): THREE.Material {
  const key = `${color}|${finish}`;
  let e = cache.get(key);
  if (!e) { e = { mat: make(color, finish), refs: 0 }; e.mat.name = `townie:${key}`; e.mat.userData.townieKey = key; cache.set(key, e); }
  e.refs++;
  return e.mat;
}

export function releaseMaterial(mat: THREE.Material): void {
  const key = mat.userData.townieKey as string | undefined;
  if (!key) { mat.dispose(); return; }
  const e = cache.get(key);
  if (!e) return;
  e.refs--;
  if (e.refs <= 0) { cache.delete(key); e.mat.dispose(); }
}

// ---------------------------------------------------------------- colour helpers
export function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color(1, 1, 1), f); else c.multiplyScalar(1 + f);
  return `#${c.getHexString()}`;
}
export function luminance(hex: string): number {
  const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
/** Readable contrast trim for a garment colour (cream on dark/saturated, navy on light). */
export function contrastOf(hex: string): string { return luminance(hex) > 0.55 ? '#2c3550' : '#f3ead8'; }
export function mix(a: string, b: string, t: number): string {
  const c = new THREE.Color(a).lerp(new THREE.Color(b), t); return `#${c.getHexString()}`;
}
