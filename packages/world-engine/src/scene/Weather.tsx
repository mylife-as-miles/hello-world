/** Rain streaks + drifting snow around the camera (GPU-animated, wrapped volume, capped counts). */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useKit } from './context';

const RAIN_VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uAmount;
varying float vA;
void main() {
  vec3 p = aSeed * uBox;
  float speed = 13.0 + fract(aSeed.x * 91.7) * 5.0;
  p.y = mod(p.y - uTime * speed, uBox.y);
  p.xz = mod(p.xz - uCenter.xz + uBox.xz * 0.5, uBox.xz) + uCenter.xz - uBox.xz * 0.5;
  p.y -= aEnd * 0.6;
  p.x -= aEnd * 0.1;
  float on = step(fract(aSeed.z * 53.1), uAmount);
  vA = on * (1.0 - aEnd * 0.7);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
varying float vA;
uniform float uAmount;
void main() { if (vA <= 0.0) discard; gl_FragColor = vec4(0.78, 0.85, 0.95, 0.42 * vA * uAmount); }`;

const SNOW_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uAmount;
uniform float uScale;
varying float vA;
void main() {
  vec3 p = aSeed * uBox;
  float speed = 0.9 + fract(aSeed.x * 71.3) * 0.7;
  p.y = mod(p.y - uTime * speed, uBox.y);
  p.x += sin(uTime * 0.7 + aSeed.z * 40.0) * 0.6;
  p.z += cos(uTime * 0.6 + aSeed.x * 40.0) * 0.6;
  p.xz = mod(p.xz - uCenter.xz + uBox.xz * 0.5, uBox.xz) + uCenter.xz - uBox.xz * 0.5;
  float on = step(fract(aSeed.y * 37.7), uAmount);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = on * (0.07 + fract(aSeed.z * 13.0) * 0.07) * uScale / -mv.z;
  vA = on;
}`;
const SNOW_FRAG = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5 || vA <= 0.0) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.15, d) * 0.92);
}`;

export function WeatherFx({ quality }: { quality: 'low' | 'high' }) {
  const kit = useKit();
  const rainN = quality === 'high' ? 2600 : 900;
  const snowN = quality === 'high' ? 2200 : 800;
  const rainRef = useRef<THREE.LineSegments>(null);
  const snowRef = useRef<THREE.Points>(null);
  const res = useMemo(() => {
    const box = new THREE.Vector3(70, 26, 70);
    const center = new THREE.Vector3();
    const rg = new THREE.BufferGeometry();
    const rs = new Float32Array(rainN * 6), re = new Float32Array(rainN * 2);
    for (let i = 0; i < rainN; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      rs.set([x, y, z, x, y, z], i * 6); re[i * 2] = 0; re[i * 2 + 1] = 1;
    }
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rainN * 6), 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(rs, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    const ru = { uTime: kit.uniforms.uTime, uCenter: { value: center }, uBox: { value: box }, uAmount: { value: 0 } };
    const rm = new THREE.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: ru, transparent: true, depthWrite: false });
    const sg = new THREE.BufferGeometry();
    const ss = new Float32Array(snowN * 3);
    for (let i = 0; i < snowN * 3; i++) ss[i] = Math.random();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(snowN * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 3));
    const su = { uTime: kit.uniforms.uTime, uCenter: { value: center }, uBox: { value: new THREE.Vector3(60, 24, 60) }, uAmount: { value: 0 }, uScale: { value: 600 } };
    const sm = new THREE.ShaderMaterial({ vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, uniforms: su, transparent: true, depthWrite: false });
    return { rg, rm, sg, sm, center };
  }, [kit, rainN, snowN]);
  useEffect(() => () => { res.rg.dispose(); res.rm.dispose(); res.sg.dispose(); res.sm.dispose(); }, [res]);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  useFrame(state => {
    const cam = state.camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(fwd);
    res.center.copy(cam.position).addScaledVector(fwd, 14);
    res.center.y = 0;
    const rain = kit.env.rain, snow = kit.env.snow;
    res.rm.uniforms.uAmount!.value = rain;
    res.sm.uniforms.uAmount!.value = snow;
    res.sm.uniforms.uScale!.value = (state.size.height * state.viewport.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 45) / 2)));
    if (rainRef.current) rainRef.current.visible = rain > 0.01;
    if (snowRef.current) snowRef.current.visible = snow > 0.01;
  });
  return (
    <group>
      <lineSegments ref={rainRef} geometry={res.rg} material={res.rm} frustumCulled={false} visible={false} />
      <points ref={snowRef} geometry={res.sg} material={res.sm} frustumCulled={false} visible={false} />
    </group>
  );
}
