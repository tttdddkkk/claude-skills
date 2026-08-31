#!/usr/bin/env node
// Figma ファイル全体を走査して実態を集計する（figma-impl-init の Step 1）。
// 推測ではなく実測値を出す。ここで出た数字が conversion.md の [実測] 行の根拠になる。
//
//   node scan-file.js <FigmaのURL または fileKey>
//
// 出力: .figma-impl/scan-report.md
'use strict';

const fs = require('node:fs');
const path = require('node:path');
// figma-impl スキルの共有モジュールを使う。2つのスキルは対で導入する前提。
// 片方だけコピーすると、ここで MODULE_NOT_FOUND になる。
let api;
try {
  api = require('../../figma-impl/scripts/figma-api');
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
  console.error(
    'figma-impl/scripts/figma-api.js が見つかりません。\n' +
      'figma-impl-init は figma-impl と対で使います。figma-impl スキルを\n' +
      'figma-impl-init と同じ親ディレクトリに置いてください。'
  );
  process.exit(1);
}
const { parseFigmaUrl, getFile, walk, FRAME_TYPES } = api;

const OUT = path.join(process.cwd(), '.figma-impl', 'scan-report.md');

const tally = (map, key) => map.set(key, (map.get(key) || 0) + 1);

function sortedEntries(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function table(title, map, total) {
  const L = [`### ${title}\n`, '| 値 | 件数 | 割合 |', '| --- | --: | --: |'];
  for (const [k, n] of sortedEntries(map)) {
    L.push(`| ${k} | ${n} | ${total ? ((n / total) * 100).toFixed(1) + '%' : ''} |`);
  }
  return L.join('\n') + '\n';
}

// 余白がどのスケールに乗っているかを判定する。4px か 8px か。
function spacingScale(values) {
  const nums = values.filter((v) => typeof v === 'number' && v > 0);
  if (nums.length === 0) return '判定不能（値が無い）';
  const on8 = nums.filter((v) => v % 8 === 0).length / nums.length;
  const on4 = nums.filter((v) => v % 4 === 0).length / nums.length;
  if (on8 >= 0.8) return `8px スケール（${(on8 * 100).toFixed(0)}% が 8 の倍数）`;
  if (on4 >= 0.8) return `4px スケール（${(on4 * 100).toFixed(0)}% が 4 の倍数）`;
  return `スケール不統一（8の倍数 ${(on8 * 100).toFixed(0)}% / 4の倍数 ${(on4 * 100).toFixed(0)}%）`;
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('使い方: node scan-file.js <FigmaのURL または fileKey>');
    process.exit(1);
  }
  const { fileKey } = parseFigmaUrl(target);
  const file = await getFile(fileKey);

  const families = new Map();
  const letterSpacings = new Map();
  const lineHeightUnits = new Map();
  const spacings = [];
  let textTotal = 0, paltOn = 0, paltAbsent = 0;
  let frameTotal = 0, noAutoLayout = 0;

  walk(file.document, (node) => {
    if (node.type === 'TEXT') {
      textTotal++;
      const s = node.style || {};
      tally(families, s.fontPostScriptName || s.fontFamily || '(不明)');
      tally(letterSpacings, s.letterSpacing === undefined ? '(指定なし)' : String(s.letterSpacing));
      tally(lineHeightUnits, s.lineHeightUnit || '(不明)');
      if (!s.opentypeFlags) paltAbsent++;
      else if (s.opentypeFlags.PALT) paltOn++;
    } else if (FRAME_TYPES.has(node.type)) {
      frameTotal++;
      if (!node.layoutMode || node.layoutMode === 'NONE') noAutoLayout++;
      for (const k of ['itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) {
        if (typeof node[k] === 'number') spacings.push(node[k]);
      }
    }
  });

  const paltRatio = textTotal ? (paltOn / textTotal) * 100 : 0;
  const noAutoRatio = frameTotal ? (noAutoLayout / frameTotal) * 100 : 0;

  const L = [];
  L.push(`# スキャン結果\n`);
  L.push(`- file: \`${fileKey}\` / ${file.name ?? ''}`);
  L.push(`- 走査日時: ${new Date().toISOString()}`);
  L.push(`- テキストノード ${textTotal} 件 / フレーム ${frameTotal} 件\n`);

  L.push(`## palt（プロポーショナル詰め）\n`);
  L.push(`- PALT が立っているテキスト: ${paltOn} / ${textTotal}（${paltRatio.toFixed(1)}%）`);
  L.push(`- opentypeFlags 自体が無いテキスト: ${paltAbsent}\n`);
  if (paltRatio >= 80) L.push(`**判定: 全体 ON**。\`reset.css\` の \`font-feature-settings\` を \`"palt" 1\` にする。\n`);
  else if (paltRatio <= 20) L.push(`**判定: 全体 OFF**。\`reset.css\` の \`font-feature-settings\` を \`"palt" 0\` にする。\n`);
  else L.push(`**判定: 混在（要判断）**。レイヤーごとの出し分けはしない方針なので、どちらに寄せるかを人が決める。\n`);

  L.push(table('フォント', families, textTotal));
  L.push(table('letterSpacing の分布', letterSpacings, textTotal));
  L.push(table('lineHeightUnit の分布', lineHeightUnits, textTotal));

  L.push(`### 余白のスケール\n`);
  L.push(`- 判定: ${spacingScale(spacings)}`);
  L.push(`- 収集した値の数: ${spacings.length}\n`);

  L.push(`### Auto Layout\n`);
  L.push(`- Auto Layout が無いフレーム: ${noAutoLayout} / ${frameTotal}（${noAutoRatio.toFixed(1)}%）\n`);
  if (noAutoRatio >= 30) {
    L.push(`> **警告**: Auto Layout が使われていないフレームが多い。座標しか情報が無いため、`);
    L.push(`> このスキルで上げられる精度には原理的な上限がある。余白・整列の再現は期待できない。`);
    L.push(`> Figma ファイル側の整備（Auto Layout 化）が先。\n`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join('\n'));
  console.log(`テキスト ${textTotal} / フレーム ${frameTotal} を走査しました。`);
  console.log(`palt ${paltRatio.toFixed(1)}% / Auto Layout 無し ${noAutoRatio.toFixed(1)}%`);
  console.log(`→ ${OUT}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
