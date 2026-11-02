/**
 * Shared, reference-counted materials for Townie avatars. Many residents share
 * skin tones / outfit colours, so materials are keyed by (colour, finish).
 */
import * as THREE from 'three';

export type Finish = 'skin' | 'cloth' | 'knit' | 'denim' | 'hair' | 'leather' | 'rubber' | 'metal' | 'plastic' | 'lens' | 'shade' | 'eye' | 'mouth' | 'teeth' | 'dark' | 'glow' | 'gem';

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
    case 'leather': return std({ roughness: 0.4 });
    case 'rubber': return std({ roughness: 0.78 });
    case 'metal': return std({ roughness: 0.28, metalness: 0.75, emissive: c.clone().multiplyScalar(0.12) });
    case 'plastic': return std({ roughness: 0.32 });
    case 'gem': return std({ roughness: 0.1, metalness: 0.1, emissive: c.clone().multiplyScalar(0.25) });
    case 'lens': return new THREE.MeshStandardMaterial({ color: c, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
    case 'shade': return std({ roughness: 0.06, metalness: 0.35 });
    case 'eye': return std({ roughness: 0.18, emissive: new THREE.Color(0.16, 0.16, 0.16) });
    case 'mouth': return std({ roughness: 0.65 });
    case 'teeth': return std({ roughness: 0.3, emissive: c.clone().multiplyScalar(0.1) });
    case 'dark': return std({ roughness: 0.5 });
    case 'glow': return new THREE.MeshBasicMaterial({ color: c, vertexColors: true, toneMapped: false });
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
