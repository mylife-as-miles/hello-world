# Realistic avatar assets — sources, licences, attribution

Every file in this folder comes from the **Valdrada** dataset. Its code is MIT (https://github.com/mkturkcan/valdrada) and
its binary assets are at https://huggingface.co/datasets/mehmetkeremturkcan/valdrada under `Content/models/peds24/`. Two
different licences apply, depending on the base model.

## 1. Photoreal bodies (`mh-*`): CC BY 4.0 **and** the Epic MetaHuman licence

*Pedestrian models: CARLA Simulator (carla.org), CC BY 4.0.* Valdrada converted these from the CARLA 0.10.0 walkers
(https://carla.org, licence https://creativecommons.org/licenses/by/4.0/).

Changes made by Valdrada: glTF + meshopt export, packing into texture arrays, recalibrated skin tones.

Changes made here: the texture-array layers were transcoded and re-encoded as 1024² WebP; props are hidden at load time;
the skeleton bind data was copied from the dataset manifest into `../bodies.ts`.

**MetaHuman notice.** These bodies contain components created with Epic Games' MetaHuman. They are therefore also covered
by Epic's MetaHuman licence (https://www.metahuman.com/license).

- **Allowed:** rendering and interactive use in this app.
- **Not allowed:** using them to build or enhance any database, or to train or test AI / machine-learning models. This
  also covers screenshots or other rendered output of these characters that is collected for such purposes.

Do not put these files, or renders of them, into datasets.

## 2. Rocketbox bodies (`rb-*`): MIT

The source is the Microsoft Rocketbox Avatar Library (https://github.com/microsoft/Microsoft-Rocketbox), from Valdrada's
`peds24/rb27` set. Valdrada re-bound the Biped skeleton to the CARLA GEN2 walker skeleton and packed the textures into
KTX2 arrays. Reference: Gonzalez-Franco et al., "The Rocketbox library and the utility of freely available rigged avatars",
Frontiers in Virtual Reality (2020), doi:10.3389/frvir.2020.561558.

    MIT License

    Copyright (c) 2020 Microsoft

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

## Files

| File | Licence | Source URL | Notes |
|---|---|---|---|
| `SK_EuroW_.glb` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/bodies/SK_EuroW_.glb | body as published (3 LODs, unchanged) |
| `SK_euroM_.glb` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/bodies/SK_euroM_.glb | body as published (3 LODs, unchanged) |
| `SK_AfroW_03_GEN23.glb` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/bodies/SK_AfroW_03_GEN23.glb | body as published (3 LODs, unchanged) |
| `SK_AsiaM_v2.glb` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/bodies/SK_AsiaM_v2.glb | body as published (3 LODs, unchanged) |
| `RB_Female_Adult_01.glb` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/bodies/RB_Female_Adult_01.glb | body as published (3 LODs, unchanged) |
| `RB_Male_Adult_01.glb` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/bodies/RB_Male_Adult_01.glb | body as published (3 LODs, unchanged) |
| `RB_Business_Female_01.glb` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/bodies/RB_Business_Female_01.glb | body as published (3 LODs, unchanged) |
| `RB_Business_Male_01.glb` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/bodies/RB_Business_Male_01.glb | body as published (3 LODs, unchanged) |
| `tex/a15.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 15, transcoded, WebP q80 |
| `tex/a21.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 21, transcoded, WebP q80 |
| `tex/a25.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 25, transcoded, WebP q80 |
| `tex/a29.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 29, transcoded, WebP q80 |
| `tex/a37.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 37, transcoded, WebP q80 |
| `tex/a38.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 38, transcoded, WebP q80 |
| `tex/a39.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 39, transcoded, WebP q80 |
| `tex/a40.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 40, transcoded, WebP q80 |
| `tex/a47.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 47, transcoded, WebP q80 |
| `tex/a48.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 48, transcoded, WebP q80 |
| `tex/a54.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 54, transcoded, WebP q80 |
| `tex/a55.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 55, transcoded, WebP q80 |
| `tex/a64.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 64, transcoded, WebP q80 |
| `tex/a75.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 75, transcoded, WebP q80 |
| `tex/a76.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 76, transcoded, WebP q80 |
| `tex/a77.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 77, transcoded, WebP q80 |
| `tex/a78.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 78, transcoded, WebP q80 |
| `tex/a79.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 79, transcoded, WebP q80 |
| `tex/a80.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 80, transcoded, WebP q80 |
| `tex/a81.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 81, transcoded, WebP q80 |
| `tex/a9.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 9, transcoded, WebP q80 |
| `tex/h13.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair layer 13 (RGBA), WebP q80 |
| `tex/h3.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair layer 3 (RGBA), WebP q80 |
| `tex/h5.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair layer 5 (RGBA), WebP q80 |
| `tex/h7.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair layer 7 (RGBA), WebP q80 |
| `tex/h8.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair layer 8 (RGBA), WebP q80 |
| `tex/ra34.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 34, transcoded, WebP q80 |
| `tex/ra35.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 35, transcoded, WebP q80 |
| `tex/ra42.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 42, transcoded, WebP q80 |
| `tex/ra43.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 43, transcoded, WebP q80 |
| `tex/ra6.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 6, transcoded, WebP q80 |
| `tex/ra7.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 7, transcoded, WebP q80 |
| `tex/ra78.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 78, transcoded, WebP q80 |
| `tex/ra79.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 79, transcoded, WebP q80 |
| `tex/rh0.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/hair.ktx2 | hair layer 0 (RGBA), WebP q80 |
| `tex/rh14.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/hair.ktx2 | hair layer 14 (RGBA), WebP q80 |
| `tex/rh18.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/hair.ktx2 | hair layer 18 (RGBA), WebP q80 |
| `tex/rh28.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/hair.ktx2 | hair layer 28 (RGBA), WebP q80 |
| `../bodies.ts` (data) | per body, as above | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/manifest.json, https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/manifest.json | inverse bind matrices + slot tables |

## Base model ids

| Id | Source body | Variant |
|---|---|---|
| `mh-elena` | SK_EuroW_ | BP_Walker_FemaleEuro |
| `mh-marco` | SK_euroM_ | BP_Walker_MaleEuro |
| `mh-amara` | SK_AfroW_03_GEN23 | BP_Walker_FemaleAfro03_v1 |
| `mh-kenji` | SK_AsiaM_v2 | BP_Walker_MaleAsia_v2 |
| `rb-sofia` | RB_Female_Adult_01 | — |
| `rb-daniel` | RB_Male_Adult_01 | — |
| `rb-claire` | RB_Business_Female_01 | — |
| `rb-james` | RB_Business_Male_01 | — |

## SHA-256

```
7d6e74bdcc580efe750cdc36bc16f03e9b2bdadb8f6b9e3dfff6508d4ad4f325  RB_Business_Female_01.glb
f1962aa991886c23e2d15c85f30f198cf561a24545c0c5bc8dc33d5bfc7fb767  RB_Business_Male_01.glb
c6e364fc139c1741afb0ae15594b3a6d1b159d64e9e1ce19b02af2d41022dae1  RB_Female_Adult_01.glb
74bab275a60e671c5f4cd5935b16784fb74833393934155aa0962cd9810a30ab  RB_Male_Adult_01.glb
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
a41aec009a421cfa5ba50350d62b6e8de34ca02e435bd5373fd2c2b4847ed223  tex/h13.webp
2914a0d2ebdd31b4f8eda900f2e197ec4497289951d4c2cd477dbb1f26caffd8  tex/h3.webp
4ba162515a547ae06bb127e2e432a5d4d61827df04b0e62b318d4e9c997c767a  tex/h5.webp
0770846a504a110e7a18ef2d4a768f1b5967aeba4e4653c822a067569fe70896  tex/h7.webp
97f7d09dad2ee5987c8dac66ab079f344fed29e72b2d9ef31755ec43314378b0  tex/h8.webp
02e38368098e714fa67855800384f4186cdeb8597d87e00b7e0d3140be97f26c  tex/ra34.webp
7adf995f040a1c2ec110a26437d9442a67c553689005bb8fec3bf19a30157350  tex/ra35.webp
6e01b9b562a5fa17833bc4050cb94694d1c9f5164222f850c9c0f2f1c537a415  tex/ra42.webp
a2c33f60e0437ff76bf2c405b42c38b890f63323456ef5732e88baa1881fd272  tex/ra43.webp
079747dca07811b772d4d84c2d3a08149723360065931d8365f23221cf732d09  tex/ra6.webp
38f622a1c4cc3702020ad23c7cbf60cdc60beceb40a5bfba280791826d84926a  tex/ra7.webp
3135fed9a9990836ff7671cb3d9d7c737d7d3a559dc54c8eacb7d01b0f215eda  tex/ra78.webp
b50cb1bf727bab42020c88764211109791bf01aa0766dc27d711ec99b33720a0  tex/ra79.webp
3bef721b2025afcfa9796985566073cdac3be18ba42379295316f2c60194dcad  tex/rh0.webp
4bc699cf5c7fad7853ecdc53a24b10ffa7b4341fecb5e9c46e67e11a86b0aaab  tex/rh14.webp
7ce72e097c0280c334a44a9fbb95593074c04279fd70f7fb45a6dd3984019a9a  tex/rh18.webp
8d3afff74487386a1e0b379f4f02c66038098f55dab2ec24ffc45bdcb70a744c  tex/rh28.webp
```
