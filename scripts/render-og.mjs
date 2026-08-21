#!/usr/bin/env node
/**
 * Render the Open Graph card to a PNG.
 *
 *   node scripts/render-og.mjs
 *
 * Rendered in headless Chromium (already a dev dependency via Playwright) rather than an SVG
 * rasteriser, so the text uses a real font and the result is exactly what a browser would draw.
 * Output is 1200×630 to match the `og:image:width/height` the app declares. On-brand: the paper
 * ground, the ink mark, and the capacity-cut motif from the existing background.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./_artifact.mjs";

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: #f7f7f5; color: #1b0624; position: relative; overflow: hidden;
    padding: 72px 76px; display: flex; flex-direction: column; justify-content: space-between;
    -webkit-font-smoothing: antialiased;
  }
  .bg { position: absolute; inset: 0; z-index: 0; }
  .layer { position: relative; z-index: 1; }
  .top { display: flex; align-items: center; gap: 15px; }
  .wordmark { font-weight: 600; font-size: 25px; letter-spacing: 0.15em; }
  .eyebrow { font-size: 17px; letter-spacing: 0.17em; text-transform: uppercase; color: #8f8a85; font-weight: 500; margin-bottom: 20px; }
  h1 { font-size: 76px; line-height: 1.01; letter-spacing: -0.032em; font-weight: 600; max-width: 15ch; }
  .sub { margin-top: 24px; font-size: 24px; line-height: 1.4; color: #5b5560; max-width: 30ch; font-weight: 400; }
  .domain { font-size: 23px; font-weight: 600; letter-spacing: -0.01em; }
</style></head>
<body>
  <svg class="bg" width="1200" height="630" viewBox="0 0 1200 630">
    <path d="M760 90H1120V205H1020V425H1120V540H760Z" fill="#edece7"/>
    <rect x="1060" y="225" width="90" height="180" rx="14" fill="#ffffff" stroke="#1b0624" stroke-width="4"/>
  </svg>

  <div class="layer top">
    <svg width="54" height="52" viewBox="0 0 66 64"><g fill="#1b0624"><path d="M7 10H43V21H34V43H43V54H7Z"/><rect x="48" y="22" width="9" height="20" rx="1.5"/></g></svg>
    <span class="wordmark">USANCE</span>
  </div>

  <div class="layer">
    <div class="eyebrow">Clearing &amp; risk layer · X Layer</div>
    <h1>Make tokenized assets usable as capital.</h1>
    <p class="sub">Verify what it is, recognise a conservative value, and finance against it — without selling.</p>
  </div>

  <div class="layer">
    <span class="domain">usance.xyz</span>
  </div>
</body></html>`;

const out = resolve(repoRoot, "apps/web/public/assets/social/og-background.png");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(400); // let the web font paint
  const buf = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
  writeFileSync(out, buf);
  console.log(`Wrote ${out} (${buf.length} bytes)`);
} finally {
  await browser.close();
}
