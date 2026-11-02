# Downtown district — credits & licences

The district (`src/scene/district/**`) is **100 % procedural code written for HELLO WORLD**.
It ships **no third-party binary assets** (no GLB/textures/fonts): the window textures and the
rooftop "HELLO WORLD" sign are drawn at runtime on a `<canvas>` (system font stack); all geometry
is generated in `build.ts` from the deterministic plan in `plan.ts`.

## Inspiration (no code or assets copied)
- **ProceduralBuildingsThreeJS** — https://github.com/achrefelouafi/ProceduralBuildingsThreeJS
  MIT License, Copyright (c) 2026 mohamedachrefelouafi.
  Its idea of assembling buildings from stacked facade modules (bays × floors, plinth,
  setbacks, cornices, rooftop props) inspired the generator here. No source file, shader or
  `public/assets/kit.glb` from that repository was copied or bundled, so its licence
  notice is not legally required; it is credited here as a courtesy.

## Considered, not used
- **Quaternius — Downtown City MegaKit** (CC0) — https://quaternius.com/packs/downtowncitymegakit.html
  Downloads are served through itch.io / Google Drive buttons that could not be scripted
  inside the time box, so nothing from the pack is included. (CC0 would allow it later.)
