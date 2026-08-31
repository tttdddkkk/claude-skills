# assets

各設定ファイルの雛形。**そのままコピーしない。** 検出結果（パッケージマネージャ、
Node バージョン、既存の scripts 名、フレームワーク）を反映させてから配置する。

`$schema` の URL（`biome.json` はバージョン番号を含む）やアクションのタグ、ツールのバージョンは
**2026-08-31 時点で確認した値**。時間が経つほどずれるので、**導入時に現行版を再確認すること。**

| ファイル | 配置先 |
| --- | --- |
| `editorconfig` | `.editorconfig` |
| `gitattributes` | `.gitattributes` |
| `gitignore-node` | `.gitignore` |
| `biome.json` | `biome.json` |
| `lefthook.yml` | `lefthook.yml` |
| `tsconfig.strict.json` | `tsconfig.json` にマージ |
| `renovate.json` | `.github/renovate.json` |
| `github/workflows/ci.yml` | `.github/workflows/ci.yml` |
| `github/pull_request_template.md` | `.github/pull_request_template.md` |

## 雛形が無いが必要なもの

固定値を置けないため雛形にしていない。導入時に作る。

- `.node-version` — `node -v` で確認した値、または合意した LTS を1行。
  `ci.yml` が `node-version-file` で参照するので、**CI を入れるなら必須**。
- `CODEOWNERS` — レビュー担当が固定されている場合のみ。中身がプロジェクト依存のため雛形なし。
  書式は `references/catalog.md` を参照。
- `package.json` の `scripts`（`format` / `lint` / `typecheck` / `test`）—
  `ci.yml` と検証手順がこれを前提にする。定義しない script はワークフローからも消す。
