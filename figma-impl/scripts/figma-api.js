// Figma REST API の薄いラッパと、ノードからの値抽出。
// 欠損は必ず null のまま返す。ここで既定値を埋めると、
// 「AIが創作した場所」の一覧が作れなくなる。
'use strict';

const API = 'https://api.figma.com/v1';

function token() {
  const t = process.env.FIGMA_TOKEN;
  if (!t) {
    throw new Error('FIGMA_TOKEN が未設定です。Figma の Settings → Security → Personal access tokens で発行してください。');
  }
  return t;
}

// https://www.figma.com/design/<key>/<name>?node-id=1-234 を分解する
function parseFigmaUrl(input) {
  if (!/^https?:\/\//.test(input)) return { fileKey: input, nodeId: null };
  const u = new URL(input);
  const m = u.pathname.match(/\/(?:file|design)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error(`Figma の URL からファイルキーを取得できません: ${input}`);
  const raw = u.searchParams.get('node-id');
  return { fileKey: m[1], nodeId: raw ? raw.replace(/-/g, ':') : null };
}

async function call(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': token() } });
  if (!res.ok) {
    throw new Error(`Figma API ${res.status} ${res.statusText}: ${path}\n${await res.text()}`);
  }
  return res.json();
}

const getNodes = (fileKey, ids) =>
  call(`/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(','))}`);

const getFile = (fileKey, depth) =>
  call(`/files/${fileKey}${depth ? `?depth=${depth}` : ''}`);

// 深さ優先で全ノードを渡す。親を辿れるよう parentId を付ける。
function walk(node, fn, parentId = null) {
  fn(node, parentId);
  for (const child of node.children || []) walk(child, fn, node.id);
}

// 値が無いことを null で表す。undefined と 0 を区別する。
const pick = (obj, key) => (obj && obj[key] !== undefined ? obj[key] : null);

// 1つのテキストレイヤー内で部分的にスタイルが違う場合、Figma は
// characterStyleOverrides（文字位置ごとのインデックス）と styleOverrideTable を返す。
// これを見ないと node.style（既定スタイル）だけを読むことになり、
// 部分的に違う実際の値が「全体の代表値」として静かに報告される。
// それは「読み取りと生成を混ぜない」という前提を、この経路だけ壊す。
// ※ REST API の当該フィールドの挙動は実ファイルで未検証。
function mixedStyleInfo(node) {
  const overrides = node.characterStyleOverrides;
  if (!Array.isArray(overrides) || !overrides.some((v) => v !== 0)) {
    return { styleMixed: false, mixedProperties: null };
  }
  const props = new Set();
  for (const [key, style] of Object.entries(node.styleOverrideTable || {})) {
    if (key === '0') continue;
    for (const p of Object.keys(style || {})) props.add(p);
  }
  return { styleMixed: true, mixedProperties: props.size ? [...props].sort() : null };
}

function extractText(node) {
  const s = node.style || null;
  const mixed = mixedStyleInfo(node);
  return {
    id: node.id,
    name: node.name ?? null,
    type: node.type,
    characters: node.characters ?? null,
    fontFamily: pick(s, 'fontFamily'),
    fontPostScriptName: pick(s, 'fontPostScriptName'),
    fontWeight: pick(s, 'fontWeight'),
    fontSize: pick(s, 'fontSize'),
    lineHeightPx: pick(s, 'lineHeightPx'),
    lineHeightUnit: pick(s, 'lineHeightUnit'),
    lineHeightPercentFontSize: pick(s, 'lineHeightPercentFontSize'),
    letterSpacing: pick(s, 'letterSpacing'),
    textCase: pick(s, 'textCase'),
    textDecoration: pick(s, 'textDecoration'),
    // opentypeFlags.PALT が 1 なら Figma 側でプロポーショナル詰めが有効。
    // MCP の生成物には出てこないため、REST でしか取れない。
    opentypeFlags: pick(s, 'opentypeFlags'),
    palt: s && s.opentypeFlags ? (s.opentypeFlags.PALT ?? 0) : null,
    fills: node.fills ?? null,
    absoluteBoundingBox: node.absoluteBoundingBox ?? null,
    // 混在している場合、上の各フィールドは既定スタイルの値でしかない。
    // 代表値として扱わず、人が確認する対象として扱う。
    ...mixed,
  };
}

function extractFrame(node) {
  return {
    id: node.id,
    name: node.name ?? null,
    type: node.type,
    layoutMode: pick(node, 'layoutMode'),
    itemSpacing: pick(node, 'itemSpacing'),
    paddingLeft: pick(node, 'paddingLeft'),
    paddingRight: pick(node, 'paddingRight'),
    paddingTop: pick(node, 'paddingTop'),
    paddingBottom: pick(node, 'paddingBottom'),
    primaryAxisAlignItems: pick(node, 'primaryAxisAlignItems'),
    counterAxisAlignItems: pick(node, 'counterAxisAlignItems'),
    absoluteBoundingBox: node.absoluteBoundingBox ?? null,
    cornerRadius: pick(node, 'cornerRadius'),
    fills: node.fills ?? null,
  };
}

const FRAME_TYPES = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);

module.exports = { parseFigmaUrl, getNodes, getFile, walk, extractText, extractFrame, mixedStyleInfo, FRAME_TYPES };
