/**
 * WebGPU presentation adapter for the same scene graph and authoritative runtime.
 * GLSL-only effects receive node materials; animated particle buffers are rendered
 * as capped instanced quads (WebGPU point primitives are fixed at one pixel).
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  color,
  float,
  length,
  mix,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";

type Shader = THREE.ShaderMaterial & {
  color?: THREE.Color;
  map?: THREE.Texture;
  isMToonMaterial?: boolean;
};
type Drawable = THREE.Object3D & {
  material?: THREE.Material | THREE.Material[];
  geometry?: THREE.BufferGeometry;
  isPoints?: boolean;
  isLineSegments?: boolean;
  isMesh?: boolean;
};
type UniformValue = { value: unknown };
interface Adapted {
  source: THREE.Material;
  material: THREE.Material;
  update(): void;
}
interface Particle {
  object: Drawable;
  mesh: THREE.InstancedMesh;
  geometry: THREE.PlaneGeometry;
  material: MeshBasicNodeMaterial;
  alpha: THREE.InstancedBufferAttribute;
  update(time: number, camera: THREE.Camera): void;
}

const value = (shader: Shader, key: string, fallback = 0): number => {
  const result = shader.uniforms[key]?.value;
  return typeof result === "number" ? result : fallback;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const frac = (n: number) => n - Math.floor(n);
const wrap = (n: number, size: number) => ((n % size) + size) % size;

function flags(target: THREE.Material, source: THREE.Material) {
  target.name = `${source.name || source.type}:webgpu`;
  target.transparent = source.transparent;
  target.opacity = source.opacity;
  target.side = source.side;
  target.depthWrite = source.depthWrite;
  target.depthTest = source.depthTest;
  target.blending = source.blending;
  target.toneMapped = source.toneMapped;
  (target as THREE.Material & { fog?: boolean }).fog = (
    source as THREE.Material & { fog?: boolean }
  ).fog;
  target.alphaTest = source.alphaTest;
}

function nodeMaterial(source: Shader): Adapted {
  // Authored VRM MToon GLSL is WebGL-specific; use the same skinned mesh/maps with
  // standard shading. Bone animation, expressions and morph targets remain live.
  if (source.isMToonMaterial || source.type.includes("MToon")) {
    const material = new THREE.MeshStandardMaterial({
      color: source.color || "#ffffff",
      map: source.map,
      roughness: 0.82,
    });
    flags(material, source);
    return {
      source,
      material,
      update: () => {
        if (source.color) material.color.copy(source.color);
        material.opacity = source.opacity;
      },
    };
  }
  const material = new MeshBasicNodeMaterial();
  flags(material, source);
  const bindings: Array<{ target: { value: unknown }; source: UniformValue }> =
    [];
  // TSL's fluent node types deliberately stay local to this graphics adapter.
  const u = (
    name: string,
    fallback: number | THREE.Color | THREE.Vector3 = 0,
  ): any => {
    const original = source.uniforms[name] || { value: fallback };
    const node = uniform(original.value as number);
    bindings.push({
      target: node as unknown as { value: unknown },
      source: original,
    });
    return node;
  };
  const time = u("uTime");
  const fragment = source.fragmentShader;
  if (source.uniforms.uTop && source.uniforms.uHorizon) {
    const height: any = positionLocal.normalize().y.clamp(0, 1).pow(0.48);
    material.colorNode = mix(
      u("uHorizon", new THREE.Color("#d4ecfa")),
      u("uTop", new THREE.Color("#5aa0e6")),
      height,
    );
    material.side = THREE.BackSide;
    material.fog = false;
    material.depthWrite = false;
  } else if (source.uniforms.uDeep) {
    const wave: any = sin(positionWorld.x.mul(2.1).add(time.mul(1.3)))
      .add(sin(positionWorld.z.mul(2.7).sub(time)))
      .mul(0.22)
      .add(0.5);
    material.colorNode = mix(
      u("uDeep", new THREE.Color("#2f8fb3")),
      u("uShallow", new THREE.Color("#7fd3e3")),
      wave,
    ).add(u("uGlow", new THREE.Color("#5fe0ff")).mul(u("uNight")).mul(0.3));
    material.opacityNode = u("uOpacity", 0.92);
  } else if (fragment.includes("float sw =")) {
    const p: any = uv().mul(2).sub(1);
    const radius: any = length(p);
    const swirl: any = sin(p.x.mul(13).add(p.y.mul(11)).sub(time.mul(2)))
      .mul(0.5)
      .add(0.5);
    material.colorNode = mix(color("#3b1679"), color("#ed70db"), swirl).mul(
      u("uRaid").mul(2.4).add(1.05),
    );
    material.opacityNode = smoothstep(1, 0.86, radius);
  } else if (fragment.includes("float band =")) {
    const radius: any = length(uv().mul(2).sub(1));
    const band: any = float(1).sub(radius.sub(0.62).abs().mul(5)).max(0).pow(2);
    material.colorNode = color("#9e6bff").mul(u("uRaid").mul(1.6).add(0.25));
    material.opacityNode = band;
  } else if (fragment.includes("float bands =")) {
    const bands: any = sin(uv().y.mul(40).sub(time.mul(8)))
      .mul(0.4)
      .add(0.6);
    material.colorNode = color("#b38cff").mul(bands);
    material.opacityNode = u("uRaid").mul(smoothstep(1, 0.25, uv().y));
  } else if (source.uniforms.uI && source.uniforms.uColor) {
    material.colorNode = u("uColor", new THREE.Color("#ffc477"));
    material.opacityNode = float(1)
      .sub(length(uv().sub(0.5)).mul(2))
      .max(0)
      .pow(2)
      .mul(u("uI"));
  } else if (fragment.includes("float streak =")) {
    material.colorNode = color("#bdefff");
    material.opacityNode = sin(uv().y.mul(15).add(time.mul(5)))
      .mul(0.15)
      .add(0.3)
      .mul(smoothstep(0, 0.15, uv().y));
  } else {
    material.colorNode = source.uniforms.uColor
      ? u("uColor", new THREE.Color("#b5dcff"))
      : color("#b5dcff");
    material.opacityNode = float(source.transparent ? 0.65 : 1);
  }
  return {
    source,
    material,
    update: () => {
      for (const binding of bindings)
        binding.target.value = binding.source.value;
    },
  };
}

function particles(object: Drawable, source: Shader): Particle | null {
  const original = object.geometry;
  if (!original) return null;
  const seed = original.getAttribute("aSeed");
  const info = original.getAttribute("aInfo");
  const origin = original.getAttribute("aOrigin");
  const velocity = original.getAttribute("aVel");
  const colors = original.getAttribute("aColor");
  const confetti = Boolean(info && info.itemSize === 2 && origin);
  const count = Math.min(
    768,
    confetti
      ? (original as THREE.InstancedBufferGeometry).instanceCount
      : seed?.count ||
          info?.count ||
          original.getAttribute("position")?.count ||
          0,
  );
  if (!Number.isFinite(count) || count < 1) return null;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  alpha.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("hwAlpha", alpha);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.blending = source.blending;
  material.opacityNode = attribute("hwAlpha", "float").mul(
    confetti ? float(1) : smoothstep(0.5, 0.08, length(uv().sub(0.5))),
  );
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = object.renderOrder;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.webgpuEffect = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const c = new THREE.Color();
  const axis = new THREE.Vector3();
  object.add(mesh);
  source.visible = false;
  const update = (time: number, camera: THREE.Camera) => {
    parentQ.copy(object.getWorldQuaternion(q)).invert();
    const billboard = parentQ.multiply(camera.quaternion).clone();
    const center = source.uniforms.uCenter?.value as THREE.Vector3 | undefined;
    const box = source.uniforms.uBox?.value as THREE.Vector3 | undefined;
    const amount = value(source, "uAmount", 1);
    for (let i = 0; i < count; i++) {
      let opacity = 1,
        size = 0.1;
      q.copy(billboard);
      c.set("#ffffff");
      if (info && origin && velocity) {
        const age = time - info.getX(i);
        const life = confetti ? 5.6 : info.getY(i);
        if (age < 0 || age > life) opacity = 0;
        const dt = Math.max(0, age);
        const k = confetti ? 2 : 1.8;
        const drag = (1 - Math.exp(-k * dt)) / k;
        p.set(
          origin.getX(i) + velocity.getX(i) * drag,
          origin.getY(i),
          origin.getZ(i) + velocity.getZ(i) * drag,
        );
        if (confetti) {
          p.y += (velocity.getY(i) + 1.05) * drag - 1.05 * dt;
          const phase = info.getY(i);
          p.x += Math.sin(dt * 3.1 + phase) * 0.32 * Math.min(dt, 1);
          p.z += Math.cos(dt * 2.7 + phase) * 0.32 * Math.min(dt, 1);
          p.y = Math.max(0.06, p.y);
          const spin = original.getAttribute("aSpin");
          if (spin) {
            axis.set(spin.getX(i), spin.getY(i), spin.getZ(i)).normalize();
            q.setFromAxisAngle(axis, dt * spin.getW(i) + phase);
          }
          opacity *= clamp((5.6 - dt) / 1);
          size = 0.16;
        } else {
          p.y += velocity.getY(i) * drag - 0.7 * dt * dt;
          opacity *= clamp(1 - dt / life);
          size = info.getZ(i) * 0.8;
        }
        if (colors) c.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
      } else if (seed && seed.itemSize === 4) {
        const raid = value(source, "uRaid");
        const a =
          seed.getX(i) * 6.2831 +
          time * (0.25 + seed.getY(i) * 0.5) * (1 + raid * 3);
        const radius = 2.3 + (seed.getZ(i) - 0.5) * (0.9 + raid * 2.5);
        p.set(
          Math.cos(a) * radius,
          Math.sin(a) * radius,
          (seed.getW(i) - 0.5) * 0.8 +
            raid * frac(seed.getW(i) * 7 + time * 0.35) * 6,
        );
        opacity = 0.5 + raid * 0.5;
        size = 0.08 + raid * 0.12;
        c.set(seed.getY(i) < 0.5 ? "#6ff3ff" : "#ff82f2");
      } else if (seed && seed.itemSize === 1) {
        const t = frac(time * 0.9 + seed.getX(i) * 7.31),
          angle = seed.getX(i) * 6.2831 * 13,
          tt = t * 0.45;
        p.set(
          Math.cos(angle) * 0.45 * t,
          2.45 + 1.6 * tt - 4.9 * tt * tt,
          Math.sin(angle) * 0.45 * t,
        );
        size = 0.07;
        opacity = 1 - t * 0.6;
        c.set("#d2f4ff");
      } else if (seed && box && center) {
        const x = seed.getX(i),
          y = seed.getY(i),
          z = seed.getZ(i);
        const speed = 0.9 + frac(x * 71.3) * 0.7;
        p.set(
          wrap(
            x * box.x +
              Math.sin(time * 0.7 + z * 40) * 0.6 -
              center.x +
              box.x / 2,
            box.x,
          ) +
            center.x -
            box.x / 2,
          wrap(y * box.y - time * speed, box.y),
          wrap(
            z * box.z +
              Math.cos(time * 0.6 + x * 40) * 0.6 -
              center.z +
              box.z / 2,
            box.z,
          ) +
            center.z -
            box.z / 2,
        );
        opacity = frac(y * 37.7) <= amount ? 0.9 : 0;
        size = 0.07 + frac(z * 13) * 0.07;
      } else {
        const positions = original.getAttribute("position");
        p.set(positions.getX(i), positions.getY(i), positions.getZ(i));
      }
      scale.set(size, confetti ? size * 0.6 : size, size);
      if (opacity <= 0) scale.setScalar(0);
      m.compose(p, q, scale);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
      alpha.setX(i, opacity);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    alpha.needsUpdate = true;
  };
  return { object, mesh, geometry, material, alpha, update };
}

export function createWebGPUSceneAdapter() {
  const state = {
    materials: new Map<THREE.Material, Adapted>(),
    originals: new Map<Drawable, THREE.Material | THREE.Material[]>(),
    particles: new Map<Drawable, Particle>(),
  };
  const update = (scene: THREE.Object3D, camera: THREE.Camera) => {
    scene.traverse((candidate) => {
      const object = candidate as Drawable;
      if (object.userData.webgpuEffect || !object.material || !object.geometry)
        return;
      const sourceMaterials = state.originals.get(object) || object.material;
      const list = Array.isArray(sourceMaterials)
        ? sourceMaterials
        : [sourceMaterials];
      let changed = false;
      const adapted = list.map((source) => {
        if (!(source as Shader).isShaderMaterial) return source;
        const shader = source as Shader;
        if (
          object.isPoints ||
          (object.geometry as THREE.InstancedBufferGeometry)
            .isInstancedBufferGeometry
        ) {
          if (!state.particles.has(object)) {
            const effect = particles(object, shader);
            if (effect) state.particles.set(object, effect);
          }
          return source;
        }
        if (object.isLineSegments && shader.uniforms.uBox) {
          let result = state.materials.get(source);
          if (!result) {
            const material = new THREE.LineBasicMaterial({
              color: "#c7ddf4",
              transparent: true,
              opacity: 0.42,
            });
            result = {
              source,
              material,
              update: () => {
                const seed = object.geometry!.getAttribute("aSeed"),
                  end = object.geometry!.getAttribute("aEnd"),
                  positions = object.geometry!.getAttribute("position");
                const box = shader.uniforms.uBox!.value as THREE.Vector3,
                  center = shader.uniforms.uCenter!.value as THREE.Vector3,
                  t = value(shader, "uTime"),
                  amount = value(shader, "uAmount");
                for (let i = 0; i < positions.count; i++) {
                  const x = seed.getX(i),
                    y = seed.getY(i),
                    z = seed.getZ(i),
                    tail = end.getX(i);
                  const on = frac(z * 53.1) <= amount;
                  positions.setXYZ(
                    i,
                    wrap(x * box.x - center.x + box.x / 2, box.x) +
                      center.x -
                      box.x / 2 -
                      tail * 0.1,
                    on
                      ? wrap(y * box.y - t * (13 + frac(x * 91.7) * 5), box.y) -
                          tail * 0.6
                      : -10000,
                    wrap(z * box.z - center.z + box.z / 2, box.z) +
                      center.z -
                      box.z / 2,
                  );
                }
                positions.needsUpdate = true;
                material.opacity = amount * 0.42;
              },
            };
            state.materials.set(source, result);
          }
          changed = true;
          return result.material;
        }
        let result = state.materials.get(source);
        if (!result) {
          result = nodeMaterial(shader);
          state.materials.set(source, result);
        }
        changed = true;
        return result.material;
      });
      if (changed) {
        state.originals.set(object, sourceMaterials);
        object.material = Array.isArray(sourceMaterials) ? adapted : adapted[0];
      }
    });
    for (const result of state.materials.values()) result.update();
    for (const effect of state.particles.values()) {
      if (!effect.object.parent) continue;
      const source = (state.originals.get(effect.object) ||
        effect.object.material) as Shader;
      effect.update(value(source, "uTime"), camera);
    }
  };
  const dispose = () => {
      for (const [object, original] of state.originals)
        object.material = original;
      for (const effect of state.particles.values()) {
        effect.object.remove(effect.mesh);
        effect.geometry.dispose();
        effect.material.dispose();
        (
          (state.originals.get(effect.object) ||
            effect.object.material) as THREE.Material
        ).visible = true;
      }
      for (const result of state.materials.values()) result.material.dispose();
  };
  return { update, dispose };
}
