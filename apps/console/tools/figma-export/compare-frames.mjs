// Compares an exported Figma draft against the running console, frame by frame.
//
// AGENTS.md makes `out/<scr>/<frame>/<frame>.html` the authority for styling — it is the frame
// rendered with resolved CSS, so it answers questions the .png and .json cannot. Reading 76 of
// them by eye is how details get lost, which is what this automates.
//
// Two comparisons, because they fail differently:
//
//   content — every text run the draft shows, checked against every text run the screen shows.
//             Catches a section that never renders (the Replay panels in GMCP-115) and copy that
//             drifted. Reported in both directions.
//   type    — for each text that appears exactly once on both sides, the computed font family,
//             size and weight. Catches a heading set in body type (GMCP-115 A-2) — a difference
//             no screenshot review reliably sees.
//
// Colour and geometry are deliberately not compared: Figma node names have no mapping onto the
// DOM, so a box-by-box diff produces noise rather than findings. Text is the one anchor both
// sides share.
//
// Usage (the dev server must already be running):
//   node apps/console/tools/figma-export/compare-frames.mjs            # every frame in the manifest
//   node apps/console/tools/figma-export/compare-frames.mjs scr-301    # one screen
//   node apps/console/tools/figma-export/compare-frames.mjs scr-301-1280-agent-단계

import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "out");
const BASE = process.env.CONSOLE_URL ?? "http://127.0.0.1:3000";

/**
 * What each frame is a picture of. `state` runs before the scrape — the mock scenario switcher
 * for data states, clicks for interaction states. A frame with no entry here is not compared:
 * silently scraping the default screen for a frame that shows a modal reports a clean match that
 * was never checked.
 */
const FRAMES = [
  // ── SCR-101 Gateway ───────────────────────────────────────────────────────
  { frame: "scr-101/scr-101-1280", path: "/", width: 1280 },
  { frame: "scr-101/scr-101-1024", path: "/", width: 1024 },
  { frame: "scr-101/scr-101-1920", path: "/", width: 1920 },
  { frame: "scr-101/scr-101-1280-empty", path: "/", width: 1280, scenario: "empty" },
  { frame: "scr-101/scr-101-1280-게이트웨이-미연결", path: "/", width: 1280, scenario: "offline" },

  // ── SCR-201 Demo & Live Console ───────────────────────────────────────────
  { frame: "scr-201/scr-201-1280", path: "/demo", width: 1280 },
  { frame: "scr-201/scr-201-1024", path: "/demo", width: 1024 },
  { frame: "scr-201/scr-201-1920", path: "/demo", width: 1920 },
  { frame: "scr-201/scr-201-1280-대기", path: "/demo", width: 1280 },

  // ── SCR-301 Replay ────────────────────────────────────────────────────────
  { frame: "scr-301/scr-301-1280", path: "/replay", width: 1280 },
  { frame: "scr-301/scr-301-1024", path: "/replay", width: 1024 },
  { frame: "scr-301/scr-301-1920", path: "/replay", width: 1920 },
  { frame: "scr-301/scr-301-1280-empty", path: "/replay", width: 1280, scenario: "empty" },
  {
    frame: "scr-301/scr-301-1280-사용자-입력-단계",
    path: "/replay",
    width: 1280,
    state: (page) => clickNode(page, /README를 요약해줘/)
  },
  {
    frame: "scr-301/scr-301-1280-agent-단계",
    path: "/replay",
    width: 1280,
    state: (page) => clickNode(page, /README 내 지시문 발견/)
  },
  {
    frame: "scr-301/scr-301-1280-tool-call-단계",
    path: "/replay",
    width: 1280,
    state: (page) => clickNode(page, /read_file\(".env"\)/)
  },
  {
    frame: "scr-301/scr-301-1280-guard-판정-단계",
    path: "/replay",
    width: 1280,
    state: (page) => clickNode(page, /차단/)
  },
  {
    frame: "scr-301/scr-301-1280-tool-결과-단계",
    path: "/replay",
    width: 1280,
    state: (page) => clickNode(page, /오류 반환/)
  },
  {
    frame: "scr-301/scr-301-1280-원문-열람-클릭-시",
    path: "/replay",
    width: 1280,
    state: (page) => page.getByRole("button", { name: "원문 열람" }).click()
  },
  {
    frame: "scr-301/scr-301-1280-원문-열람-계속-클릭-시",
    path: "/replay",
    width: 1280,
    state: async (page) => {
      await page.getByRole("button", { name: "원문 열람" }).click();
      await page.getByRole("button", { name: "계속" }).click();
    }
  },

  // ── SCR-302 Policies ──────────────────────────────────────────────────────
  { frame: "scr-302/scr-302-1280", path: "/policies", width: 1280 },
  { frame: "scr-302/scr-302-1024", path: "/policies", width: 1024 },
  { frame: "scr-302/scr-302-1920", path: "/policies", width: 1920 },
  { frame: "scr-302/scr-302-1280-empty", path: "/policies", width: 1280, scenario: "empty" },

  // ── SCR-401 Detector ──────────────────────────────────────────────────────
  { frame: "scr-401/scr-401-1280", path: "/detector", width: 1280 },
  { frame: "scr-401/scr-401-1024", path: "/detector", width: 1024 },
  { frame: "scr-401/scr-401-1920", path: "/detector", width: 1920 },
  { frame: "scr-401/scr-401-1280-입력-전", path: "/detector", width: 1280 },

  // ── SCR-402 Approval ──────────────────────────────────────────────────────
  { frame: "scr-402/scr-402-1280", path: "/approvals", width: 1280 },
  { frame: "scr-402/scr-402-1024", path: "/approvals", width: 1024 },
  { frame: "scr-402/scr-402-1920", path: "/approvals", width: 1920 },
  { frame: "scr-402/scr-402-1280-대기열", path: "/approvals", width: 1280 },
  { frame: "scr-402/scr-402-1280-empty", path: "/approvals", width: 1280, scenario: "empty" },

  // ── SCR-501 Settings ──────────────────────────────────────────────────────
  { frame: "scr-501/scr-501-1280", path: "/settings", width: 1280 },
  { frame: "scr-501/scr-501-1024", path: "/settings", width: 1024 },
  { frame: "scr-501/scr-501-1920", path: "/settings", width: 1920 }
];

