const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');

const source = fs.readFileSync('src/webview/fork-player.js', 'utf8');
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
let assets;
async function setup() {
    if (!assets) assets = (async () => {
        const home = await fetch('https://stremio.zarg.me/'); assert.ok(home.ok);
        const url = (await home.text()).match(/href="([^"\s]+\/styles\/main\.css)"/)[1];
        const response = await fetch(new URL(url, 'https://stremio.zarg.me/')); assert.ok(response.ok);
        const css = await response.text();
        const playerCss = css.slice(css.indexOf('.player-container-'));
        const name = key => { const m = playerCss.match(new RegExp(`\\.(${key}-[\\w-]+)`)); assert.ok(m, key); return m[1]; };
        return {css, name};
    })();
    const {css, name} = await assets;
    const body = `<div id="player" class="${name('player-container')}">
        <div id="frame" class="${name('layer')}" style="background:linear-gradient(135deg,#286779,#43335d);display:grid;place-items:center"><span id="subtitle">Paused video — subtitles preserved</span></div>
        <div id="top" class="${name('layer')} ${name('nav-bar-layer')}" style="height:72px"><button id="back">Back</button> Episode 3 <button id="fullscreen">Fullscreen</button></div>
        <div id="bottom" class="${name('layer')} ${name('control-bar-layer')}" style="height:100px"><input id="seek" type="range" aria-label="Progress"><button id="pause">Pause</button><button id="settings">Settings</button></div>
        <button id="drawer-button" class="${name('layer')} ${name('side-drawer-button-layer')}">Episodes</button>
    </div>`;
    const html = `<html><meta charset="utf-8"><style>${css}</style><style>html,body{margin:0;width:100%;height:100%;color:white;font:18px system-ui}button{font:inherit;color:white;background:#7272c2;margin:12px;padding:8px}#seek{width:60%}#subtitle{background:#0009;padding:8px}#drawer-button{width:80px;height:60px;right:0}</style><body>${body}</body></html>`;
    const browser = await chromium.launch({executablePath, headless: true});
    const page = await browser.newPage({viewport: {width: 1280, height: 720}});
    await page.route('https://stremio.zarg.me/**', route => route.fulfill({body: html, contentType: 'text/html'}));
    await page.goto('https://stremio.zarg.me/#/player/pause-fixture');
    await page.evaluate(() => {
        window.messages = []; window.handlers = [];
        window.chrome = {webview: {postMessage: text => window.messages.push(JSON.parse(text)), addEventListener: (_, fn) => window.handlers.push(fn)}};
        window.native = (name, value) => window.handlers.forEach(fn => fn({data: JSON.stringify({args: [name, value]})}));
        window.pauseState = paused => window.native('mpv-prop-change', {name: 'pause', data: paused});
        window.activeVideo = active => window.native('display-mode-changed', {mode: 'fit', active});
    });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addScriptTag({content: source});
    await page.evaluate(() => window.activeVideo(true));
    const player = page.locator('#player');
    const wait = state => page.waitForFunction(state => document.querySelector('#player')?.getAttribute('data-stremio-paused-controls') === state, state);
    const addLayer = (id, layer) => page.evaluate(({id, layer}) => {
        const node = document.createElement('div'); node.id = id; node.className = layer;
        node.style.cssText = 'position:absolute;right:50px;bottom:150px;width:300px;height:200px;background:#333';
        document.querySelector('#player').append(node);
    }, {id, layer: name(layer)});
    return {browser, page, player, wait, addLayer, body, name, errors};
}

