# CI レシピ（GitHub Actions）

CI の目的は「壊れたコードを main に入れないこと」。それ以上でも以下でもない。
デプロイ、リリース、通知は別ワークフローとして扱う（このスキルの非目標）。

**アクションのバージョンは記憶で書かない。** 以下のテンプレートのタグは 2026-08-31 時点で
確認した現行メジャーであり、**導入時に各アクションのリポジトリで再確認して合わせること。**

## 目次
- [基本形](#基本形)
- [必ず入れる4つの設定](#必ず入れる4つの設定)
- [ジョブ分割の判断](#ジョブ分割の判断)
- [モノレポ](#モノレポ)
- [ライブラリ公開](#ライブラリ公開)

---

## 基本形

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

# 同一ブランチの古い実行をキャンセルする。連続pushでの無駄な消費を防ぐ
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .node-version   # このファイルが無いと失敗する。先に作る
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

テンプレートは pnpm 前提で書いてある。**検出したパッケージマネージャに読み替える。**

| PM | セットアップ | `cache` | インストール |
| --- | --- | --- | --- |
| pnpm | `pnpm/action-setup` を先に置く | `pnpm` | `pnpm install --frozen-lockfile` |
| npm | 不要 | `npm` | `npm ci` |
| yarn | Corepack 有効化（`packageManager` を参照させる） | `yarn` | `yarn install --immutable`（Berry）/ `--frozen-lockfile`（v1） |
| bun | `oven-sh/setup-bun` | （`setup-node` を使わない） | `bun install --frozen-lockfile` |

`packageManager` フィールドがある場合は Corepack がそれを読むので、
アクション側でバージョンを二重指定しない。

---

## 前提：`package.json` の scripts

この基本形は `lint` / `typecheck` / `test` の3つの script が存在することを前提にしている。
**定義していない script をワークフローに書かない。** 型チェックを入れないなら `typecheck` の行を、
テストが1本も無いなら `test` の行を消す。ステップを消すか、script を足すか、必ずどちらかに揃える。

---

## 必ず入れる4つの設定

これらが抜けている CI は、動くが無駄が多い。

### 1. `concurrency` + `cancel-in-progress`
PR に連続で push したとき、古い実行が最後まで走り続けるのを止める。
実行時間の削減効果が最も大きい一行。

### 2. `permissions` の最小化
デフォルトの `GITHUB_TOKEN` は書き込み権限を持つ場合がある。
ワークフロー単位で `contents: read` に絞り、必要なジョブにだけ個別に権限を足す。

### 3. 依存キャッシュ
`setup-node` の `cache` オプションで lockfile ベースのキャッシュが効く。
自前で `actions/cache` を書く必要はほぼない。

### 4. `--frozen-lockfile` / `npm ci`
lockfile を無視した解決を禁止する。これがないと CI とローカルで違うバージョンが入り、
「CI だけ落ちる」の原因になる。

---

## ジョブ分割の判断

**分けない方がいい場合（デフォルト）**
lint / typecheck / test を1ジョブに直列で書く。
ジョブを分けると各ジョブで checkout と install が繰り返され、
チェック自体より準備の方が長いという状態になりやすい。小〜中規模ではこれが最適。

**分ける価値がある場合**
- install + build に時間がかかり、後段を並列化する利得が上回る
- 複数の Node バージョン / OS でテストする必要がある（ライブラリで頻出）
- 失敗箇所を GitHub UI 上で区別したい要求が明確にある

**matrix を組むなら**
アプリケーションで matrix は基本不要（動かす環境は1つに決まっているはず）。
ライブラリでサポート範囲を保証したい場合のみ:

```yaml
    strategy:
      fail-fast: false
      matrix:
        node: [22, 24]   # 現役の LTS を確認して指定（EOL 済みを残さない）
```

---

## パス絞り込み

ドキュメントだけの変更で全チェックを回す必要はない。ただし**入れすぎると
「必須チェックが実行されずマージできない」問題**が起きるので注意する。

```yaml
on:
  pull_request:
    paths-ignore:
      - '**.md'
      - 'docs/**'
```

Branch protection の required checks に指定しているジョブに `paths-ignore` を付けると、
スキップ時に「pending のまま」になる。その場合は `paths-ignore` を使わず、
ジョブ内の `if` で早期終了させるか、必須チェックから外す。

---

## モノレポ

変更されたパッケージだけ回す。全パッケージを毎回ビルドすると時間が線形に伸びる。

- Turborepo: `turbo run lint test --filter=...[origin/main]`
- pnpm: `pnpm --filter "...[origin/main]" run test`
- どちらの場合も `fetch-depth: 0`（または比較対象のコミットが取れる深さ）が必要

```yaml
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
```

キャッシュ（Turborepo のリモートキャッシュ等）は、効果を測ってから入れる。
設定コストに見合わないケースもある。

---

## ライブラリ公開

配布物の整合性チェックは、公開後に気づくと修正コストが高いので CI に入れる価値が大きい。

```yaml
      - run: pnpm build
      - run: pnpx publint            # package.json の公開設定の妥当性
      - run: pnpx @arethetypeswrong/cli --pack   # 型定義の解決可否
```

リリース自動化（Changesets 等）を入れる場合は、`permissions` に
`contents: write` / `id-token: write`（npm provenance）が必要になる。
**ワークフロー全体ではなく該当ジョブにだけ**付ける。

---

## 入れない方がいいもの

- **自動フォーマット commit を CI から push する**：ループやレビュー中の差分混入の原因になる。
  ローカルの hook か、PR コメントでの指摘に留める。
- **失敗しても続行する `continue-on-error` の常用**：チェックが飾りになる。
- **全部入りの巨大ワークフロー**：デプロイと検査を1ファイルに混ぜると、
  検査だけ回したいときに動かせなくなる。
