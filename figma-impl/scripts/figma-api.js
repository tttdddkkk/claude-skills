// Figma REST API の薄いラッパと、ノードからの値抽出。
// 欠損は null のまま返す。ここで推測の値を埋めると、
// 「AIが創作した場所」の一覧が作れなくなる。
// 例外は、API がレスポンスから省く既定値（公式仕様に default があるもの）。withDefault() を参照。
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

// Figma 側のレンダリング結果を PNG で書き出す。返るのは一時 URL なので、すぐにダウンロードする。
async function getImages(fileKey, ids, scale = 2) {
  const res = await call(`/images/${fileKey}?ids=${encodeURIComponent(ids.join(','))}&format=png&scale=${scale}`);
  if (res.err) throw new Error(`Figma images API: ${res.err}`);
  const out = {};
  for (const [id, url] of Object.entries(res.images || {})) {
    if (!url) continue;
    const r = await fetch(url);
    if (r.ok) out[id] = Buffer.from(await r.arrayBuffer());
  }
  return out;
}

// 深さ優先で全ノードを渡す。親を辿れるよう parentId を付ける。
function walk(node, fn, parentId = null) {
  fn(node, parentId);
  for (const child of node.children || []) walk(child, fn, node.id);
}

// 値が無いことを null で表す。undefined と 0 を区別する。
const pick = (obj, key) => (obj && obj[key] !== undefined ? obj[key] : null);

// REST API は既定値と同じ項目をレスポンスから省く（DADS v2.18.0 の実データで、
// layoutMode: "NONE" や padding: 0 が明示された例は約2.6万フレーム中 0 件）。
// 省かれた項目を null にすると「欠損」に混ざり、欠損一覧が AI の創作場所を示さなくなる。
// そこで、公式仕様（github.com/figma/rest-api-spec の openapi.yaml）が default を
// 定めている項目に限り、その値として読む。仕様に default が無い項目は pick() で null のまま。
// 唯一の例外は opentypeFlags で、仕様に default は無いが、機能を1つも設定していない
// テキストでは項目ごと省かれる（Figma の既定は PALT / PWID とも無効）ため空として読む。
const withDefault = (obj, key, def) => (obj && obj[key] !== undefined ? obj[key] : def);

// 1つのテキストレイヤー内で部分的にスタイルが違う場合、Figma は
// characterStyleOverrides（文字位置ごとのインデックス）と styleOverrideTable を返す。
// これを見ないと node.style（既定スタイル）だけを読むことになり、
// 部分的に違う実際の値が「全体の代表値」として静かに報告される。
// それは「読み取りと生成を混ぜない」という前提を、この経路だけ壊す。
//
// styleOverrideTable の各エントリには、既定スタイルと同じ値も含めて全項目が入ってくる。
// キーの有無ではなく値の比較で、実際に違う項目だけを拾う。
// 見た目に関係しない参照情報（スタイル/変数の紐付け）は比較から外す。
const MIXED_IGNORE = new Set(['inheritTextStyleId', 'inheritFillStyleId', 'boundVariables', 'isOverrideOverTextStyle', 'textAutoResize']);

function mixedStyleInfo(node) {
  const overrides = node.characterStyleOverrides;
  if (!Array.isArray(overrides) || !overrides.some((v) => v !== 0)) {
    return { styleMixed: false, mixedProperties: null };
  }
  const base = node.style || {};
  const used = new Set(overrides.filter((v) => v !== 0).map(String));
  const props = new Set();
  for (const [key, style] of Object.entries(node.styleOverrideTable || {})) {
    if (!used.has(key)) continue;
    for (const [p, v] of Object.entries(style || {})) {
      if (MIXED_IGNORE.has(p)) continue;
      const b = p === 'fills' ? node.fills : base[p];
      if (JSON.stringify(v) !== JSON.stringify(b)) props.add(p);
    }
  }
  return props.size
    ? { styleMixed: true, mixedProperties: [...props].sort() }
    : { styleMixed: false, mixedProperties: null };
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
    textCase: withDefault(s, 'textCase', 'ORIGINAL'),
    textDecoration: withDefault(s, 'textDecoration', 'NONE'),
    textAutoResize: withDefault(s, 'textAutoResize', 'NONE'),
    // opentypeFlags.PALT が 1 なら Figma 側でプロポーショナル詰めが有効。
    // PWID（プロポーショナル幅）も和文の字幅を変えるので並べて出す。
    // 有効な機能が1つも無いとき opentypeFlags 自体が省かれる（DADS では 9551 件中 9439 件）。
    // MCP の生成物には出てこないため、REST でしか取れない。
    opentypeFlags: withDefault(s, 'opentypeFlags', {}),
    palt: s ? (s.opentypeFlags?.PALT ?? 0) : null,
    pwid: s ? (s.opentypeFlags?.PWID ?? 0) : null,
    fills: node.fills ?? null,
    absoluteBoundingBox: node.absoluteBoundingBox ?? null,
    // 混在している場合、上の各フィールドは既定スタイルの値でしかない。
    // 代表値として扱わず、人が確認する対象として扱う。
    ...mixed,
  };
}

function extractFrame(node) {
  const layoutMode = withDefault(node, 'layoutMode', 'NONE');
  // gap・padding・揃えは Auto Layout の属性で、Auto Layout 無しのフレームには意味を持たない。
  // 出力に並べると値のように見えるため、Auto Layout が有効なときだけ出す。
  const autoLayout = layoutMode !== 'NONE'
    ? {
        itemSpacing: withDefault(node, 'itemSpacing', 0),
        paddingLeft: withDefault(node, 'paddingLeft', 0),
        paddingRight: withDefault(node, 'paddingRight', 0),
        paddingTop: withDefault(node, 'paddingTop', 0),
        paddingBottom: withDefault(node, 'paddingBottom', 0),
        primaryAxisAlignItems: withDefault(node, 'primaryAxisAlignItems', 'MIN'),
        counterAxisAlignItems: withDefault(node, 'counterAxisAlignItems', 'MIN'),
      }
    : {};
  // 4隅が別々の角丸は cornerRadius ではなく rectangleCornerRadii（[左上, 右上, 右下, 左下]）で返る。
  const corners = Array.isArray(node.rectangleCornerRadii)
    ? { rectangleCornerRadii: node.rectangleCornerRadii }
    : { cornerRadius: withDefault(node, 'cornerRadius', 0) };
  return {
    id: node.id,
    name: node.name ?? null,
    type: node.type,
    layoutMode,
    ...autoLayout,
    absoluteBoundingBox: node.absoluteBoundingBox ?? null,
    ...corners,
    fills: node.fills ?? null,
  };
}

// GROUP と SECTION は Auto Layout を持てないノードなので含めない。
// 含めると fetch-node の欠損一覧と scan-file の「Auto Layout 無し」の割合が、
// ファイルの作りと無関係に水増しされる。子ノードは walk で辿るので取りこぼしはない。
const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);

module.exports = { parseFigmaUrl, getNodes, getFile, getImages, walk, extractText, extractFrame, mixedStyleInfo, FRAME_TYPES };
