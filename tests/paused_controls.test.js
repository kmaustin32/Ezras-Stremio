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
    const wait = async (state, settled = true) => {
        await page.waitForFunction(state => document.querySelector('#player')?.getAttribute('data-stremio-controls') === state, state);
        if (state === 'hidden') await page.locator('#bottom').waitFor({state: 'hidden'});
        if (state === 'visible' && settled) await page.waitForFunction(() =>
            document.getElementById('player').getAttribute('data-stremio-controls') === 'visible' &&
            ['top', 'bottom'].every(id => {
                const el = document.getElementById(id);
                return Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42) < 0.1 &&
                    !el.getAnimations().some(animation => animation.transitionProperty === 'transform' && animation.playState !== 'finished');
            }));
    };
    const addLayer = (id, layer) => page.evaluate(({id, layer}) => {
        const node = document.createElement('div'); node.id = id; node.className = layer;
        node.style.cssText = 'position:absolute;right:50px;bottom:150px;width:300px;height:200px;background:#333';
        document.querySelector('#player').append(node);
    }, {id, layer: name(layer)});
    return {browser, page, player, wait, addLayer, body, name, errors};
}

async function sampleSlides(page) {
    return page.evaluate(() => ['top', 'bottom'].map(id => {
        const el = document.getElementById(id);
        const animations = el.getAnimations();
        const slide = animations.find(animation => animation.transitionProperty === 'transform');
        if (!slide) throw new Error('Missing slide transition: ' + id);
        const duration = slide.effect.getTiming().duration;
        for (const animation of animations) { animation.pause(); animation.currentTime = 250; }
        const style = getComputedStyle(el);
        return {duration, y: new DOMMatrixReadOnly(style.transform).m42, height: el.getBoundingClientRect().height,
            opacity: Number(style.opacity), visibility: style.visibility, pointerEvents: style.pointerEvents};
    }));
}

async function finishSlides(page) {
    await page.evaluate(() => ['top', 'bottom'].forEach(id =>
        document.getElementById(id).getAnimations().forEach(animation => animation.finish())));
}

