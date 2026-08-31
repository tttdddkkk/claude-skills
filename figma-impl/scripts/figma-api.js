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

function extractText(node) {
  const s = node.style || null;
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

module.exports = { parseFigmaUrl, getNodes, getFile, walk, extractText, extractFrame, FRAME_TYPES };
