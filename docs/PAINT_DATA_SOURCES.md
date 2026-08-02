# 絵の具色見本・測色データ調査台帳

更新日: 2026-08-02

## 取り込み方針

色見本写真と測色値は役割を分ける。

- 写真・JPEG・画面用スウォッチは、製品名、質感、透明性、色相の大まかな目視確認にだけ使う。
- 分光反射率は、測定波長、照明、観測者、測定ジオメトリ、膜厚、下地、乾燥状態が明記されたものだけを数値検証へ使う。
- 二定数Kubelka–Munkの `K(λ)` と `S(λ)` は、反射率1本から安定して分離できない。既知膜厚の反射・透過、または同一塗膜の黒地・白地測定など、二つ以上の独立条件が必要である。
- 別の媒材、ブランド、膜厚、顔料濃度から得たK・SをGolden Heavy Body Acrylicへ直接移植しない。
- MIT公開物へ収録するデータは、再配布・商用利用・改変の条件を個別に確認する。「閲覧できる」「無料ダウンロードできる」は再配布許可と同義ではない。

## 現在の採否

| データ源 | 実物・測定内容 | ライセンス／公開条件 | このアプリでの扱い |
| --- | --- | --- | --- |
| [RIT Artist Paint Spectral Database](https://www.rit.edu/science/sites/rit.edu.science/files/2019-03/ArtistSpectralDatabase.pdf) | Golden Heavy Body Acrylicの不透明な実物塗膜。Macbeth MS7000積分球、SPIN、380–750 nm、10 nm。masstoneと既知濃度のTitanium White tintから二定数K・Sを推定 | 原測定の完全ワークブックは現在の公式ページから取得困難 | 5色の物理基準。MITのWacton転記から必要なK・Sだけを採用 |
| [Wacton.Unicolour](https://gitlab.com/Wacton/Unicolour) | 上記RITデータの数値転記と二定数実装 | MIT | 本番データの直接の数値転記元。コミットとSHA-256を固定 |
| [Golden Paint Spectra](https://www.realtimerendering.com/golden.html) | Heavy Body 78色、白Lenetaカード上の湿潤10 mil／乾燥約6 mil、D65/10°、400–700 nm、10 nm | Goldenが共有を明示。標準ライセンス表記はない | 同一製品3色の独立分光形状テストだけに収録。有限白地データを本番K・Sへ置換しない |
| [Revigo spectra](https://github.com/fligt/revigo-spectra) | 再現油絵具、85配合、黒地・白地を含む336反射スペクトル、400–700 nm、10 nm | CC0 1.0 | 二定数・有限厚混色の外部ベンチマーク候補。油絵具なのでGolden係数の学習には使わない |
| [Hilda Deborah Hyperspectral Pigment Dataset](https://doi.org/10.5281/zenodo.5592485) | Kremer顔料チャート約327種のRGB画像と約405–996 nmハイパースペクトル | CC BY 4.0 | 商品番号とColour Indexを照合できた色の独立純色検証候補。未収録 |
| [HYPERDOC](https://www.nature.com/articles/s41597-025-05599-0) | 紙・羊皮紙、アラビアゴム・卵白、粒径、混合・重層のVNIR/SWIR/DRIFTS | 公開補足データはCC BY 4.0 | 支持体・媒材・粒径による誤差幅の研究用。対象5色の係数には使わない |
| [UiO oil-paint spectral libraries](https://zenodo.org/records/13359559) | Old Holland等の実物油絵具スウォッチ・混色のVNIR/SWIR | CC BY-NC-ND 4.0 | 非商用・改変禁止のためMITアプリへ収録しない。研究閲覧だけ |
| [ArtistPigments.org](https://artistpigments.org/color_library?mode=spectral) | 多ブランドの実物スウォッチ写真、Lab、分光曲線、Colour Index検索 | CC BY-NC 4.0、追加データは会員条件あり | 製品・顔料同定の研究閲覧だけ。MITアプリへ収録しない |
| [CHSOS Pigments Checker](https://chsopensource.org/products/pigments-checker/) | 顔料を複数媒材で作ったスウォッチ、FORS反射スペクトル | 無料取得可だが再配布・商用利用の明確な許可を確認できない | 許可取得前は目視・研究だけ。数値を同梱しない |
| [IFAC-CNR FORS](https://spectradb.ifac.cnr.it/) | 顔料、混合、卵、油、ワニス等の270–1700 nm反射率 | 登録制、科学・非商用利用 | MITアプリへ収録しない |
| [LBNL Pigment Database](https://coolcolors.lbl.gov/LBNL-Pigment-Database/database.html) | 建築着色塗膜、黒白地、膜厚、反射・透過、二定数K・S | 一般公開データの再配布条件を確認できず、配布ZIPは保護 | 測定設計の参考だけ。数値を同梱しない |
| [CAVE Multispectral Paints](https://cave.cs.columbia.edu/repository/Multispectral/Paints/) | 400–700 nmの空間分光画像 | 顔料同定・再配布条件が不十分 | 校正には使わない |

## Golden製品ページの現在値

メーカー製品ページのスウォッチとCIE Lab値は、同じ商品番号・Colour Indexであることを確認する参照値とする。ページ上では測定ジオメトリ、観測者、膜厚が完全には示されないため、アプリのD65/2°出力へ厳密な色差しきい値を設けない。画像はGoldenの著作物なのでコピーせず、公式ページへリンクする。

| アプリ色 | Golden製品 | Colour Index | 掲載CIE Lab | 表示上の不透明性 |
| --- | --- | --- | --- | --- |
| 赤 | [Pyrrole Red 1277](https://goldenartistcolors.com/products/heavy-body-acrylic-color-pyrrole-red) | PR254 | 43.54, 54.93, 33.22 | Semi-Opaque |
| 青 | [Cerulean Blue Chromium 1050](https://goldenartistcolors.com/products/heavy-body-acrylic-color-cerulean-blue-chromium) | PB36 | 40.96, -10.70, -32.37 | Semi-Opaque |
| 黄 | [Hansa Yellow Opaque 1191](https://goldenartistcolors.com/products/heavy-body-acrylic-color-hansa-yellow-opaque) | PY74 | 84.48, 10.79, 91.83 | Semi-Opaque |
| 黒 | [Bone Black 1010](https://goldenartistcolors.com/products/heavy-body-acrylic-color-bone-black) | PBk9 | 23.82, -0.05, -0.45 | Semi-Opaque |
| 白 | [Titanium White 1380](https://goldenartistcolors.com/products/heavy-body-acrylic-color-titanium-white) | PW6 | 98.25, -0.74, 1.24 | Opaque |

## 独立実測で確認したこと

Golden共有ワークブックのうち、現行プロファイルと製品番号が一致するPyrrole Red 1277、Cerulean Blue Chromium 1050、Bone Black 1010を抽出した。現行RIT二定数プロファイルから再構成した400–700 nm反射率とのPearson相関は次のとおりだった。

| 製品 | 分光形状相関 | 読み方 |
| --- | ---: | --- |
| Pyrrole Red 1277 | 0.999895 | 590 nm付近から急上昇する赤の吸収端が一致 |
| Cerulean Blue Chromium 1050 | 0.956137 | 青緑域の山、黄赤域の谷、長波長側の再上昇が一致 |
| Bone Black 1010 | 0.917279 | 低反射でほぼ中性な形状が一致。微小変動なので相関値を過大解釈しない |

絶対反射率には赤RMSE 0.0257、青0.0602、黒0.0278の差がある。これは無限厚近似と白地有限膜、SPIN原測定とSPEX表示仮定、試料・年代差が混在した比較である。この差を消すよう現行K・Sを調整すると条件差を顔料特性へ誤帰属するため、形状一致だけを回帰テストに採用した。

## 混色精度へ反映した研究判断

- RITのKとSを別々に配合する現行二定数モデルを維持する。
- Golden白地データのK/S列は、基材影響を除いた真の二定数K・Sとはみなさない。
- 写真のRGB値、メーカーWeb画像、画面のHEXから分光曲線やK・Sを逆算しない。異なるスペクトルが同じRGBになり得るメタメリズムがあるためである。
- Revigoのような既知質量比・黒白地・実測混色は、有限厚モデルを追加する段階の未学習ベンチマークに使う。
- 実測混色の学習と評価は分ける。Dichterの33物理混色研究で、質量比を濃度近似として使う構成が平均1.49 ΔE00だった一方、密度・吸油量補正は改善しなかったため、測っていない密度補正をアプリへ推測追加しない。
- Bernsの58単一顔料・831計算色研究が指摘するように、2試料から2未知量を解く校正だけでは独立精度を評価できない。別に作った混色チップを必ず保持する。
- Cerulean BlueとTitanium Whiteの組合せは、白のUV吸収により光学値が不安定になり得る。負のKや非正のSを許さず、青白ティントは未学習実測で検証する。
- 水・湿潤は顔料K・Sの共通倍率にしない。水量、膜厚、紙、湿潤・乾燥を別プロファイルとして測定する。

## 次に取得する自前データ

1. 対象5色を同じロットで用意し、黒白Lenetaカードへ一定膜厚で塗る。
2. 乾燥後と湿潤直後を分け、各パッチを複数地点・複数回測定する。
3. 単色、1:3、1:1、3:1の二色混合、白ティント、黒シェード、三色中和を質量で作る。
4. 学習用と未学習評価用のチップを物理的に分ける。
5. スペクトルRMSE、D65/D50/A下のCIEDE2000、反復測定誤差、色域外率を公開する。
6. 写真を残す場合はColorChecker、RAW、照明、露出、ホワイトバランス、レンズ、試料角度を固定し、写真は分光測定の代用にしない。

## 取得ファイルの固定情報

- Golden workbook SHA-256: `584a38368c4af637a1253b6465b9f71493e38c65340092a0cfe9f73b3ed227cf`
- Revigo spectral data SHA-256: `7cd24814f5d4bc73d012013d637de5d5d47b627ce859efa97b2e7f1a7bc010db`
- Revigo mixture specification SHA-256: `b87920287cbb1b92c17879072f817bc29e7e66f60198fd7bc180b455d46684f3`
- Revigo repository snapshot: `f09ed729f0826f0161b70ecb125fe597b31ea297`

Revigoの完全データはCC0だが、現時点では本番バンドルへ不要なので複製せず、URL、コミット、チェックサムだけを固定した。Goldenから許可され共有された3曲線の最小サブセットは、`tests/fixtures/goldenDrawdowns2014.mjs` に本番コードから分離している。
