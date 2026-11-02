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
  /** See-through cone camera → subject (close shots): props inside it dissolve with a dither. */
  uCutA: { value: THREE.Vector3 };
  uCutB: { value: THREE.Vector3 };
  /** x = radius at the camera, y = radius at the subject. */
  uCutR: { value: THREE.Vector2 };
  /** Nothing within this distance (m) of the subject is cut (seats, ground, the subject's own props). */
  uCutKeep: { value: number };
  /** 0…1 strength (eased by the camera rig). */
  uCutOn: { value: number };
}

const CUT_PARS = /* glsl */ `
uniform vec3 uCutA;
uniform vec3 uCutB;
uniform vec2 uCutR;
uniform float uCutKeep;
uniform float uCutOn;
varying vec3 vCutW;
float hwBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float hwBayer4(vec2 a) { return hwBayer2(0.5 * a) * 0.25 + hwBayer2(a); }
`;
const CUT_FRAG = /* glsl */ `
  if (uCutOn > 0.001) {
    vec3 hwAB = uCutB - uCutA;
    float hwL = max(length(hwAB), 0.001);
    vec3 hwDir = hwAB / hwL;
    vec3 hwAP = vCutW - uCutA;
    float hwT = dot(hwAP, hwDir);
    if (hwT > 0.15 && hwT < hwL - uCutKeep) {
      float hwD = length(hwAP - hwDir * hwT);
      float hwRad = mix(uCutR.x, uCutR.y, clamp(hwT / hwL, 0.0, 1.0));
      float hwK = (1.0 - smoothstep(hwRad * 0.55, hwRad, hwD)) * uCutOn;
      if (hwK > 0.0 && hwK * 1.05 > hwBayer4(gl_FragCoord.xy)) discard;
    }
  }
`;
const CUT_VERT = /* glsl */ `
  vec4 hwCutW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    hwCutW = instanceMatrix * hwCutW;
  #endif
  vCutW = (modelMatrix * hwCutW).xyz;
`;

/**
 * Dithered see-through for props between the camera and the subject (WebGL GLSL only — WebGPU
 * node materials ignore onBeforeCompile; the camera director swings around blockers instead).
 */
export function injectCutout(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }, uniforms: SharedUniforms): void {
  shader.uniforms.uCutA = uniforms.uCutA;
  shader.uniforms.uCutB = uniforms.uCutB;
  shader.uniforms.uCutR = uniforms.uCutR;
  shader.uniforms.uCutKeep = uniforms.uCutKeep;
  shader.uniforms.uCutOn = uniforms.uCutOn;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + CUT_VERT);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + CUT_PARS)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + CUT_FRAG);
}

/** Cutout-only patch (for unlit bulbs / extra materials). */
export function patchCutout(material: THREE.Material, uniforms: SharedUniforms, key: string): void {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => { prev.call(material, shader, renderer); injectCutout(shader, uniforms); };
  material.customProgramCacheKey = () => `hw-cut-${key}`;
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
export function patchWeather(material: THREE.MeshStandardMaterial, uniforms: SharedUniforms, snowScale = 1, cutout = false): void {
  material.onBeforeCompile = shader => {
    if (cutout) injectCutout(shader, uniforms);
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
  material.customProgramCacheKey = () => `hw-weather-${snowScale}-${cutout ? 'cut' : 'solid'}`;
}

export function createKit(): SceneKit {
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(r: T): T => { disposables.push(r); return r; };
  const uniforms: SharedUniforms = {
    uSnow: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 },
    uCutA: { value: new THREE.Vector3() }, uCutB: { value: new THREE.Vector3() }, uCutR: { value: new THREE.Vector2(0.35, 0.95) },
    uCutKeep: { value: 1.3 }, uCutOn: { value: 0 },
  };

  const solid = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }));
  patchWeather(solid, uniforms, 1, true);
  const ground = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  patchWeather(ground, uniforms);

  const glass = track(new THREE.MeshStandardMaterial({
    vertexColors: true, color: '#4f6d86', roughness: 0.18, metalness: 0.15, emissive: '#ffffff', emissiveIntensity: 0,
  }));
  glass.onBeforeCompile = shader => {
    injectCutout(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;');
  };
  glass.customProgramCacheKey = () => 'hw-glass-cut';

  const bulbs = track(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  patchCutout(bulbs, uniforms, 'bulbs');

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
