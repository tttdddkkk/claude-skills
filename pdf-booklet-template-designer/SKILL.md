---
name: pdf-booklet-template-designer
description: pdf-booklet スキル用の新しい冊子デザインテンプレート(style.css / template.json)を、ヒアリングした要望に沿って作成し、実際にビルド・プレビューして確認する。「新しいテンプレートを作りたい」「別のデザインのテンプレートを追加したい」のような依頼で使う。
---

# 冊子PDFテンプレート作成スキル

`pdf-booklet` スキル(`~/.claude/skills/pdf-booklet/`)用の新しいデザインテンプレートを作成する。テンプレートは見た目(CSS)だけを担当し、Markdownの解釈・ページネーションは `pdf-booklet/lib/engine.py` が共通で行う。

## 1. 要望をヒアリングする

最低限、以下を確認する:
- テンプレート名(フォルダ名にするので短い英数字スラッグも決める。例: `soft-ui-chapter-color`)
- 雰囲気・トーン(例: 硬め/ビジネス、カジュアル、学術寄り、カラフル、モノトーン)
- 章カラーパレット(お任せでよいか、指定色があるか)
- 参考にしたいデザイン(既存テンプレートのどこを踏襲/変更したいか)

不明な点は憶測で進めず質問する。

## 2. 契約を読む

必ず以下を読んでから設計する:
- `~/.claude/skills/pdf-booklet/lib/HTML_CONTRACT.md` — スタイルすべき正確なHTML構造・CSSクラス一覧
- `~/.claude/skills/pdf-booklet/SKILL.md` の「レンダリング上の既知の制約」— PDF書き出しで壊れる表現(グラデーション文字の`background-clip: text`、ぼかし付き`box-shadow`)を踏まない
- 既存テンプレート(例: `templates/soft-ui-chapter-color/style.css`)を構造の参考にする(コピペではなく、ヒアリング内容に沿って再設計する)

## 3. テンプレートを作成する

`~/.claude/skills/pdf-booklet/templates/<スラッグ>/` に以下を作成する:
- `style.css` — HTML契約のセレクタを一通りスタイルする。`--accent` はCSS変数として章ごとにインラインで渡される前提で `var(--accent)` を使う
- `template.json` — `name`(表示名)・`description`(1〜2文)・`palette`(章カラー配列。ヒアリングで決めた色、または雰囲気に合わせて選定)・`nombre`(ページ番号の体裁。`font_size`/`color`/`font_family`/`align`。省略時は `7pt`/`#7A8194`)
  - ノンブルはPDFのフッター領域に描画されるため `style.css` では変更できない。サイズや色を変えたい場合は必ず `template.json` の `nombre` で指定する
  - `format`(既定 `"{page} / {total}"`)と `skip_cover`(既定 `false`、表紙のノンブルを省く)も指定できる。`skip_cover` は内部で `pdfunite`(poppler)を使うため、無い環境では警告のうえ全ページに入る
- `README.md`(任意)— カスタマイズ方法や設計意図のメモ

## 4. ビルド・プレビューして確認する(省略しない)

`pdf-booklet` スキルの手順(2. ビルドする 〜 3. プレビューする)をそのまま流用して検証する。テスト用の原稿がなければユーザーに確認するか、既存の原稿(手元にあれば)を借りる。

```
python3 ~/.claude/skills/pdf-booklet/lib/engine.py \
  ~/.claude/skills/pdf-booklet/templates/<スラッグ> \
  <テスト原稿.md> <一時出力.pdf>
```

生成したPDFの表紙・章扉・表やカードを含むページをReadツールで画像プレビューし、HTML契約通りに正しく見た目が反映されているか、崩れ(輪郭の乱れた四角形、豆腐化、改ページ分断)がないかを確認する。

## 5. 確認とイテレーション

プレビューをユーザーに見せて確認を取る。修正があれば `style.css` / `template.json` を直し、4に戻る。OKが出たら完成。以降は `pdf-booklet` スキル側の「1. テンプレートを選ぶ」で自動的に選択肢に出るようになる(追加の登録作業は不要)。
