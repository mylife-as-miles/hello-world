/** Gradient sky dome (sun glow, moon, twinkling stars) + slow low-poly clouds. All local, no network. */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Batch, Prims, mtx, rng } from './batch';
import { useKit } from './context';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uTime;
uniform float uSunVis;
uniform float uCloudy;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.48));
  col = mix(col, uBottom, smoothstep(0.0, -0.18, h));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  float clear = 1.0 - uCloudy * 0.85;
  col += uSunColor * (pow(sd, 1400.0) * 9.0 * clear + pow(sd, 22.0) * 0.32 + pow(sd, 4.0) * 0.14) * uSunVis;
  col += uSunColor * pow(1.0 - abs(h), 7.0) * 0.1 * uSunVis;
  float md = max(dot(d, normalize(uMoonDir)), 0.0);
  col += vec3(0.92, 0.95, 1.0) * (smoothstep(0.99955, 0.9998, md) * 1.8 + pow(md, 80.0) * 0.18) * uNight * clear;
  vec3 sp = d * 260.0;
  vec3 cell = floor(sp);
  float rnd = hash(cell);
  float star = step(0.9962, rnd) * smoothstep(0.02, 0.3, h);
  float tw = 0.55 + 0.45 * sin(uTime * (1.5 + rnd * 3.0) + rnd * 100.0);
  float core = smoothstep(0.42, 0.0, length(fract(sp) - 0.5));
  col += vec3(1.0, 0.97, 0.9) * star * core * tw * uNight * clear * 1.6;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyUniforms {
  uTop: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uBottom: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uMoonDir: { value: THREE.Vector3 };
  uNight: { value: number };
  uTime: { value: number };
  uSunVis: { value: number };
  uCloudy: { value: number };
}

export function createSkyUniforms(): SkyUniforms {
  return {
    uTop: { value: new THREE.Color('#5aa0e6') }, uHorizon: { value: new THREE.Color('#d4ecfa') }, uBottom: { value: new THREE.Color('#9fbf8a') },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, -0.2) }, uSunColor: { value: new THREE.Color('#fff1d6') },
    uMoonDir: { value: new THREE.Vector3(-0.3, 0.7, 0.6).normalize() }, uNight: { value: 0 }, uTime: { value: 0 },
    uSunVis: { value: 1 }, uCloudy: { value: 0 },
  };
}

export function SkyDome({ uniforms }: { uniforms: SkyUniforms }) {
  const ref = useRef<THREE.Mesh>(null);
  const res = useMemo(() => {
    const geo = new THREE.SphereGeometry(500, 32, 20);
    const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: uniforms as unknown as Record<string, THREE.IUniform>, side: THREE.BackSide, depthWrite: false, fog: false });
    return { geo, mat };
  }, [uniforms]);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); }, [res]);
  useFrame(({ camera }) => { ref.current?.position.copy(camera.position); });
  return <mesh ref={ref} geometry={res.geo} material={res.mat} renderOrder={-1000} frustumCulled={false} />;
}

/** Puffy flat-shaded clouds drifting around the horizon; tint is driven by the atmosphere. */
export function Clouds({ tint }: { tint: THREE.Color }) {
  const kit = useKit();
  const group = useRef<THREE.Group>(null);
  const res = useMemo(() => {
    const P = new Prims();
    const b = new Batch();
    const r = rng(4242);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + r() * 0.3;
      const R = 95 + r() * 70;
      const cx = Math.cos(a) * R, cz = Math.sin(a) * R, cy = 34 + r() * 26;
      const s = 4 + r() * 4;
      const puffs = 4 + Math.floor(r() * 4);
      for (let k = 0; k < puffs; k++) {
        const ox = (k - puffs / 2) * s * 0.75 + (r() - 0.5) * s * 0.4;
        const ps = s * (0.7 + r() * 0.6) * (1 - Math.abs(k - puffs / 2) / puffs * 0.6);
        b.add(P.blob(k % 6, 0.15, 1), k % 2 ? '#ffffff' : '#f4f6fa', mtx(cx + ox * Math.cos(a + Math.PI / 2), cy + (r() - 0.3) * s * 0.3, cz + ox * Math.sin(a + Math.PI / 2), r() * 6, ps, ps * 0.62, ps * 0.85), true);
      }
      b.add(P.blob(7, 0.1, 1), '#e8ecf2', mtx(cx, cy - s * 0.25, cz, a, s * puffs * 0.42, s * 0.3, s * 0.8), true);
    }
    const geo = b.build();
    P.dispose();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.35, fog: false });
    return { geo, mat };
  }, []);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); }, [res]);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * (0.004 + kit.env.rain * 0.006);
    res.mat.color.copy(tint);
    res.mat.emissive.copy(tint).multiplyScalar(0.55);
  });
  return <group ref={group}><mesh geometry={res.geo} material={res.mat} /></group>;
}
