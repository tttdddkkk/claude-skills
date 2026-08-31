#!/usr/bin/env node
// 実装したページを Playwright で開き、Figma の取得値と突き合わせる。
//
//   node verify.js --url http://localhost:3000/foo [--nodes .figma-impl/tmp/nodes.json] [--tolerance 1]
//
// 対応付けは DOM 側の data-figma-id 属性で行う（実装時に付与する）。
// 閾値は 0 にしない。ラスタライザ由来の床があるため、0 では永久に緑にならない。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const a = { url: null, nodes: path.join(process.cwd(), '.figma-impl', 'tmp', 'nodes.json'), tolerance: 1 };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--url') a.url = v;
    else if (k === '--nodes') a.nodes = v;
    else if (k === '--tolerance') a.tolerance = Number(v);
  }
  return a;
}

// ブラウザ内で実測する。Range.getClientRects でテキストランの実アドバンス幅を取る。
const MEASURE = `(ids) => ids.map((id) => {
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
})`;

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
  if (expected.absoluteBoundingBox && expected.fontSize !== null && near(expected.fontSize, actual.fontSize)) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error('使い方: node verify.js --url <ページURL> [--nodes nodes.json] [--tolerance 1]');
    process.exit(1);
  }
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright が見つかりません。`npm i -D playwright && npx playwright install chromium` を実行してください。');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(args.nodes, 'utf8'));
  const expectedById = new Map(data.texts.map((t) => [t.id, t]));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(args.url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const measured = await page.evaluate(MEASURE, [...expectedById.keys()]);
  await browser.close();

  const notFound = [];
  const diffs = [];
  for (const m of measured) {
    if (!m.found) { notFound.push(m.id); continue; }
    const rows = classify(expectedById.get(m.id), m, args.tolerance);
    for (const r of rows) diffs.push({ id: m.id, name: expectedById.get(m.id).name, ...r });
  }

  // 出力はズレた行だけ。全件は出さない。
  if (notFound.length) {
    console.log(`\n対応する要素が見つからない node-id が ${notFound.length} 件あります（data-figma-id 未付与の可能性）:`);
    for (const id of notFound) console.log(`  ${id}`);
  }
  if (diffs.length === 0) {
    console.log(`\n差分なし（許容 ±${args.tolerance}px）。`);
    process.exit(0);
  }
  console.log(`\n差分 ${diffs.length} 件（許容 ±${args.tolerance}px）\n`);
  console.log('| id | name | 種別 | 原因 | 詳細 |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const d of diffs) console.log(`| \`${d.id}\` | ${d.name ?? ''} | ${d.level} | ${d.cause} | ${d.detail} |`);
  process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
