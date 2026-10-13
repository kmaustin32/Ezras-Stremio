const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {chromium} = require('playwright');

const source = fs.readFileSync('src/webview/fork-player.js', 'utf8');
const shortcuts = vm.runInNewContext(source.match(/const playerShortcuts = (\[[\s\S]*?\n    \]);/)[1]);
const defaults = fs.readFileSync('utils/mpv/anime4k/portable_config/input.conf', 'utf8')
    .split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => ({key: line.trim().split(/\s+/)[0].toUpperCase(), command: line.trim().replace(/^\S+\s+/, '')}));
const byKey = new Map(shortcuts.map(shortcut => [shortcut.key.toUpperCase(), shortcut]));
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));

test('Player shortcut catalog covers every shipped input binding and fork control', () => {
    assert.equal(byKey.size, shortcuts.length, 'No duplicate bindings');
    for (const binding of defaults) assert.ok(byKey.has(binding.key), `Document ${binding.key}`);
    for (const key of ['CTRL+B', 'CTRL+SHIFT+F', 'CTRL+SHIFT+C', 'TAB']) assert.ok(byKey.has(key));
    for (const binding of defaults.filter(binding => /Anime4K: Mode/.test(binding.command))) {
        const mode = binding.command.match(/show-text "([^"]+)"/)[1];
        assert.equal(byKey.get(binding.key).label, mode, 'Mode name agrees with input.conf');
    }
    const clear = defaults.find(binding => /glsl-shaders clr/.test(binding.command));
    assert.equal(byKey.get(clear.key).label, 'Clear GLSL shaders');
    assert.ok(!byKey.has('CTRL+0'), 'Do not show the obsolete upstream shader-clear shortcut');
    const intro = fs.readFileSync('utils/mpv/anime4k/portable_config/scripts/skip-intro.lua', 'utf8');
    assert.ok(intro.includes("mp.add_key_binding('Tab'"), 'Keep the bundled intro shortcut');
});

test('Settings show the complete catalog, preserve upstream rows, and survive navigation', async () => {
    const home = await fetch('https://stremio.zarg.me/');
    assert.ok(home.ok);
    const url = (await home.text()).match(/href="([^"\s]+\/styles\/main\.css)"/)[1];
    const response = await fetch(new URL(url, 'https://stremio.zarg.me/'));
    assert.ok(response.ok);
    const css = await response.text();
    const settingsCss = css.slice(css.indexOf('.settings-container-'));
    const classFor = name => settingsCss.match(new RegExp(`\\.(${name}-[\\w-]+)`))[1];
    const labelClass = settingsCss.match(/\.option-name-container-[\w-]+ \.(label-[\w-]+)/)[1];
    const row = (text, id, keys) => `<div id="${id}" class="${classFor('option-container')}"><div class="${classFor('option-name-container')}"><div class="${labelClass}">${text}</div></div><div class="${classFor('option-input-container')} ${classFor('shortcut-container')}"><kbd>${keys}</kbd></div></div>`;
    const body = `<div class="${classFor('settings-container')}"><div class="${classFor('settings-content')}"><div class="${classFor('side-menu-container')}">Player Shortcuts</div><div class="${classFor('sections-container')}"><div class="${classFor('section-container')}"><div class="${classFor('section-title')}">Keyboard Shortcuts</div>${row('Fullscreen', 'general-row', 'F')}</div><div id="player-shortcuts-section" class="${classFor('section-container')}"><div class="${classFor('section-title')}">Player Shortcuts<div class="${classFor('option-container')} link-container-test">Some features require latest portable config.</div></div>${row('Clear Anime 4k Shader', 'upstream-row', 'Ctrl + 0')}</div></div></div></div>`;
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const output = process.env.STREMIO_UI_TEST_OUTPUT || '.build-cache/ui-test-evidence';
        fs.mkdirSync(output, {recursive: true});
        const page = await browser.newPage({viewport: {width: 1280, height: 900}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://stremio.zarg.me/**', route => route.fulfill({body: `<html><head><style>${css}</style></head><body>${body}</body></html>`, contentType: 'text/html'}));
        await page.goto('https://stremio.zarg.me/#/settings');
        await page.evaluate(() => {window.chrome = {webview: {postMessage() {}, addEventListener() {}}};});
        await page.addScriptTag({content: source});
        const rows = page.locator('.stremio-fork-shortcuts [data-shortcut]');
        await rows.first().waitFor();
        assert.equal(await rows.count(), shortcuts.length);
        const renderedKeys = await rows.evaluateAll(elements => elements.map(element => element.dataset.shortcut.toUpperCase()));
        for (const binding of defaults) assert.ok(renderedKeys.includes(binding.key));
        assert.equal(await page.locator('#upstream-row').count(), 1, 'React-owned row stays in the DOM');
        assert.equal(await page.locator('#upstream-row').isVisible(), false);
        assert.equal(await page.locator('#general-row').isVisible(), true, 'General keyboard shortcuts remain unchanged');
        for (const width of [1280, 800, 600]) {
            await page.setViewportSize({width, height: 900});
            const metrics = await rows.evaluateAll(elements => elements.map(element => {
                const name = element.querySelector('[class*="option-name-container"]');
                const binding = element.querySelector('[class*="option-input-container"]');
                const a = name.getBoundingClientRect(), b = binding.getBoundingClientRect();
                const detail = name.querySelector('p');
                return {clipped: name.scrollWidth > name.clientWidth + 1 || binding.scrollWidth > binding.clientWidth + 1,
                    detailBelow: !detail || detail.getBoundingClientRect().top >= name.firstElementChild.getBoundingClientRect().bottom,
                    right: Math.max(a.right, b.right), separated: b.left >= a.right || b.top >= a.bottom};
            }));
            assert.ok(metrics.every(item => !item.clipped && item.detailBelow && item.separated && item.right <= width), `Readable labels and keys at ${width}px: ${JSON.stringify(metrics.filter(item => item.clipped || !item.detailBelow || !item.separated || item.right > width))}`);
            await page.locator('#player-shortcuts-section').scrollIntoViewIfNeeded();
            await page.screenshot({path: path.join(output, `player-shortcuts-${width}.png`)});
        }
        // A normal upstream row update must not duplicate the catalog.
        await page.evaluate(() => document.querySelector('#upstream-row kbd').textContent = 'Updated by React');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await rows.count(), shortcuts.length);
        // Route changes unmount and remount the settings section after script startup.
        await page.evaluate(() => document.body.replaceChildren());
        await page.evaluate(body => document.body.innerHTML = body, body);
        await rows.first().waitFor();
        assert.equal(await rows.count(), shortcuts.length);
        await page.addScriptTag({content: source});
        assert.equal(await rows.count(), shortcuts.length, 'Repeated bootstrap is safe');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
