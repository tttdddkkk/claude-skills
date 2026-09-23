#!/usr/bin/env node
/**
 * comment-lint
 *
 * 追加されたコメント行だけを検査する簡易lint。
 * 正規表現で確定判定できるルールのみを扱う（意味的な検証はAIレイヤーの担当）。
 *
 * 重大度の定義:
 *   error   = AIが根拠として採用すると誤った実装を生むもの
 *             （嘘・推測・感想・いずれ陳腐化する情報・根拠不明の主張）
 *   warning = 採用されても害はないが、読むコストだけかかるもの
 *
 * 使い方:
 *   node scripts/comment-lint.mjs                  # ステージ済み差分を検査
 *   node scripts/comment-lint.mjs --all            # 追跡中の全ファイルを検査
 *   node scripts/comment-lint.mjs --base <ref>     # <ref> からの差分を検査（CI向け）
 *   node scripts/comment-lint.mjs --json           # JSON出力
 *
 * 終了コード:
 *   0 = error なし（warning はあってもよい）
 *   1 = error あり
 *   2 = 設定ファイルの不正（検査は行わない）
 *
 * 設定:
 *   リポジトリ直下の comment-lint.config.json で上書きする（無ければ既定値）。
 *   {
 *     "targetExtensions": ["ts", "tsx"],
 *     "ticketPattern": "\\b(ABC-\\d+)\\b",
 *     "allowedDocHosts": ["wiki.example.co.jp"],
 *     "rules": { "todo-requires-ticket": "error", "no-decorative-comment": "off" }
 *   }
 *   rules の値は "error" / "warning" / "off"。
 *
 * 抑制:
 *   該当行に comment-lint-disable を含めるとその行をスキップ。
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// 設定の読み込み
// ---------------------------------------------------------------------------

const CONFIG_FILE = 'comment-lint.config.json';

const DEFAULT_CONFIG = {
  targetExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'css', 'scss'],
  ticketPattern: '\\b([A-Z]{2,10}-\\d+|#\\d+)\\b',
  /** 設計書・仕様書として認めるドメイン。社内wikiはここに足す */
  allowedDocHosts: [
    'figma.com',
    'www.figma.com',
    'developer.mozilla.org',
    'caniuse.com',
    'github.com',
    'bugs.webkit.org',
    'bugzilla.mozilla.org',
  ],
  rules: {},
};

const fail = (msg) => {
  console.error(`comment-lint: ${msg}`);
  process.exit(2);
};

function loadConfig() {
  let user;
  try {
    user = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_CONFIG };
    fail(`${CONFIG_FILE} を読み込めません: ${e.message}`);
  }
  if (typeof user !== 'object' || user === null || Array.isArray(user)) {
    fail(`${CONFIG_FILE} はオブジェクトである必要があります`);
  }
  return {
    ...DEFAULT_CONFIG,
    ...user,
    rules: { ...DEFAULT_CONFIG.rules, ...(user.rules ?? {}) },
  };
}

const config = loadConfig();

const TARGET_EXT = new RegExp(`\\.(${config.targetExtensions.join('|')})$`, 'i');

/** チケット参照パターン */
let TICKET;
try {
  TICKET = new RegExp(config.ticketPattern);
} catch (e) {
  fail(`ticketPattern が正規表現として不正です: ${e.message}`);
}

/** 引用として認める記法 */
const CITATION = {
  ticket: TICKET,
  // Figmaはnode-id必須（ファイルURLだけでは結局探すことになるため）
  figma: /figma\.com\/(file|design)\/[^\s)]*[?&]node-id=[\w:%-]+/i,
  url: new RegExp(
    `https?://(?:${config.allowedDocHosts.map((h) => h.replace(/\./g, '\\.')).join('|')})/\\S+`,
    'i',
  ),
  // 同リポジトリ内のシンボル参照。行番号ではなく関数名・型名で指す
  symbol: /(?:@see|@link)\s+([A-Za-z_$][\w$]*)/,
};