async function waitForEntry(page) {
    await page.waitForFunction(() => ['top', 'bottom'].every(id => {
        const el = document.getElementById(id);
        const style = getComputedStyle(el);
        return style.visibility === 'visible' && Math.abs(new DOMMatrixReadOnly(style.transform).m42) < 0.1 &&
            !el.getAnimations().some(animation => animation.transitionProperty === 'transform' && animation.playState !== 'finished');
    }));
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
        await wait('visible');
        await wait('hidden');
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
            assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'), 'visible', layer + ' remains usable');
            await page.locator('#popup').evaluate(el => el.remove());
            await wait('hidden');
            await page.mouse.move(mouseX++, 350);
            await wait('visible');
        }
        await page.locator('#seek').hover();
        await page.mouse.down();
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'), 'visible', 'Do not hide during a drag');
        await page.mouse.up();
        await wait('hidden');
        await page.keyboard.press('Tab');
        await page.locator('#fullscreen').focus();
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'), 'visible', 'Keyboard focus remains accessible');
        await page.locator('#fullscreen').evaluate(el => el.blur());
        await wait('hidden');
        // A mouse click may leave focus on the pause button; it must still hide.
        await page.mouse.move(600, 350); await wait('visible');
        await page.locator('#pause').click();
        await wait('hidden');
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'), 'hidden', 'No focus-out flicker loop');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Playback, navigation, new videos and repeated bootstrap cannot leave hidden or stale controls', async () => {
    const {browser, page, wait, body, errors} = await setup();
    try {
        await wait('hidden');
        await page.evaluate(() => window.pauseState(true));
        await wait('visible');
        await page.evaluate(() => window.activeVideo(false));
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'), null, 'No hiding after video ends');
        await page.evaluate(() => document.body.replaceChildren());
        await page.waitForTimeout(1100);
        await page.evaluate(body => document.body.innerHTML = body, body);
        await page.evaluate(() => {window.pauseState(false); window.activeVideo(true);});
        await wait('visible');
        await wait('hidden');
        const before = await page.evaluate(() => window.handlers.length);
        await page.addScriptTag({content: source});
        assert.equal(await page.evaluate(() => window.handlers.length), before);
        await page.evaluate(() => window.pauseState('bad'));
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'), 'hidden');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Half-second slides move top and bottom controls off opposite edges and reverse smoothly without moving the picture', async () => {
    const {browser, page, wait, errors} = await setup();
    try {
        await page.emulateMedia({reducedMotion: 'no-preference'});
        for (const viewport of [{width: 1280, height: 720}, {width: 480, height: 270}]) {
            await page.setViewportSize(viewport);
            const frame = await page.locator('#frame').boundingBox();
            const drawerTransform = await page.locator('#drawer-button').evaluate(el => getComputedStyle(el).transform);
            await page.evaluate(() => window.pauseState(true));
            await page.waitForFunction(() => document.querySelector('#player').getAttribute('data-stremio-controls') === 'hidden');
            // Freeze real CSS transitions halfway through, rather than relying
            // on a wall-clock screenshot landing on one particular frame.
            const halfway = await sampleSlides(page);
            for (const control of halfway) {
                assert.equal(control.duration, 500);
                assert.ok(control.opacity > 0 && control.opacity < 1, 'Shadows fade during the slide');
                assert.equal(control.visibility, 'visible', 'Do not disappear before the slide finishes');
                assert.equal(control.pointerEvents, 'none', 'Exiting controls cannot intercept video clicks');
            }
            assert.ok(halfway[0].y < 0 && halfway[0].y > -halfway[0].height, 'Top slides upward');
            assert.ok(halfway[1].y > 0 && halfway[1].y < halfway[1].height, 'Bottom slides downward');
            const output = '.build-cache/ui-test-evidence'; fs.mkdirSync(output, {recursive: true});
            await page.screenshot({path: `${output}/paused-slide-halfway-${viewport.width}.png`});
            await page.mouse.move(viewport.width / 2, viewport.height / 2);
            await wait('visible', false);
            const reversing = await page.evaluate(() => ['top', 'bottom'].map(id =>
                new DOMMatrixReadOnly(getComputedStyle(document.getElementById(id)).transform).m42));
            assert.ok(reversing[0] < -1 && reversing[1] > 1, 'Interrupted slides reverse from the current position without snapping');
            await page.waitForFunction(() => ['top', 'bottom'].every(id =>
                Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.getElementById(id)).transform).m42) < 0.1));
            await wait('hidden');
            const bounds = await page.evaluate(() => {
                const player = document.getElementById('player').getBoundingClientRect();
                const top = document.getElementById('top').getBoundingClientRect();
                const bottom = document.getElementById('bottom').getBoundingClientRect();
                return {topOffscreen: top.bottom <= player.top + 0.1, bottomOffscreen: bottom.top >= player.bottom - 0.1,
                    noOverflow: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth};
            });
            assert.deepEqual(bounds, {topOffscreen: true, bottomOffscreen: true, noOverflow: true});
            assert.deepEqual(await page.locator('#frame').boundingBox(), frame, 'Video geometry remains fixed');
            assert.equal(await page.locator('#drawer-button').evaluate(el => getComputedStyle(el).transform), drawerTransform, 'Preserve the episode button positioning');
            await page.evaluate(() => window.pauseState(false));
            await wait('visible');
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Reduced motion hides paused controls without animation and mouse movement still restores them', async () => {
    const {browser, page, wait, errors} = await setup();
    try {
        await page.emulateMedia({reducedMotion: 'reduce'});
        await page.evaluate(() => window.pauseState(true));
        await wait('hidden');
        for (const id of ['top', 'bottom', 'drawer-button']) {
            assert.equal(await page.locator('#' + id).isVisible(), false);
            assert.equal(await page.locator('#' + id).evaluate(el => el.getAnimations().length), 0);
        }
        await page.mouse.move(600, 350);
        await wait('visible');
        assert.ok(await page.locator('#top').isVisible());
        assert.ok(await page.locator('#bottom').isVisible());
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Playing controls follow the selected timeout, ignore upstream hiding, reverse on mouse movement, and protect active sliders', async () => {
    const {browser, page, player, wait, name, errors} = await setup();
    const overlay = hidden => player.evaluate((el, {hidden, className}) => el.classList.toggle(className, hidden), {hidden, className: name('overlayHidden')});
    try {
        await page.emulateMedia({reducedMotion: 'no-preference'});
        // Upstream mouse updates must not replace the configured timer.
        await player.evaluate((el, className) => el.addEventListener('mousemove', () => el.classList.remove(className)), name('overlayHidden'));
        await waitForEntry(page);
        const frame = await page.locator('#frame').boundingBox();
        for (let cycle = 0; cycle < 3; cycle++) {
            await overlay(true);
            await page.waitForFunction(() => document.getElementById('player').getAttribute('data-stremio-controls') === 'hidden');
            const exiting = await sampleSlides(page);
            assert.ok(exiting[0].y < 0 && exiting[1].y > 0);
            for (const control of exiting) assert.equal(control.duration, 500);
            await page.mouse.move(550 + cycle, 350);
            const reversing = await page.evaluate(() => ['top', 'bottom'].map(id =>
                new DOMMatrixReadOnly(getComputedStyle(document.getElementById(id)).transform).m42));
            assert.ok(reversing[0] < -1 && reversing[1] > 1, 'Playing controls reverse without snapping');
            await waitForEntry(page);
        }
        await overlay(true);
        await page.locator('#bottom').waitFor({state: 'hidden'});
        await page.evaluate(className => document.documentElement.classList.add(className), 'active-slider-within-fixture');
        await waitForEntry(page);
        await page.waitForTimeout(1100);
        assert.ok(await page.locator('#bottom').isVisible(), 'The upstream active-slider exception wins over overlayHidden');
        await page.evaluate(() => document.documentElement.classList.remove('active-slider-within-fixture'));
        await page.locator('#bottom').waitFor({state: 'hidden'});
        assert.equal(await player.getAttribute('data-stremio-controls'), 'hidden', 'The same timer governs playing videos');
        assert.deepEqual(await page.locator('#frame').boundingBox(), frame);
        assert.ok(await page.locator('#subtitle').isVisible());
        await page.emulateMedia({reducedMotion: 'reduce'});
        await overlay(false); await page.mouse.move(650, 350); await waitForEntry(page);
        await overlay(true); await wait('hidden');
        assert.equal(await page.locator('#bottom').evaluate(el => el.getAnimations().length), 0);
        assert.deepEqual(await page.evaluate(() => window.messages.filter(m => m.args[0] === 'mpv-command')), []);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Pause and resume wake controls smoothly, redundant state updates do not reset inactivity', async () => {
    const {browser, page, player, wait, name, errors} = await setup();
    try {
        await page.emulateMedia({reducedMotion: 'no-preference'});
        await wait('hidden');
        await player.evaluate((el, className) => el.classList.add(className), name('overlayHidden'));
        for (const paused of [true, false]) {
            await page.evaluate(paused => window.pauseState(paused), paused);
            await wait('visible', false);
            const returning = await sampleSlides(page);
            assert.ok(returning[0].y < 0 && returning[1].y > 0);
            for (const control of returning) assert.equal(control.duration, 500);
            await finishSlides(page); await waitForEntry(page);
            assert.ok(await page.locator('#top').isVisible(), 'Configured visibility overrides the upstream class');
            await wait('hidden');
            await page.evaluate(paused => window.pauseState(paused), paused);
            assert.equal(await player.getAttribute('data-stremio-controls'), 'hidden', 'Repeated native notifications do not wake controls');
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Newly mounted toolbars slide into position without moving the picture', async () => {
    const {browser, page, errors} = await setup();
    try {
        await page.emulateMedia({reducedMotion: 'no-preference'});
        await waitForEntry(page);
        const frame = await page.locator('#frame').boundingBox();
        await page.evaluate(() => {
            const bars = ['top', 'bottom'].map(id => document.getElementById(id));
            const markup = bars.map(el => el.outerHTML).join('');
            bars.forEach(el => el.remove());
            document.getElementById('player').insertAdjacentHTML('beforeend', markup);
        });
        const entering = await sampleSlides(page);
        assert.ok(entering[0].y < 0 && entering[1].y > 0);
        for (const control of entering) assert.equal(control.duration, 500);
        await finishSlides(page); await waitForEntry(page);
        assert.deepEqual(await page.locator('#frame').boundingBox(), frame);
        assert.ok(await page.locator('#subtitle').isVisible());
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
