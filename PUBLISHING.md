# 公開前チェックリスト

このフォルダはGitHub公開・更新用です。公開やデプロイの前に、以下を確認します。

## 公開前

- 公開URLが `https://lunaneco.github.io/Colot-recipe/`、Viteの公開パスが `/Colot-recipe/` で一致していることを確認する。
- `.openai/`、`.env`、音声参照、モデル、キャッシュ、個人パス、開発ログ、raw素材が含まれていないことを確認する。
- `npm ci`、`npm test`、`npx playwright install chromium`、`npm run test:e2e:static` をクリーン環境で実行する。
- `npm audit` と秘密情報スキャンを実行し、結果を確認する。
- チュートリアルのMP4、ポスター、VTT、文字起こしに個人情報やローカルパスがないことを確認する。
- `git status` と追跡対象一覧を確認し、許可したファイルだけをコミットする。
- `LICENSE`、`package.json`、READMEの著作権者が `Lunaneco`、利用条件がMITで一致していることを確認する。

## GitHub作成後

- Private vulnerability reporting、Dependabot、CodeQL default setupを有効にする。
- `main` を保護し、CI成功とレビューを必須にする。
- Actionsの権限を「Read repository contents」に制限し、外部ActionのSHA固定を維持する。
- PagesのSourceをGitHub Actionsにし、`.github/workflows/pages.yml` から生成物 `dist/` だけを配信する。
- `github-pages` Environmentは `main` からのデプロイだけを許可する。
- 公開URLをHTTPで開いたときHTTPSへ移動し、動画・字幕・分割JSがすべてHTTPSで読み込まれることを確認する。
- GitHub Pagesでは任意のレスポンスヘッダーを設定できないため、`index.html` のCSPを維持する。独自ヘッダーや保存領域の厳密な分離が必要なら専用ドメインのホスティングへ移す。
- HTTPSドメインとサブドメインの運用が確定してからHSTSを検討する。

## 更新時

- 依存関係、動画、スクリーンショット、プライバシー説明を同じ変更内で更新する。
- バックアップ形式を変更するときは版番号を上げ、旧版移行と悪意ある入力のテストを追加する。
- CSPの緩和は最小限にし、外部接続先を追加する場合はREADMEとPRIVACYへ理由を記載する。
