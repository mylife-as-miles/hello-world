/**
 * Raid portal: stone ring with a swirling shader, idle glow, orbiting motes.
 * A fresh raid (kit.fx.raidAt) opens it dramatically for ~15 s: ring spins +
 * scales, core brightens, light beam, flash, extra particles.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getPoi } from '../world/layout';
import { Batch, Prims, mtx } from './batch';
import { useKit } from './context';

export const RAID_DURATION = 15;

const DISC_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uRaid;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float sp = 1.0 + uRaid * 3.0;
  float s1 = sin(a * 3.0 + r * 9.0 - uTime * sp * 2.0);
  float s2 = sin(a * 5.0 - r * 15.0 + uTime * sp * 1.3);
  float sw = 0.5 + 0.25 * s1 + 0.25 * s2;
  vec3 deep = vec3(0.18, 0.06, 0.45), mag = vec3(1.0, 0.32, 0.86), cyan = vec3(0.32, 0.95, 1.0);
  vec3 col = mix(deep, mag, smoothstep(0.3, 0.9, sw));
  col = mix(col, cyan, smoothstep(0.72, 1.0, sw) * (0.4 + 0.6 * r));
  col += vec3(1.0, 0.86, 1.0) * smoothstep(0.6, 0.0, r) * (0.2 + uRaid * 0.6);
  float alpha = smoothstep(1.0, 0.86, r) * (0.72 + 0.28 * uRaid);
  gl_FragColor = vec4(col * (1.05 + uRaid * 1.1), alpha);
}`;
const HALO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uRaid;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float band = exp(-pow((r - 0.62) * 6.0, 2.0));
  float a = atan(p.y, p.x);
  float flick = 0.8 + 0.2 * sin(a * 8.0 + uTime * 3.0);
  float I = (0.25 + uRaid * 1.6) * band * flick;
  gl_FragColor = vec4(vec3(0.62, 0.42, 1.0) * max(I, 1.0), min(I, 1.0));
}`;
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uRaid;
uniform float uBeamGain;
varying vec2 vUv;
void main() {
  float fade = smoothstep(1.0, 0.25, vUv.y) * smoothstep(0.0, 0.04, vUv.y);
  float bands = 0.6 + 0.4 * sin(vUv.y * 40.0 - uTime * 8.0 + sin(vUv.x * 31.4) * 2.0);
  float I = uRaid * fade * bands * 1.3 * uBeamGain;
  gl_FragColor = vec4(vec3(0.7, 0.55, 1.0) * max(I, 1.0), min(I, 1.0));
}`;
const MOTE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uRaid;
uniform float uScale;
varying float vA;
varying vec3 vC;
void main() {
  float sp = (0.25 + aSeed.y * 0.5) * (1.0 + uRaid * 3.0);
  float ang = aSeed.x * 6.2831 + uTime * sp;
  float rad = 2.3 + (aSeed.z - 0.5) * (0.9 + uRaid * 2.5);
  float fwd = (aSeed.w - 0.5) * 0.8 + uRaid * fract(aSeed.w * 7.0 + uTime * 0.35) * 6.0;
  vec3 p = vec3(cos(ang) * rad, sin(ang) * rad, fwd);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.09 + 0.12 * uRaid) * uScale / -mv.z;
  vA = (0.35 + 0.65 * uRaid) * (0.6 + 0.4 * sin(uTime * 4.0 + aSeed.x * 40.0));
  vC = mix(vec3(0.45, 0.95, 1.0), vec3(1.0, 0.45, 0.95), step(0.5, aSeed.y));
}`;
const MOTE_FRAG = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float I = smoothstep(0.5, 0.0, d) * vA * 2.0;
  gl_FragColor = vec4(vC * max(I, 1.0), min(I, 1.0));
}`;

export function Portal({ quality, overlay = false }: { quality: 'low' | 'high'; overlay?: boolean }) {
  const kit = useKit();
  const p = getPoi('portal')?.position ?? { x: 0, z: -24 };
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const beam = useRef<THREE.Mesh>(null);
  const res = useMemo(() => {
    const P = new Prims();
    const stones = new Batch();
    const runes = new Batch();
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      stones.add(P.rbox(0.86, 0.62, 0.95, 0.08), i % 2 ? '#a39d91' : '#b1ab9f', mtx(Math.cos(a) * 2.32, Math.sin(a) * 2.32, 0, 0, 1, 1, 1, 0, a + Math.PI / 2));
      if (i % 2 === 0) runes.add(P.box(), i % 4 ? '#b98cff' : '#6ff3ff', mtx(Math.cos(a) * 2.32, Math.sin(a) * 2.32, 0.49, 0, 1, 1, 1, 0, a + Math.PI / 2).multiply(mtx(0, 0, 0, 0, 0.3, 0.12, 0.03)));
    }
    const stoneGeo = stones.build();
    const runeGeo = runes.build();
    P.dispose();
    const uniforms = { uTime: kit.uniforms.uTime, uRaid: { value: 0 } };
    const discMat = new THREE.ShaderMaterial({ vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const haloMat = new THREE.ShaderMaterial({ vertexShader: DISC_VERT, fragmentShader: HALO_FRAG, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    const beamMat = new THREE.ShaderMaterial({ vertexShader: DISC_VERT, fragmentShader: BEAM_FRAG, uniforms: { ...uniforms, uBeamGain: { value: overlay ? 0.38 : 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    const runeMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const discGeo = new THREE.CircleGeometry(2.05, 48);
    const haloGeo = new THREE.PlaneGeometry(7.4, 7.4);
    const beamGeo = new THREE.CylinderGeometry(1.5, 2.1, 60, 28, 1, true);
    const M = quality === 'high' ? 320 : 140;
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    const seeds = new Float32Array(M * 4);
    for (let i = 0; i < M * 4; i++) seeds[i] = Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
    moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const moteMat = new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { ...uniforms, uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    // Grounding plinth (used in overlay mode, where the town's own plinth is not drawn)
    const P2 = new Prims();
    const plinth = new Batch();
    plinth.add(P2.cyl(28), '#a9a397', mtx(0, 0.13, 0, 0, 3.4, 0.26, 3.0));
    plinth.add(P2.cyl(28), '#bdb6a8', mtx(0, 0.36, 0, 0, 2.8, 0.22, 2.3));
    for (const sx of [-1, 1]) plinth.add(P2.rbox(0.9, 2.1, 1.0, 0.08), '#9a9488', mtx(sx * 2.55, 1.35, 0));
    const plinthGeo = plinth.build();
    P2.dispose();
    return { stoneGeo, runeGeo, discMat, haloMat, beamMat, runeMat, discGeo, haloGeo, beamGeo, moteGeo, moteMat, uniforms, plinthGeo };
  }, [kit, quality, overlay]);
  useEffect(() => () => {
    for (const r of [res.stoneGeo, res.runeGeo, res.discMat, res.haloMat, res.beamMat, res.runeMat, res.discGeo, res.haloGeo, res.beamGeo, res.moteGeo, res.moteMat, res.plinthGeo]) r.dispose();
  }, [res]);

  useFrame((state, dt) => {
    const env = kit.env;
    const age = env.t - kit.fx.raidAt;
    const raid = age >= 0 && age <= RAID_DURATION ? smooth(0, 1.4, age) * (1 - smooth(RAID_DURATION - 3, RAID_DURATION, age)) : 0;
    env.raid = raid;
    res.uniforms.uRaid.value = raid;
    const flash = age >= 0 && age < 3 ? Math.exp(-Math.max(0, age - 0.15) * 2.5) : 0;
    if (ring.current) {
      ring.current.rotation.z += dt * (0.04 + raid * 1.6);
      const s = 1 + raid * 0.16 + flash * 0.05;
      ring.current.scale.setScalar(s);
    }
    res.runeMat.color.setScalar(0.8 + env.lights * 1.5 + raid * 3.5);
    if (light.current) light.current.intensity = 2 + env.lights * 5 + raid * 30 + flash * 80;
    if (beam.current) beam.current.visible = raid > 0.01;
    // keep the opening flash, then settle to ~30 % so the beam never washes out the shot
    const settle = age < 0.4 ? 1 : Math.max(0.3, 1 - ((age - 0.4) / 0.8) * 0.7);
    res.beamMat.uniforms.uBeamGain!.value = (overlay ? 0.38 : 1) * settle;
    // Overlay: the portal only appears (grounded on its plinth) while a raid is happening.
    if (overlay && root.current) {
      root.current.visible = raid > 0.01;
      root.current.scale.setScalar(Math.max(0.001, Math.min(1, raid * 1.4)));
    }
    const cam = state.camera as THREE.PerspectiveCamera;
    res.moteMat.uniforms.uScale!.value = (state.size.height * state.viewport.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 45) / 2)));
  });

  return (
    <group ref={root} position={[p.x, 0, p.z]} visible={!overlay}>
      {overlay && <mesh geometry={res.plinthGeo} material={kit.solid} castShadow receiveShadow />}
      <group position={[0, 2.65, 0]}>
        <group ref={ring}>
          <mesh geometry={res.stoneGeo} material={kit.solid} castShadow receiveShadow />
          <mesh geometry={res.runeGeo} material={res.runeMat} />
        </group>
        <mesh geometry={res.discGeo} material={res.discMat} renderOrder={7} />
        <mesh geometry={res.haloGeo} material={res.haloMat} position={[0, 0, 0.05]} renderOrder={8} />
        <points geometry={res.moteGeo} material={res.moteMat} frustumCulled={false} renderOrder={9} />
      </group>
      <mesh ref={beam} geometry={res.beamGeo} material={res.beamMat} position={overlay ? [0, 9, 0] : [0, 30, 0]} scale={overlay ? [0.42, 0.3, 0.42] : [0.5, 1, 0.5]} visible={false} renderOrder={9} />
      <pointLight ref={light} position={[0, 2.6, 1.6]} color="#b28cff" intensity={2} distance={16} decay={1.5} />
    </group>
  );
}

function smooth(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