function clickNode(page, name) {
  return page.getByRole("log").getByRole("button", { name }).first().click();
}

/** Ignorable difference: a live clock, a counted total, or anything else the design froze. */
const VOLATILE = /^\d{1,2}:\d{2}(:\d{2})?$|^\d+$|^[+-]?\d+(\.\d+)?%$|^#[0-9a-f]{6}$/i;

/** Below this a difference is the draft rounding Figma's layout, not a misplacement. */
const POSITION_TOLERANCE = 8;

/**
 * Every visible text run with the type it is set in. Runs inside script/style/template carry the
 * RSC payload rather than anything a user reads, so they are dropped on both sides.
 */
// Serialised into the page by `page.evaluate`, so its body runs in the browser, not in Node.
/* global document, getComputedStyle, NodeFilter, window */
const SCRAPE = (side) => {
  const out = [];
  const push = (text, el) => {
    const clean = (text ?? "").replace(/\s+/g, " ").trim();
    if (!clean || !el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const style = getComputedStyle(el);
    // Colour, and the box the run sits in, are anchored on the run itself — that is the one thing
    // both sides name the same way. Figma node names have no DOM counterpart, so a box compared
    // any other way cannot be matched at all.
    let box = null;
    for (let node = el, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const boxStyle = getComputedStyle(node);
      const painted =
        boxStyle.backgroundColor !== "rgba(0, 0, 0, 0)" && boxStyle.backgroundColor !== "transparent";
      if (painted || boxStyle.borderRadius !== "0px") {
        box = {
          background: boxStyle.backgroundColor,
          // A pill is a pill: the design writes 1000px and Tailwind's `rounded-full` computes to
          // half the box, so both are normalised rather than reported as a difference.
          radius: /e\+\d+px$|^\d{4,}(\.\d+)?px$/.test(boxStyle.borderRadius) ? "full" : boxStyle.borderRadius,
          padding: `${boxStyle.paddingTop} ${boxStyle.paddingRight} ${boxStyle.paddingBottom} ${boxStyle.paddingLeft}`,
          w: Math.round(node.getBoundingClientRect().width),
          h: Math.round(node.getBoundingClientRect().height)
        };
        break;
      }
    }
    out.push({
      text: clean,
      family: style.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      size: style.fontSize,
      weight: style.fontWeight,
      color: style.color,
      box,
      // Page coordinates: the draft's frame starts at 0,0 with the design's own width, and the app
      // is loaded at that same width, so the two origins line up without any further mapping.
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY)
    });
  };
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("script, style, template") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  let node;
  while ((node = walk.nextNode())) push(node.textContent, node.parentElement);
  // Copy a user reads that is not a text node. A placeholder is ordinary text in the draft, so
  // both sides need it. `alt` is app-only: the draft's images carry Figma layer names ("bg",
  // "Button/Solid", "Timeline_Rail/Node Marker") that no one reads, while the app's alt is what
  // stands in for a picture the draft draws as text — the logo, above all.
  for (const el of document.querySelectorAll("[placeholder]")) push(el.getAttribute("placeholder"), el);
  if (side === "app") for (const el of document.querySelectorAll("img[alt]")) push(el.getAttribute("alt"), el);
  return out;
};

