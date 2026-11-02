// @ts-nocheck — offline Node tool (npx tsx), not part of the runtime bundle.
// Offline bake: super-terrain (MIT, (c) alightinastorm) procedural tree generator
// -> compact GLB geometry + one shared leaf atlas PNG for HELLO WORLD (WebGL).
// CommonJS on purpose: tsx compiles the clone's TypeScript through require(), so its bare
// `three` import resolves via the NODE_PATH that `npx tsx` (pnpm shim) provides.
// Run: cd packages/world-engine && npx tsx src/scene/foliage/tools/bake-trees.cts
const { writeFileSync } = require('node:fs')
const { deflateSync } = require('node:zlib')
const { join } = require('node:path')
const ST = process.env.SUPER_TERRAIN ?? '/home/user/vibe-stack/super-terrain'
const { compileProceduralTree } = require(`${ST}/src/tree/generator/compileTree.ts`)
const { bakeLeafSpray } = require(`${ST}/src/tree/materials/leafSprayAtlas.ts`)
// meshoptimizer (MIT, Arseny Kapoulkine) — already in the workspace store; offline use only.
const MESHOPT = process.env.MESHOPT ?? '/home/user/hello-world/node_modules/.pnpm/meshoptimizer@1.1.1/node_modules/meshoptimizer/index.js'
const { MeshoptSimplifier } = require(MESHOPT)
const WOOD_RATIO = Number(process.env.WOOD_RATIO ?? 0.45) // keep ~45% of the generator's LOD-2 wood triangles

const OUT = process.env.OUT ?? join(__dirname, '../assets')
const LOD = Number(process.env.LOD ?? 2) as 0 | 1 | 2 // shipped assets: LOD 2
const TILE = 128 // atlas tile per spray variant
const VARIANTS_PER_SPECIES = 3 // leaf-spray tiles per species (5 species × 3 = 15 tiles in a 4×4 grid of 128² = 512²)
const CARD_SCALE = Number(process.env.CARD_SCALE ?? 1.4) // fuller, softer crowns than the realistic source
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
interface Spec { name: string; species: string; seed: number; height: number; dark: string; light: string }
const SPECS: Spec[] = [
  // dark/light = stylised pastel ramp the rasterised leaf luminance is remapped onto (matches the town palette)
  { name: 'broadleaf', species: 'european-beech', seed: 1201, height: 6.2, dark: '#4a8a36', light: '#b4dc62' },
  { name: 'conifer', species: 'norway-spruce', seed: 2203, height: 7.0, dark: '#2c6a47', light: '#86c06c' },
  { name: 'birch', species: 'silver-birch', seed: 3307, height: 6.6, dark: '#62a23e', light: '#d2ea7e' },
  { name: 'blossom', species: 'field-oak', seed: 4409, height: 5.2, dark: '#cf7299', light: '#ffd6e4' },
  { name: 'autumn', species: 'european-beech', seed: 5501, height: 5.8, dark: '#c8662c', light: '#ffc35e' },
]

// ---------------- PNG ----------------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
function crc32(buf: Uint8Array) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out
}
function png(rgba: Uint8Array, w: number, h: number) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())])
}

// ---------------- GLB ----------------
interface Prim { name: string; attrs: Record<string, { data: Float32Array; size: number }>; index: Uint32Array }
function glb(prims: Prim[]) {
  const views: Buffer[] = []; let offset = 0
  const json: any = { asset: { version: '2.0', generator: 'hello-world foliage bake (super-terrain generator)' }, buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [], meshes: [], nodes: [], scenes: [{ nodes: [] }], scene: 0 }
  const push = (b: Buffer, target: number) => { const pad = (4 - (b.length % 4)) % 4; json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length, target }); views.push(b, Buffer.alloc(pad)); offset += b.length + pad; return json.bufferViews.length - 1 }
  for (const p of prims) {
    const attributes: Record<string, number> = {}
    for (const [key, { data, size }] of Object.entries(p.attrs)) {
      const view = push(Buffer.from(data.buffer, data.byteOffset, data.byteLength), 34962)
      const acc: any = { bufferView: view, componentType: 5126, count: data.length / size, type: size === 2 ? 'VEC2' : size === 3 ? 'VEC3' : 'VEC4' }
      if (key === 'POSITION') { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < data.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], data[i + k]); mx[k] = Math.max(mx[k], data[i + k]) } acc.min = mn; acc.max = mx }
      json.accessors.push(acc); attributes[key] = json.accessors.length - 1
    }
    const vcount = p.attrs.POSITION.data.length / 3
    const idx = vcount < 65536 ? new Uint16Array(p.index) : p.index
    const iv = push(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength), 34963)
    json.accessors.push({ bufferView: iv, componentType: vcount < 65536 ? 5123 : 5125, count: idx.length, type: 'SCALAR' })
    json.meshes.push({ name: p.name, primitives: [{ attributes, indices: json.accessors.length - 1 }] })
    json.nodes.push({ name: p.name, mesh: json.meshes.length - 1 }); json.scenes[0].nodes.push(json.nodes.length - 1)
  }
  const bin = Buffer.concat(views); json.buffers[0].byteLength = bin.length
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)])
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8)
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4)
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jh, js, bh, bin])
}

