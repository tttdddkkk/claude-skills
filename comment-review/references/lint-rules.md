# lintルール（層A）

`scripts/comment-lint.mjs` は**正規表現で確定判定できるものだけ**を扱う。
意味的な判定を混ぜると誤検知が増え、警告が信用されなくなり、最終的に `--no-verify` が常用されて仕組みごと死ぬ。

## 実装済みルール

重大度は `comment-lint.config.json` で上書きできる。以下は既定値。

### error（既定）

| ルール名 | 検出内容 |
|---|---|
| `no-unresolved-assumption` | `ASSUMPTION:` / `GUESS:` / 要確認 / 未確認 |
| `no-subjective-claim` | 感想（わかりやすく／読みやすく／シンプルに／きれいに／モダンな／ベストプラクティス） |
| `unverified-perf-claim` | パフォーマンス主張のうち、数値もチケット参照もないもの |
| `no-change-history` | 変更履歴・経緯（〜から変更／以前は／旧実装／元々は／修正しました） |
| `require-citation` | 引用が必要な主張に引用元がない |
| `no-vague-citation` | 「設計書参照」のように参照先が特定できない |
| `no-secret-in-comment` | 秘匿情報らしき文字列 |
| `citation-symbol-exists` | `@see funcName` のシンボルがリポジトリ内に存在しない |

### warning（既定）

上4つは**正当なコメントにも一致する**ことが実測で確認されているため既定を warning にしている。
チケット運用や表記規約が固まっているプロジェクトでは config で error に引き上げる。

| ルール名 | 検出内容 | warning にしている理由 |
|---|---|---|
| `no-speculation` | 推測表現（おそらく／と思われる／たぶん／のはず／一般的に／通常は） | 「通常は200が返るが、認証失敗時のみ401」のような条件説明に一致する |
| `no-volatile-metadata` | 日付・担当者の直書き | 「例: 2024-01-15 のような形式」のような書式例に一致する |
| `todo-requires-ticket` | チケット参照のない TODO / FIXME / HACK / XXX | チケット運用が無いプロジェクトでは全 TODO が一致する |
| `no-line-number-reference` | `foo.ts:123` 形式の行番号参照 | 「style.css: 12px を基準にしている」のような値の記述に一致する |
| `no-commented-out-code` | コメントアウトされたコード | — |
| `no-decorative-comment` | 情報量のない飾りコメント | — |

## プロジェクトごとに調整する箇所

リポジトリ直下の `comment-lint.config.json`。無ければ既定値で動くので、必ず作る必要はない。

```json
{
  "targetExtensions": ["ts", "tsx"],
  "ticketPattern": "\\b(ABC-\\d+)\\b",
  "allowedDocHosts": ["wiki.example.co.jp"],
  "ignorePaths": ["__fixtures__/"],
  "rules": { "todo-requires-ticket": "error", "no-decorative-comment": "off" }
}
```

| キー | 内容 |
|---|---|
| `targetExtensions` | 検査対象の拡張子 |
| `ticketPattern` | チケット番号の形式（JIRA / GitHub issue など） |
| `allowedDocHosts` | 引用として認めるドメイン。**社内wiki・Confluence等を必ず追加する** |
| `ignorePaths` | 検査対象外のパス（正規表現の文字列）。既定は lint 自身とフィクスチャ |
| `rules` | ルールごとの重大度。`error` / `warning` / `off` |

未知のルール名・不正な重大度・壊れた JSON は検査せず終了コード 2 で止まる。

`CITATION_TRIGGERS`（引用が必要な主張のトリガー語）だけはスクリプト内に直書きしてある。
系統ごと外したい場合はスクリプトを編集する。

## 既知の誤検知パターン

**規約やルールについて語っているコメント**が引っかかる。
例: `/** チケット参照パターン */` は `no-vague-citation`、`/** 仕様書として認めるドメイン */` は `require-citation` に当たる。

lint自身は `ignorePaths` の既定値で除外済み。
規約を扱うツール・ドキュメント的なコードを追加した場合は `ignorePaths` に足す。

## ルールを変更したときの確認

`scripts/__fixtures__/sample.ts` に、全ルールのNG例とOK例を置いてある。

```bash
node scripts/comment-lint.mjs --all --include-fixtures
```

**期待結果: error 8件 / warning 6件、OK群は1件も検出されない。**
ルールを足したらフィクスチャにもNG例とOK例を追記する。
OK例を用意しないと、誤検知が増えても気づけない。

