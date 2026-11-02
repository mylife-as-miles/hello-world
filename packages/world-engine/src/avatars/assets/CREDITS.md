# Avatar assets — credits & licence evidence

All files in this folder are **CC0 1.0 (public domain dedication)** VRM avatars from
**100Avatars Round 1 by Polygonal Mind** (https://www.polygonalmind.com), used as
optional "guest skins" (`baseModelId: vrm-*`). No attribution is legally required by
CC0; we credit the authors anyway (also shown in the creator via `BASE_MODELS[].credit`).

| File | Avatar | Catalog id | Source URL (Arweave) | Size (bytes) | SHA-256 |
|---|---|---|---|---|---|
| polybot.vrm | 051 Polybot | `vrm-polybot` | https://arweave.net/DUR8v-IugXppdMBxPdE1rDO2dZCJJ7ZgBTXSRgPJFNo | 997048 | e255bace0d7de8b5fc90756efc83e167080e6db97692f23623fec5f1c67c423d |
| astrodisco.vrm | 027 Astrodisco | `vrm-astrodisco` | https://arweave.net/uS4wvZn6sURMWJuwWzWnCqGaqDtZSiQQdTwci0f6hmM | 1033356 | 6385ea72c79699a441a2d4590b7308170b46e140474003ee11055e0f0ba9e834 |
| coffee.vrm | 080 Coffee | `vrm-coffee` | https://arweave.net/JxV2leixFtpOsscIyelJzK6OSA84hnyrWZs7LAMfU8c | 1172848 | 9e4220df5d9866e948fb0862c8aa38983b25a97a1afcbdd89b5961cbd2b09a64 |
| chill.vrm | 012 Chill | `vrm-chill` | https://arweave.net/JCzmV7mgqDGNDu8YkdSMeJApOA09CCL2i71BqvJKCVs | 1124256 | 96c24da7c655705726af9bc9656742ad015d09489575709c79c093b35467f122 |

## Licence evidence (checked 2026-11-02)

1. **Registry**: ToxSam/open-source-avatars (https://github.com/ToxSam/open-source-avatars),
   `data/projects.json`, project `100avatars-r1` ("100Avatars R1", creator `Polygonal-Mind`):
   `"license": "CC0"`, `"storage_type": "arweave"`. The per-avatar list
   (`avatars/100avatars-r1.json`) gives the `model_file_url` values above.
2. **Embedded VRM 0.0 meta** of every file (read locally from the GLB JSON chunk):
   `title` = avatar name, `author: "Polygonal Mind"`, `licenseName: "CC0"`,
   `allowedUserName: "Everyone"`, `commercialUssageName: "Allow"`,
   `violentUssageName: "Allow"`, `sexualUssageName: "Allow"`,
   `contactInformation: "www.polygonalmind.com"`.
3. Polygonal Mind publishes the 100Avatars collection as free CC0 avatars.

## Technical notes
- All four are VRM 0.0 (exporter: saturday06 Blender VRM exporter), one mesh / one
  material / one texture, 2.1k–3.5k triangles, blend-shape groups A/E/I/O/U + Blink only
  (no emotion presets → happy/sad/angry/surprised/relaxed are no-ops on these).
- Files are used unmodified. Do NOT run gltfpack/gltf-transform on them (strips VRM data).