/** 引用が必要な主張のトリガー（誤検知を避けるため最初は狭く保つ） */
const CITATION_TRIGGERS = [
  { kind: '仕様', test: /仕様(上|書|では|により|に従)|要件(上|では|により)|定められて|規定されて/ },
  { kind: 'デザイン', test: /デザイン(指定|都合|上|により|に合わせ)|デザイナー(指定|確認|より)/ },
  { kind: '業務ルール', test: /手数料|税率|営業日|締め日|利用規約|法令|コンプライアンス/ },
  { kind: '外部API制約', test: /API(の)?(制限|制約|仕様)|最大\s*\d+\s*件|レート制限|返(さない|却されない)/ },
  { kind: '不具合回避', test: /バグ(回避|対応)|不具合(回避|対応)|(iOS|Android|Safari|Chrome|WebView)[^。]{0,20}(問題|不具合|バグ|挙動)/ },
];

/** 引用不要とみなす軽微なコメント（トリガー語を含んでいても除外） */
const CITATION_EXEMPT = /^\s*[/*\s]*(TODO|FIXME|HACK|XXX)\b/i;

// ---------------------------------------------------------------------------
// ルール定義
//
// severity の既定値は comment-lint.config.json の rules で上書きできる。
// 既定を warning にしてあるものは、正当なコメントにも一致することが実測で確認されている
// ルール。チケット運用や表記規約が固まっているプロジェクトでは error に引き上げてよい。
// ---------------------------------------------------------------------------

const RULES = [
  // --- error: AIが根拠として採用すると誤った実装を生むもの ---
  {
    name: 'no-unresolved-assumption',
    severity: 'error',
    test: /\b(ASSUMPTION|ASSUME|GUESS)\b\s*[:：]|要確認|未確認/i,
    message: '未解決の仮定が残っています。確認して確定内容に書き換えるか削除してください',
  },
  {
    name: 'no-subjective-claim',
    severity: 'error',
    // 検証不能な感想。AIが設計方針として採用してしまうため実害になる
    test: /(わかり|分かり|判り)やすく|読みやすく|シンプルに|きれいに|美しく|モダンな|ベストプラクティス|イケてる|便利な(ため|ので)/,
    message: '検証できない主観です。削除してください（設計方針は規約に書く）',
  },
  {
    name: 'unverified-perf-claim',
    severity: 'error',
    // 検証可能だが根拠がない主張。数値もチケットもなければ未検証とみなす
    test: (text) =>
      /パフォーマンス(向上|改善)|高速化|最適化(のため|して)|メモリ(削減|節約)|効率化のため|for performance|optimi[sz]ed/i.test(text) &&
      !TICKET.test(text) &&
      !/\d/.test(text),
    message: 'パフォーマンスを理由にするなら、結果ではなく守るべき制約を書いてください（例: 1000件超で描画が破綻するため）',
  },
  {
    name: 'no-change-history',
    severity: 'error',
    // 次の変更で必ず古くなる。経緯はPR/gitに残す
    test: /から変更|に変更しました|以前は|旧実装|旧API|修正前は|元々は|削除しました|追加しました|リファクタしました/,
    message: '変更履歴・経緯はgit/PRの役割です。残す必要があるならTODO(チケット)として書いてください',
  },
  {
    name: 'require-citation',
    severity: 'error',
    // 外部に根拠があるはずの主張に引用がない = レビュワーが裏取りする羽目になる
    test: (text) => {
      if (CITATION_EXEMPT.test(text)) return false;
      const trigger = CITATION_TRIGGERS.find((t) => t.test.test(text));
      if (!trigger) return false;
      const hasCitation =
        CITATION.ticket.test(text) ||
        CITATION.figma.test(text) ||
        CITATION.url.test(text) ||
        CITATION.symbol.test(text);
      return hasCitation ? false : { kind: trigger.kind };
    },
    message: (hit) =>
      `${hit.kind}に関する主張に引用元がありません。出典を添えてください（例: 出典: ABC-123 / 参照: figma.com/design/...?node-id=1:23 / @see funcName）`,
  },
  {
    name: 'no-vague-citation',
    severity: 'error',
    test: (text) =>
      /(設計書|仕様書|デザイン|チケット|ドキュメント)(を)?(参照|確認|参考)|詳細は(別途|以下|そちら)/.test(text) &&
      !(CITATION.ticket.test(text) || CITATION.figma.test(text) || CITATION.url.test(text)),
    message: '参照先が特定できません。チケット番号かURLを明記してください',
  },
  {
    name: 'no-secret-in-comment',
    severity: 'error',
    test: /(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[\w\-]{12,}|https?:\/\/\S*[?&](token|key|access_token)=/i,
    message: '秘匿情報らしき文字列が含まれています',
  },

  // --- warning: 正当なコメントにも一致しうるもの（error への引き上げは設定で行う） ---
  {
    name: 'no-speculation',
    severity: 'warning',
    // 「通常は200が返るが、認証失敗時のみ401」のような正当な条件説明にも一致する
    test: /おそらく|恐らく|と思われる|と思います|たぶん|多分|かもしれない|のはず|一般的に|通常は|probably|presumably|might be|I think/i,
    message: '推測表現です。根拠を示すか、コメントごと削除してください',
  },
  {
    name: 'todo-requires-ticket',
    severity: 'warning',
    // チケット運用が無いプロジェクトでは全TODOが一致する
    test: (text) => /\b(TODO|FIXME|HACK|XXX)\b/i.test(text) && !TICKET.test(text),
    message: 'TODO/FIXME にチケット参照がありません（例: TODO(ABC-123): ...）',
  },
  {
    name: 'no-volatile-metadata',
    severity: 'warning',
    // 日付フォーマットの例示（「例: 2024-01-15 のような形式」）にも一致する
    test: /\d{4}[/\-年]\d{1,2}[/\-月]\d{1,2}|作成者\s*[:：]|担当\s*[:：]|@[a-z][\w.-]{2,}\s*(さん|作成|対応)/i,
    message: '日付・担当者の直書きは陳腐化します。git blameとチケットに任せてください',
  },
  {
    name: 'no-line-number-reference',
    severity: 'warning',
    // 「style.css: 12px を基準にしている」のような値の記述にも一致する
    test: /[\w/.\-]+\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|css|scss)\s*[:：#]\s*L?\d+/i,
    message: '行番号参照は陳腐化します。関数名・型名で指してください（例: @see formatCurrency）',
  },
  {
    name: 'no-commented-out-code',
    severity: 'warning',
    test: /^\/\/\s*(const|let|var|function|return|if|for|while|import|export|await|console)\b/,
    message: 'コメントアウトされたコードの可能性があります。不要なら削除してください',
  },
  {
    name: 'no-decorative-comment',
    severity: 'warning',
    test: /^\s*[/*\s]*([-=*#~]{3,}|ここから|ここまで|以下|処理|メイン|その他)\s*[-=*#~]*\s*$/,
    message: '情報量のない飾りコメントです',
  },
];

/** RULES に無い疑似ルール。severity の上書きだけ受け付ける */
const SYMBOL_RULE = 'citation-symbol-exists';

// ---------------------------------------------------------------------------
// severity の上書き適用
// ---------------------------------------------------------------------------

const SEVERITIES = new Set(['error', 'warning', 'off']);
const KNOWN_RULES = new Set([...RULES.map((r) => r.name), SYMBOL_RULE]);

for (const [name, severity] of Object.entries(config.rules)) {
  if (!KNOWN_RULES.has(name)) {
    fail(`${CONFIG_FILE}: 未知のルール名 "${name}"（有効: ${[...KNOWN_RULES].join(', ')}）`);
  }
  if (!SEVERITIES.has(severity)) {
    fail(`${CONFIG_FILE}: ルール "${name}" の値 "${severity}" は error / warning / off のいずれかである必要があります`);
  }
}

const ACTIVE_RULES = RULES.map((rule) => ({ ...rule, severity: config.rules[rule.name] ?? rule.severity })).filter(
  (rule) => rule.severity !== 'off',
);
const symbolSeverity = config.rules[SYMBOL_RULE] ?? 'error';

// ---------------------------------------------------------------------------
// 対象行の収集
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const scanAll = argv.includes('--all');

/** --base <ref> / --base=<ref> */
const baseRef = (() => {
  const eq = argv.find((a) => a.startsWith('--base='));
  if (eq) return eq.slice('--base='.length);
  const i = argv.indexOf('--base');
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!value || value.startsWith('-')) fail('--base にはリビジョンを指定してください（例: --base origin/main）');
  return value;
})();

