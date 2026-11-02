/** Stylised animated water (ripples, sky fresnel, sparkles, night glow, ice under snow). */
import * as THREE from 'three';
import type { SceneKit } from './kit';

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uGlow;
uniform float uNight;
uniform float uSnow;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uRipple;
uniform float uOpacity;
varying vec3 vWorld;
float wave(vec2 p) {
  return sin(p.x * 2.1 + uTime * 1.3) * 0.5 + sin(p.y * 2.7 - uTime * 1.1) * 0.5 + sin((p.x + p.y) * 3.3 + uTime * 1.7) * 0.3;
}
void main() {
  vec2 p = vWorld.xz;
  float r = length(p - uCenter) / uRadius;
  float ring = (sin(r * 24.0 - uTime * 4.0) * 0.5 + 0.5) * smoothstep(1.0, 0.15, r) * uRipple;
  float w = wave(p * 1.7) * 0.25 + 0.5;
  vec3 col = mix(uDeep, uShallow, smoothstep(0.1, 1.0, r) * 0.55 + w * 0.3);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.5);
  col = mix(col, uSky, fres * 0.55 + 0.08);
  col += vec3(smoothstep(0.8, 0.98, w) * 0.35 + ring * 0.16);
  col += uGlow * uNight * (0.55 + 0.45 * w) * smoothstep(1.1, 0.0, r);
  col = mix(col, vec3(0.86, 0.92, 0.97), uSnow * 0.55);
  col = mix(col, vec3(0.96, 0.98, 1.0), smoothstep(0.86, 1.0, r) * 0.3);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createWaterMaterial(kit: SceneKit, center: { x: number; z: number }, radius: number, ripple: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    uniforms: {
      uTime: kit.uniforms.uTime,
      uSnow: kit.uniforms.uSnow,
      uDeep: { value: new THREE.Color('#2f8fb3') },
      uShallow: { value: new THREE.Color('#7fd3e3') },
      uSky: { value: new THREE.Color('#d6eef7') },
      uGlow: { value: new THREE.Color('#5fe0ff') },
      uNight: { value: 0 },
      uCenter: { value: new THREE.Vector2(center.x, center.z) },
      uRadius: { value: radius },
      uRipple: { value: ripple },
      uOpacity: { value: 0.92 },
    },
  });
}
