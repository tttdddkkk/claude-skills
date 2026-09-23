// verify.js の結果を証跡として残す。
//
// 「一致しました」を AI の報告で済ませると、検証したかどうか自体が確かめられない。
// そこで、レポートはスクリプトが生成し、PR への投稿もスクリプトが直接行う。
// AI が内容を要約・転記する経路を作らない。
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const EVIDENCE_BRANCH = 'figma-impl-evidence';

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const safeId = (id) => id.replace(/[^A-Za-z0-9]+/g, '-');

function gitState() {
  try {
    // 取得結果と証跡そのものは検証対象ではないので、未コミット判定から外す。
    // 外さないと、1回目の実行で出力したファイルのせいで2回目以降が必ず止まる。
    const status = sh('git', ['status', '--porcelain', '--', ':/', ':(exclude,top).figma-impl/tmp', ':(exclude,top).figma-impl/evidence']);
    return { sha: sh('git', ['rev-parse', 'HEAD']), dirty: status !== '' };
  } catch {
    return { sha: null, dirty: null };
  }
}

// PR に貼る証跡が、PR の最新コミットをそのまま検証したものであることを保証する。
// 未コミットの変更がある状態や別のコミットでの結果を貼ると、証跡が実物と食い違う。
function assertPublishable(pr) {
  const git = gitState();
  if (!git.sha) throw new Error('git リポジトリの外では --pr を使えません。');
  if (git.dirty) throw new Error('未コミットの変更があります。コミットして push してから検証してください（証跡とコミットを一致させるため）。');
  const head = sh('gh', ['pr', 'view', String(pr), '--json', 'headRefOid', '-q', '.headRefOid']);
  if (head !== git.sha) {
    throw new Error(`手元の HEAD (${git.sha.slice(0, 7)}) が PR #${pr} の最新コミット (${head.slice(0, 7)}) と違います。PR のブランチを最新にしてから検証してください。`);
  }
  return git;
}

const f = (v, digits = 2) => (v === null || v === undefined ? '—' : typeof v === 'number' ? String(+v.toFixed(digits)) : String(v));
const LABEL = { OK: '✅ OK', DIFF: '❌ DIFF', BUG: '❌ BUG', WARN: '⚠️ WARN', NOT_FOUND: '❌ 要素なし' };

function toMarkdown(r, imageUrl) {
  const L = [];
  const failed = r.results.filter((x) => x.status !== 'OK' && x.status !== 'WARN').length;
  L.push('## Figma 実装検証レポート\n');
  L.push(failed === 0
    ? `**結果: ✅ 差分なし**（${r.results.length} 要素、許容 ±${r.tolerance}px）\n`
    : `**結果: ❌ 差分あり**（${r.results.length} 要素中 ${failed} 要素、許容 ±${r.tolerance}px）\n`);

  L.push('| 項目 | 値 |');
  L.push('| --- | --- |');
  L.push(`| 検証したコミット | ${r.git.sha ? `\`${r.git.sha}\`` : '不明（git 管理外）'}${r.git.dirty ? ' ⚠️ 未コミットの変更あり' : ''} |`);
  L.push(`| 検証したページ | ${r.url} |`);
  L.push(`| Figma ファイル | ${r.figma.fileName ?? ''} (\`${r.figma.fileKey}\`) |`);
  L.push(`| Figma の版 | version \`${r.figma.fileVersion ?? '不明'}\` / 最終更新 ${r.figma.fileLastModified ?? '不明'} |`);
  L.push(`| Figma から取得した日時 | ${r.figma.fetchedAt} |`);
  L.push(`| nodes.json の SHA-256 | \`${r.nodesSha256}\` |`);
  L.push(`| ブラウザ | Chromium ${r.browserVersion} |`);
  L.push(`| 実行日時 | ${r.runAt} |`);
  L.push('');

  if (r.images.length) {
    L.push('### 見た目（左: Figma の書き出し / 右: 実装のスクリーンショット）\n');
    L.push('参考用。判定には使っていない（判定は下の数値のみ）。\n');
    L.push('| node | Figma | 実装 |');
    L.push('| --- | --- | --- |');
    for (const im of r.images) {
      const cell = (file) => (file ? `<img src="${imageUrl(file)}" width="320">` : '—');
      L.push(`| \`${im.id}\` ${im.name ?? ''} | ${cell(im.figma)} | ${cell(im.dom)} |`);
    }
    L.push('');
  }

  L.push('### 全要素の実測値（figma / 実装）\n');
  L.push('| 判定 | id | name | font-size | line-height | letter-spacing | weight | 幅 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const x of r.results) {
    const e = x.expected, a = x.actual || {};
    const pair = (ev, av) => `${f(ev)} / ${f(av)}`;
    L.push(`| ${LABEL[x.status]} | \`${x.id}\` | ${e.name ?? ''} | ${pair(e.fontSize, a.fontSize)} | ${pair(e.lineHeightPx, a.lineHeight)} | ${pair(e.letterSpacing, a.letterSpacing)} | ${pair(e.fontWeight, a.fontWeight)} | ${e.textAutoResize === 'WIDTH_AND_HEIGHT' ? pair(e.absoluteBoundingBox?.width, a.runWidth ?? a.width) : '対象外'} |`);
  }
  const details = r.results.flatMap((x) => x.rows.map((row) => ({ id: x.id, ...row })));
  if (details.length) {
    L.push('\n### 差分の内訳\n');
    L.push('| id | 種別 | 原因 | 詳細 |');
    L.push('| --- | --- | --- | --- |');
    for (const d of details) L.push(`| \`${d.id}\` | ${d.level} | ${d.cause} | ${d.detail} |`);
  }
  L.push(`\n<sub>このレポートは figma-impl/scripts/verify.js が生成・投稿した。手作業や AI による編集は経ていない。実行コマンド: \`${r.command}\`</sub>`);
  return L.join('\n') + '\n';
}

