import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

// Simple static file server for docs/
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = join(process.cwd(), 'docs', urlPath);

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((resolve) => server.listen(8080, resolve));
console.log('Local static server running at http://localhost:8080');

const viewports = [
  { name: '360x800', width: 360, height: 800 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
];

const pagesToTest = [
  'index.html',
  'portfolio.html',
  'performance.html',
  'health.html',
  'asset.html?asset=BTC',
  'asset.html?asset=ETH',
  'asset.html?asset=LINK',
];

const browser = await chromium.launch();
let totalErrors = 0;
let overflowErrors = 0;

for (const vp of viewports) {
  console.log(`\n--- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleLogs.push(msg.text());
      totalErrors++;
    }
  });

  for (const p of pagesToTest) {
    const url = `http://localhost:8080/${p}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500); // Allow JS rendering

    // Check horizontal page overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    if (hasHorizontalOverflow) {
      console.error(`❌ Overflow detected on ${p} at ${vp.name}! scrollWidth > clientWidth`);
      overflowErrors++;
    } else {
      console.log(`  ✓ ${p}: Fits viewport width (${vp.width}px) without overflow`);
    }

    if (p === 'index.html' && vp.name === '390x844') {
      await page.screenshot({ path: 'mobile-dashboard-screenshot.png' });
    }
  }

  if (consoleLogs.length > 0) {
    console.error(`  Console errors on ${vp.name}:`, consoleLogs);
  }

  await context.close();
}

await browser.close();
server.close();

console.log(`\nVerification Complete!`);
console.log(`Total Horizontal Overflows: ${overflowErrors}`);
console.log(`Total Console Errors: ${totalErrors}`);

if (overflowErrors > 0 || totalErrors > 0) {
  process.exit(1);
} else {
  console.log('ALL MOBILE VIEWPORT VERIFICATIONS PASSED CLEANLY! 🎉');
  process.exit(0);
}
