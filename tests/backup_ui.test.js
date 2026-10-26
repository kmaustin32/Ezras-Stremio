const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const source = fs.readFileSync('src/webview/fork-backup.js', 'utf8');
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
const html = '<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#141322;color:white;font:16px Segoe UI,sans-serif}.settings-container-test{padding:24px}.sections-container-test{max-width:850px;margin:auto}</style><div class="settings-container-test"><div class="sections-container-test"><div id="upstream">Community settings</div></div></div></html>';

test('Settings export downloads an offline ZIP, has no network/data mutations, survives remounts, and fits narrow windows', async () => {
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 850}, acceptDownloads: true});
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', route => {requests.push(route.request().url()); return route.fulfill({body: html, contentType: 'text/html'});});
        await page.goto('https://stremio.zarg.me/#/settings');
        await page.evaluate(() => {
            window.chrome = {webview: {}};
            localStorage.setItem('profile', JSON.stringify({auth: {user: {_id: 'fixture-user'}, key: 'PRIVATE-LOGIN'}, addons: [
                {manifest: {id: 'fixture-addon', name: 'Example add-on', version: '1.0'}, transportUrl: 'https://addon.invalid/PRIVATE-KEY/manifest.json'}]}));
            const item = {_id: 'tt-test', name: '犬夜叉 — Inuyasha', type: 'series', removed: false, temp: false, _mtime: '2026-10-26T10:00:00Z', state: {timeOffset: 10000}};
            localStorage.setItem('library', JSON.stringify({uid: 'fixture-user', items: {'tt-test': item}}));
            localStorage.setItem('library_recent', JSON.stringify({uid: 'fixture-user', items: {}}));
        });
        const original = await page.evaluate(() => JSON.stringify({...localStorage}));
        await page.addScriptTag({content: source});
        const button = page.getByRole('button', {name: 'Export library & add-ons'});
        await button.waitFor();
        const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
        assert.match(download.suggestedFilename(), /^Ezras-Stremio-backup-.*\.zip$/);
        const buffer = fs.readFileSync(await download.path());
        assert.equal(buffer.readUInt32LE(0), 0x04034b50);
        assert.ok(buffer.includes(Buffer.from('犬夜叉 — Inuyasha')));
        assert.ok(!buffer.includes(Buffer.from('PRIVATE-LOGIN')));
        assert.ok(buffer.includes(Buffer.from('PRIVATE-KEY')));
        assert.match(await page.locator('[role="status"]').innerText(), /1 saved title and 1 add-on/);
        assert.match(await page.locator('[role="status"]').innerText(), /account synchronization was not checked/);
        assert.equal(await page.evaluate(() => JSON.stringify({...localStorage})), original);
        assert.equal(requests.length, 1, 'Export does not contact any service');
        const output = '.build-cache/ui-test-evidence'; fs.mkdirSync(output, {recursive: true});
        for (const width of [1280, 600, 360]) {
            await page.setViewportSize({width, height: 850});
            assert.ok(await button.isVisible());
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.screenshot({path: path.join(output, `library-backup-${width}.png`)});
        }
        await page.evaluate(() => document.body.replaceChildren());
        await page.evaluate(html => document.body.innerHTML = html, html);
        await button.waitFor();
        await page.addScriptTag({content: source});
        assert.equal(await button.count(), 1);
        assert.equal(await page.locator('#upstream').count(), 1);
        await page.evaluate(() => localStorage.setItem('library', '{broken'));
        let downloads = 0; page.on('download', () => ++downloads);
        await button.click();
        assert.match(await page.locator('[role="status"]').innerText(), /cannot be read/);
        assert.equal(downloads, 0, 'Unreadable data does not produce a misleading backup');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Backup fits actual community Settings CSS, and the readable report opens offline without scripts or requests', async () => {
    const response = await fetch('https://stremio.zarg.me/'); assert.ok(response.ok);
    const cssUrl = (await response.text()).match(/href="([^"\s]+\/styles\/main\.css)"/)[1];
    const cssResponse = await fetch(new URL(cssUrl, 'https://stremio.zarg.me/')); assert.ok(cssResponse.ok);
    const css = await cssResponse.text();
    const settingsCss = css.slice(css.indexOf('.settings-container-'));
    const classFor = name => settingsCss.match(new RegExp(`\\.(${name}-[\\w-]+)`))[1];
    const fixture = `<html><meta charset="utf-8"><style>${css}</style><div class="${classFor('settings-container')}"><div class="${classFor('settings-content')}"><div class="${classFor('side-menu-container')}">Settings</div><div class="${classFor('sections-container')}"><div class="${classFor('section-container')}">Community settings</div></div></div></div></html>`;
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 900}});
        await page.route('https://stremio.zarg.me/**', route => route.fulfill({body: fixture, contentType: 'text/html'}));
        await page.goto('https://stremio.zarg.me/#/settings');
        await page.evaluate(() => window.chrome = {webview: {postMessage() {}, addEventListener() {}}});
        await page.addScriptTag({content: fs.readFileSync('src/webview/fork-player.js', 'utf8')});
        await page.addScriptTag({content: source});
        const section = page.locator('#stremio-fork-backup');
        await section.waitFor();
        for (const width of [1280, 800, 600]) {
            await page.setViewportSize({width, height: 900});
            assert.ok(await section.evaluate(el => el.scrollWidth <= el.clientWidth), `Backup content fits at ${width}px`);
            const box = await section.boundingBox(); assert.ok(box.x + box.width <= width);
            await page.screenshot({path: `.build-cache/ui-test-evidence/library-backup-community-${width}.png`});
        }
        const {collect, files} = require('../src/webview/fork-backup');
        const data = {profile: {auth: null, addons: [{manifest: {id: 'addon', name: 'My configured add-on', version: '1.0'}, transportUrl: 'https://example.invalid/PRIVATE/manifest.json'}]},
            library: {uid: null, items: {title: {_id: 'title', name: '犬夜叉 — Inuyasha', type: 'series', removed: false, temp: false, _mtime: '2026-10-26T12:00:00Z'}}},
            library_recent: {uid: null, items: {}}};
        const report = files(collect({getItem(key) {return JSON.stringify(data[key]);}}))['Library.html'];
        const offline = await browser.newPage();
        let requests = 0; offline.on('request', () => ++requests);
        await offline.setContent(report);
        assert.equal(await offline.locator('script').count(), 0);
        assert.match(await offline.locator('body').innerText(), /犬夜叉 — Inuyasha/);
        assert.match(await offline.locator('body').innerText(), /My configured add-on/);
        assert.ok(!(await offline.content()).includes('https://example.invalid/PRIVATE'));
        assert.equal(requests, 0);
        await offline.screenshot({path: '.build-cache/ui-test-evidence/library-backup-report.png', fullPage: true});
    } finally { await browser.close(); }
});
