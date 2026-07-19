// Figma main-thread code (sandbox): read local variables + styles and hand them to the UI.
// Components and screens are intentionally NOT dumped — they are rebuilt by hand from
// screenshots + these tokens, which yields far cleaner code than a raw node-tree dump.
// The sandbox cannot make network requests, so the UI iframe POSTs to the bridge.

figma.showUI(__html__, { width: 360, height: 300, title: "GuardMCP Token Sync" });

function rgbToHex({ r, g, b }) {
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function encodeValue(type, value, byId, collectionById) {
  if (value && value.type === "VARIABLE_ALIAS") {
    const target = byId.get(value.id);
    if (!target) return null;
    const coll = collectionById.get(target.variableCollectionId);
    return { kind: "ALIAS", refCollection: coll ? coll.name : "", refName: target.name };
  }
  if (type === "COLOR" && value && typeof value === "object") {
    return { kind: "COLOR", hex: rgbToHex(value), a: value.a === undefined ? 1 : value.a };
  }
  if (type === "FLOAT") return { kind: "FLOAT", value };
  if (type === "STRING") return { kind: "STRING", value };
  if (type === "BOOLEAN") return { kind: "BOOLEAN", value };
  return { kind: "RAW", value };
}

function firstSolid(paints) {
  const p = (paints || []).find((x) => x.type === "SOLID" && x.visible !== false);
  if (!p) return null;
  return { hex: rgbToHex(p.color), a: p.opacity === undefined ? 1 : p.opacity };
}

function shadowsOf(effects) {
  return (effects || [])
    .filter((e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false)
    .map((e) => ({
      inset: e.type === "INNER_SHADOW",
      x: e.offset.x,
      y: e.offset.y,
      blur: e.radius,
      spread: e.spread || 0,
      color: { hex: rgbToHex(e.color), a: e.color.a === undefined ? 1 : e.color.a }
    }));
}

async function collect() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const byId = new Map(variables.map((v) => [v.id, v]));
  const collectionById = new Map(collections.map((c) => [c.id, c]));

  const [textStyles, paintStyles, effectStyles] = await Promise.all([
    figma.getLocalTextStylesAsync(),
    figma.getLocalPaintStylesAsync(),
    figma.getLocalEffectStylesAsync()
  ]);

  const collectionsOut = collections.map((c) => ({
    name: c.name,
    defaultModeId: c.defaultModeId,
    modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
    variables: variables
      .filter((v) => v.variableCollectionId === c.id)
      .map((v) => ({
        name: v.name,
        type: v.resolvedType,
        valuesByMode: Object.fromEntries(
          Object.entries(v.valuesByMode).map(([modeId, val]) => [modeId, encodeValue(v.resolvedType, val, byId, collectionById)])
        )
      }))
  }));

  const styles = {
    text: textStyles.map((s) => ({
      name: s.name,
      fontFamily: s.fontName.family,
      fontStyle: s.fontName.style,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      textCase: s.textCase,
      textDecoration: s.textDecoration
    })),
    paint: paintStyles.map((s) => ({ name: s.name, color: firstSolid(s.paints) })),
    effect: effectStyles.map((s) => ({ name: s.name, shadows: shadowsOf(s.effects) }))
  };

  const payload = { source: "figma", fileName: figma.root.name, collections: collectionsOut, styles };
  payload.meta = {
    collections: collectionsOut.map((c) => ({ name: c.name, modes: c.modes.map((m) => m.name), variables: c.variables.length })),
    textStyles: styles.text.length,
    paintStyles: styles.paint.length,
    effectStyles: styles.effect.length
  };
  return payload;
}

figma.ui.onmessage = (msg) => {
  if (msg && msg.type === "close") figma.closePlugin();
};

collect()
  .then((payload) => {
    const vars = payload.collections.reduce((n, c) => n + c.variables.length, 0);
    const total = vars + payload.styles.text.length + payload.styles.paint.length + payload.styles.effect.length;
    figma.ui.postMessage(total === 0 ? { type: "empty" } : { type: "tokens", payload });
  })
  .catch((err) => {
    figma.ui.postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
  });
