# claude-skills

[Claude Code](https://claude.com/claude-code) 用のカスタムスキル集。

繰り返し発生する作業を、都度プロンプトで指示するのではなく、手順そのものを定義して再利用できる形にしたもの。

## 収録スキル

### `pdf-booklet`

Markdown 原稿とデザインテンプレートから冊子 PDF を生成する。

Markdown の解釈（章扉・Q&A・POINT/HINT/COLUMN カード・表への変換）とページネーションは `lib/engine.py` が全テンプレート共通で担当し、テンプレート側は見た目だけを持つ構成。生成して終わりにせず、主要ページを画像プレビューして崩れを確認してから確定する。

出力例（画像）・記法の一覧・原稿の書き方は [`pdf-booklet/README.md`](pdf-booklet/README.md) を参照。

同梱テンプレート:

- `soft-ui-chapter-color` — 章ごとに色が変わる柔らかめのデザイン
- `stencil-mono` — モノクロ印刷を想定したテンプレート

### `pdf-booklet-template-designer`

`pdf-booklet` 用の新しいテンプレート（`style.css` / `template.json`）を作成する。要望をヒアリングし、HTML 契約仕様に沿って設計して、実際にビルド・プレビューまで行う。

### `skill-creator`

新しいスキルの `SKILL.md` を作成する。質問攻めから始めず、まず推測込みのたたき台を出し、推測箇所を明示して確認を取る方針。スキル化すべきでないケース（一度きりの作業、恒久的な好み、自動発火）の判定も含む。

### `deep-investigation`

コードベース調査・技術調査を、検証済みの根拠と反証済みの仮説に基づいて行う。

事実収集の段階では結論を書かず、仮説は最低2つ立て、裏付けより先に反証を探す — という順序を手順として固定している。所見には `[確認]` / `[推定]` / `[未確認]` のラベルと出典（`file:line` / 実行コマンド / そのセッションで取得した URL）を必須とし、ラベルを付けられない文は報告に書かない。

調査タイプに応じて参照ファイルを読み分ける:

- `references/codebase.md` — 事実収集の5方向、静的検索で拾えない参照、影響範囲の段階分け
- `references/tech-research.md` — 一次/二次ソースの分類、「できない」の検証条件、技術選定の報告形式

### `dev-setup`

リポジトリの開発環境設定（`.gitignore` / `.editorconfig` / フォーマッター / リンター / 型チェック / Git hooks / CI / 依存自動更新 / PR テンプレート）を、既存リポジトリの検出結果に基づいて必要な分だけ導入する。

`package.json` や lockfile を読めば分かることは質問せず、判別できなかった項目だけを一度にまとめて聞く。厳格度（最小限 / 標準 / 厳格）を縦軸にした決定表で導入対象を決めるため、指定なしに「全部入り」にはならない。設定ファイルを置いて終わりにせず、実際にコマンドを走らせて既存コードで通ることまで確認する。記録には、何を入れたかだけでなく**何をあえて入れなかったか**も残す（次に触った人が、一度見送った設定を「足りない」と判断して再導入するのを防ぐため）。

- `references/catalog.md` — 決定表と、ツール選定の判断基準（Biome か Prettier + ESLint か、Renovate か Dependabot か）
- `references/ci-recipes.md` — GitHub Actions の構成パターンと、CI 時間・コストを抑える書き方
- `assets/` — 各設定ファイルの雛形

### `figma-impl-init` / `figma-impl`

Figma からの実装で、Figma 通りにならない問題に対処する2スキル。初期化と実装を分けてある（実装スキルに初期化を混ぜると、毎回発火判定が走って判断が引きずられる）。

問題を3つに分けて扱う。**A: Figma に存在しない情報**（hover、中間ブレークポイント、テキスト溢れ）は `figma-impl-init` で既定値を先に決めて固定する。**B: 存在するが CSS に直訳できない**（`line-height: AUTO`、`letter-spacing` の%指定、palt）は変換規則を1回決めて固定する。**C: 存在するが AI に届いていない**は、スクリプトで機械的に取得して解決する。

要点は、**読み取りと生成を混ぜないこと**。混ぜると読めなかった箇所を生成側の推測が静かに埋め、出力を見ても「読んだ値」と「創作した値」が区別できなくなる。取得スクリプトは欠損を `null` のまま残し、その一覧がそのまま「AI が創作する場所」のリストになる。AI の自己申告は使わない（埋めた自覚が無いため機能しない）。

検証にスクリーンショットのピクセル差分は使わない。Figma はテキストをブラウザに描かせておらず（自前レンダラ、ヒンティングなし）、アンチエイリアスのノイズが支配的で差分から原因への逆写像が無いため。代わりに `getComputedStyle` と `Range.getClientRects` の実測値を突き合わせる。

- `figma-impl-init/scripts/scan-file.js` — Figma ファイル全体の実測（palt の割合、フォント、余白スケール、Auto Layout の使用率）
- `figma-impl-init/templates/` — `conversion.md` / `defaults.md` / `reset.css` の草案
- `figma-impl/scripts/fetch-node.js` — ノードの値を正規化して取得。欠損は `null` のまま残す
- `figma-impl/scripts/verify.js` — Playwright で実測し、ズレた行だけを出力

## 設計方針

- **確認を手順に組み込む** — 生成物をそのまま確定せず、プレビューや推測箇所の明示を挟む
- **責務を分離する** — `pdf-booklet` では、Markdown 解釈とページネーション（共通ロジック）をデザイン（テンプレート）から切り離し、`HTML_CONTRACT.md` で両者の境界を定義している
- **出力量を先に決める** — `dev-setup` では厳格度と体制を縦軸にした決定表で導入対象を絞り、該当しないものは提案止まりにする
- **憶測で進めない** — 判断材料が足りない場合は質問する

## 動作環境

大半のスキルは Claude Code 単体で動く。外部依存があるのは以下。

### `pdf-booklet` / `pdf-booklet-template-designer`

```bash
pip install markdown beautifulsoup4 playwright
playwright install chromium

# プレビューと、表紙のノンブル除外に使用
brew install poppler   # pdftoppm / pdfunite
```

poppler が無い環境では、表紙のノンブル除外が機能せず警告を出して全ページに入った状態で出力される。

### `dev-setup`

`jq`（設定の検出に使用）。導入するツール自体（Biome、lefthook 等）は、対象リポジトリ側にインストールする。

### `figma-impl-init` / `figma-impl`

Node.js と、Figma の個人アクセストークン（環境変数 `FIGMA_TOKEN`）。検証スクリプトを使う場合は、検証対象のプロジェクト側に playwright が必要。

```bash
npm i -D playwright && npx playwright install chromium
```

## インストール

```bash
git clone https://github.com/tttdddkkk/claude-skills.git ~/.claude/skills
```

既に `~/.claude/skills` がある場合は、必要なスキルのディレクトリだけをコピーする。

ただし `figma-impl-init` と `figma-impl` は**対でコピーする**。前者のスクリプトが後者の共有モジュール（`figma-impl/scripts/figma-api.js`）を参照しているため、片方だけでは動かない。

## 使い方

Claude Code で自然文で依頼すると、`description` のトリガーに応じて自動的に呼ばれる。

```
原稿をPDFにして
新しいテンプレートを作りたい
この手順をスキル化して
開発環境を整えたい
```

明示的に指定する場合は `/pdf-booklet` のようにスラッシュコマンドとして呼ぶ。

## ライセンス

MIT
