# カタログ：何を入れるか、どのツールを選ぶか

## 目次
- [決定表](#決定表)
- [各項目の解説](#各項目の解説)
- [ツール選定](#ツール選定)
- [既存プロジェクトへの後付け](#既存プロジェクトへの後付け)

---

## 決定表

Q3（厳格度）が縦軸。◎=必ず入れる / ○=入れる / △=提案のみ（承認を取る） / −=入れない。

| 設定 | 最小限 | 標準 | 厳格 |
| --- | :-: | :-: | :-: |
| `.gitignore` | ◎ | ◎ | ◎ |
| `.editorconfig` | ◎ | ◎ | ◎ |
| `.gitattributes`（改行正規化） | ○ | ◎ | ◎ |
| フォーマッター | ◎ | ◎ | ◎ |
| リンター | △ | ◎ | ◎ |
| ランタイムバージョン固定 | △ | ◎ | ◎ |
| `tsconfig` strict | ○ | ◎ | ◎ |
| CI（lint / typecheck / test） | − | ◎ | ◎ |
| Git hooks（pre-commit） | − | △ | ◎ |
| 依存同期 hook（post-merge） | − | ○ | ◎ |
| 依存自動更新（Renovate / Dependabot） | − | △ | ◎ |
| 更新 PR の automerge | − | − | △ |
| GitHub auto-merge / merge queue | − | − | △ |
| PR テンプレート | − | △ | ○ |
| CODEOWNERS | − | − | ○ |
| commitlint | − | − | △ |
| LICENSE | − | △ | ◎ |
| セキュリティスキャン（CodeQL 等） | − | − | △ |

**Q2（体制）による補正**

- 自分だけ → CODEOWNERS / PR テンプレート / commitlint は不要。厳格を選んでいても提案止まりにする。
  一方で更新 PR の automerge は、レビュアーがいないぶん滞留を防ぐ効果が大きい。ただし**CI が
  無い、または CI が飾りの状態では絶対に入れない**（無人で壊れたコードが main に入る）。
- 社内チーム → CODEOWNERS は「レビュー担当が固定なら」入れる。人数が少ないなら不要。
- OSS 公開 → LICENSE、`CONTRIBUTING.md`、Issue テンプレート、Dependabot security updates は必須級。

**Q1（種別）による補正**

- ライブラリ → `exports` / `types` の整合チェック（`publint` / `arethetypeswrong`）を CI に入れる価値が高い。
  `files` フィールドか `.npmignore` で公開物を絞る。リリース自動化（Changesets）は厳格時に提案。
- モノレポ → lint / test は変更されたパッケージだけ回す仕組み（turbo / nx / workspace filter）を検討。
  ルート設定と各パッケージ設定の継承関係を明示する。
- 検証・使い捨て → `.gitignore` と フォーマッターだけでよい。CI を提案しない。

---

## 各項目の解説

### `.gitignore`
生成系（`node_modules`、`dist`、`.next`、`coverage`）、環境変数（`.env*`、ただし `.env.example` は除外しない）、
OS/エディタ（`.DS_Store`、`.idea`）を含める。
**`.env.example` を無視してしまう事故が多い**ので `!.env.example` を必ず入れる。

### `.editorconfig`
エディタ間でインデント・改行・文字コードを揃える。フォーマッターと役割が重なるが、
**フォーマッター対象外のファイル（Markdown、設定ファイル、シェル）にも効く**点で価値がある。
末尾改行と行末空白の除去は、無意味な差分を減らす効果が大きい。

### `.gitattributes`
`* text=auto eol=lf` で改行コードを正規化する。
Windows/macOS 混在チームや、CI とローカルで差分が出る場合に効く。
バイナリ（画像、フォント）を `binary` 指定しておくと diff が壊れない。

### ランタイムバージョン固定
「自分の環境では動く」を潰すための設定。以下を揃える:
- `package.json` の `engines` と `packageManager`（Corepack が読む）
- `.node-version` または `.nvmrc`（`mise` / `nvm` / `fnm` が読む）
- CI の `setup-node` は `node-version-file` でこれらを参照させる（**バージョンを二重に書かない**）

### Git hooks
`lefthook` を推奨（単一バイナリ、YAML設定、並列実行、Node 非依存）。
`husky` + `lint-staged` は既存プロジェクトで使われていれば維持でよい。

**`lefthook.yml` を置くだけでは hook は動かない。** 本体の導入と、`.git/hooks` への登録が要る。
npm / pnpm で入れた場合は postinstall が登録まで済ませる（検証済み: lefthook 2.1.12）。
`brew install lefthook` のようにパッケージマネージャ外で入れた場合は `lefthook install` を実行する。

**pnpm 10 以降は依存の postinstall を既定で実行しない**ため、承認しないと登録されないうえに
install 自体が失敗し、`pnpm run` 系がすべて動かなくなる。`pnpm-workspace.yaml` に
`allowBuilds: { lefthook: true }` を書く（マップ形式。詳細は SKILL.md §5）。
登録漏れが起きていないかは `ls .git/hooks/` で確認できる。

`assets/lefthook.yml` は `jobs` 構文で書いてある（lefthook 2.1.12 の公式ドキュメントで確認）。
`commands` も別の書き方として存在するので、既存プロジェクトが `commands` で書かれていれば
そのまま維持してよい。無理に統一しない。

非 staged なフック（`post-merge` 等）で「特定のファイルが変わったときだけ走らせる」には、
`files` に列挙コマンドを書き、`glob` で絞る。**`files` の実行結果が空なら job はスキップされる**
という仕様なので、条件分岐をシェルで自作しなくてよい。

**hooks に何を入れるかが重要**。フォーマットと lint の自動修正までに留める。
pre-commit で型チェックやテストを走らせると、コミットが数十秒かかって
`--no-verify` が常用されるようになり、設定が形骸化する。重い検査は CI の担当。

### 依存同期 hook（post-merge）
pull やブランチ切替のあとに `install` を打ち忘れて、「動かない」と原因を探す時間を潰すための設定。
効果のわりに事故が少ないので、標準以上では入れてよい。

**必ず lockfile が変わったときだけ走らせる。** 毎回無条件に `install` すると切替が数秒〜数十秒
遅くなり、結局 hook ごと無効化される。pre-commit と同じ失敗の仕方をする。

`post-checkout` でも同じことができるが、git がフックに渡す引数（切替前後の HEAD）の受け取り方は
lefthook のバージョンで確認が必要。まず `post-merge` だけ入れて、必要なら足す。

### マージ自動化
次の3つは別物なので、混ぜて説明しない。

- **Renovate / Dependabot の automerge** — 更新 PR を無人でマージする。設定は `renovate.json` 側。
  **条件を必ず絞る**（例: `patch` のみ、`devDependencies` のみ）。範囲を広げるほど、
  CI が拾えない挙動変化がそのまま main に入る。
- **GitHub の auto-merge** — 「チェックが通ったらマージ」を PR 単位で予約する機能。
  リポジトリ設定での有効化が必要（管理者権限）。人が押すマージボタンを省くだけで、判断は省かない。
- **merge queue** — main へのマージを直列化し、マージ順による壊れを防ぐ。
  並行 PR が多いリポジトリ向けで、少人数では過剰。

**3つとも前提は同じ**: branch protection の required checks が正しく設定されていること。
ここが緩いまま automerge を入れるのが最大の事故パターンなので、**CI とチェック必須化が
先に入っていない場合は automerge を提案しない**。

automerge を入れる場合の `renovate.json` への追記例（既定では入れない。承認を取ってから）:

```json
{
  "packageRules": [
    {
      "description": "patch のみ、CI 通過を条件に自動マージ",
      "matchUpdateTypes": ["patch"],
      "automerge": true
    }
  ]
}
```

Renovate がプラットフォーム側の auto-merge を使うか自前でマージするかは設定と
バージョンで変わる。**挙動を公式ドキュメントで確認してから有効化する。**

### 依存自動更新
- **Renovate**: 設定の柔軟性が高い。まとめPR、自動マージ条件、スケジュール指定ができる。
- **Dependabot**: GitHub 標準で導入が楽。security updates だけなら Dependabot で十分。

**Renovate は設定ファイルを置くだけでは動かない**。GitHub App（または self-hosted）の
インストールが別途必要で、これはリポジトリ管理者の操作になる。設置を依頼する必要がある旨を
必ず伝える。Dependabot は GitHub 組み込みなのでファイル配置だけで動く。

どちらも**無設定だと PR が溢れる**。最低限、パッチ更新のグルーピングと更新頻度の制限を入れる。

`assets/renovate.json` は週1回（月曜朝）に寄せてある。**更新 PR を「片付ける時間」を週の一箇所に
固めるため**で、頻度そのものに根拠があるわけではない。日常的に触るリポジトリなら毎日でも捌けるし、
放置しがちなリポジトリなら隔週の方が溜まらない。脆弱性アラートだけはスケジュールを外して
即時に出す設定にしてある（`vulnerabilityAlerts`）。
グルーピングの既定挙動はプリセットの内容で決まる。**確認時点（2026-08）の `config:recommended` は
`separateMajorMinor` の既定（true）を維持しており、major は自動的に個別 PR になる**ため、
それを狙った packageRules を書き足す必要はない。プリセットの内容は変わりうるので、
挙動を前提にしたルールを書く前に現行内容を確認する。確認せずに「効いているつもりの
no-op ルール」を置かない。

### CODEOWNERS
特定のパスに対するレビュー担当を GitHub に指定する。該当パスを含む PR に自動でレビュアーが付く。
**branch protection の「Require review from Code Owners」と組み合わせて初めて強制力を持つ**ので、
ファイルを置くだけでは通知が増えるだけになる。

**入れる条件はレビュー担当が実際に固定されていること。** 2〜3人で全員が全部見るチームでは、
全パスを1チームに割り当てただけの空設定になり、レビュー待ちを増やすだけで終わる。

雛形は置かない。中身が完全にプロジェクト依存で、汎用の初期値が存在しないため。書式は
「パス 所有者」の順で、後に書いた行が優先される:

```
# 既定の担当
*                @org/dev

# 特定領域だけ担当を変える
/infra/          @org/platform
/docs/           @org/writers
```

粒度は**実際にレビューを差し戻せる単位**で切る。細かく切りすぎると、担当者が不在のときに
その領域の PR が全部止まる。

### commitlint
Conventional Commits を強制する。**自動生成の CHANGELOG やリリース自動化とセットでないと、
規約のためだけの規約になる**ので、そこまでやる意思があるか確認してから入れる。

---

## ツール選定

### Biome か Prettier + ESLint か

**Biome を選ぶ条件**
- 新規プロジェクト、または既存の lint 設定が薄い
- 対象が JS / TS / JSX / JSON / CSS 中心
- ツール数と実行速度を重視する（単一バイナリ、設定ファイル1つ）

**Prettier + ESLint を維持・採用する条件**
- フレームワーク固有の ESLint プラグインに強く依存している
  （`@next/eslint-plugin-next`、`eslint-plugin-vue` の詳細ルール、`eslint-plugin-testing-library` 等）
- Biome に存在しないカスタムルールを運用している
- チームが既に ESLint 設定を育てていて、移行コストが利得を上回る

**注意**: Vue / Svelte / Astro など HTML 系テンプレートの扱いは、Biome のバージョンによって
対応範囲も必要な設定キーも変わる（実験的フラグの明示的な有効化を要する時期がある）。
これらのファイルを扱う場合は、**対応状況・設定キー名・安定度を導入時に公式ドキュメントで確認する**。
ここに書いてあるバージョン番号を根拠に判断しない。
フレームワーク固有ルールが必要なら、Biome（JS/TS）+ ESLint（`.vue` のみ）の併用も現実的。

**移行する場合**は既存ルールの棚卸しを先にやる。落ちるルールを列挙して提示し、
「これらは Biome に対応がないので外れます」と合意を取ってから進める。黙って落とさない。

### パッケージマネージャ
**選ばない。** lockfile が示すものをそのまま使う。
新規で指定がない場合のみ pnpm を提案する（ディスク効率、厳格な依存解決）。
既存プロジェクトのパッケージマネージャ変更は、このスキルの守備範囲外。

### テストランナー
既存があればそれを使う。新規で必要なら Vitest（Vite系プロジェクト）か、
フレームワーク標準のものに合わせる。**テストが1つもないプロジェクトに
テストランナーだけ入れても意味がない**ので、その場合は CI の test ステップを外すか、
サンプルテストを1本置いて緑にしておく。

---

## 既存プロジェクトへの後付け

新規より難しい。以下の順で進める。

1. **現状の把握を先に共有する**
   「既に `.prettierrc` と ESLint があり、CI は deploy のみ」のように整理して見せる。
   人間が把握していない設定があることは珍しくない。

2. **差分の量を見積もる**
   フォーマッターを入れると全ファイルが書き換わる可能性がある。
   `--check` 系のドライラン（`biome check .` / `prettier --check .`）で影響ファイル数を先に数え、
   件数を伝えてから実行する。

3. **段階導入を選択肢に出す**
   一括適用が現実的でない場合:
   - フォーマット適用のみ先行 → 別コミット → `.git-blame-ignore-revs` に登録
   - lint は最初 `warn` で入れて CI は落とさない → 数を減らしてから `error` に上げる
   - 対象を新規/変更ファイルのみに絞る（lefthook の staged files 指定）
   - `tsconfig` の追加オプションは1つずつ有効化する（`strict` → 個別オプションの順）

4. **CI は既存ワークフローを壊さない**
   新規ジョブは別ファイル（`ci.yml`）で追加し、既存の deploy 等には触らない。
   同名ジョブの上書きや、`on:` の条件変更は事故のもと。
