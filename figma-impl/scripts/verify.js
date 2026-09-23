#!/usr/bin/env node
// 実装したページを Playwright で開き、Figma の取得値と突き合わせる。
//
//   node verify.js --url http://localhost:3000/foo [--nodes .figma-impl/tmp/nodes.json] [--tolerance 1] [--pr 123]
//
// 結果は毎回 .figma-impl/evidence/<実行日時>/ に保存する（report.md / report.json / 画像）。
// --pr を付けると、同じレポートをこのスクリプトが PR にコメントとして投稿する。
// 対応付けは DOM 側の data-figma-id 属性で行う（実装時に付与する）。
// 閾値は 0 にしない。ラスタライザ由来の床があるため、0 では永久に緑にならない。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const evidence = require('./evidence');

function parseArgs(argv) {
  const a = { url: null, nodes: path.join(process.cwd(), '.figma-impl', 'tmp', 'nodes.json'), tolerance: 1, pr: null };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--url') a.url = v;
    else if (k === '--nodes') a.nodes = v;
    else if (k === '--tolerance') a.tolerance = Number(v);
    else if (k === '--pr') a.pr = Number(v);
  }
  return a;
}

const SEVERITY = ['OK', 'WARN', 'DIFF', 'BUG'];
const worst = (rows) => rows.reduce((acc, r) => (SEVERITY.indexOf(r.level) > SEVERITY.indexOf(acc) ? r.level : acc), 'OK');

// ブラウザ内で実測する。Range.getClientRects でテキストランの実アドバンス幅を取る。
// 文字列で渡すと page.evaluate は式として評価するだけで関数を呼ばないため、関数のまま渡す。
const MEASURE = (ids) => ids.map((id) => {
  const el = document.querySelector('[data-figma-id="' + id + '"]');
  if (!el) return { id, found: false };
  const cs = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  let runWidth = null;
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  if (rects.length) runWidth = Math.max(...[...rects].map((r) => r.width));
  return {
    id, found: true,
    fontSize: parseFloat(cs.fontSize),
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    fontWeight: cs.fontWeight,
    fontFamily: cs.fontFamily,
    fontFeatureSettings: cs.fontFeatureSettings,
    fontSynthesis: cs.fontSynthesis,
    width: box.width, height: box.height,
    runWidth,
  };
});

// 差分の原因を切り分ける。ここが空になれば「数値は届いている」と確定でき、
// 残る差異は追う必要のない床だと判断できる。
function classify(expected, actual, tol) {
  const rows = [];
  const near = (a, b) => a !== null && b !== null && Math.abs(a - b) <= tol;

  if (actual.letterSpacing === 'normal' || actual.lineHeight === 'normal') {
    rows.push({ level: 'BUG', cause: '変換規則の適用漏れ', detail: `computed に normal が残っている (letter-spacing: ${actual.letterSpacing} / line-height: ${actual.lineHeight})` });
  }
  if (expected.fontSize !== null && !near(expected.fontSize, actual.fontSize)) {
    rows.push({ level: 'DIFF', cause: 'font-size 不一致', detail: `figma ${expected.fontSize} / dom ${actual.fontSize}` });
  }
  if (expected.lineHeightPx !== null) {
    const domLh = parseFloat(actual.lineHeight);
    if (!Number.isNaN(domLh) && !near(expected.lineHeightPx, domLh)) {
      rows.push({ level: 'DIFF', cause: 'line-height のメトリクス問題', detail: `figma ${expected.lineHeightPx}px / dom ${actual.lineHeight}` });
    }
  }
  // letter-spacing は 0.01〜0.08em 程度の差を見るので、±1px の閾値では何も検出できない。
  // computed は px で返るので、Figma の px 値と直接比べる。
  if (expected.letterSpacing !== null && actual.letterSpacing !== 'normal') {
    const domLs = parseFloat(actual.letterSpacing);
    if (!Number.isNaN(domLs) && Math.abs(expected.letterSpacing - domLs) > 0.05) {
      rows.push({ level: 'DIFF', cause: 'letter-spacing 不一致', detail: `figma ${expected.letterSpacing}px / dom ${actual.letterSpacing}` });
    }
  }
  // 幅で tracking / palt を疑えるのは、テキストボックスが文字列に合わせて伸縮する
  // WIDTH_AND_HEIGHT のときだけ。固定幅・高さのみ自動のボックスは幅がボックスの幅なので比べない。
  if (expected.textAutoResize === 'WIDTH_AND_HEIGHT' && expected.absoluteBoundingBox && expected.fontSize !== null && near(expected.fontSize, actual.fontSize)) {
    const w = expected.absoluteBoundingBox.width;
    const domW = actual.runWidth ?? actual.width;
    if (w != null && domW != null && Math.abs(w - domW) > tol) {
      rows.push({ level: 'DIFF', cause: 'tracking / palt の問題', detail: `font-size は一致、幅のみ差 figma ${w.toFixed(1)} / dom ${domW.toFixed(1)}` });
    }
  }
  if (expected.fontWeight !== null && String(expected.fontWeight) !== String(actual.fontWeight)) {
    rows.push({ level: 'DIFF', cause: 'font-weight 不一致', detail: `figma ${expected.fontWeight} / dom ${actual.fontWeight}` });
  }
  if (actual.fontSynthesis && actual.fontSynthesis !== 'none') {
    rows.push({ level: 'WARN', cause: '合成太字/斜体が有効', detail: `font-synthesis: ${actual.fontSynthesis}` });
  }
  return rows;
}

