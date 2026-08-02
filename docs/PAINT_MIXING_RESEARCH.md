# 絵の具混色研究ノート

更新日: 2026-08-02
実装プロファイル: rit-artist-paint-two-constant-2016-v1

## 結論

現在のアプリは、RGBやHEXの平均ではなく、顔料ごとの分光吸収 K(λ) と分光散乱 S(λ) を別々に配合する二定数Kubelka–Munkモデルへ移行した。

旧モデルは単色の反射率から得た K/S を直接平均していた。この方法は全顔料の散乱力が等しい場合にしか二定数モデルと一致せず、Titanium White、Cerulean Blue、Bone Blackのように散乱力が大きく異なる絵の具で、同じ1部の効き方を再現できない。

新モデルでは実測由来のPR254、PB36、PY74、PBk9、PW6を380–750 nm、10 nm間隔で計算する。白も理想値ではなく、有限の吸収と強い散乱を持つTitanium Whiteである。この38点計算は収録K・Sデータに合わせた実用近似であり、ISO/CIEの一般的な標準測色手順そのものではない。規格上の測色計算では通常、少なくとも380–780 nmを覆い、5 nm以下の間隔が求められる。

## 採用した計算

完成絵の具の相対量を cᵢ とし、波長ごとに次を計算する。

    Kmix(λ) = Σ cᵢ Kᵢ(λ) / Σ cᵢ
    Smix(λ) = Σ cᵢ Sᵢ(λ) / Σ cᵢ
    q(λ)    = Kmix(λ) / Smix(λ)

不透明・光学的無限厚の内部反射率は、暗色で桁落ちしにくい形を使う。

    R∞(λ) = 1 / (1 + q + √(q² + 2q))

RITの原測定はSPINである。一方、数値転記元Wacton.Unicolourが選んだSPEX表示ジオメトリをレンダリング仮定として再現し、外部反射率には次のSaunderson補正を使う。SPEXをRITの測定条件とは解釈しない。

    Rmeasured = (1-k1)(1-k2)R∞ / (1-k2R∞)
    k1 = 0.03
    k2 = 0.65

その反射率をCIE標準イルミナントD65とCIE 1931 2°等色関数でXYZへ直接積分し、D65 sRGBへ変換する。同じD65であるためBradford色順応は使わない。観測者の10°と2°の違いを色順応変換で代用する旧処理も廃止した。

開始色の赤 #E60012、青 #00A1E9、黄 #FFF100、黒 #000000、白 #f8f3e8 は既存UIの契約として維持する。表示時は各純色の物理色と指定色の差を配合比で加え、旧モデルの「混ざった色数」や白黒比で物理効果を弱める経験係数は使わない。白ティントは二定数スペクトルから得た色相・彩度を保持し、D65輝度だけを白へ向かう物理進行へ合わせる。8bit化では輝度補正後の分光結果から各チャンネル最大4コード以内だけを探索し、単独チャンネル丸めによる可視的な逆転を抑える。0.001部刻みの単色・複合色と極端な黄優勢比率の検証では、下向き量子化誤差を相対輝度0.001未満に制限し、元の1コード緑変化による約0.006の逆転は解消した。検証用の反射率APIは、これらの表示補正を受けない。

## 実装した検証

- KとSを独立に加重した参照式との波長単位一致
- 旧式のK/S直接平均と実際に異なること
- 同じ比率の倍率不変性（1:1と2:2）
- 材料順序による結果不変性
- 5顔料・38波長の有限値、非負K、正のS
- Saunderson係数と数値転記の固定点
- Titanium Whiteが理想白ではなく、実測由来KとSを持つこと
- 白の増加に対するD65測色輝度の上昇
- 単色および複合色へ0.001部刻みで白を加え、極端な黄優勢比率も確認した時の、最終8bit表示における下向き量子化誤差が相対輝度0.001未満であること
- 無限小の白を加えた時に白なしの分光表示へ連続すること
- 黒の増加に対する表示輝度の低下
- 純色端点と微量混色の連続性
- 局所の小数比率、スポイト、保存レシピ、描画キャッシュとの一致
- Goldenが別条件で測定した同一製品3色との独立分光形状一致（赤0.999895、青0.956137、黒0.917279）

これらは「実装がモデルどおりか」を検証する。実物との精度を主張するには、未学習の実測混色チップによる外部検証が別に必要である。

Goldenの独立値は白Lenetaカード上の有限膜厚、D65/10°、400–700 nmであり、現行レンダラーの不透明無限厚・D65/2°とは条件が違う。そのため絶対反射率へ回帰させず、波長方向の形状だけを回帰テストに使う。色見本写真、採否、ライセンス、製品ページのLab参照値は [PAINT_DATA_SOURCES.md](./PAINT_DATA_SOURCES.md) に分離した。

