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

## Golden Heavy Body Acrylic spectral data

`lib/paintCalibration.ts` は、Golden Artist Colors, Inc. がAndrew GlassnerとEric Hainesへ提供した「HB 10 mil Drawdowns over White」ワークブックのうち、次の4製品の反射率および単一定数Kubelka–Munk `K/S` を収録しています。公開ページには、Goldenがこのスペクトルデータを他者へ共有することを許可した旨が明記されています。

- Pyrrole Red（製品番号1277、PR254）
- Cerulean Blue Chromium（製品番号1050、PB36）
- Hansa Yellow Medium（歴史的製品番号1190、PY73）
- Bone Black（製品番号1010、PBk9）

試料は白のLenetaカード上へ湿潤10 milで塗布され、乾燥後約6 milの塗膜をD65光源・10°観測者条件で400–700 nm、10 nm間隔に測定したものです。元データにはTitanium Whiteの行がないため、アプリの白は実測色として扱わず、`K/S = 0` の理想散乱白リファレンスとして明記しています。

- Sharing statement and documentation: <https://www.realtimerendering.com/golden.html>
- Original workbook archive: <https://www.realtimerendering.com/downloads/GoldenSpectra.zip>
- Golden Artist Colors: <https://goldenartistcolors.com/>

このスペクトルデータはプロジェクト固有コードのMIT Licenseとして再許諾せず、上記の元の共有表明に基づく第三者データとして区別します。Golden、Andrew Glassner、Eric Hainesによる本プロジェクトへの提携・承認を意味しません。

## CIE open colourimetric datasets

`lib/cieD65.ts` は、CIE 1964 10°標準観測者の等色関数とCIE標準イルミナントD65の公式1 nmデータを、実測絵の具データと同じ400–700 nm・10 nm間隔へ抽出して収録しています。このファイルのデータ部分にはCreative Commons Attribution-ShareAlike 4.0 International（CC BY-SA 4.0）が適用されます。

- CIE 1964 colour-matching functions, 10 degree observer: <https://cie.co.at/datatable/cie-1964-colour-matching-functions-10-degree-observer>
- Official CMF CSV: <https://files.cie.co.at/CIE_xyz_1964_10deg.csv>（DOI: `10.25039/CIE.DS.sqksu2n5`、SHA-256: `1b27fd4e8ca1167b47c3a6aee3aafe56abc57eae51fa20032cb83704224a27dc`）
- CMF metadata: <https://files.cie.co.at/CIE_xyz_1964_10deg.csv_metadata.json>
- CIE standard illuminant D65: <https://www.cie.co.at/datatable/cie-standard-illuminant-d65>
- Official D65 CSV: <https://files.cie.co.at/CIE_std_illum_D65.csv>（DOI: `10.25039/CIE.DS.hjfjmt59`、SHA-256: `e76f210bffff3d552ef7113025da5f325d5dfec200dd4b878b1a2f3a507032cb`）
- D65 metadata: <https://files.cie.co.at/CIE_std_illum_D65.csv_metadata.json>
- License: <https://creativecommons.org/licenses/by-sa/4.0/>

抽出値そのものは変更せず、配列形式への整形と対象波長の選択だけを行っています。公式データで560 nm以降が `NaN` となる10°観測者の z̄ は、CIEメタデータの外挿指定に従い0として収録しています。本アプリ全体のMIT Licenseは、上記CC BY-SA 4.0データへ上書き適用されません。

## アプリの依存関係

JavaScript依存関係の正確な版と配布元は `package-lock.json` に固定しています。再配布やホスティングを行う人は、各パッケージのライセンスを公開形態に合わせて確認してください。

## プロジェクト固有素材

画面、ロゴ、スクリーンショット、塗り絵、チュートリアルの構成はカラーレシピ用に制作したものです。本プロジェクトはCopyright (c) 2026 Lunanecoのもと、MIT Licenseで公開します。第三者技術には、それぞれのライセンスが適用されます。
