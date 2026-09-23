// ルール調整時の動作確認用フィクスチャ。
// ignorePaths で除外されているため、通常の検査では対象外。
//
// 確認方法:
//   node scripts/comment-lint.mjs --all --include-fixtures
//
// 期待: NG群のみが検出され、OK群は1件も検出されない。
// 重大度は comment-lint.config.json で変えられるため、以下の分類は既定値のもの。

// ===== NG: error になるべきもの =====

// ASSUMPTION: 認証は済んでいる前提
export const ng_assumption = 1;

// わかりやすくするため分割
export const ng_subjective = 2;

// パフォーマンス向上のため
export const ng_perf = 3;

// 旧APIから変更
export const ng_history = 4;

// 仕様上、手数料は3%固定
export const ng_citation = 5;

// 詳細は設計書参照
export const ng_vague = 6;

// @see nonExistentHelperThatDoesNotExistAnywhere
export const ng_symbol = 7;

// apiKey: DUMMYVALUEFORFIXTUREONLY
export const ng_secret = 8;

// ===== NG: warning になるべきもの =====
//
// 以下の4つは正当なコメントにも一致するため既定を warning にしている。
// チケット運用や表記規約が固まっているプロジェクトでは config で error に引き上げる。

// おそらくユーザーIDを渡す必要がある
export const ng_speculation = 9;

// 2026/09/18 田中対応
export const ng_metadata = 10;

// TODO: あとで直す
export const ng_todo = 11;

// @see src/utils/format.ts:123
export const ng_lineref = 12;

// const old = compute();
export const ng_commented_out = 13;

// -------------------
export const ng_decorative = 14;

// ===== OK: 検出されるべきでないもの =====

// 仕様上、手数料は3%固定（出典: ABC-1234）
export const ok_citation = 15;

// 1000件超で描画が破綻するため仮想スクロール化（出典: ABC-99）
export const ok_constraint = 16;

// iOS WebViewで100vhがツールバー分ずれるため dvh を使用（参照: https://bugs.webkit.org/show_bug.cgi?id=141832）
export const ok_why = 17;

// TODO(ABC-5678): バックエンド対応後にフォールバック削除
export const ok_todo = 18;

// 二重送信防止のため意図的にdebounceしている。削除しないこと
export const ok_warning = 19;

// デザイン指定の余白（参照: https://www.figma.com/design/abc?node-id=1:23）
export const ok_figma = 20;

// @see ok_citation
export const ok_symbol = 21;
