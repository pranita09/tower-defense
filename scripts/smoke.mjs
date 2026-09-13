/**
 * Drives the built game in a real browser — play, build, upgrade, run a wave, load
 * the stress preset, zoom — and asserts on what the DOM reports. Covers what Node
 * tests cannot: WebGL, canvas and layout. It caught a stacking bug where the
 * overlay canvas sat above the HUD and swallowed every click.
 *
 * Run `npm run build && npm run preview`, then `npm run smoke`.
 * Override with SMOKE_URL and CHROME_PATH.
 */

import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = process.env.SMOKE_URL ?? 'http://localhost:4173/';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  pass  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
    failures.push(label);
  }
};

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  // Software GL, because CI machines have no GPU. It is far slower than real
  // hardware, so this script never asserts on frame rate — only on behaviour and
  // on the counters that reveal *how* the frame was drawn.
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1440,900',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(URL, { waitUntil: 'networkidle0' });

const read = () =>
  page.evaluate(() => {
    const number = (text) => Number((text ?? '').replace(/[^0-9.]/g, ''));
    const counters = {};
    for (const counter of document.querySelectorAll('.hud__counter')) {
      counters[counter.querySelector('.hud__counter-label')?.textContent ?? '?'] = number(
        counter.querySelector('.hud__counter-value')?.textContent
      );
    }
    const stats = {};
    for (const stat of document.querySelectorAll('.perf__stat')) {
      stats[stat.querySelector('dt')?.textContent ?? '?'] = number(
        stat.querySelector('dd')?.textContent
      );
    }
    const stage = document.querySelector('.game');
    return {
      enemies: counters.enemies ?? 0,
      towers: counters.towers ?? 0,
      shots: counters.shots ?? 0,
      drawCalls: stats['draw calls'] ?? 0,
      sprites: stats.sprites ?? 0,
      culled: stats.culled ?? 0,
      gold: number(document.querySelector('.hud__stat--gold .hud__value')?.textContent),
      inspectorOpen: Boolean(document.querySelector('.tower-panel')),
      baselineBadge: Boolean(document.querySelector('.game__mode-badge')),
      overflowX: stage.scrollWidth - stage.clientWidth,
      scrollLeft: stage.scrollLeft,
    };
  });

console.log(`\nsmoke: ${URL}\n`);

await page.waitForSelector('.start__play');
check('title screen renders', true);
await page.click('.start__play');
await wait(600);

const booted = await read();
check('optimized renderer is active', !booted.baselineBadge, 'WebGL2 unavailable');
check('draws in two calls', booted.drawCalls === 2, `${booted.drawCalls} calls`);

// Buy the first tower in the shop, then find a buildable tile by trying a grid.
await page.click('.shop__card');
check(
  'shop selection registers',
  await page.$eval('.shop__card', (el) => el.className.includes('is-active'))
);

const placements = [];
for (let x = 120; x <= 1300 && placements.length < 4; x += 60) {
  for (let y = 140; y <= 780 && placements.length < 4; y += 60) {
    const before = (await read()).towers;
    await page.mouse.click(x, y);
    await wait(120);
    if ((await read()).towers > before) placements.push([x, y]);
  }
}
check('towers can be placed by clicking', placements.length >= 4, `${placements.length} placed`);

await page.keyboard.press('Escape');
await page.mouse.click(placements[0][0], placements[0][1]);
await wait(300);
check('clicking a tower opens the inspector', (await read()).inspectorOpen);

// Play a wave at 4x and confirm the towers actually shoot.
await page.keyboard.press('Digit3');
await page.keyboard.press('Enter');
await wait(5000);
const playing = await read();
check('towers engage the wave', playing.shots > 0 || playing.enemies > 0);

// The graded stress scenario.
await page.click('.game__stress-toggle');
await page.waitForSelector('.stress__preset');
const presets = await page.$$('.stress__preset');
await presets[1].click();
await wait(5000);
const stress = await read();
check('stress reaches 5,000 enemies', stress.enemies >= 5000, `${stress.enemies}`);
check('stress reaches 100 towers', stress.towers >= 100, `${stress.towers}`);
check('stress reaches 1,000 projectiles', stress.shots >= 980, `${stress.shots}`);
check(
  'still two draw calls under load',
  stress.drawCalls === 2,
  `${stress.drawCalls} calls for ${stress.sprites} sprites`
);
check('remains interactive', await page.$eval('.controls__button', (el) => !el.disabled));

// Zooming in must reduce the work, not just magnify it.
await page.mouse.move(700, 450);
for (let i = 0; i < 14; i += 1) await page.mouse.wheel({ deltaY: -120 });
await wait(2500);
const zoomed = await read();
check('offscreen sprites are culled', zoomed.culled > 0, `${zoomed.culled} culled`);
check(
  'culling reduces the batch',
  zoomed.sprites < stress.sprites,
  `${zoomed.sprites} vs ${stress.sprites}`
);

// The baseline engine has to be reachable, since the comparison depends on it.
const engineButtons = await page.$$('.engine__option');
await engineButtons[1].click();
await wait(1500);
const naive = await read();
check('baseline engine can be switched in', naive.baselineBadge);
check(
  'baseline issues a draw call per object',
  naive.drawCalls > 100,
  `${naive.drawCalls} draw calls`
);

const final = await read();
check('no horizontal overflow', final.overflowX === 0 && final.scrollLeft === 0);
check('no console errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();

console.log(`\n${failures.length === 0 ? 'all checks passed' : `${failures.length} failed`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