if (scanAll && baseRef) fail('--all と --base は同時に指定できません');

// stderr は握って握りつぶさない。失敗時は呼び出し側が e.message に載せて出す
const sh = (cmd) =>
  execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function collectLines() {
  if (scanAll) return collectFromWorktree();
  return collectFromDiff(
    baseRef
      ? `git diff --unified=0 --no-color ${JSON.stringify(baseRef)}...HEAD`
      : 'git diff --cached --unified=0 --no-color',
  );
}

function collectFromWorktree() {
  const files = sh('git ls-files').split('\n').filter((f) => f && TARGET_EXT.test(f));
  const out = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    content.split('\n').forEach((text, i) => out.push({ file, line: i + 1, text }));
  }
  return out;
}

function collectFromDiff(cmd) {
  let diff;
  try {
    diff = sh(cmd);
  } catch (e) {
    fail(`差分を取得できません: ${e.message.trim()}`);
  }
  const out = [];
  let file = null;
  let lineNo = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      const path = raw.slice(6).trim();
      file = path === '/dev/null' ? null : path;
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (!file || !TARGET_EXT.test(file)) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      out.push({ file, line: lineNo, text: raw.slice(1) });
      lineNo += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// コメント抽出
// ---------------------------------------------------------------------------

function extractComment(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return trimmed;

  const idx = trimmed.indexOf('//');
  if (idx > 0 && !/https?:$/.test(trimmed.slice(0, idx))) return trimmed.slice(idx);
  return null;
}

// ---------------------------------------------------------------------------
// シンボル実在チェック（@see で指したシンボルがリポジトリに存在するか）
// ---------------------------------------------------------------------------

const symbolCache = new Map();

function symbolExists(name) {
  if (symbolCache.has(name)) return symbolCache.get(name);
  let found = false;
  try {
    // 宣言らしき箇所を探す。見つからなければ嘘の参照
    const pattern = `(function|class|const|let|var|type|interface|enum)\\s+${name}\\b|${name}\\s*[:=]\\s*(async\\s*)?\\(`;
    const res = sh(`git grep -lE ${JSON.stringify(pattern)} -- ${JSON.stringify('*.*')} || true`);
    found = res.trim().length > 0;
  } catch {
    found = true; // grep失敗時は誤検知を避けて通す
  }
  symbolCache.set(name, found);
  return found;
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

const findings = [];

for (const { file, line, text } of collectLines()) {
  if (text.includes('comment-lint-disable')) continue;

  const comment = extractComment(text);
  if (!comment) continue;
  if (/@license|Copyright|eslint-disable|@ts-|stylelint-disable|prettier-ignore/i.test(comment)) continue;

  for (const rule of ACTIVE_RULES) {
    const hit = typeof rule.test === 'function' ? rule.test(comment) : rule.test.test(comment);
    if (!hit) continue;
    findings.push({
      file,
      line,
      rule: rule.name,
      severity: rule.severity,
      message: typeof rule.message === 'function' ? rule.message(hit) : rule.message,
      comment: comment.slice(0, 120),
    });
  }

  // @see で指したシンボルが実在するか
  if (symbolSeverity !== 'off') {
    const sym = comment.match(CITATION.symbol);
    if (sym && !symbolExists(sym[1])) {
      findings.push({
        file,
        line,
        rule: SYMBOL_RULE,
        severity: symbolSeverity,
        message: `参照先シンボル ${sym[1]} がリポジトリ内に見つかりません`,
        comment: comment.slice(0, 120),
      });
    }
  }
}

const errors = findings.filter((f) => f.severity === 'error');
const warnings = findings.filter((f) => f.severity === 'warning');

if (asJson) {
  console.log(JSON.stringify({ errors: errors.length, warnings: warnings.length, findings }, null, 2));
} else if (findings.length) {
  const order = { error: 0, warning: 1 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line,
  );
  for (const f of findings) {
    console.log(`${f.file}:${f.line}`);
    console.log(`  ${f.severity === 'error' ? 'error  ' : 'warning'}  ${f.message}  [${f.rule}]`);
    console.log(`           ${f.comment}`);
  }
  console.log(`\n${errors.length} error, ${warnings.length} warning`);
  if (errors.length) console.log('抑制する場合は該当行に comment-lint-disable を追記してください。');
} else {
  console.log('comment-lint: 指摘なし');
}

process.exit(errors.length ? 1 : 0);
