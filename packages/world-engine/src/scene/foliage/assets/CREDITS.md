# Foliage assets — credits & licence

The tree meshes (`tree-*.glb`) and the leaf atlas (`leaf-atlas.png`) in this folder were
**generated offline** with the procedural tree generator and leaf-spray rasteriser of
**super-terrain** — https://github.com/vibe-stack/super-terrain (commit `b82e823`),
MIT License, Copyright (c) 2026 alightinastorm (x.com/alightinastorm).

What was used (executed in Node via `../tools/bake-trees.cts`; no super-terrain source is
shipped in the runtime bundle — only the generated data plus our own WebGL renderer):

- `src/tree/generator/compileTree.ts` (+ `semanticGraph`, `woodMesher`, `foliageCompiler`,
  `speciesCatalog`, `types` …): species `european-beech` (broadleaf, seed 1201; autumn,
  seed 5501), `norway-spruce` (conifer), `silver-birch` (birch), `field-oak` (blossom); LOD 2
  ("far") wood topology + leaf-card instances.
- `src/tree/materials/leafSprayAtlas.ts` (`bakeLeafSpray` → `leaf/raster`, `blade`, `layout`,
  `pigment`, `profiles`, `dilate`, …): 3 spray variants per species at 512², box-downsampled
  to 128² tiles (15 tiles in a 4×4 grid → 512² atlas).

Our post-processing: height normalised to 5.2–7 m; woody mesh simplified to ~45 % of its
triangles with **meshoptimizer** (MIT, © Arseny Kapoulkine — already in the workspace's
pnpm store, used offline only, not shipped); leaf cards merged into one mesh and enlarged
×1.4; normals biased outward for soft crowns; atlas luminance remapped onto a pastel colour
ramp per variant (blossom = pink, autumn = orange); custom minimal GLB/PNG writers.

At runtime `GeneratedTrees.tsx` (our code) renders these with three.js `MeshStandardMaterial`
(WebGL) and bakes its own impostor atlas from the same meshes.

Rebuild: `cd packages/world-engine && npx tsx src/scene/foliage/tools/bake-trees.cts`
(needs a local clone; `SUPER_TERRAIN=/path/to/super-terrain`).

---

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