test('Pause hides all player chrome after one second, mouse motion restores it, and playback/subtitles stay intact', async () => {
    const {browser, page, player, wait, errors} = await setup();
    try {
        await page.evaluate(() => {window.pauseState(true); window.pauseStarted = performance.now();});
        await wait('visible');
        assert.ok(await page.locator('#top').isVisible());
        await wait('hidden');
        assert.ok(await page.evaluate(() => performance.now() - window.pauseStarted >= 950), 'Not hidden before the requested delay');
        for (const id of ['top', 'bottom', 'drawer-button']) assert.equal(await page.locator('#' + id).isVisible(), false);
        assert.equal(await player.evaluate(el => getComputedStyle(el).cursor), 'none');
        assert.ok(await page.locator('#frame').isVisible());
        assert.ok(await page.locator('#subtitle').isVisible());
        assert.deepEqual(await page.evaluate(() => window.messages.filter(m => m.args[0] === 'mpv-command')), [], 'No pause, seek or video commands');
        assert.ok(await page.evaluate(() => window.messages.some(m => m.args[0] === 'mpv-observe-prop' && m.args[1][0] === 'pause')));
        const output = '.build-cache/ui-test-evidence'; fs.mkdirSync(output, {recursive: true});
        await page.screenshot({path: output + '/paused-frame-clean.png'});
        await page.mouse.move(600, 350);
        await wait('visible');
        assert.ok(await page.locator('#top').isVisible());
        assert.ok(await page.locator('#bottom').isVisible());
        await page.screenshot({path: output + '/paused-frame-controls.png'});
        await wait('hidden');
        await page.evaluate(() => window.pauseState(false));
        await page.waitForFunction(() => !document.querySelector('#player').hasAttribute('data-stremio-paused-controls'));
        assert.ok(await page.locator('#bottom').isVisible(), 'Normal playing behavior restored');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Open menus, buffering/errors, pointer drags and keyboard focus protect controls while paused', async () => {
    const {browser, page, wait, addLayer, errors} = await setup();
    try {
        await page.evaluate(() => window.pauseState(true));
        await wait('visible');
        let mouseX = 500;
        for (const layer of ['menu-layer', 'side-drawer-layer', 'buffering-layer', 'error-layer']) {
            await addLayer('popup', layer);
            await page.waitForTimeout(1100);
            assert.equal(await page.locator('#player').getAttribute('data-stremio-paused-controls'), 'visible', layer + ' remains usable');
            await page.locator('#popup').evaluate(el => el.remove());
            await wait('hidden');
            await page.mouse.move(mouseX++, 350);
            await wait('visible');
        }
        await page.locator('#seek').hover();
        await page.mouse.down();
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-paused-controls'), 'visible', 'Do not hide during a drag');
        await page.mouse.up();
        await wait('hidden');
        await page.keyboard.press('Tab');
        await page.locator('#fullscreen').focus();
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-paused-controls'), 'visible', 'Keyboard focus remains accessible');
        await page.locator('#fullscreen').evaluate(el => el.blur());
        await wait('hidden');
        // A mouse click may leave focus on the pause button; it must still hide.
        await page.mouse.move(600, 350); await wait('visible');
        await page.locator('#pause').click();
        await wait('hidden');
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-paused-controls'), 'hidden', 'No focus-out flicker loop');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Playback, navigation, new videos and repeated bootstrap cannot leave hidden or stale controls', async () => {
    const {browser, page, wait, body, errors} = await setup();
    try {
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-paused-controls'), null, 'Playing state is untouched');
        await page.evaluate(() => window.pauseState(true));
        await wait('visible');
        await page.evaluate(() => window.activeVideo(false));
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-paused-controls'), null, 'No hiding after video ends');
        await page.evaluate(() => document.body.replaceChildren());
        await page.waitForTimeout(1100);
        await page.evaluate(body => document.body.innerHTML = body, body);
        await page.evaluate(() => {window.pauseState(false); window.activeVideo(true);});
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-paused-controls'), null, 'New video does not inherit hidden controls');
        const before = await page.evaluate(() => window.handlers.length);
        await page.addScriptTag({content: source});
        assert.equal(await page.evaluate(() => window.handlers.length), before);
        await page.evaluate(() => window.pauseState('bad'));
        assert.equal(await page.locator('#player').getAttribute('data-stremio-paused-controls'), null);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