`CITATION_TRIGGERS` が最も誤検知の出やすい部分。
最初は実装済みの5系統（仕様／デザイン／業務ルール／外部API制約／不具合回避）のまま回し、
ノイズが多い系統は外す方向で調整する。**トリガーは狭く保つ方が安全**。

## コメント抽出の範囲

コメントの切り出しはファイル単位で走査し、文字列リテラルとブロックコメントの状態を持つ。
そのため次のどちらも検査対象になる。

```js
const url = "https://example.com"; // 行内にURLがあっても後続のコメントを拾う
/*
  行頭に * を置かないブロックコメントの継続行も拾う
*/
```

差分モード（既定 / `--base`）でも、対象行だけでなくファイル全体を `git show` で読む。
内容が取れない場合は行単位の判定に退避するため、ブロックの継続行は取りこぼす。

## 抑制

該当行に `comment-lint-disable` を含めるとその行をスキップする。
乱用されていないかは、定期的に `git grep comment-lint-disable` で確認する。

## 導入

### pre-commit（lefthook）

```yaml
# lefthook.yml
pre-commit:
  commands:
    comment-lint:
      run: node scripts/comment-lint.mjs
```

husky なら `.husky/pre-commit` に同じ1行を書く。

### Claude Code のフック

git hook は人間でもAIでも通るが、Claude Code 側にも入れるとAIのコミット経路をより早く止められる。

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node scripts/comment-lint.mjs" }]
    }]
  }
}
```

終了コード 2 で返すと stderr の内容がAIに戻り、自己修正させられる。
ブロックするだけでなく直させたい場合は、そのラッパーを用意して終了コードを変換する。

### CI

`--no-verify` の抜け道を塞ぐ最終防衛線として、PRチェックで層A＋層Bを実行する。
層Bの結果はブロックせず、PRコメントとして出す（非決定的なため）。

層Aは `--base` で PR 差分だけを対象にする。`--all` を CI に入れると既存コードの指摘が
一度に出て、ジョブごと無視される。

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0   # base との差分を取るため
- uses: actions/setup-node@v7
  with:
    node-version-file: .node-version
- run: node scripts/comment-lint.mjs --base ${{ github.event.pull_request.base.sha }}
```

依存パッケージを使わないので `install` ステップは不要。

---

# 今後追加できる機械判定

検出に必要な情報量で3段階。

## 1. 正規表現で弾ける（テキストだけで判定）

実装済みのものに加えて追加候補:

| ルール | 重大度 |
|---|---|
| 許可リスト外のURL | warning |
| 異常に長いブロックコメント（設計書の書き写し疑い。例: 15行超） | warning |

## 2. AST・型情報が要る（費用対効果が高い領域）

| ルール | 検出方法 |
|---|---|
| JSDocの `@param` 名・個数が実引数と不一致 | eslint-plugin-jsdoc に既存ルールあり |
| `@returns` があるのに void、型と矛盾 | 同上（TS併用） |
| **コメント内の識別子が実在しない** | AST＋シンボル照合 |
| **コメント内の数値と近傍の定数が不一致**（`// 最大100件` vs `LIMIT = 50`） | 数値抽出＋定数比較 |
| コメント内のファイルパス参照が存在しない | パス抽出＋`fs.existsSync` |
| `@deprecated` なのに新規呼び出しが増えている | 参照解析 |
| 直後の関数名とコメント本文がほぼ同義（Whatの言い換え） | 識別子を分割して語の重複率で判定 |

**識別子・数値・パスの3つが最優先**。推測で書かれた嘘はたいてい固有名詞か数字を含むため、ここで相当拾える。

## 3. 外部参照が要る（CI向き）

| ルール | 検出方法 |
|---|---|
| TODOのチケットが実在しない／既にClosed | JIRA・GitHub API |
| Figmaのnode-idが無効 | Figma API |
| **コメント行がコード行より古い** | `git blame` で行単位の日付を比較 |

最後の git blame 差分は効果が大きい。
「コードは3回直されたのにコメントは半年前のまま」という、最も嘘になりやすいパターンを構造的に検出できる。

---

# 機械では弾けないもの（層Bに回す）

- 根拠が妥当か（示された出典が実際にその主張を支持しているか）
- コメントの主張と実装の挙動が**意味的に**一致しているか
- 設計書・Figmaと矛盾していないか
- 理由の記載が必要なのにコメントがない箇所

`// 二重送信防止のためdebounce` が本当に二重送信防止なのかは、実装を読まないと判定できない。
ここだけは機械では届かない。