/**
 * Every string the console itself says lives in `messages/ko.json`; everything else on a screen is
 * data. That split is what makes the content difference readable: a frame run that matches a
 * catalogue message and is not on screen is a missing label — a real defect — while one that does
 * not is the design's sample data differing from the mock's, which is not. Without it the content
 * axis is 500 lines of noise with the handful of real findings buried in it.
 */
const CHROME = new Set();
{
  const messages = JSON.parse(readFileSync(resolve(HERE, "../../messages/ko.json"), "utf8"));
  (function collect(node) {
    if (node && typeof node === "object") for (const value of Object.values(node)) collect(value);
    else if (typeof node === "string") {
      // A message with an ICU placeholder never appears verbatim, so match on its literal parts.
      for (const part of node.split(/\{[^}]*\}/)) {
        const trimmed = part.trim();
        if (trimmed.length >= 2) CHROME.add(trimmed.replace(/\s+/g, ""));
      }
    }
  })(messages);
}

/** Whether a run of frame text is something the console says, rather than something it shows. */
const isChrome = (text) => {
  const squashed = text.replace(/\s+/g, "");
  if (CHROME.has(squashed)) return true;
  // The drafts break a sentence across spans, so a run is chrome when a message contains it.
  for (const message of CHROME) if (message.length > squashed.length && message.includes(squashed)) return true;
  return false;
};

/** The design's quotes and ellipsis are typographic; the app's come from JSON. Same words. */
const norm = (text) =>
  text
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[…]/g, "...")
    .replace(/\s+/g, " ")
    .trim();

function compare(figma, app) {
  const appTexts = app.map((entry) => norm(entry.text));
  const figmaTexts = figma.map((entry) => norm(entry.text));
  // Each side also breaks a run wherever its own markup happens to — React splits `{speed}x`
  // into "1" and "x" — and neither split is a difference anyone can see, so containment is
  // checked with the whitespace and the node boundaries taken out.
  const squash = (text) => text.replace(/\s+/g, "");
  const appJoined = squash(appTexts.join(""));
  const figmaJoined = squash(figmaTexts.join(""));

  // A draft splits an inline run across several spans ("read_file(", ".env", "\")"), so a run is
  // "present" when the screen's text contains it anywhere, not when a node matches it whole.
  const absent = [...new Set(figmaTexts)].filter(
    (text) => text && !VOLATILE.test(text) && !appJoined.includes(squash(text))
  );
  const missing = absent.filter(isChrome);
  const sample = absent.filter((text) => !isChrome(text));
  const extra = [...new Set(appTexts)].filter(
    (text) => text && !VOLATILE.test(text) && !figmaJoined.includes(squash(text)) && isChrome(text)
  );

  // Type, colour, box and position are only comparable where a run is unambiguous on both sides —
  // two runs of the same text give no way to tell which is which.
  const once = (list, text) => list.filter((entry) => norm(entry.text) === text).length === 1;
  const type = [];
  const color = [];
  const boxes = [];
  const position = [];
  for (const text of new Set(figmaTexts)) {
    if (!text || VOLATILE.test(text) || !once(figma, text) || !once(app, text)) continue;
    const f = figma.find((entry) => norm(entry.text) === text);
    const a = app.find((entry) => norm(entry.text) === text);
    if (f.family !== a.family || f.size !== a.size || f.weight !== a.weight) {
      type.push({ text, figma: `${f.family} ${f.size}/${f.weight}`, app: `${a.family} ${a.size}/${a.weight}` });
    }
    if (f.color !== a.color) color.push({ text, figma: f.color, app: a.color });
    if (f.box && a.box) {
      const parts = [];
      if (f.box.background !== a.box.background) parts.push(["배경", f.box.background, a.box.background]);
      if (f.box.radius !== a.box.radius) parts.push(["radius", f.box.radius, a.box.radius]);
      if (f.box.padding !== a.box.padding) parts.push(["padding", f.box.padding, a.box.padding]);
      // The box the run sits in: a chip that is 4px wider is a different chip. Same tolerance as
      // position, since both are the draft rounding Figma's layout.
      if (Math.abs(f.box.w - a.box.w) > POSITION_TOLERANCE || Math.abs(f.box.h - a.box.h) > POSITION_TOLERANCE) {
        parts.push(["크기", `${f.box.w}×${f.box.h}`, `${a.box.w}×${a.box.h}`]);
      }
      for (const [what, figmaValue, appValue] of parts) boxes.push({ text, what, figma: figmaValue, app: appValue });
    }
    // A few pixels is the draft rounding Figma's own layout, not a misplacement worth reporting.
    const dx = a.x - f.x;
    const dy = a.y - f.y;
    if (Math.abs(dx) > POSITION_TOLERANCE || Math.abs(dy) > POSITION_TOLERANCE) {
      position.push({ text, figma: `${f.x},${f.y}`, app: `${a.x},${a.y}`, delta: `${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : ""}${dy}` });
    }
  }
  return { missing, sample, extra, type, color, boxes, position };
}

