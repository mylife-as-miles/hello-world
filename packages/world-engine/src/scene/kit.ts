/**
 * Per-WorldScene rendering kit: shared materials, shared shader uniforms and the
 * mutable environment state that the atmosphere controller writes every frame
 * (read by other components inside useFrame — never React state).
 */
import * as THREE from 'three';

export interface EnvState {
  /** Render clock seconds (R3F clock). */
  t: number;
  /** Smoothed simulation time (seconds). */
  simTime: number;
  hours: number;
  day: number;
  /** 0 night … 1 full day (smoothed). */
  daylight: number;
  /** 0…1 how strongly artificial lights glow (night, storms). */
  lights: number;
  /** Smoothed weather weights. */
  rain: number;
  snow: number;
  sunset: number;
  /** Direction towards the key (shadow) light: sun by day, moon by night. */
  keyDir: THREE.Vector3;
  /** 0…1 raid portal intensity (written by Portal). */
  raid: number;
}

export interface SharedUniforms {
  uSnow: { value: number };
  uWet: { value: number };
  uTime: { value: number };
}

export interface FxApi {
  /** env.t at which the latest raid started (−∞ when none). */
  raidAt: number;
  emitSparkles: (origin: THREE.Vector3, count: number, palette: readonly string[], spread?: number) => void;
  emitConfetti: (origin: THREE.Vector3, count: number) => void;
}

/** Vertical cylinders the camera director avoids (lamp posts, trees, planters…), published by Town. */
export interface CameraOccluder { x: number; z: number; r: number; h: number }

export interface SceneKit {
  env: EnvState;
  /** Small occluders for camera framing (filled by Town after it builds). */
  occluders: CameraOccluder[];
  uniforms: SharedUniforms;
  fx: FxApi;
  /** Vertex-coloured lit material for all static props/buildings. */
  solid: THREE.MeshStandardMaterial;
  /** Vertex-coloured lit material for ground-level surfaces (paths, beds). */
  ground: THREE.MeshStandardMaterial;
  /** Window glass: dark glass by day, emissive = vertex colour × intensity at night. */
  glass: THREE.MeshStandardMaterial;
  /** Unlit bulbs/neon (vertex colours, colour scalar = brightness, not tone mapped → bloom). */
  bulbs: THREE.MeshBasicMaterial;
  track<T extends { dispose(): void }>(resource: T): T;
  dispose(): void;
}

/** Adds snow cover on upward faces and a wet (darker, glossier) look in rain. */
export function patchWeather(material: THREE.MeshStandardMaterial, uniforms: SharedUniforms, snowScale = 1): void {
  material.onBeforeCompile = shader => {
    shader.uniforms.uSnow = uniforms.uSnow;
    shader.uniforms.uWet = uniforms.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUpW;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
  vec3 hwUp = objectNormal;
  #ifdef USE_INSTANCING
    hwUp = mat3(instanceMatrix) * hwUp;
  #endif
  vUpW = normalize(mat3(modelMatrix) * hwUp).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUpW;\nuniform float uSnow;\nuniform float uWet;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  float hwSnow = clamp(uSnow * ${snowScale.toFixed(2)}, 0.0, 1.0) * smoothstep(0.3, 0.85, vUpW);
  diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.3 * uWet), vec3(0.92, 0.95, 1.0), hwSnow);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.32, uWet * smoothstep(0.5, 0.9, vUpW) * (1.0 - uSnow));`);
  };
  material.customProgramCacheKey = () => `hw-weather-${snowScale}`;
}

export function createKit(): SceneKit {
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(r: T): T => { disposables.push(r); return r; };
  const uniforms: SharedUniforms = { uSnow: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 } };

  const solid = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }));
  patchWeather(solid, uniforms);
  const ground = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  patchWeather(ground, uniforms);

  const glass = track(new THREE.MeshStandardMaterial({
    vertexColors: true, color: '#4f6d86', roughness: 0.18, metalness: 0.15, emissive: '#ffffff', emissiveIntensity: 0,
  }));
  glass.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;');
  };
  glass.customProgramCacheKey = () => 'hw-glass';

  const bulbs = track(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));

  const env: EnvState = {
    t: 0, simTime: 0, hours: 8, day: 1, daylight: 1, lights: 0, rain: 0, snow: 0, sunset: 0,
    keyDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(), raid: 0,
  };
  const fx: FxApi = { raidAt: -1e9, emitSparkles: () => {}, emitConfetti: () => {} };

  return {
    env, uniforms, fx, solid, ground, glass, bulbs, track, occluders: [],
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
