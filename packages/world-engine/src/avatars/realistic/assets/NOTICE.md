# Realistic avatar assets — sources, licences, attribution

All files in this folder come from the **Valdrada** dataset (code MIT: https://github.com/mkturkcan/valdrada; binary assets:
https://huggingface.co/datasets/mehmetkeremturkcan/valdrada, `Content/models/peds24/`).

## Photoreal bodies (`mh-*` base models) — CC BY 4.0 **and** Epic MetaHuman licence

*Pedestrian models: CARLA Simulator (carla.org), CC BY 4.0.* Converted by Valdrada from the CARLA 0.10.0 walkers
(https://carla.org, licence https://creativecommons.org/licenses/by/4.0/). Changes: Valdrada's conversion (glTF, meshopt,
texture arrays, recalibrated skin tones); ours: texture-array layers extracted and re-encoded as 1024² WebP, props hidden
at load time, skeleton rest pose copied from the dataset manifest into `../bodies.ts`.

**MetaHuman notice.** These bodies contain components created with Epic Games' MetaHuman and are additionally subject to
Epic's MetaHuman licence (https://www.metahuman.com/license). They may be used for rendering / interactive use in this
app. They must **NOT** be used to build or enhance any database, or to train or test AI / machine-learning models —
this includes screenshots or other rendered output of these characters collected for such purposes. Do not include
these files or their renders in datasets.

| File | Source URL | Notes |
|---|---|---|
| `SK_EuroW_.glb` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/bodies/SK_EuroW_.glb | body as published (3 LODs, unchanged) |
| `SK_euroM_.glb` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/bodies/SK_euroM_.glb | body as published (3 LODs, unchanged) |
| `SK_AfroW_03_GEN23.glb` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/bodies/SK_AfroW_03_GEN23.glb | body as published (3 LODs, unchanged) |
| `SK_AsiaM_v2.glb` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/bodies/SK_AsiaM_v2.glb | body as published (3 LODs, unchanged) |
| `tex/a15.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 15) | albedo layer 15, transcoded + WebP q80 |
| `tex/a21.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 21) | albedo layer 21, transcoded + WebP q80 |
| `tex/a25.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 25) | albedo layer 25, transcoded + WebP q80 |
| `tex/a29.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 29) | albedo layer 29, transcoded + WebP q80 |
| `tex/a37.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 37) | albedo layer 37, transcoded + WebP q80 |
| `tex/a38.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 38) | albedo layer 38, transcoded + WebP q80 |
| `tex/a39.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 39) | albedo layer 39, transcoded + WebP q80 |
| `tex/a40.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 40) | albedo layer 40, transcoded + WebP q80 |
| `tex/a47.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 47) | albedo layer 47, transcoded + WebP q80 |
| `tex/a48.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 48) | albedo layer 48, transcoded + WebP q80 |
| `tex/a54.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 54) | albedo layer 54, transcoded + WebP q80 |
| `tex/a55.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 55) | albedo layer 55, transcoded + WebP q80 |
| `tex/a64.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 64) | albedo layer 64, transcoded + WebP q80 |
| `tex/a75.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 75) | albedo layer 75, transcoded + WebP q80 |
| `tex/a76.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 76) | albedo layer 76, transcoded + WebP q80 |
| `tex/a77.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 77) | albedo layer 77, transcoded + WebP q80 |
| `tex/a78.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 78) | albedo layer 78, transcoded + WebP q80 |
| `tex/a79.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 79) | albedo layer 79, transcoded + WebP q80 |
| `tex/a80.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 80) | albedo layer 80, transcoded + WebP q80 |
| `tex/a81.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 81) | albedo layer 81, transcoded + WebP q80 |
| `tex/a9.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 (layer 9) | albedo layer 9, transcoded + WebP q80 |
| `tex/h13.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 (layer 13) | hair card layer 13 (RGBA), WebP q85 |
| `tex/h3.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 (layer 3) | hair card layer 3 (RGBA), WebP q85 |
| `tex/h5.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 (layer 5) | hair card layer 5 (RGBA), WebP q85 |
| `tex/h7.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 (layer 7) | hair card layer 7 (RGBA), WebP q85 |
| `tex/h8.webp` | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 (layer 8) | hair card layer 8 (RGBA), WebP q85 |
| `../bodies.ts` (data) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/manifest.json | skeleton rest pose + slot tables of the 4 bodies |

Base model ids: `mh-elena` = SK_EuroW_ (variant BP_Walker_FemaleEuro), `mh-marco` = SK_euroM_ (BP_Walker_MaleEuro),
`mh-amara` = SK_AfroW_03_GEN23 (BP_Walker_FemaleAfro03_v1), `mh-kenji` = SK_AsiaM_v2 (BP_Walker_MaleAsia_v2).

## SHA-256

```
e7414c492e0269c8a91a212fd0c7588a5133a6e0f4b4d92675df206444f9ad07  SK_AfroW_03_GEN23.glb
6410a8b2babf78ce4a0129c8e776c55c5c3bf8abb3c1f36970b84cc346dde1c6  SK_AsiaM_v2.glb
fb80d8eaa901ecc4f1e45105f64f960b3cab95d906078c13bf4ddeb2a5fda275  SK_EuroW_.glb
c303ddffeaf0b1c7e8995b9e87fc28488fcf8efa253e9615997c59edfe093ad5  SK_euroM_.glb
51500760d496cda7e1310f2cc6650595fd83256f2c97cd50a7a8ee69977de234  tex/a15.webp
e13634f0c49c7031e1821ef0d7213703896ef0d1c806178177d0c7f135630da4  tex/a21.webp
1b8655f01899904a5cee02bd90b16bd59f2bce12919e0e4b9ba940cd11677a86  tex/a25.webp
e4dabb9b4acf641e430f7e70ba4726ea3a5fc463f53a7bb522fbca0697c3addf  tex/a29.webp
b2e950bd39ba76058d0191a7899252c2f9814f110b9eecb1b0dd3877c4e92730  tex/a37.webp
0e833bba6ed2937dcfb1c86fe82abb36d0568791e0d10d4a1d34f21d993f6729  tex/a38.webp
4f9b32843a9cccaa5152a6c6e57238a222cdf51e5a1f655161191b6167d13ef0  tex/a39.webp
bf13e9dbdd24463a7ffea901eeb05bcb3509f943836100d75ad9ab8d1c14b271  tex/a40.webp
9e19aa15dbe3a71e71a3151a0fe829339678b3118bf29f1d08d422bfee9e9dc9  tex/a47.webp
539ffabaae4afcdb4d89e9a852ac5fb21c142e4f82be413ea6492c97690d58c2  tex/a48.webp
2336c226cf29548c3ae627fe17f64464824f97ba44797dfa17ebf7bbc189f7cb  tex/a54.webp
23d423c53e51f7008b70fa2b2dd8112c007a301222b6f8e7a4d5ce80e60ed254  tex/a55.webp
80dfe443ee556aae69b75c6ab51ddae7541bfc96003644f788a2c086bced53bd  tex/a64.webp
fa7746fdd7e786eb1a382129a5d1af83d29b76184f661537b02525f987a72e2c  tex/a75.webp
27ac735417cb116c30ed3427eab14fecf4b111c8e6078272a74afa06c6aa366b  tex/a76.webp
a02122bc6f2bc0cc0d00b8e121688c7842144300e9815f38417b0135691e129d  tex/a77.webp
a02122bc6f2bc0cc0d00b8e121688c7842144300e9815f38417b0135691e129d  tex/a78.webp
67b9d5f610846ec2084b693bd1135521d82c9b9509633fb964b5a59ead8bdedd  tex/a79.webp
1408ccc1f05696a8bb788b8d76a926a5c0485b0eec6650b3df3bb94396353023  tex/a80.webp
9d84769dda74b48a7a4a136bdc741c8a6a48b627879a6a9e191de2d068f34bd7  tex/a81.webp
cbb7c186240a343b16d8d029fb374d1c48117666bc0cf366052bf5516f751693  tex/a9.webp
93b57d552e100f20cc7a68b704640701dd0d20e27b9d0ae252417db56d48af7f  tex/h13.webp
541c35586942ded45e0e41db00948355fa8e4ca8125b6331ed31144bf38c32e2  tex/h3.webp
d01d05ca9590886c3b6996da934f41076c7677f3cac1f5d0e71b755b07e5e4b9  tex/h5.webp
97b0a5815c2e7e829d9b1f4d22271589fac1e078c0c015fe27390f0e7578f471  tex/h7.webp
6c3357a716bec84848d8d4ef30f42433f770322b642a04224a1dea7d0cb1a2a5  tex/h8.webp
```