/**
 * The findings are only useful if you can see them one state at a time — a flat log of 36 frames
 * reads as a wall. `--report <file>` writes the same run as a page grouped screen → state, so a
 * reviewer opens the state they care about and sees only its differences.
 */
function renderReport(rows) {
  const esc = (text) =>
    String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const screens = new Map();
  for (const row of rows) {
    const screen = row.frame.split("/")[0].toUpperCase();
    if (!screens.has(screen)) screens.set(screen, []);
    screens.get(screen).push(row);
  }
  // Two tiers, because the axes are not equally trustworthy. Type, radius, background and the
  // labels are exact: they compare a property that does not move when the data behind the screen
  // does. Size, padding and position do move — the mock's text is not the design's sample text,
  // so a box that is 40px wider is usually a longer word, not a misbuilt box. Colour sits in the
  // first tier: it is a property of the run itself, and one wrong token repeats across every
  // frame rather than scattering.
  const sharp = (r) =>
    r.missing.length + r.extra.length + r.type.length + r.color.length +
    r.boxes.filter((b) => b.what === "radius" || b.what === "배경").length;
  const soft = (r) => r.position.length + r.boxes.filter((b) => b.what === "크기" || b.what === "padding").length;
  const total = rows.reduce((sum, r) => sum + sharp(r), 0);
  const softTotal = rows.reduce((sum, r) => sum + soft(r), 0);
  const samples = rows.reduce((sum, r) => sum + r.sample.length, 0);

  const list = (title, kind, items, render) =>
    items.length
      ? `<div class="group ${kind}"><h4>${title} <span class="n">${items.length}</span></h4><ul>${items
          .map((item) => `<li>${render(item)}</li>`)
          .join("")}</ul></div>`
      : "";

  const body = [...screens.entries()]
    .map(([screen, list_]) => {
      const count = list_.reduce((sum, r) => sum + sharp(r), 0);
      const states = list_
        .map((row) => {
          const n = sharp(row);
          const pair = (item) =>
            `<span class="t">${esc(item.text.length > 80 ? item.text.slice(0, 80) + "…" : item.text)}</span>` +
            `<span class="pair"><b>프레임</b> ${esc(item.figma)} <b>화면</b> ${esc(item.app)}</span>`;
          const compare_ = row.figmaShot && row.appShot
            ? `<figure class="cmp" style="aspect-ratio:${row.shotW}/${row.shotH}">
                 <img class="under" src="${row.appShot}" alt="화면" loading="lazy" />
                 <img class="over" src="${row.figmaShot}" alt="프레임" loading="lazy" />
                 <span class="handle"></span>
                 <input type="range" min="0" max="100" value="50" aria-label="프레임과 화면 사이를 문질러 비교" />
                 <figcaption><b>왼쪽 프레임</b> · <b>오른쪽 화면</b> — 손잡이를 드래그하세요. 사진을 누르면 두 장을 번갈아 깜빡입니다.</figcaption>
               </figure>`
            : "";
          const inner =
            list("빠진 문구 — 프레임에 있고 화면에 없음", "missing", row.missing, esc) +
            list("남는 문구 — 화면에 있고 프레임에 없음", "extra", row.extra, esc) +
            list("서체", "type", row.type, pair) +
            list("색", "color", row.color, pair) +
            list("radius", "type", row.boxes.filter((b) => b.what === "radius"), pair) +
            list("배경색", "color", row.boxes.filter((b) => b.what === "배경"), pair);
          const softItems = [
            ...row.boxes.filter((b) => b.what === "크기" || b.what === "padding").map((b) => ({ ...b, kind: b.what })),
            ...row.position.map((p) => ({ ...p, kind: "위치", figma: p.figma, app: `${p.app}  (${p.delta})` }))
          ];
          const soft_ = softItems.length
            ? `<div class="group sample"><h4>크기 · padding · 위치 <span class="n">${softItems.length}</span></h4>` +
              `<p class="hint">목 데이터가 디자인 샘플과 글자 수가 달라 상자 폭과 좌표가 함께 움직입니다. 이 축은 오탐이 많으니 참고만 하세요.</p>` +
              `<ul>${softItems.map((item) => `<li><span class="t">${esc(item.text.slice(0, 60))}</span> <em>${esc(item.kind)}</em><span class="pair"><b>프레임</b> ${esc(item.figma)} <b>화면</b> ${esc(item.app)}</span></li>`).join("")}</ul></div>`
            : "";
          const samples_ = row.sample.length
            ? `<div class="group sample"><h4>샘플 데이터 차이 <span class="n">${row.sample.length}</span></h4>` +
              `<p class="hint">화면 문구가 아니라 목 데이터가 디자인 샘플과 다른 경우입니다. 결함이 아닙니다.</p>` +
              `<ul>${row.sample.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`
            : "";
          return `<details class="state${n ? "" : " clean"}"${n ? " open" : ""}>
            <summary><span class="name">${esc(row.state)}</span>
            <span class="meta">${esc(row.path)} @ ${row.width}${row.scenario ? ` · ${row.scenario}` : ""}</span>
            <span class="badge${n ? "" : " ok"}">${n || "일치"}</span></summary>${compare_}${inner || '<p class="none">차이 없음</p>'}${samples_}${soft_}</details>`;
        })
        .join("");
      return `<section><h2>${esc(screen)} <span class="n">${count}</span></h2>${states}</section>`;
    })
    .join("");

  return `<title>프레임 대조 리포트</title>
<style>
:root{--bg:#fff;--fg:#16191d;--muted:#5b6472;--line:#e4e7ec;--card:#f7f8fa;--miss:#c2410c;--extra:#0369a1;--type:#7c3aed;--ok:#15803d}
:root:not([data-theme="light"]){@media (prefers-color-scheme:dark){--bg:#0f1115;--fg:#e8eaed;--muted:#98a2b3;--line:#252a33;--card:#171a20;--miss:#fb923c;--extra:#38bdf8;--type:#c4b5fd;--ok:#4ade80}}
:root[data-theme="dark"]{--bg:#0f1115;--fg:#e8eaed;--muted:#98a2b3;--line:#252a33;--card:#171a20;--miss:#fb923c;--extra:#38bdf8;--type:#c4b5fd;--ok:#4ade80}
body{background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:2rem 1.25rem 4rem}
.wrap{max-width:60rem;margin:0 auto}
h1{font-size:1.6rem;margin:0 0 .25rem}
.sub{color:var(--muted);margin:0 0 2rem}
h2{font-size:1.1rem;border-bottom:1px solid var(--line);padding-bottom:.4rem;margin:2.5rem 0 .75rem}
.n{color:var(--muted);font-weight:400;font-size:.85rem}
.state{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:.5rem 0;padding:.6rem .9rem}
.state.clean{opacity:.6}
summary{cursor:pointer;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.name{font-weight:600}
.meta{color:var(--muted);font-size:.82rem}
.badge{margin-left:auto;background:var(--miss);color:#fff;border-radius:99px;padding:.05rem .55rem;font-size:.78rem}
.badge.ok{background:var(--ok)}
.group{margin:.9rem 0 .2rem}
.group h4{margin:0 0 .35rem;font-size:.82rem;letter-spacing:.02em;text-transform:uppercase}
.missing h4{color:var(--miss)} .extra h4{color:var(--extra)} .type h4{color:var(--type)} .sample h4{color:var(--muted)}
.sample{opacity:.75} .sample ul{max-height:11rem;overflow-y:auto}
.color h4{color:var(--ok)}
li em{color:var(--muted);font-style:normal;font-size:.8rem}
.hint{color:var(--muted);font-size:.8rem;margin:0 0 .3rem}
ul{margin:0;padding-left:1.1rem}
li{margin:.15rem 0;font-size:.9rem;overflow-wrap:anywhere}
.t{font-weight:600}
.pair{display:block;color:var(--muted);font-size:.82rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pair b{font-weight:600;color:var(--fg)}
.none{color:var(--muted);margin:.6rem 0 .2rem;font-size:.9rem}
.cmp{position:relative;margin:.9rem 0 .4rem;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#000;--wipe:50%}
.cmp img{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;display:block}
.cmp .over{clip-path:inset(0 calc(100% - var(--wipe)) 0 0)}
.cmp.blink .over{clip-path:none;animation:blink 1.4s steps(1,end) infinite}
@keyframes blink{0%,50%{opacity:1}50.01%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.cmp.blink .over{animation:none;opacity:1}}
.cmp .handle{position:absolute;top:0;bottom:0;left:var(--wipe);width:2px;background:#f43f5e;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.cmp.blink .handle{display:none}
.cmp input[type=range]{position:absolute;inset:auto 0 0 0;width:100%;margin:0;opacity:0;height:100%;cursor:ew-resize}
.cmp figcaption{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.66);color:#fff;font-size:.75rem;padding:.3rem .6rem;pointer-events:none}
</style>
<div class="wrap">
<h1>피그마 프레임 대조 리포트</h1>
<p class="sub"><b>${rows.length}개 상태 · 고쳐야 할 차이 ${total}건.</b>
서체 · 색 · radius · 배경색 · 문구는 데이터가 바뀌어도 움직이지 않는 속성이라 그대로 믿으셔도 됩니다.<br />
아래로 접어 둔 <b>크기 · padding · 위치 ${softTotal}건</b>과 <b>샘플 데이터 ${samples}건</b>은 목 데이터가 디자인 샘플과 달라서 생기는 잡음이 섞여 있습니다.
문구는 <code>messages/ko.json</code>에 있으면 화면 문구, 없으면 목 데이터로 갈랐습니다.</p>
${body}
</div>
<script>
// Wiping is how a difference in a box or a colour becomes visible at a glance; blinking is how a
// small shift in position becomes visible. Both beat reading two pictures side by side.
for (const cmp of document.querySelectorAll(".cmp")) {
  const range = cmp.querySelector("input");
  range.addEventListener("input", () => {
    cmp.classList.remove("blink");
    cmp.style.setProperty("--wipe", range.value + "%");
  });
  cmp.addEventListener("click", (event) => {
    if (event.target === range) return;
    cmp.classList.toggle("blink");
  });
}
</script>`;
}

