# 公開色・オープンカラーデータ調査

更新日: 2026-08-02

## 目的

著作権・再利用条件が明確な色資料を広く調べ、カラーレシピで何を学習材料にできるかを分類した。ここでいう「学習」は、出典を調べて設計判断と検証計画へ反映することであり、外部画像やパレットを機械学習モデルへ投入することではない。

重要なのは、画面用のRGB色、作品写真、実物の分光測色を同じデータとして扱わないことである。今回、外部パレットのHEXや作品画像はアプリへ複製せず、絵の具の二定数 `K(λ)`・`S(λ)` の再調整にも使用していない。

## すぐ研究利用できる色・分光データ

| 公開資料 | 規模・内容 | 利用条件 | 安全な用途 |
| --- | --- | --- | --- |
| [Revigo Spectra](https://github.com/fligt/revigo-spectra) | 16種の歴史的油絵具と白・黒、85配合、黒白地を含む336反射スペクトル、400–700 nm／10 nm | CC0 1.0 | 既知質量比・下地・膜厚を持つ混色モデルの独立検証。油絵具なのでGolden Acrylicの係数へ直接転用しない |
| [Dryad: 48 artist pastel spectra](https://datadryad.org/dataset/doi:10.5061/dryad.pj073) | 48色の反射スペクトルCSV、写真、線形化データ | CC0 1.0 | スペクトルから画面色への変換検証。蛍光性の2色は通常のK/S学習から除外 |
| [USGS Spectral Library Version 7](https://pubs.usgs.gov/publication/ds1035) | 数千の鉱物、化合物、加工材料、塗料顔料、混合物。紫外から遠赤外まで | [USGS作成物は原則として米国パブリックドメイン](https://www.usgs.gov/faqs/are-usgs-reportspublications-copyrighted) | 顔料・鉱物固有の吸収帯と色域の妥当性確認。粉体や異なる媒材を本番K・Sへ直接移植しない |
| [NASA RELAB Spectral Library](https://catalog.data.gov/dataset/relab-spectral-library-bundle) | 約23,600反射スペクトル製品、PDS4データとXML、主に鉱物 | Public Domain | 無機顔料候補とスペクトル処理の広範囲な回帰検証。画材混色の直接教師にはしない |
| [Palette Atlas](https://www.palette-atlas.com/license) | 地域別の色名、HEX、説明 | 色名・HEX・説明はCC0、コードはMIT。写真は個別権利 | UIの色名と発見性の研究。写真はコピーしない |

Revigoは約100 µmの均一層、黒白チャート、Konica-Minolta CM-2600d、d/8、正反射込みという測定条件と混合比がそろい、公開データでは特に有力である。ただし歴史的油絵具なので、現行アプリのGolden Heavy Body Acrylic係数を置換せず、未学習の検証用コーパスとして扱う。

## 画面と配色の公開資料

| 公開資料 | 規模・内容 | 利用条件 | 採用した知見 |
| --- | --- | --- | --- |
| [W3C CSS Color 4](https://www.w3.org/TR/css-color-4/) | CSSの名前付きsRGB色と各種色空間 | W3Cの許諾的文書ライセンス | 名前付き色は広い参照集合だが、知覚的に均等でなく、名前だけでは見た目を推測しにくい。色だけを操作の手掛かりにしない |
| [Open Color](https://github.com/yeun/open-color) | 13系統×10段階、計130色 | [MIT](https://github.com/yeun/open-color/blob/master/LICENSE) | 明度段階をそろえたUI色の考え方を確認。外部HEXはコピーせず、現在色と操作色のコントラスト確認に利用 |
| [ColorBrewer](https://colorbrewer2.org/) | 35配色（連続18、発散9、定性8） | [Apache 2.0](https://github.com/axismaps/colorbrewer/blob/master/LICENCE.txt) | 選択状態は色相差だけに頼らず、文字・形・境界でも示す |

## CC0・公開作品から調べられる色の組合せ

| 公開資料 | 規模 | 条件 | このアプリでの扱い |
| --- | ---: | --- | --- |
| [Smithsonian Open Access](https://www.si.edu/openaccess/faq) | 5.1百万件超の2D・3D画像とデータ | CC0表示の個別資産 | 歴史的作品の配色を目視研究。写真・スキャンを測色値にしない |
| [Art Institute of Chicago Open Access](https://www.artic.edu/open-access/open-access-images) | 5万点超の作品画像 | CC0表示の個別資産 | 多様な絵画表現の目視資料。撮影・照明・画像処理の影響を分離する |
| [National Gallery of Art Open Access](https://www.nga.gov/artworks/free-images-and-open-access) | 6万点超の画像、13万件超の作品・作家データ | 公開画像・データはCC0。個別表示を確認 | 作品の色名や技法の文脈を研究。物理混色の校正には使わない |
| [Rijksmuseum Data Services](https://data.rijksmuseum.nl/policy/) | コレクション画像・メタデータ | 個別にPDM、CC0またはCC BY 4.0 | 権利表示のある資産だけを研究対象にし、表示のない画像を一括取得しない |

作品画像がCC0でも、撮影照明、カメラ、画像補正、ICCプロファイル、経年変化を含む。自然な配色の目視研究には使えるが、反射スペクトルや顔料配合比の正解データではない。

## 条件付き、または収録しない資料

- [3,154色のアーティスト用パステル調査](https://www.aic-publishing.org/ojs/index.php/JAIC/article/view/190) は8ブランドの反射スペクトル、CIE値、Munsell値を含むがCC BY 4.0である。利用時はMIT本体と分け、帰属と改変表示が必要になるため、今回は同梱しない。
- [286油絵具＋397水彩絵具の混色測定研究](https://pure.mpg.de/rest/items/item_3285223/component/file_3285224/content) は正確な質量比と400–700 nm測定を持つが、元数値の明確なCC0条件を確認できないため、論文の手法だけを研究する。
- [INFRA-ART](https://infra-art.eu/resources/faq) はメタデータがCC0でも、多くのスペクトルがCC BY-NC 4.0であり、商用MITアプリへ収録しない。
- Golden、ArtistPigments.org、CHSOS Pigments Checker、Pantone、RAL、NCSは、公開閲覧できてもオープンライセンス不在、非商用限定、商品画像・商標・データベース権などの条件があるため収録しない。

「画面で見られる」「無料でダウンロードできる」は、再配布・商用利用・改変の許可を意味しない。

## 今回の画面へ反映したこと

W3Cは、重要な情報を色だけで伝えないよう求めている。Open ColorとColorBrewerも、用途・明度・識別性を制御した体系であり、単一の色見本だけを操作ボタンにする設計は不十分だった。

- 色見本だけでなく、「現在の色」または「ぬりえの色」、色名、「色を変える」を一つの大きなボタンにした。
- ボタン全体をタップでき、保存パレットとの関係を `aria-controls` でも明示した。
- 保存パレットの選択色へチェックと「選択中」を表示し、枠色だけに依存しないようにした。
- 320 px幅でも「色を変える」を省略せず、44 px以上のタッチ領域を維持する。
- 空の保存パレットの説明を、現在の「この色を登録」操作と一致させた。

## 絵の具混色へ入れなかったもの

- CSS、Open Color、ColorBrewerのRGB/HEXは、発光する画面向けであり、顔料の吸収・散乱係数ではない。
- 美術館の画像は、権利が開かれていても測色値として扱えない。
- USGS、RELAB、Dryadは有用な分光資料だが、アプリが基準にするGolden Heavy Body Acrylicと試料条件が一致しない。
- Revigoは黒白地と配合比を含む有力な検証資料だが、油絵具なのでGolden Acrylicの本番係数を合わせ込む学習データにはしない。

物理混色の本番値は、引き続き試料と測定条件が一致するRIT由来の二定数K・Sだけを使用する。公開色資料は、未学習評価、設計レビュー、アクセシビリティの根拠として分離して保管する。

## 著作権・再利用の運用

1. CC0、PDM、MIT、Apache 2.0など、資産またはデータセットに付いた条件を確認する。
2. 美術館サイトはコレクション全体でなく、各資産の権利表示を確認する。
3. CC0でも商標、肖像、プライバシー、文化的配慮など別の権利は残り得る。
4. 米国政府資料でも、第三者提供の写真・図表は個別表示を確認する。
5. 外部データを将来バンドルする場合は、固定版、URL、ライセンス、取得日、チェックサム、補間や除外処理を `THIRD_PARTY_NOTICES.md` に追加する。

今回の実装には外部パレット値、外部作品画像、USGS・NASA・Dryadデータを同梱していないため、追加の第三者配布物はない。
