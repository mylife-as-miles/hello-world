# Landscape — credits & licences

## super-terrain (code, MIT)

Portions of this folder are ported (copied and adapted to plain TypeScript /
classic WebGL three.js) from **super-terrain** — https://github.com/vibe-stack/super-terrain

```
MIT License

Copyright (c) 2026 alightinastorm (x.com/alightinastorm)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

| Our file | super-terrain source | What was taken |
| --- | --- | --- |
| `superTerrainNoise.ts` | `src/terrain/compiler/heightField.ts` (`ridgedMultifractal`, `billow`, `fbm`, `valueNoise`, `smoothFraction`, `hash2`), `src/terrain/core/bounds.ts` (`clamp`, `lerp`, `smoothstep`) | Noise primitives verbatim, minus the LOD band-limiting (`octaveGain`) |
| `terrain.ts` | `src/terrain/compiler/heightField.ts` → `sampleHeightField` | Landform composition: massif mask (spine × regional fbm), domain-warped ridged multifractal range (`RIDGE_SHARPNESS`, amplitudes), billow foothills, fbm plains, drainage-valley carving with flattened floors. Re-scaled (domain ×7.5, heights ÷7.5), radial spine, town blend, lake basin are ours |
| `forest.ts` | `src/tree/forestPresets.ts` → `generateForestLayoutInRegion`, `standCover`, `habitatNoise`, `gridHash`, `SpacingGrid`, `hashString`, `mulberry32` ('temperate-mixed' density/gap rate) | Region forest layout (rejection sampling, three-scale stand field, open-grown size bias, spacing grid). Region coverage (ring, slope, tree line, lake, district), species mix and scale are ours |

Not used: super-terrain's WebGPU/TSL rendering (`src/terrain/rendering/**`),
workers, BVH/CSG modules (three-mesh-bvh / three-bvh-csg / meshoptimizer are not
dependencies here), the tree mesh generator (used separately by
`src/scene/foliage`).

## Art assets

None. All colours are procedural vertex colours; no textures or models are
shipped in this folder.
