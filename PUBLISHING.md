# 公開前チェックリスト

このフォルダはGitHub公開・更新用です。公開やデプロイの前に、以下を確認します。

## 公開前

- `.env.example` の `NEXT_PUBLIC_SITE_URL` を実際のHTTPS URLへ変更する。
- `.openai/`、`.env`、音声参照、モデル、キャッシュ、個人パス、開発ログ、raw素材が含まれていないことを確認する。
- `npm ci`、`npm test`、`npx playwright install chromium`、`npm run test:e2e` をクリーン環境で実行する。
- `npm audit` と秘密情報スキャンを実行し、結果を確認する。
- チュートリアルのMP4、ポスター、VTT、文字起こしに個人情報やローカルパスがないことを確認する。
- `git status` と追跡対象一覧を確認し、許可したファイルだけをコミットする。
- `LICENSE`、`package.json`、READMEの著作権者が `Lunaneco`、利用条件がMITで一致していることを確認する。

## GitHub作成後

- Private vulnerability reporting、Dependabot、CodeQL default setupを有効にする。
- `main` を保護し、CI成功とレビューを必須にする。
- Actionsの権限を「Read repository contents」に制限し、外部ActionのSHA固定を維持する。
- GitHub Pagesなどで公開する場合は、生成物だけを配信し、秘密値をビルドへ埋め込まない。
- HTTPSドメインとサブドメインの運用が確定してからHSTSを検討する。

## 更新時

- 依存関係、動画、スクリーンショット、プライバシー説明を同じ変更内で更新する。
- バックアップ形式を変更するときは版番号を上げ、旧版移行と悪意ある入力のテストを追加する。
- CSPの緩和は最小限にし、外部接続先を追加する場合はREADMEとPRIVACYへ理由を記載する。