// 画像を PR のブランチにも main にも入れず、証跡専用ブランチに積む。
// 作業ツリーと index に触れないよう、一時 index でコミットを組み立てて push する。
function pushImages(localDir, files, remoteDir) {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(os.tmpdir(), `figma-impl-evidence-index-${process.pid}`) };
  let parent = null;
  try {
    sh('git', ['fetch', '-q', 'origin', `${EVIDENCE_BRANCH}:refs/remotes/origin/${EVIDENCE_BRANCH}`]);
    parent = sh('git', ['rev-parse', `refs/remotes/origin/${EVIDENCE_BRANCH}`]);
  } catch {
    // ブランチがまだ無い（初回）
  }
  try {
    if (parent) sh('git', ['read-tree', parent], { env });
    else sh('git', ['read-tree', '--empty'], { env });
    for (const file of files) {
      const blob = sh('git', ['hash-object', '-w', path.join(localDir, file)]);
      sh('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},${remoteDir}/${file}`], { env });
    }
    const tree = sh('git', ['write-tree'], { env });
    const args = ['commit-tree', tree, '-m', `evidence: ${remoteDir}`];
    if (parent) args.push('-p', parent);
    const commit = sh('git', args, { env });
    sh('git', ['push', '-q', 'origin', `${commit}:refs/heads/${EVIDENCE_BRANCH}`]);
    return commit;
  } finally {
    fs.rmSync(env.GIT_INDEX_FILE, { force: true });
  }
}

// ローカルに保存し、pr が指定されていれば PR にコメントする。
async function record({ report, outDir, screenshots, figmaImages, pr }) {
  const stamp = report.runAt.replace(/[:.]/g, '-');
  const dir = path.join(outDir, stamp);
  fs.mkdirSync(dir, { recursive: true });

  const images = [];
  for (const id of report.imageTargets) {
    const im = { id, name: report.nameById[id] ?? null, figma: null, dom: null };
    if (figmaImages[id]) { im.figma = `figma-${safeId(id)}.png`; fs.writeFileSync(path.join(dir, im.figma), figmaImages[id]); }
    if (screenshots[id]) { im.dom = `dom-${safeId(id)}.png`; fs.writeFileSync(path.join(dir, im.dom), screenshots[id]); }
    if (im.figma || im.dom) images.push(im);
  }
  report.images = images;

  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), toMarkdown(report, (file) => file));

  if (!pr) return { dir, commentUrl: null };

  const files = images.flatMap((im) => [im.figma, im.dom].filter(Boolean));
  const remoteDir = `pr-${pr}/${stamp}`;
  let imageUrl = () => '';
  if (files.length) {
    const commit = pushImages(dir, files, remoteDir);
    const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    // コミット SHA 固定の URL にして、後から画像を差し替えられないようにする。
    imageUrl = (file) => `https://github.com/${repo}/blob/${commit}/${remoteDir}/${file}?raw=true`;
  }
  const bodyFile = path.join(dir, 'comment.md');
  fs.writeFileSync(bodyFile, toMarkdown(report, imageUrl));
  const commentUrl = sh('gh', ['pr', 'comment', String(pr), '--body-file', bodyFile]);
  return { dir, commentUrl };
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

module.exports = { gitState, assertPublishable, record, sha256, safeId };
