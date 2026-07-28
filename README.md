# claude-skills

[Claude Code](https://claude.com/claude-code) 用のカスタムスキル集。

繰り返し発生する作業を、都度プロンプトで指示するのではなく、手順そのものを定義して再利用できる形にしたもの。

## 収録スキル

### `pdf-booklet`

Markdown 原稿とデザインテンプレートから冊子 PDF を生成する。

Markdown の解釈（章扉・Q&A・POINT/HINT/COLUMN カード・表への変換）とページネーションは `lib/engine.py` が全テンプレート共通で担当し、テンプレート側は見た目だけを持つ構成。生成して終わりにせず、主要ページを画像プレビューして崩れを確認してから確定する。

同梱テンプレート:

- `soft-ui-chapter-color` — 章ごとに色が変わる柔らかめのデザイン
- `stencil-mono` — モノクロ印刷を想定したテンプレート

### `pdf-booklet-template-designer`

`pdf-booklet` 用の新しいテンプレート（`style.css` / `template.json`）を作成する。要望をヒアリングし、HTML 契約仕様に沿って設計して、実際にビルド・プレビューまで行う。

### `skill-creator`

新しいスキルの `SKILL.md` を作成する。質問攻めから始めず、まず推測込みのたたき台を出し、推測箇所を明示して確認を取る方針。スキル化すべきでないケース（一度きりの作業、恒久的な好み、自動発火）の判定も含む。

## 設計方針

- **確認を手順に組み込む** — 生成物をそのまま確定せず、プレビューや推測箇所の明示を挟む
- **責務を分離する** — `pdf-booklet` では、Markdown 解釈とページネーション（共通ロジック）をデザイン（テンプレート）から切り離し、`HTML_CONTRACT.md` で両者の境界を定義している
- **憶測で進めない** — 判断材料が足りない場合は質問する

## 動作環境

`pdf-booklet` の実行には以下が必要:

```bash
pip install markdown beautifulsoup4 playwright
playwright install chromium

# プレビューと、表紙のノンブル除外に使用
brew install poppler   # pdftoppm / pdfunite
```

poppler が無い環境では、表紙のノンブル除外が機能せず警告を出して全ページに入った状態で出力される。

## インストール

```bash
git clone https://github.com/tttdddkkk/claude-skills.git ~/.claude/skills
```

既に `~/.claude/skills` がある場合は、必要なスキルのディレクトリだけをコピーする。

## 使い方

Claude Code で自然文で依頼すると、`description` のトリガーに応じて自動的に呼ばれる。

```
原稿をPDFにして
新しいテンプレートを作りたい
この手順をスキル化して
```

明示的に指定する場合は `/pdf-booklet` のようにスラッシュコマンドとして呼ぶ。

## ライセンス

MIT