// ---------------- atlas ----------------
const COLS = 4, ROWS = Math.ceil((SPECS.length * VARIANTS_PER_SPECIES) / COLS)
const atlasW = COLS * TILE, atlasH = ROWS * TILE
const atlas = new Uint8Array(atlasW * atlasH * 4)
/** [column, row] of a species' spray tile; tiles run row-major, top row first. */
const tileOf = (species: number, variant: number) => { const t = species * VARIANTS_PER_SPECIES + variant; return [t % COLS, Math.floor(t / COLS)] }
function downsample(src: Uint8Array, size: number, dst: number) {
  const out = new Uint8Array(dst * dst * 4), f = size / dst
  for (let y = 0; y < dst; y++) for (let x = 0; x < dst; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0, ur = 0, ug = 0, ub = 0
    for (let sy = 0; sy < f; sy++) for (let sx = 0; sx < f; sx++) { const i = ((y * f + sy) * size + x * f + sx) * 4; const al = src[i + 3]; r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; n++; ur += src[i]; ug += src[i + 1]; ub += src[i + 2] }
    // fully transparent texels keep the rasteriser's dilated colour so mips never fringe dark
    const o = (y * dst + x) * 4; out[o] = a ? r / a : ur / n; out[o + 1] = a ? g / a : ug / n; out[o + 2] = a ? b / a : ub / n; out[o + 3] = a / n
  }
  return out
}

