#!/usr/bin/env node
// Figma のノードを取得して、正規化した表を出力する。
//
//   node fetch-node.js <FigmaのURL または fileKey> [nodeId ...]
//
// 出力: .figma-impl/tmp/nodes.json / nodes.md
// 欠損は null のまま残す。null の一覧が「AIが創作する場所」のリストになる。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseFigmaUrl, getNodes, walk, extractText, extractFrame, FRAME_TYPES } = require('./figma-api');

const OUT_DIR = path.join(process.cwd(), '.figma-impl', 'tmp');

function nullPaths(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) out.push(prefix + k);
  }
  return out;
}

function toMarkdown(result) {
  const L = [];
  L.push(`# 取得結果\n`);
  L.push(`- file: \`${result.fileKey}\``);
  L.push(`- 取得日時: ${result.fetchedAt}`);
  L.push(`- テキストノード: ${result.texts.length} / フレーム: ${result.frames.length}\n`);

  L.push(`## テキスト\n`);
  L.push('| id | name | family | size | lineHeight | lhUnit | tracking | palt |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of result.texts) {
    const f = (v) => (v === null ? '**null**' : String(v));
    L.push(`| \`${t.id}\` | ${t.name ?? ''} | ${f(t.fontPostScriptName ?? t.fontFamily)} | ${f(t.fontSize)} | ${f(t.lineHeightPx)} | ${f(t.lineHeightUnit)} | ${f(t.letterSpacing)} | ${f(t.palt)} |`);
  }

  L.push(`\n## フレーム\n`);
  L.push('| id | name | layout | gap | padding (L/R/T/B) |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const fr of result.frames) {
    const f = (v) => (v === null ? '**null**' : String(v));
    L.push(`| \`${fr.id}\` | ${fr.name ?? ''} | ${f(fr.layoutMode)} | ${f(fr.itemSpacing)} | ${f(fr.paddingLeft)}/${f(fr.paddingRight)}/${f(fr.paddingTop)}/${f(fr.paddingBottom)} |`);
  }

  L.push(`\n## 欠損（null）の一覧\n`);
  if (result.missing.length === 0) {
    L.push('欠損なし。');
  } else {
    L.push('ここに挙がった項目は Figma から取得できていない。**推測で埋めず**、`defaults.md` の既定値を適用し `UNRESOLVED.md` に記録する。\n');
    L.push('| id | name | 欠けている項目 |');
    L.push('| --- | --- | --- |');
    for (const m of result.missing) {
      L.push(`| \`${m.id}\` | ${m.name ?? ''} | ${m.fields.join(', ')} |`);
    }
  }
  return L.join('\n') + '\n';
}

async function main() {
  const [target, ...ids] = process.argv.slice(2);
  if (!target) {
    console.error('使い方: node fetch-node.js <FigmaのURL または fileKey> [nodeId ...]');
    process.exit(1);
  }
  const parsed = parseFigmaUrl(target);
  const nodeIds = ids.length ? ids.map((i) => i.replace(/-/g, ':')) : parsed.nodeId ? [parsed.nodeId] : [];
  if (nodeIds.length === 0) {
    console.error('node-id が指定されていません。URL に ?node-id= を含めるか、引数で渡してください。');
    console.error('画面全体ではなく、末端のコンポーネント1つずつを指定すること。');
    process.exit(1);
  }

  const res = await getNodes(parsed.fileKey, nodeIds);
  const texts = [];
  const frames = [];
  const missing = [];

  for (const id of nodeIds) {
    const doc = res.nodes?.[id]?.document;
    if (!doc) {
      console.error(`node-id ${id} が見つかりません。`);
      continue;
    }
    walk(doc, (node) => {
      if (node.type === 'TEXT') {
        const t = extractText(node);
        texts.push(t);
        const nulls = nullPaths(t).filter((k) => k !== 'opentypeFlags');
        if (nulls.length) missing.push({ id: t.id, name: t.name, fields: nulls });
      } else if (FRAME_TYPES.has(node.type)) {
        const fr = extractFrame(node);
        frames.push(fr);
        const nulls = nullPaths(fr);
        if (nulls.length) missing.push({ id: fr.id, name: fr.name, fields: nulls });
      }
    });
  }

  const result = { fileKey: parsed.fileKey, nodeIds, fetchedAt: new Date().toISOString(), texts, frames, missing };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'nodes.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'nodes.md'), toMarkdown(result));

  console.log(`テキスト ${texts.length} / フレーム ${frames.length} / 欠損 ${missing.length} 件`);
  console.log(`→ ${path.join(OUT_DIR, 'nodes.json')}`);
  console.log(`→ ${path.join(OUT_DIR, 'nodes.md')}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
