# Third-party notices

## Irodori-TTS

チュートリアルの日本語ナレーションは、Irodori-TTSコードと `Aratako/Irodori-TTS-500M-v3` をローカル環境で使用して生成しました。

- Code: <https://github.com/Aratako/Irodori-TTS>
- Model: <https://huggingface.co/Aratako/Irodori-TTS-500M-v3>
- License shown by the code repository and model card: MIT

モデルカードには、本人の明示的同意がない声のなりすまし、および誤情報や欺瞞を目的とする合成音声を禁じる倫理上の制限が記載されています。本チュートリアルは、利用者が指定したローカル音声スロット `nyanluna` を製品説明だけに使用しています。

公開物には参照音声、音声スロットのメタデータ、モデル、codec、キャッシュ、仮想環境、生成ログを含めません。完成ナレーションにはIrodori-TTSのSilentCipherによる不可聴の `IRDTS` 透かしが含まれます。

## SilentCipher

Irodori-TTSが生成音声へ透かしを付与するために使用します。

- Source: <https://github.com/SesameAILabs/silentcipher>
- License: MIT

## RIT Artist Paint Spectral Database

`lib/paintCalibration.ts` は、Rochester Institute of Technology（RIT）のArtist Paint Spectral Databaseで公開された二定数Kubelka–Munkの吸収係数 `K(λ)` と散乱係数 `S(λ)` に由来する、次のGolden Heavy Body Acrylicプロファイルを収録しています。

- Pyrrole Red（製品番号1277、PR254）
- Cerulean Blue Chromium（製品番号1050、PB36）
- Hansa Yellow Opaque（製品番号1191、PY74）
- Bone Black（製品番号1010、PBk9）
- Titanium White（製品番号1380、PW6）

値は380–750 nm、10 nm間隔です。アプリは完全な測定ワークブックを再配布せず、下記Wacton.UnicolourのMITライセンス版 `ArtistPaint.cs` から上記5色の数値だけを転記しています。学術的な測定・導出条件はRITの論文を参照してください。

- RIT project and publications: <https://www.rit.edu/science/studio-scientific-imaging-and-archiving-cultural-heritage>
- RIT paper: <https://www.rit.edu/science/sites/rit.edu.science/files/2019-03/ArtistSpectralDatabase.pdf>
- Golden Artist Colors: <https://goldenartistcolors.com/>

GoldenおよびRITによる本プロジェクトへの提携・承認を意味しません。Golden、製品名およびColour Indexは、採用した測定プロファイルを特定する目的だけで記載しています。

## Golden shared drawdown reference subset

`tests/fixtures/goldenDrawdowns2014.mjs` は、Golden Artist Colorsが共有を許可し、Real-Time RenderingのGolden Paint Spectraページで公開されたHeavy Body Acrylic 78色ワークブックから、現行RITプロファイルと製品番号が一致する3色の反射率とCIE Lab参照値だけを収録します。

- Pyrrole Red（1277）
- Cerulean Blue Chromium（1050）
- Bone Black（1010）
- Source and sharing statement: <https://www.realtimerendering.com/golden.html>
- Workbook SHA-256: `584a38368c4af637a1253b6465b9f71493e38c65340092a0cfe9f73b3ed227cf`

試料は白Lenetaカード上の湿潤10 mil、乾燥後約6 mil、D65/10°、400–700 nm・10 nm間隔です。Golden自身が不透明塗膜の色を表すものではないと説明しているため、本番のK・Sへは使わず、独立した分光形状回帰テストだけに使用します。Goldenはデータ共有を明示していますが標準オープンライセンスは表示していません。このサブセットは本プロジェクトのMIT Licenseで再許諾されません。

Goldenの製品ページに掲載されたスウォッチ画像は複製していません。研究台帳では製品識別と目視参照のため、公式ページへリンクするだけです。

## Wacton.Unicolour ArtistPaint transcription

RIT由来の `K`、`S`、Saunderson係数（`k1 = 0.03`、`k2 = 0.65`）の数値転記元です。

- Project: <https://gitlab.com/Wacton/Unicolour>
- Source file (commit固定): <https://gitlab.com/Wacton/Unicolour/-/blob/3c888f040d89117a7c452076097beabd7ed766c8/Unicolour.Datasets/ArtistPaint.cs>
- Commit: `3c888f040d89117a7c452076097beabd7ed766c8`
- `ArtistPaint.cs` SHA-256: `43c454d8e17f040ee82a1fde4aabd6c8bd0c30a7d2e99b5c0dfe0ca871870e2c`
- 収録5色のK・S配列JSON SHA-256: `9a125f240286f3f8f17c76b6f3da4532fcfae52e5bf357827e49b79a1cc372a2`
- License: MIT

RITの原測定はSPINです。ここで使うSPEXはWacton.Unicolourが選んだ表示ジオメトリ／レンダリング仮定であり、RITの測定条件ではありません。

```text
MIT License

Copyright (c) 2022-2026 William Acton

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

## CIE open colourimetric datasets

`lib/cieD65.ts` は、CIE 1931 2°標準観測者の等色関数とCIE標準イルミナントD65の公式1 nmデータを、絵の具プロファイルと同じ380–750 nm・10 nm間隔へ抽出して収録しています。このファイルのデータ部分にはCreative Commons Attribution-ShareAlike 4.0 International（CC BY-SA 4.0）が適用されます。

- CIE 1931 colour-matching functions, 2 degree observer: <https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer>
- Official CMF CSV: <https://files.cie.co.at/CIE_xyz_1931_2deg.csv>（DOI: `10.25039/CIE.DS.xvudnb9b`、MD5: `17cca777db64b17170f06f67ce9d3ab7`、SHA-256: `fa663e3535a7e0763a745993a1f0a192eb0275ac46ad2d1befd7626841e713c1`）
- CMF metadata: <https://files.cie.co.at/CIE_xyz_1931_2deg.csv_metadata.json>
- CIE standard illuminant D65: <https://www.cie.co.at/datatable/cie-standard-illuminant-d65>
- Official D65 CSV: <https://files.cie.co.at/CIE_std_illum_D65.csv>（DOI: `10.25039/CIE.DS.hjfjmt59`、SHA-256: `e76f210bffff3d552ef7113025da5f325d5dfec200dd4b878b1a2f3a507032cb`）
- D65 metadata: <https://files.cie.co.at/CIE_std_illum_D65.csv_metadata.json>
- License: <https://creativecommons.org/licenses/by-sa/4.0/>

抽出値そのものは変更せず、配列形式への整形と対象波長の選択だけを行っています。本アプリ全体のMIT Licenseは、上記CC BY-SA 4.0データへ上書き適用されません。

## アプリの依存関係

JavaScript依存関係の正確な版と配布元は `package-lock.json` に固定しています。再配布やホスティングを行う人は、各パッケージのライセンスを公開形態に合わせて確認してください。

## プロジェクト固有素材

画面、ロゴ、スクリーンショット、塗り絵、チュートリアルの構成はカラーレシピ用に制作したものです。本プロジェクトはCopyright (c) 2026 Lunanecoのもと、MIT Licenseで公開します。第三者技術には、それぞれのライセンスが適用されます。