function loadChromium() {
  const tried = [];
  for (const base of [process.cwd(), __dirname]) {
    try {
      return require(require.resolve('playwright', { paths: [base] })).chromium;
    } catch {
      tried.push(base);
    }
  }
  console.error(
    'playwright が見つかりません。検証したいプロジェクトのルートで入れてください:\n' +
      '  npm i -D playwright && npx playwright install chromium\n' +
      `探索したディレクトリ: ${tried.join(' , ')}`
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error('使い方: node verify.js --url <ページURL> [--nodes nodes.json] [--tolerance 1] [--pr <PR番号>]');
    process.exit(1);
  }
  // 投稿できない状態なら、ブラウザを起動する前に止める。
  const git = args.pr ? evidence.assertPublishable(args.pr) : evidence.gitState();
  // require() はこのスクリプト自身のディレクトリを起点に解決されるため、
  // 素直に書くとユーザーのプロジェクトに入れた playwright が見つからない。
  // cwd を先に探し、次にスキル同梱分を探す。
  const chromium = loadChromium();

  const data = JSON.parse(fs.readFileSync(args.nodes, 'utf8'));
  const expectedById = new Map(data.texts.map((t) => [t.id, t]));

  const browser = await chromium.launch();
  // Figma の書き出し（scale 2）と同じ倍率で撮り、見比べやすくする。
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(args.url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const measured = await page.evaluate(MEASURE, [...expectedById.keys()]);
  const screenshots = {};
  for (const id of data.nodeIds) {
    const el = page.locator(`[data-figma-id="${id}"]`).first();
    if (await el.count()) screenshots[id] = await el.screenshot();
  }
  const browserVersion = browser.version();
  await browser.close();

  const results = measured.map((m) => {
    const expected = expectedById.get(m.id);
    if (!m.found) return { id: m.id, status: 'NOT_FOUND', expected, actual: null, rows: [] };
    const rows = classify(expected, m, args.tolerance);
    return { id: m.id, status: worst(rows), expected, actual: m, rows };
  });

  let figmaImages = {};
  try {
    figmaImages = await require('./figma-api').getImages(data.fileKey, data.nodeIds);
  } catch (e) {
    console.error(`Figma の画像を取得できませんでした（数値の検証には影響しない）: ${e.message}`);
  }

  const nameById = {};
  for (const x of [...data.texts, ...data.frames]) nameById[x.id] = x.name;
  const report = {
    runAt: new Date().toISOString(),
    command: ['node', 'verify.js', ...process.argv.slice(2)].join(' '),
    url: args.url,
    tolerance: args.tolerance,
    git,
    figma: { fileKey: data.fileKey, fileName: data.fileName, fileVersion: data.fileVersion, fileLastModified: data.fileLastModified, fetchedAt: data.fetchedAt },
    nodesSha256: evidence.sha256(args.nodes),
    browserVersion,
    imageTargets: data.nodeIds,
    nameById,
    results,
  };
  const { dir, commentUrl } = await evidence.record({
    report, outDir: path.join(process.cwd(), '.figma-impl', 'evidence'), screenshots, figmaImages, pr: args.pr,
  });

  // 出力はズレた行だけ。全件は証跡側（report.md）に残す。
  const notFound = results.filter((x) => x.status === 'NOT_FOUND');
  const diffs = results.flatMap((x) => x.rows.map((r) => ({ id: x.id, name: x.expected.name, ...r })));
  if (notFound.length) {
    console.log(`\n対応する要素が見つからない node-id が ${notFound.length} 件あります（data-figma-id 未付与の可能性）:`);
    for (const x of notFound) console.log(`  ${x.id}`);
  }
  if (diffs.length === 0) {
    console.log(`\n差分なし（許容 ±${args.tolerance}px）。`);
  } else {
    console.log(`\n差分 ${diffs.length} 件（許容 ±${args.tolerance}px）\n`);
    console.log('| id | name | 種別 | 原因 | 詳細 |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const d of diffs) console.log(`| \`${d.id}\` | ${d.name ?? ''} | ${d.level} | ${d.cause} | ${d.detail} |`);
  }
  console.log(`\n証跡: ${dir}`);
  if (commentUrl) console.log(`PR コメント: ${commentUrl}`);
  // 見つからない要素は検証できていないので、差分と同じく失敗として返す。
  const failed = notFound.length > 0 || results.some((x) => x.status === 'DIFF' || x.status === 'BUG');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
