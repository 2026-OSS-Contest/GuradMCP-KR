// Figma main-thread code: export the CURRENT SELECTION as an exact structure + PNG.
// Selection-scoped (not a whole-document dump), so it stays small and precise.
// Bound design tokens are resolved to their variable names so the output can use var(--...).

figma.showUI(__html__, { width: 380, height: 320, title: "GuardMCP Export" });

let VARREF = new Map(); // variable id -> "Collection/name"
let STYLEREF = new Map(); // style id -> name

const round = (n) => Math.round(n * 100) / 100;

function rgbToHex({ r, g, b }) {
  const to = (v) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function boundVar(node, field) {
  const bv = node.boundVariables && node.boundVariables[field];
  if (!bv) return undefined;
  const alias = Array.isArray(bv) ? bv[0] : bv;
  return alias && alias.id ? VARREF.get(alias.id) : undefined;
}

function paintToObj(p, node, i) {
  if (p.type === "SOLID") {
    const o = {
      type: "SOLID",
      hex: rgbToHex(p.color),
      a: p.opacity === undefined ? 1 : p.opacity,
    };
    if (p.visible === false) o.hidden = true;
    const bvs = node.boundVariables && node.boundVariables.fills;
    if (bvs && bvs[i] && VARREF.get(bvs[i].id))
      o.variable = VARREF.get(bvs[i].id);
    return o;
  }
  if (typeof p.type === "string" && p.type.indexOf("GRADIENT") === 0) {
    return {
      type: p.type,
      stops: (p.gradientStops || []).map((s) => ({
        pos: round(s.position),
        hex: rgbToHex(s.color),
        a: s.color.a,
      })),
      transform: p.gradientTransform,
    };
  }
  if (p.type === "IMAGE") return { type: "IMAGE", scaleMode: p.scaleMode };
  return { type: p.type };
}

const SIZING = (n) =>
  n && n.layoutSizingHorizontal
    ? { h: n.layoutSizingHorizontal, v: n.layoutSizingVertical }
    : undefined;

const VECTOR_TYPES = [
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "LINE",
  "ELLIPSE",
  "POLYGON",
];

async function imageFillData(node) {
  if (!Array.isArray(node.fills)) return null;
  const f = node.fills.find(
    (p) => p.type === "IMAGE" && p.visible !== false && p.imageHash,
  );
  if (!f) return null;
  try {
    const image = figma.getImageByHash(f.imageHash);
    if (!image) return null;
    const bytes = await image.getBytesAsync();
    return { base64: figma.base64Encode(bytes), scaleMode: f.scaleMode };
  } catch {
    return null;
  }
}

async function describe(node) {
  const o = { type: node.type, name: node.name };
  if (node.visible === false) o.hidden = true;
  if (typeof node.width === "number") {
    o.w = round(node.width);
    o.h = round(node.height);
  }
  if (typeof node.x === "number") {
    o.x = round(node.x);
    o.y = round(node.y);
  }

  if (node.layoutMode && node.layoutMode !== "NONE") {
    o.layout = {
      dir: node.layoutMode,
      wrap: node.layoutWrap,
      gap: node.itemSpacing,
      pad: {
        t: node.paddingTop,
        r: node.paddingRight,
        b: node.paddingBottom,
        l: node.paddingLeft,
      },
      primary: node.primaryAxisAlignItems,
      counter: node.counterAxisAlignItems,
      primarySizing: node.primaryAxisSizingMode,
      counterSizing: node.counterAxisSizingMode,
    };
    const bs = {};
    for (const f of [
      "itemSpacing",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
    ]) {
      const v = boundVar(node, f);
      if (v) bs[f] = v;
    }
    if (Object.keys(bs).length) o.layout.boundSpacing = bs;
  }
  const sizing = SIZING(node);
  if (sizing) o.sizing = sizing;
  if (typeof node.layoutGrow === "number" && node.layoutGrow)
    o.grow = node.layoutGrow;
  if (node.layoutAlign && node.layoutAlign !== "INHERIT")
    o.selfAlign = node.layoutAlign;

  if (typeof node.cornerRadius === "number") {
    if (node.cornerRadius) o.radius = node.cornerRadius;
  } else if (typeof node.topLeftRadius === "number") {
    o.radius = {
      tl: node.topLeftRadius,
      tr: node.topRightRadius,
      br: node.bottomRightRadius,
      bl: node.bottomLeftRadius,
    };
  }
  const rv = boundVar(node, "cornerRadius") || boundVar(node, "topLeftRadius");
  if (rv) o.radiusVar = rv;

  if (Array.isArray(node.fills) && node.fills.length)
    o.fills = node.fills.map((p, i) => paintToObj(p, node, i));
  else if (node.fills === figma.mixed) o.fills = "MIXED";
  if (typeof node.fillStyleId === "string" && STYLEREF.get(node.fillStyleId))
    o.fillStyle = STYLEREF.get(node.fillStyleId);

  if (Array.isArray(node.strokes) && node.strokes.length) {
    o.strokes = node.strokes.map((p, i) => paintToObj(p, node, i));
    if (typeof node.strokeWeight === "number")
      o.strokeWeight = node.strokeWeight;
    o.strokeAlign = node.strokeAlign;
    const sv = boundVar(node, "strokes") || boundVar(node, "strokeWeight");
    if (sv) o.strokeVar = sv;
  }

  if (Array.isArray(node.effects) && node.effects.length) {
    o.effects = node.effects
      .filter((e) => e.visible !== false)
      .map((e) => ({
        type: e.type,
        radius: e.radius,
        spread: e.spread,
        offset: e.offset,
        color: e.color ? { hex: rgbToHex(e.color), a: e.color.a } : undefined,
      }));
    if (
      typeof node.effectStyleId === "string" &&
      STYLEREF.get(node.effectStyleId)
    )
      o.effectStyle = STYLEREF.get(node.effectStyleId);
  }

  if (typeof node.opacity === "number" && node.opacity !== 1)
    o.opacity = node.opacity;
  if (node.clipsContent) o.clip = true;

  if (node.type === "TEXT") {
    o.text = node.characters;
    o.textAlign = node.textAlignHorizontal;
    o.vAlign = node.textAlignVertical;
    o.autoResize = node.textAutoResize;
    if (node.fontName !== figma.mixed)
      o.font = { family: node.fontName.family, style: node.fontName.style };
    if (node.fontSize !== figma.mixed) o.fontSize = node.fontSize;
    if (node.lineHeight !== figma.mixed) o.lineHeight = node.lineHeight;
    if (node.letterSpacing !== figma.mixed)
      o.letterSpacing = node.letterSpacing;
    if (typeof node.textStyleId === "string" && STYLEREF.get(node.textStyleId))
      o.textStyle = STYLEREF.get(node.textStyleId);
  }

  if (node.type === "INSTANCE") o.instanceOf = node.name;

  // Vector-family nodes: inline as SVG (crisp, single-file), no children recursion.
  if (VECTOR_TYPES.indexOf(node.type) >= 0) {
    try {
      const bytes = await node.exportAsync({ format: "SVG" });
      o.image = { format: "svg", base64: figma.base64Encode(bytes) };
    } catch {
      /* export can fail on some nodes; skip image */
    }
    return o;
  }
  // Raster image fills: embed the raw image as base64 (keeps children/text on top).
  const bg = await imageFillData(node);
  if (bg) o.bgImage = bg;
  if ("children" in node && node.children.length) {
    o.children = [];
    for (const c of node.children) o.children.push(await describe(c));
  }
  return o;
}

async function buildMaps() {
  const [vars, colls, ts, ps, es] = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalPaintStylesAsync(),
    figma.getLocalEffectStylesAsync(),
  ]);
  const cn = new Map(colls.map((c) => [c.id, c.name]));
  VARREF = new Map(
    vars.map((v) => [
      v.id,
      `${cn.get(v.variableCollectionId) || ""}/${v.name}`,
    ]),
  );
  STYLEREF = new Map([...ts, ...ps, ...es].map((s) => [s.id, s.name]));
}

async function run() {
  const sel = figma.currentPage.selection;
  if (!sel.length) {
    figma.ui.postMessage({ type: "empty" });
    return;
  }
  await buildMaps();
  const nodes = [];
  for (const node of sel) {
    let png = null;
    try {
      const bytes = await node.exportAsync({
        format: "PNG",
        constraint: { type: "SCALE", value: 2 },
      });
      png = figma.base64Encode(bytes);
    } catch {
      /* export can fail on some node types; structure still useful */
    }
    const structure = await describe(node);
    nodes.push({ name: node.name, structure, png });
  }
  figma.ui.postMessage({ type: "export", fileName: figma.root.name, nodes });
}

figma.ui.onmessage = (msg) => {
  if (msg && msg.type === "close") figma.closePlugin();
  if (msg && msg.type === "rerun") run();
};

run();
