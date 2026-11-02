/** Animated fountain water: basin + bowls (shader), falling water sheets, bubbling jet. */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useKit } from './context';
import { createWaterMaterial } from './water';

const SHEET_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHEET_FRAG = /* glsl */ `
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
void main() {
  float s = fract(vUv.y * 2.5 + uTime * 1.4 + sin(vUv.x * 70.0) * 0.08);
  float streak = 0.55 + 0.45 * sin(vUv.x * 120.0 + sin(vUv.y * 9.0 + uTime) * 2.0);
  float a = (0.18 + 0.32 * smoothstep(0.1, 0.7, s)) * streak * smoothstep(0.0, 0.15, vUv.y);
  vec3 col = mix(vec3(0.82, 0.95, 1.0), vec3(0.55, 0.95, 1.0) * 1.6, uNight);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const JET_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uScale;
varying float vA;
void main() {
  float t = fract(uTime * 0.9 + aSeed * 7.31);
  float ang = aSeed * 6.2831 * 13.0;
  float T = 0.45;
  float tt = t * T;
  vec3 p = vec3(cos(ang) * 0.45 * t, 2.45 + 1.6 * tt - 4.9 * tt * tt, sin(ang) * 0.45 * t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 0.07 * uScale / -mv.z;
  vA = 1.0 - t * 0.6;
}`;
const JET_FRAG = /* glsl */ `
varying float vA;
uniform float uNight;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 col = mix(vec3(0.9, 0.98, 1.0), vec3(0.6, 0.95, 1.0) * 1.8, uNight);
  gl_FragColor = vec4(col, vA * smoothstep(0.5, 0.2, d) * 0.85);
  #include <colorspace_fragment>
}`;

export function Fountain() {
  const kit = useKit();
  const res = useMemo(() => {
    const basin = createWaterMaterial(kit, { x: 0, z: 0 }, 1.9, 1);
    const bowl = createWaterMaterial(kit, { x: 0, z: 0 }, 0.9, 0.6);
    const top = createWaterMaterial(kit, { x: 0, z: 0 }, 0.45, 0.4);
    const disc = (r: number) => { const g = new THREE.CircleGeometry(r, 40); g.rotateX(-Math.PI / 2); return g; };
    const sheetMat = new THREE.ShaderMaterial({
      vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: kit.uniforms.uTime, uNight: { value: 0 } },
    });
    const sheet1 = new THREE.CylinderGeometry(1.04, 1.2, 1.12, 40, 1, true);
    const sheet2 = new THREE.CylinderGeometry(0.52, 0.62, 0.5, 28, 1, true);
    const N = 140;
    const jetGeo = new THREE.BufferGeometry();
    jetGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) seeds[i] = i / N;
    jetGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const jetMat = new THREE.ShaderMaterial({
      vertexShader: JET_VERT, fragmentShader: JET_FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: kit.uniforms.uTime, uScale: { value: 600 }, uNight: { value: 0 } },
    });
    return { basin, bowl, top, d1: disc(1.9), d2: disc(0.9), d3: disc(0.46), sheetMat, sheet1, sheet2, jetGeo, jetMat };
  }, [kit]);
  useEffect(() => () => {
    for (const r of [res.basin, res.bowl, res.top, res.d1, res.d2, res.d3, res.sheetMat, res.sheet1, res.sheet2, res.jetGeo, res.jetMat]) r.dispose();
  }, [res]);
  useFrame(state => {
    const n = kit.env.lights;
    res.basin.uniforms.uNight!.value = n; res.bowl.uniforms.uNight!.value = n * 0.8; res.top.uniforms.uNight!.value = n * 0.6;
    res.sheetMat.uniforms.uNight!.value = n; res.jetMat.uniforms.uNight!.value = n;
    const cam = state.camera as THREE.PerspectiveCamera;
    res.jetMat.uniforms.uScale!.value = (state.size.height * state.viewport.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 45) / 2)));
  });
  return (
    <group>
      <mesh geometry={res.d1} material={res.basin} position={[0, 0.5, 0]} />
      <mesh geometry={res.d2} material={res.bowl} position={[0, 1.64, 0]} />
      <mesh geometry={res.d3} material={res.top} position={[0, 2.18, 0]} />
      <mesh geometry={res.sheet1} material={res.sheetMat} position={[0, 0.52 + 0.56, 0]} renderOrder={4} />
      <mesh geometry={res.sheet2} material={res.sheetMat} position={[0, 1.66 + 0.25, 0]} renderOrder={4} />
      <points geometry={res.jetGeo} material={res.jetMat} frustumCulled={false} renderOrder={5} />
    </group>
  );
}
