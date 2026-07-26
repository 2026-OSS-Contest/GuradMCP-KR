// Figma main-thread code: export the CURRENT SELECTION as an exact structure + PNG.
// Selection-scoped (not a whole-document dump), so it stays small and precise.
// Bound design tokens are resolved to their variable names so the output can use var(--...).
//
// Sections act as folders: selecting a section exports every frame/component inside it as its
// own item, mirroring the section nesting as directories. Items are streamed to the bridge one
// at a time (each waits for an ack) so a large section never builds one huge message.

figma.showUI(__html__, { width: 380, height: 360, title: "GuardMCP Export" });

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

// `field` is "fills" or "strokes" — reading the wrong one hands a stroke the fill's colour
// variable, which is how a grey border ends up painted black.
function paintToObj(p, node, i, field) {
  if (p.type === "SOLID") {
    const o = {
      type: "SOLID",
      hex: rgbToHex(p.color),
      a: p.opacity === undefined ? 1 : p.opacity,
    };
    if (p.visible === false) o.hidden = true;
    const bvs = node.boundVariables && node.boundVariables[field];
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

// A wrapper whose whole subtree is artwork — an icon. Exporting it as ONE SVG keeps the masks,
// boolean operations and relative alignment that Figma's own exporter resolves. Descending into
// it instead yields a pile of separate SVGs that have to be re-stacked by hand, and they never
// line up. Text or a raster fill anywhere inside means it is a layout frame, not an icon.
function isIconLike(node) {
  if (!("children" in node) || !node.children.length) return false;
  let vectors = 0;
  const visit = (n) => {
    if (n.visible === false) return true;
    if (n.type === "TEXT") return false;
    if (Array.isArray(n.fills) && n.fills.some((p) => p.type === "IMAGE"))
      return false;
    if (VECTOR_TYPES.indexOf(n.type) >= 0) {
      vectors++;
      return true;
    }
    if (!("children" in n)) return false; // slices, embeds and anything else unknown
    return n.children.every(visit);
  };
  return node.children.every(visit) && vectors > 0;
}

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
    o.fills = node.fills.map((p, i) => paintToObj(p, node, i, "fills"));
  else if (node.fills === figma.mixed) o.fills = "MIXED";
  if (typeof node.fillStyleId === "string" && STYLEREF.get(node.fillStyleId))
    o.fillStyle = STYLEREF.get(node.fillStyleId);

  if (Array.isArray(node.strokes) && node.strokes.length) {
    o.strokes = node.strokes.map((p, i) => paintToObj(p, node, i, "strokes"));
    if (typeof node.strokeWeight === "number")
      o.strokeWeight = node.strokeWeight;
    // Figma reports strokeWeight as mixed when the sides differ. A bottom-only divider is the
    // common case, and without the per-side values it comes out as a full box.
    const sides = {};
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const w = node["stroke" + side + "Weight"];
      if (typeof w === "number") sides[side.toLowerCase()] = w;
    }
    if (Object.keys(sides).length) o.strokeSides = sides;
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
    // Per-character colour (a two-tone wordmark, a highlighted word). Without the segments the
    // whole run is "MIXED", which carries no colour at all and renders in the inherited one.
    if (node.fills === figma.mixed && node.getStyledTextSegments) {
      try {
        o.segments = node
          .getStyledTextSegments(["fills"])
          .map((seg) => ({
            text: seg.characters,
            fills: (seg.fills || []).map((p) => paintToObj(p, node, 0, "none")),
          }));
      } catch {
        /* segment read can fail on unloaded fonts; the plain text still exports */
      }
    }
  }

  if (node.type === "INSTANCE") o.instanceOf = node.name;

  // Vector-family nodes and whole icons: inline as ONE SVG, no children recursion.
  if (VECTOR_TYPES.indexOf(node.type) >= 0 || isIconLike(node)) {
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

// Node types that become one exported item. Anything else found loose inside a section
// (stray labels, annotation vectors) is skipped rather than turned into a file.
const ITEM_TYPES = ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP"];

// Sections map to directories; the first frame-like node on a branch ends the walk and becomes
// an item (its own subtree still gets described in full inside that item's file).
function planNode(node, dir, plan, isSelectionRoot) {
  if (node.visible === false) return;
  if (node.type === "SECTION") {
    const nested = dir.concat([node.name]);
    for (const child of node.children) planNode(child, nested, plan, false);
    return;
  }
  if (!isSelectionRoot && ITEM_TYPES.indexOf(node.type) < 0) {
    plan.skipped.push(node.name);
    return;
  }
  plan.items.push({ id: node.id, name: node.name, path: dir });
}

function buildPlan() {
  const plan = { items: [], skipped: [] };
  for (const node of figma.currentPage.selection) planNode(node, [], plan, true);
  return plan;
}

// The UI acks every item it has POSTed, which throttles us to one in-flight message.
let ack = null;
const waitForAck = () =>
  new Promise((resolve) => {
    ack = resolve;
  });

let PLAN = null;

async function scan() {
  PLAN = buildPlan();
  if (!PLAN.items.length) {
    figma.ui.postMessage({ type: "empty", skipped: PLAN.skipped });
    return;
  }
  const roots = [];
  for (const item of PLAN.items) {
    const root = item.path[0];
    if (root && roots.indexOf(root) < 0) roots.push(root);
  }
  figma.ui.postMessage({
    type: "plan",
    fileName: figma.root.name,
    roots,
    skipped: PLAN.skipped,
    items: PLAN.items.map((i) => ({ name: i.name, path: i.path })),
  });
}

async function stream() {
  if (!PLAN || !PLAN.items.length) return;
  await buildMaps();
  const total = PLAN.items.length;
  for (let i = 0; i < total; i++) {
    const entry = PLAN.items[i];
    const node = await figma.getNodeByIdAsync(entry.id);
    if (!node) continue;
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
    let structure = null;
    try {
      structure = await describe(node);
    } catch (err) {
      figma.ui.postMessage({
        type: "item-failed",
        index: i,
        total,
        name: entry.name,
        error: String((err && err.message) || err),
      });
      continue;
    }
    figma.ui.postMessage({
      type: "item",
      index: i,
      total,
      item: { name: entry.name, path: entry.path, structure, png },
    });
    await waitForAck();
  }
  figma.ui.postMessage({ type: "finished", total });
}

figma.ui.onmessage = (msg) => {
  if (!msg) return;
  if (msg.type === "close") figma.closePlugin();
  if (msg.type === "rerun") scan();
  if (msg.type === "start") stream();
  if (msg.type === "ack" && ack) {
    const resolve = ack;
    ack = null;
    resolve();
  }
};

scan();