const REPORT = (() => {
  const i = process.argv.indexOf("--report");
  return i > -1 ? process.argv[i + 1] : null;
})();
const only = process.argv[2] && process.argv[2] !== "--report" ? process.argv[2] : null;
const selected = only ? FRAMES.filter((f) => f.frame.includes(only)) : FRAMES;
if (!selected.length) {
  console.error(`No frame matches "${only}".`);
  process.exit(1);
}

/** A JPEG data URI. Quality 55 keeps a 1280-wide dark screen near 65KB, so 36 states of both
 *  sides stay well inside what a single self-contained page can carry. */
async function shoot(page, locator, clip) {
  const buffer = await (locator ?? page).screenshot({ type: "jpeg", quality: 55, ...(clip ? { clip } : {}) });
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/** The PNG's own pixel size, straight out of the IHDR chunk. */
function pngSize(file) {
  const header = readFileSync(file).subarray(16, 24);
  return { w: header.readUInt32BE(0), h: header.readUInt32BE(4) };
}

/**
 * The comparison shows the exported .png, not the .html. The draft is a reconstruction — close,
 * but not what Figma actually drew — so comparing against it hides the very differences the
 * comparison is for. The .html stays the source for the measurements, since only it has computed
 * styles; the .png is what the eye is given.
 *
 * Figma exports at 2x, which is four times the bytes for no more detail at the size the report
 * shows it, so it is re-rendered at 1x and re-encoded on the way in.
 */
async function shootPng(page, file, width, height) {
  const data = readFileSync(file).toString("base64");
  await page.setContent(
    `<body style="margin:0"><img src="data:image/png;base64,${data}" ` +
      `style="display:block;width:${width}px;height:${height}px" /></body>`
  );
  const image = page.locator("img");
  await image.waitFor();
  return shoot(page, image);
}

const browser = await chromium.launch();
const report = [];
let frames = 0;
let findings = 0;

for (const entry of selected) {
  const file = resolve(OUT, entry.frame, `${entry.frame.split("/").pop()}.html`);
  if (!existsSync(file)) {
    console.log(`\n## ${entry.frame}\n   (no export on disk — run the Figma export first)`);
    continue;
  }
  const context = await browser.newContext({ viewport: { width: Math.max(entry.width, 1280), height: 1400 } });
  const page = await context.newPage();

  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(300);
  const figma = await page.evaluate(SCRAPE, "figma");
  // The draft's frame is a fixed-size box at 0,0, so shooting it and then shooting the screen
  // clipped to the same box gives two images that overlay pixel for pixel — which is what makes
  // a wipe between them readable at all.
  // The .png is the authority for what the frame looks like; its half-size is the box both
  // images are shown at, so they overlay exactly.
  const png = file.replace(/\.html$/, ".png");
  const shotBox =
    REPORT && existsSync(png) ? (({ w, h }) => ({ w: Math.round(w / 2), h: Math.round(h / 2) }))(pngSize(png)) : null;

  await page.setViewportSize({ width: entry.width, height: 1400 });
  if (entry.scenario) {
    await page.goto(`${BASE}/`);
    await page.evaluate((name) => localStorage.setItem("guardmcp.mock-scenario", name), entry.scenario);
  }
  await page.goto(`${BASE}${entry.path}`);
  await page.waitForTimeout(2500);
  if (entry.state) await entry.state(page).catch((error) => console.log(`   ! state failed: ${error.message}`));
  await page.waitForTimeout(600);
  const app = await page.evaluate(SCRAPE, "app");
  const appShot = shotBox ? await shoot(page, null, { x: 0, y: 0, width: shotBox.w, height: shotBox.h }) : null;
  const figmaShot = shotBox ? await shootPng(page, png, shotBox.w, shotBox.h) : null;

  const result = compare(figma, app);
  const { missing, sample, extra, type, color, boxes, position } = result;
  report.push({ ...entry, state: entry.frame.split('/').pop(), ...result, figmaShot, appShot, shotW: shotBox && shotBox.w, shotH: shotBox && shotBox.h });
  frames += 1;
  findings += missing.length + extra.length + type.length + color.length + boxes.length + position.length;

  console.log(`\n## ${entry.frame}  (${entry.path} @ ${entry.width}${entry.scenario ? ` · ${entry.scenario}` : ""})`);
  if (!missing.length && !extra.length && !type.length && !color.length && !boxes.length && !position.length)
    console.log("   ✓ no difference");
  if (missing.length) console.log(`   MISSING label ${missing.length}:\n     ${missing.join("\n     ")}`);
  if (sample.length) console.log(`   (sample data differs: ${sample.length})`);
  if (extra.length) console.log(`   EXTRA label ${extra.length}:\n     ${extra.join("\n     ")}`);
  for (const t of type) console.log(`   TYPE  "${t.text}"  frame=${t.figma}  app=${t.app}`);
  for (const c of color) console.log(`   COLOR "${c.text}"  frame=${c.figma}  app=${c.app}`);
  for (const b of boxes) console.log(`   BOX   "${b.text}" ${b.what}  frame=${b.figma}  app=${b.app}`);
  for (const p of position) console.log(`   POS   "${p.text}"  frame=${p.figma}  app=${p.app}  (${p.delta})`);

  await context.close();
}

console.log(`\n${frames} frames compared, ${findings} differences.`);
await browser.close();

if (REPORT) {
  await writeFile(REPORT, renderReport(report), "utf8");
  console.log(`report written to ${REPORT}`);
}