## 調査した一次資料・公式規格

- [Kubelka, 1948: 有限厚層と基材を含む一般式](https://doi.org/10.1364/JOSA.38.000448)
- [Duncan, 1940: KとSの理想混合加法則](https://doi.org/10.1088/0959-5309/52/3/310)
- [Saunderson, 1942: 表面反射補正](https://doi.org/10.1364/JOSA.32.000727)
- [ISO 18314-2:2023](https://www.iso.org/standard/81971.html)
- [RIT Artist Paint Spectral Database](https://www.rit.edu/science/studio-scientific-imaging-and-archiving-cultural-heritage)
- [RIT Artist Paint Spectral Database paper](https://www.rit.edu/science/sites/rit.edu.science/files/2019-03/ArtistSpectralDatabase.pdf)
- [Abed & Berns: 単一定数モデルの限界と顔料散乱](https://doi.org/10.1002/col.22086)
- [Berns, 2022: 58色・831スペクトルのArtist Acrylic Paint Colorimetric Dataset](https://library.imaging.org/archiving/articles/19/1/10)
- [Latour et al.: 黒・白基材からKとSを分離する方法](https://doi.org/10.1366/000370209788559719)
- [CIE 1931 2°公式データ](https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer)
- [CIE D65公式データ](https://www.cie.co.at/datatable/cie-standard-illuminant-d65)
- [ISO/CIE 11664-3: XYZ三刺激値](https://www.iso.org/standard/74165.html)
- [ISO/CIE 11664-4: CIELAB](https://www.iso.org/standard/74166.html)
- [ICC sRGB characterization](https://registry.color.org/rgb-registry/srgb)
- [LBNL Pigment Database](https://coolcolors.lbl.gov/LBNL-Pigment-Database/database.html)
- [Golden Paint Spectra: 78色の白地実測反射率](https://www.realtimerendering.com/golden.html)
- [Revigo spectra: CC0の既知配合・黒白地実測](https://github.com/fligt/revigo-spectra)
- [Dichter, 2023: 33物理混色の交差検証](https://www.aic-publishing.org/ojs/index.php/JAIC/article/view/277)

## 現段階で断定しないこと

二定数Kubelka–Munkは、すべての絵の具を完全再現するモデルではない。

- 現実の塗膜は有限厚で、紙や下塗りの反射を透過する。
- 顔料体積濃度、粒径、凝集、バインダー、製造ロットで特にSが非線形に変わる。
- 濡れた状態から乾く変化は顔料共通の明度・彩度係数では表せない。
- 透明なグレーズと、パレット上で完全に練り合わせた混色は異なる。
- 蛍光、金属、真珠、干渉、強い光沢や方向性を持つ顔料は通常の二束KMの適用外である。
- 赤・青・黄の3顔料だけでは、実在する多数の顔料の全色域を再現できない。
- アプリの1部は完成絵の具の相対量であり、乾燥顔料の質量や体積分率ではない。

## 次の研究段階

実物精度を上げる次段階は、画面上の主観調整ではなく、対象絵の具を同一条件で測定する校正実験である。

1. 各色を同じバインダー・基材・乾燥条件で、黒地と白地へ均一膜厚で塗る。
2. 各単色について5–8段階の濃度、複数膜厚、湿潤直後・中間・完全乾燥を測る。
3. 1:3、1:1、3:1の二色混合、白ティント、黒シェード、三色中和を質量で作る。
4. 測定反射率に対して K ≥ 0、S > 0 のforward fittingを行う。暗部ノイズを増幅するため、測定値を直接K/Sへ変換して回帰しない。
5. 学習に使わない混色と膜厚で、スペクトルRMSEとCIEDE2000をD65・D50・A下で交差検証する。
6. 有限厚式へ膜厚 X と基材反射率 Rg(λ) を追加する。
7. wet・dryは別プロファイルとして保持し、全色共通の彩度倍率を使わない。

RevigoのCC0データは有限厚式を実装する段階の独立ベンチマークにする。油絵具をGoldenアクリルの係数学習へ混ぜず、アルゴリズムの検証集合としてのみ使う。測色データ源ごとの採否は [PAINT_DATA_SOURCES.md](./PAINT_DATA_SOURCES.md) を参照する。

目標値はデータ収集後に固定する。まず測定の反復誤差を求め、その誤差より十分に大きい改善だけを採用する。比較対象は現行二定数モデル、単一定数モデル、単純RGB平均で、未学習チップのスペクトルRMSEとΔE00を公開する。

## データとライセンス

採用したK・Sの数値転記元はMITライセンスのWacton.Unicolourで、原測定の出典はRITである。CIE配列はCC BY-SA 4.0である。詳細、著作権表示、チェックサムは [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) に分離して記録する。
