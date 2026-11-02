# Realistic avatar assets — sources, licences, attribution

Every file in this folder comes from the **Valdrada** dataset. Its code is MIT (https://github.com/mkturkcan/valdrada) and
its binary assets are at https://huggingface.co/datasets/mehmetkeremturkcan/valdrada under `Content/models/peds24/`. Two
different licences apply, depending on the base model.

## 1. Photoreal bodies (`mh-*`): CC BY 4.0 **and** the Epic MetaHuman licence

*Pedestrian models: CARLA Simulator (carla.org), CC BY 4.0.* Valdrada converted these from the CARLA 0.10.0 walkers
(https://carla.org, licence https://creativecommons.org/licenses/by/4.0/).

Changes made by Valdrada: glTF + meshopt export, packing into texture arrays, recalibrated skin tones.

Changes made here: the texture-array layers were transcoded and re-encoded as WebP. Skin and face layers and hair are
1024²; clothing and eye layers are 512². Props are hidden at load time. The skeleton bind data was copied from the
dataset manifest into `../bodies.ts`. One change to the variant table: `mh-amara` uses eye layer 15 (dark-brown iris)
instead of 21.

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
| `tex/a9.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 9, 512² WebP |
| `tex/a15.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 15, 512² WebP |
| `tex/a25.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 25, 512² WebP |
| `tex/a29.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 29, 512² WebP |
| `tex/a37.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 37, 512² WebP |
| `tex/a38.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 38, 512² WebP |
| `tex/a39.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 39, 1024² WebP |
| `tex/a40.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 40, 1024² WebP |
| `tex/a47.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 47, 512² WebP |
| `tex/a48.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 48, 512² WebP |
| `tex/a54.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 54, 1024² WebP |
| `tex/a55.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 55, 1024² WebP |
| `tex/a64.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 64, 512² WebP |
| `tex/a75.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 75, 1024² WebP |
| `tex/a76.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 76, 1024² WebP |
| `tex/a77.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 77, 512² WebP |
| `tex/a78.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 78, 512² WebP |
| `tex/a79.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 79, 1024² WebP |
| `tex/a80.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 80, 1024² WebP |
| `tex/a81.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/albedo.ktx2 | albedo layer 81, 1024² WebP |
| `tex/h3.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair (RGBA) layer 3, 1024² WebP |
| `tex/h5.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair (RGBA) layer 5, 1024² WebP |
| `tex/h7.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair (RGBA) layer 7, 1024² WebP |
| `tex/h8.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair (RGBA) layer 8, 1024² WebP |
| `tex/h13.webp` | CC BY 4.0 + MetaHuman | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/tex/hair.ktx2 | hair (RGBA) layer 13, 1024² WebP |
| `tex/ra6.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 6, 512² WebP |
| `tex/ra7.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 7, 1024² WebP |
| `tex/ra34.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 34, 512² WebP |
| `tex/ra35.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 35, 1024² WebP |
| `tex/ra42.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 42, 512² WebP |
| `tex/ra43.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 43, 1024² WebP |
| `tex/ra78.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 78, 512² WebP |
| `tex/ra79.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/albedo.ktx2 | albedo layer 79, 1024² WebP |
| `tex/rh0.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/hair.ktx2 | hair (RGBA) layer 0, 1024² WebP |
| `tex/rh14.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/hair.ktx2 | hair (RGBA) layer 14, 1024² WebP |
| `tex/rh18.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/hair.ktx2 | hair (RGBA) layer 18, 1024² WebP |
| `tex/rh28.webp` | MIT (Rocketbox) | https://huggingface.co/datasets/mehmetkeremturkcan/valdrada/resolve/main/Content/models/peds24/rb27/tex/hair.ktx2 | hair (RGBA) layer 28, 1024² WebP |
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
bc1433a046749f8c134a14d022534c614dc9262e70e8b435ec40ca15d323587a  tex/a15.webp
60f6d8519eae7c22d5597d25c824b5a7183be4fe5bb717eb20dfba1c41e29211  tex/a25.webp
a1636f545e7cf66079afe306375e341006d589476afe0844278cacf0490192fc  tex/a29.webp
661b935ac14da698c87fd47efda8b1b3c0d6be0e611f02f87e4291d39f597e43  tex/a37.webp
a8a79eec9392ca3a29e143917d64116528297e65dd6e605dee502e37c9e4cc0f  tex/a38.webp
4f9b32843a9cccaa5152a6c6e57238a222cdf51e5a1f655161191b6167d13ef0  tex/a39.webp
bf13e9dbdd24463a7ffea901eeb05bcb3509f943836100d75ad9ab8d1c14b271  tex/a40.webp
9e10e653e9badcd0cd9b457ad46df393b5057d55d6205cdf7c7a1094ae02b312  tex/a47.webp
2f5e45c1b8a8c5415c1b7ca2ee73678c8b5d68456bf82b9c457682162bed30be  tex/a48.webp
2336c226cf29548c3ae627fe17f64464824f97ba44797dfa17ebf7bbc189f7cb  tex/a54.webp
23d423c53e51f7008b70fa2b2dd8112c007a301222b6f8e7a4d5ce80e60ed254  tex/a55.webp
9a646282f31dbea2acc2cf929ebc541cd11c5245df7b475e4105407ea4133607  tex/a64.webp
fa7746fdd7e786eb1a382129a5d1af83d29b76184f661537b02525f987a72e2c  tex/a75.webp
27ac735417cb116c30ed3427eab14fecf4b111c8e6078272a74afa06c6aa366b  tex/a76.webp
6e72014af261abce193e64e8d517916d6f5f54b6f842682786b53cebaa1440b5  tex/a77.webp
6e72014af261abce193e64e8d517916d6f5f54b6f842682786b53cebaa1440b5  tex/a78.webp
67b9d5f610846ec2084b693bd1135521d82c9b9509633fb964b5a59ead8bdedd  tex/a79.webp
1408ccc1f05696a8bb788b8d76a926a5c0485b0eec6650b3df3bb94396353023  tex/a80.webp
9d84769dda74b48a7a4a136bdc741c8a6a48b627879a6a9e191de2d068f34bd7  tex/a81.webp
9058065270907b490f55eb1a17258c9d05e7c842607d5b250e2f27ebac819d09  tex/a9.webp
a41aec009a421cfa5ba50350d62b6e8de34ca02e435bd5373fd2c2b4847ed223  tex/h13.webp
2914a0d2ebdd31b4f8eda900f2e197ec4497289951d4c2cd477dbb1f26caffd8  tex/h3.webp
4ba162515a547ae06bb127e2e432a5d4d61827df04b0e62b318d4e9c997c767a  tex/h5.webp
0770846a504a110e7a18ef2d4a768f1b5967aeba4e4653c822a067569fe70896  tex/h7.webp
97f7d09dad2ee5987c8dac66ab079f344fed29e72b2d9ef31755ec43314378b0  tex/h8.webp
824577905523e516d78ba0619401440232cfdcef85c0cb618789332ccd148aeb  tex/ra34.webp
7adf995f040a1c2ec110a26437d9442a67c553689005bb8fec3bf19a30157350  tex/ra35.webp
98b85715b247849a64e3073cd8e45c5e11162cc841584ae60896a7c9e882261a  tex/ra42.webp
a2c33f60e0437ff76bf2c405b42c38b890f63323456ef5732e88baa1881fd272  tex/ra43.webp
234721cec4dbf9478e09c602e771179064168c64b18651c99184e59211d31763  tex/ra6.webp
38f622a1c4cc3702020ad23c7cbf60cdc60beceb40a5bfba280791826d84926a  tex/ra7.webp
94c7c3d863378981ed20f5201065e44c5261182d52e243364313634a08cd068f  tex/ra78.webp
b50cb1bf727bab42020c88764211109791bf01aa0766dc27d711ec99b33720a0  tex/ra79.webp
3bef721b2025afcfa9796985566073cdac3be18ba42379295316f2c60194dcad  tex/rh0.webp
4bc699cf5c7fad7853ecdc53a24b10ffa7b4341fecb5e9c46e67e11a86b0aaab  tex/rh14.webp
7ce72e097c0280c334a44a9fbb95593074c04279fd70f7fb45a6dd3984019a9a  tex/rh18.webp
8d3afff74487386a1e0b379f4f02c66038098f55dab2ec24ffc45bdcb70a744c  tex/rh28.webp
```
