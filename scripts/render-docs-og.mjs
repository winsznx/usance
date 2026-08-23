#!/usr/bin/env node
/**
 * Render the Open Graph card for the documentation site (docs.usance.xyz).
 *
 *   node scripts/render-docs-og.mjs
 *
 * Same house language as the main site card (paper ground, ink mark, capacity-cut motif), but the
 * copy speaks to the docs rather than the product. Rendered in headless Chromium so the type uses a
 * real font and the output is exactly what a browser would draw. 1200x630 to match og:image.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../apps/web/public/assets/social/og-docs.png");

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
  .docs-tag { margin-left: 6px; font-size: 13px; letter-spacing: 0.18em; color: #8f8a85; font-weight: 600; }
  .eyebrow { font-size: 17px; letter-spacing: 0.17em; text-transform: uppercase; color: #8f8a85; font-weight: 500; margin-bottom: 20px; }
  h1 { font-size: 72px; line-height: 1.02; letter-spacing: -0.032em; font-weight: 600; max-width: 16ch; }
  .sub { margin-top: 24px; font-size: 23px; line-height: 1.4; color: #5b5560; max-width: 32ch; font-weight: 400; }
  .domain { font-size: 23px; font-weight: 600; letter-spacing: -0.01em; }
</style></head>
<body>
  <svg class="bg" width="1200" height="630" viewBox="0 0 1200 630">
    <path d="M760 90H1120V205H1020V425H1120V540H760Z" fill="#edece7"/>
    <rect x="1060" y="225" width="90" height="180" rx="14" fill="#ffffff" stroke="#1b0624" stroke-width="4"/>
  </svg>

  <div class="layer top">
    <svg width="54" height="54" viewBox="0 0 64 64"><g fill="#1b0624"><path d="M7 10H43V21H34V43H43V54H7Z"/><rect x="48" y="22" width="9" height="20" rx="1.5"/></g></svg>
    <span class="wordmark">USANCE</span>
    <span class="docs-tag">DOCS</span>
  </div>

  <div class="layer">
    <div class="eyebrow">Documentation · X Layer</div>
    <h1>The clearing and risk layer, documented.</h1>
    <p class="sub">From evidence to Passport to recognised value to capacity, with every step inspectable.</p>
  </div>

  <div class="layer">
    <span class="domain">docs.usance.xyz</span>
  </div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const buf = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
  writeFileSync(out, buf);
  console.log(`Wrote ${out} (${buf.length} bytes)`);
} finally {
  await browser.close();
}
