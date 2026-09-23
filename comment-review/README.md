# comment-review

AI駆動開発における、コード内コメントの精査スキル。

## なぜ必要か

AIは異様にコメントを書きたがるが、その内容は推測で書かれた嘘であることが多い。
そして次に実装させると、**設計書やFigmaより先に、コードに直書きされたコメントを鵜呑みにして実装する**。

嘘コメントは自己増殖する。
あるセッションでAIが推測でコメントを書き、次のAIがそれを事実として読み、そのコメントに合わせて実装を寄せる。
さらにその実装を根拠に、また推測コメントが足される。

そして、この問題は既存の品質保証の網を全部すり抜ける。

- lint が見るのは形式だけ
- テストが見るのは挙動だけ
- 監視が見るのは障害だけ

コメントは lint も型チェックもテストも通らないため、**コードベース内で唯一「検証されない仕様書」**になっている。
障害として顕在化しないので原因が特定されず、対策も打たれず、静かに工数を奪い続ける。

## 構成

```
comment-review/
├── SKILL.md                          スキル本体（入口）
├── README.md                         このファイル
├── references/
│   ├── severity.md                   重大度の定義（error / warning の判断軸）
│   ├── comment-rules.md              質の良いコメントの定義、書いてよい／だめな種類
│   ├── consistency-check.md          コメント・実装の一致検証手順（層B）
│   ├── lint-rules.md                 lintルール一覧、導入方法、拡張候補、機械判定の限界
│   └── review-checklist.md           人間向けレビュー観点、PRテンプレート
├── assets/
│   └── agent-rules.md                CLAUDE.md / AGENTS.md 貼り付け用スニペット
└── scripts/
    ├── comment-lint.mjs              層Aの機械判定（依存なし、Node単体で動く）
    └── __fixtures__/sample.ts        全ルールのNG例／OK例（ルール変更時の確認用）
```

lint の挙動は導入先リポジトリ直下の `comment-lint.config.json` で調整する
（検査対象の拡張子、チケット形式、引用を認めるドメイン、除外パス、ルールごとの重大度）。

## 導入手順

### 1. スキルを配置する

Claude Code のプロジェクトスキルとして使う場合:

```bash
mkdir -p .claude/skills
cp -r comment-review .claude/skills/
```

### 2. lintスクリプトをリポジトリに置く

```bash
cp comment-review/scripts/comment-lint.mjs scripts/comment-lint.mjs
node scripts/comment-lint.mjs --all    # まず現状を把握する
```

`--all` の初回実行は指摘が大量に出る想定。既存コードは一旦放置し、差分（引数なし）から始めるのが現実的。

### 3. プロジェクト設定を調整する

リポジトリ直下に `comment-lint.config.json` を置く。**無ければ既定値で動くので、必須ではない。**

```json
{
  "ticketPattern": "\\b(ABC-\\d+)\\b",
  "allowedDocHosts": ["wiki.example.co.jp"],
  "rules": { "todo-requires-ticket": "error" }
}
```

- `allowedDocHosts` — **社内wiki・Confluence のドメインを追加する**
- `rules` — 重大度を `error` / `warning` / `off` で指定する。
  誤検知しやすい4ルール（`no-speculation` / `no-volatile-metadata` / `todo-requires-ticket` /
  `no-line-number-reference`）は既定が warning。引き上げる前に `--all` で件数を見る
- `ignorePaths` — 規約自体を扱うコードは除外する（既定は lint 自身とフィクスチャ）

キーの一覧は `references/lint-rules.md`。ルールを変更したら動作確認する。

```bash
node scripts/comment-lint.mjs --all --include-fixtures
# 期待: error 8件 / warning 6件、OK群は1件も検出されない
```

### 4. pre-commit に組み込む

```yaml
# lefthook.yml
pre-commit:
  commands:
    comment-lint:
      run: node scripts/comment-lint.mjs
```

### 5. CI に入れる（任意）

pre-commit は `--no-verify` で抜けられるため、PR でも同じ検査を回す。
`--base` で PR 差分だけを対象にする（`--all` は既存コードの指摘が一度に出る）。

```yaml
- run: node scripts/comment-lint.mjs --base ${{ github.event.pull_request.base.sha }}
```

`fetch-depth: 0` が要る。依存パッケージを使わないので `install` は不要。

### 6. コメント規約をAIに渡す

`assets/agent-rules.md` の内容を `CLAUDE.md` / `AGENTS.md` にコピーする。

規約だけでは必ず守られるわけではないため、4のフックと併用する。

## 3層の役割分担

| 層 | 実行タイミング | 手段 | ブロックするか |
|---|---|---|---|
| A. 機械判定 | pre-commit | `comment-lint.mjs` | する |
| B. 一致検証 | pre-push / CI | AI（このスキル） | しない（報告のみ） |
| C. 全体レビュー | Bの後 | 通常のレビュー | — |

層Bを pre-commit に入れるとコミットのたびに数十秒止まるため、pre-push か CI が現実的。
層Bの判定は非決定的なので、ブロックは層Aだけに任せる。

## 運用上の注意

- **error を増やしすぎない**。乱発されると `--no-verify` が常用され、仕組みごと死ぬ
- 機械で確信が持てないものは warning に置く
- `comment-lint-disable` の乱用は `git grep` で定期的に確認する