async function main() {
await MeshoptSimplifier.ready
const report: string[] = []
SPECS.forEach((spec, row) => {
  const t0 = performance.now()
  const asset = compileProceduralTree({ species: spec.species as any, seed: spec.seed })
  const lod = asset.lods[LOD]
  const w = lod.wood
  // normalise to target height, ground at y=0
  let minY = Infinity, maxY = -Infinity
  for (let i = 1; i < w.positions.length; i += 3) { minY = Math.min(minY, w.positions[i]); maxY = Math.max(maxY, w.positions[i]) }
  const f = lod.foliage
  let cardMinY = Infinity, cardMaxY = -Infinity
  for (let c = 0; c < f.count; c++) { const ty = f.matrices[c * 16 + 13]; maxY = Math.max(maxY, ty); cardMinY = Math.min(cardMinY, ty); cardMaxY = Math.max(cardMaxY, ty) }
  const crownMidY = (cardMinY + cardMaxY) / 2
  const s = spec.height / (maxY - minY)
  const wp = new Float32Array(w.positions.length)
  for (let i = 0; i < wp.length; i += 3) { wp[i] = w.positions[i] * s; wp[i + 1] = (w.positions[i + 1] - minY) * s; wp[i + 2] = w.positions[i + 2] * s }
  // simplify the woody mesh (crown hides most twigs) and compact the vertex set
  const srcIdx = new Uint32Array(w.indices)
  const target = Math.max(300, Math.floor((srcIdx.length / 3) * WOOD_RATIO)) * 3
  const [simp] = MeshoptSimplifier.simplify(srcIdx, wp, 3, target, 0.03, [])
  const remap = new Int32Array(wp.length / 3).fill(-1)
  let used = 0
  for (const i of simp) if (remap[i] < 0) remap[i] = used++
  const cp = new Float32Array(used * 3), cn = new Float32Array(used * 3), cc = new Float32Array(used * 3)
  remap.forEach((to, from) => { if (to < 0) return; for (let k = 0; k < 3; k++) { cp[to * 3 + k] = wp[from * 3 + k]; cn[to * 3 + k] = w.normals[from * 3 + k]; cc[to * 3 + k] = w.colors[from * 3 + k] } })
  const ci = new Uint32Array(simp.length); simp.forEach((v, k) => { ci[k] = remap[v] })
  const wood: Prim = { name: 'wood', attrs: { POSITION: { data: cp, size: 3 }, NORMAL: { data: cn, size: 3 }, COLOR_0: { data: cc, size: 3 } }, index: ci }
  // merge leaf cards (flat quad x[-.5,.5] y[0,1]) with per-card matrix, atlas tile UVs
  const n = f.count, lp = new Float32Array(n * 12), ln = new Float32Array(n * 12), lc = new Float32Array(n * 12), lu = new Float32Array(n * 8), li = new Uint32Array(n * 6)
  const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]
  for (let c = 0; c < n; c++) {
    const m = f.matrices.subarray(c * 16, c * 16 + 16)
    const v = f.variants[c] % VARIANTS_PER_SPECIES
    let nx = m[8], ny = m[9], nz = m[10]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl
    corners.forEach(([cx, cy], k) => {
      const x = cx * CARD_SCALE, y = cy * CARD_SCALE
      const px = m[0] * x + m[4] * y + m[12], py = m[1] * x + m[5] * y + m[13], pz = m[2] * x + m[6] * y + m[14]
      const o = (c * 4 + k) * 3
      lp[o] = px * s; lp[o + 1] = (py - minY) * s; lp[o + 2] = pz * s
      // bias normals outward from the crown's mid-height (vertical part damped + an upward lean)
      // so crowns shade like soft domes and low cards (e.g. spruce skirts) never face the ground
      const hl = Math.hypot(px, pz) || 1, vy = (py - crownMidY) / (Math.hypot(px, py - crownMidY, pz) || 1)
      const bx = nx * 0.15 + (px / hl) * 0.75, by = ny * 0.15 + 0.5 + vy * 0.3, bz = nz * 0.15 + (pz / hl) * 0.75; const bl = Math.hypot(bx, by, bz) || 1
      ln[o] = bx / bl; ln[o + 1] = by / bl; ln[o + 2] = bz / bl
      lc[o] = f.colors[c * 3]; lc[o + 1] = f.colors[c * 3 + 1]; lc[o + 2] = f.colors[c * 3 + 2]
      const uo = (c * 4 + k) * 2
      const [tc, tr] = tileOf(row, v)
      const iu = 0.008 + (cx + 0.5) * 0.984, iv = 0.008 + cy * 0.984 // tiny inset: no mip bleed
      lu[uo] = (tc + iu) / COLS
      lu[uo + 1] = 1 - (tr + (1 - iv)) / ROWS
    })
    li.set([c * 4, c * 4 + 1, c * 4 + 2, c * 4, c * 4 + 2, c * 4 + 3], c * 6)
  }
  const leaves: Prim = { name: 'leaves', attrs: { POSITION: { data: lp, size: 3 }, NORMAL: { data: ln, size: 3 }, TEXCOORD_0: { data: lu, size: 2 }, COLOR_0: { data: lc, size: 3 } }, index: li }
  const file = glb([wood, leaves])
  writeFileSync(`${OUT}/tree-${spec.name}.glb`, file)
  // leaf atlas row: bake the generator's own spray rasteriser
  const tiles: Uint8Array[] = []
  const lums: number[] = []
  for (let v = 0; v < VARIANTS_PER_SPECIES; v++) {
    const spray = bakeLeafSpray(4242 ^ 0x5f3759df, spec.species as any, v, 512)
    const small = downsample(spray.albedo, spray.size, TILE)
    tiles.push(small)
    for (let i = 0; i < small.length; i += 4) if (small[i + 3] > 100) lums.push(0.3 * small[i] + 0.59 * small[i + 1] + 0.11 * small[i + 2])
  }
  lums.sort((a, b) => a - b)
  const lo = lums[Math.floor(lums.length * 0.04)] ?? 0, hi = lums[Math.floor(lums.length * 0.96)] ?? 255
  const D = hex(spec.dark), L = hex(spec.light)
  tiles.forEach((small, v) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const [tc, tr] = tileOf(row, v)
      const si = (y * TILE + x) * 4, di = ((tr * TILE + y) * atlasW + tc * TILE + x) * 4
      const l = 0.3 * small[si] + 0.59 * small[si + 1] + 0.11 * small[si + 2]
      const t = Math.min(1, Math.max(0, (l - lo) / Math.max(1, hi - lo)))
      const tt = t * t * (3 - 2 * t)
      for (let k = 0; k < 3; k++) atlas[di + k] = Math.round(D[k] + (L[k] - D[k]) * tt)
      atlas[di + 3] = small[si + 3]
    }
  })
  report.push(`${spec.name} (${spec.species}) lod${LOD}: ${(file.length / 1024).toFixed(1)} KB, wood ${w.indices.length / 3}->${ci.length / 3} tris, ${n} cards (${f.representation}/${f.cardGeometry}), gen ${(performance.now() - t0).toFixed(0)} ms`)
})
writeFileSync(`${OUT}/leaf-atlas.png`, png(atlas, atlasW, atlasH))
console.log(report.join('\n'))
console.log(`atlas ${atlasW}x${atlasH}`)
}
main().catch((error) => { console.error(error); process.exit(1) })
