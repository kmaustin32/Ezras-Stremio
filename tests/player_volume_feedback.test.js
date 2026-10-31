const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
let fork = fs.readFileSync(process.env.STREMIO_VOLUME_FORK_SCRIPT || 'src/webview/fork-player.js', 'utf8');
for (const mode of ['fit', 'crop', 'stretch']) fork = fork.replace(`__FORK_${mode.toUpperCase()}_SVG__`, fs.readFileSync(`images/player/video-scale-${mode}.svg`, 'utf8').trim());
const shortcuts = fs.readFileSync('src/webview/webview.cpp', 'utf8').match(/INJECTED_KEYDOWN_SCRIPT = LR"JS\(([\s\S]*?)\)JS";/)[1];
let assets;

async function setup(clock = false) {
    assets ||= (async () => {
        const html = await (await fetch('https://stremio.zarg.me/')).text();
        return Promise.all(['scripts/main.js', 'styles/main.css'].map(async suffix => {
            const path = html.match(new RegExp(`(?:src|href)="([^"\\s]+/${suffix.replace('.', '\\.')})"`))[1];
            const response = await fetch(new URL(path, 'https://stremio.zarg.me/')); assert.ok(response.ok);
            return response.text();
        }));
    })();
    const [original, css] = await assets;
    const compiled = '.build-cache/player-autoplay/patched.js';
    const patched = fs.existsSync(compiled) ? fs.readFileSync(compiled, 'utf8') : '';
    const verified = patched.includes('__stremioForkVolumeFeedbackPatched=true');
    if (process.env.CI) assert.ok(verified, 'Use the real C++-patched current player in CI');
    let bundle = verified ? patched : original;
    // Local machines without a native compiler exercise the same live mount
    // change; CI additionally verifies the exact C++ output and all untouched bytes.
    if (!verified) bundle = bundle.replace(/(null!==[\w$]+\.state\.volume)&&[\w$]+(\?[\w$]+\.createElement\([\w$]+,\{muted:[\w$]+\.state\.muted,volume:[\w$]+\.state\.volume\}\):null)/, '$1$2');
    if (process.env.STREMIO_VOLUME_TEST_ORIGINAL_GATE) bundle = original;
    const mount = bundle.match(/null!==[\w$]+\.state\.volume(?:&&[\w$]+)?\?[\w$]+\.createElement\([\w$]+,\{muted:[\w$]+\.state\.muted,volume:[\w$]+\.state\.volume\}\):null/)[0];
    const effect = bundle.match(/\.useLayoutEffect\((function\(\)\{var e=function\(e\)\{switch\(e\.code\|\|e\.key\)[\s\S]*?window\.removeEventListener\("wheel",[\w$]+\)\}\}),\[/)[1];
    const callback = bundle.match(/\.useCallback\((function\(([\w$]+)\)\{([\w$]+)\.setProp\("volume",Math\.min\(\2,Number\(([\w$]+)\.maxVolume\)\)\)\}),\[[^\]]*\]\)/)[1];
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 720}});
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('https://stremio.zarg.me/**', route => route.fulfill({contentType: 'text/html', body: `<html><head><style>${css}</style><style>html,body,#app{margin:0;width:100%;height:100%}#frame{position:absolute;inset:0;background:linear-gradient(135deg,#24445d,#405737)}#subtitle{position:absolute;bottom:160px;left:35%;color:white}#top{height:70px;display:flex;gap:20px}#bottom{height:100px;display:flex;align-items:center;gap:20px}#toolbar-volume{width:180px;height:50px}#editor{width:150px}#menu{position:absolute;right:100px;bottom:150px;width:200px;height:200px;background:#303344}#menu>div{height:60px}#range{width:160px}</style></head><body><div id="app"></div></body></html>`}));
        await page.addInitScript(() => {
            window.messages = []; window.handlers = []; window.__stremioForkDarkTheme = true;
            localStorage.setItem('localProfile', JSON.stringify({maxVolume: '225'}));
            localStorage.setItem('stremio-fork-control-animation-duration', '0');
            localStorage.setItem('stremio-fork-control-timeout', '1');
            window.native = (name, data) => window.handlers.forEach(fn => fn({data: {args: [name, data]}}));
            window.chrome = {webview: {addEventListener: (_, fn) => window.handlers.push(fn), postMessage: text => {
                const message = JSON.parse(text); window.messages.push(message);
                if (message.args[0] === 'cycle-display-mode') window.native('display-mode-changed', {mode: 'crop', active: true});
                if (message.args[0] === 'get-theme') queueMicrotask(() => window.native('theme-changed', {dark: true}));
            }}};
        });
        await page.goto('https://stremio.zarg.me/#/player/test');
        if (clock) await page.clock.install();
        const anchor = '(()=>{var e;o.g.importScripts'; assert.ok(bundle.includes(anchor));
        await page.addScriptTag({content: bundle.replace(anchor, 'window.req=o;window.modules=a;return;' + anchor)});
        await page.evaluate(({mount, effect, callback}) => {
            const req = window.req, React = req(30758), ReactDOM = req(99576), h = React.createElement;
            const load = (factory, overrides = {}) => {const m = {exports: {}}; factory(m, m.exports, Object.assign(id => Object.hasOwn(overrides, id) ? overrides[id] : req(id), req)); return m.exports;};
            const find = term => Object.values(window.modules).find(fn => fn.toString().includes(term));
            const sliderFactory = Object.values(window.modules).find(fn => fn.toString().includes('active-slider-within') && fn.toString().includes('getBoundingClientRect'));
            const Slider = load(sliderFactory, {75394: {useRouteFocused: () => true}, 31187: {useServices: () => ({shell: {active: false}})}});
            const preferences = {maxVolume: '225'};
            const VolumeSlider = load(find('displayName="VolumeSlider"') || window.modules[60941], {75394: {useRouteFocused: () => true}, 84902: {Slider}, 60350: {useStorage: () => [preferences]}});
            const Indicator = load(find('displayName="VolumeChangeIndicator"'), {27708: VolumeSlider});
            const Button = req(4723).default, Icon = req(4672).default, player = req(39031);
            const toolbar = load(find('"seek-bar":"seek-bar-'));
            const runtime = {state: {volume: 100, muted: false, paused: false, time: 20000, subtitlesTracks: [], extraSubtitlesTracks: [], audioTracks: []}, setProp: (name, value) => {
                window.volumeCommands.push([name, value]); window.setVolume(value);
            }};
            window.volumeCommands = []; window.seeks = []; window.buttonClicks = 0;
            const scope = {Oe: runtime, le: preferences, l: React, G: Indicator, de: true, lt: false, at: false, At: false,
                Te: {seekTimeDuration: 10000, seekShortTimeDuration: 1000, escExitFullscreen: true},
                te: {metaItem: null}, Ae: {statistics: null}, De: () => {}, kt: value => window.seeks.push(value),
                It: () => {}, vt: () => window.setPaused(false), Wt: () => window.setPaused(true),
                J: {active: true, send: (name, args) => window.messages.push({args: [name, args]})}};
            scope.bt = new Function('scope', 'with(scope){return (' + callback + ');}') (scope);
            const mountIndicator = new Function('scope', 'with(scope){return (' + mount + ');}') ;
            function App() {
                const [volume, setVolume] = React.useState(100), [paused, setPaused] = React.useState(false);
                const [hidden, setHidden] = React.useState(false), [menu, setMenu] = React.useState(false), [maximum, setMaximum] = React.useState(225);
                Object.assign(runtime.state, {volume, paused}); Object.assign(scope, {lt: menu, At: hidden});
                window.setVolume = value => {runtime.state.volume = value; setVolume(value); window.native('mpv-prop-change', {name: 'volume', data: value});};
                window.setPaused = value => {setPaused(value); window.native('mpv-prop-change', {name: 'pause', data: value});};
                window.setUpstreamHidden = setHidden; window.setMenu = setMenu;
                window.setMaximum = value => {preferences.maxVolume = String(value); setMaximum(value); window.dispatchEvent(new CustomEvent('stremio-fork-volume-limit', {detail: value}));};
                window.snapshot = () => ({volume: runtime.state.volume, paused, hidden, menu, maximum});
                React.useLayoutEffect(() => new Function('scope', 'with(scope){return (' + effect + ')();}')(scope), [volume, paused, menu, maximum]);
                const button = (id, label) => h(Button, {id, onClick: () => window.buttonClicks++, style: {width: 80, height: 50}}, label);
                return h('div', {id: 'player', className: player['player-container'] + (hidden ? ' ' + player.overlayHidden : ''), onMouseMove: () => setHidden(false)},
                    h('div', {id: 'frame'}), h('div', {id: 'subtitle'}, 'Subtitles stay visible'),
                    mountIndicator(scope),
                    h('div', {id: 'top', className: player.layer + ' ' + player['nav-bar-layer']}, button('back', 'Back'), button('fullscreen', 'Fullscreen')),
                    h('div', {id: 'bottom', className: player.layer + ' ' + player['control-bar-layer']}, button('pause', 'Pause'),
                        h(VolumeSlider, {className: toolbar['volume-slider'], volume, onVolumeChangeRequested: scope.bt}),
                        h('div', {className: toolbar['control-bar-buttons-menu-container']}, button('options', 'Options'))),
                    menu ? h('div', {id: 'menu', role: 'menu', className: player['menu-layer']}, button('menu-one', 'First'), button('menu-two', 'Second'),
                        h('input', {id: 'editor', onKeyDown: event => event.stopPropagation()}),
                        h('input', {id: 'range', type: 'range', defaultValue: 50, onKeyDown: event => event.stopPropagation()}),
                        h('select', {id: 'selection', onKeyDown: event => event.stopPropagation()}, h('option', null, 'One'), h('option', null, 'Two'))) : null);
            }
            ReactDOM.createRoot(document.getElementById('app')).render(h(App));
            // The actual community spatial-navigation polyfill installs at load.
            req(30627); window.dispatchEvent(new Event('load'));
        }, {mount, effect, callback});
        await page.locator('#pause').waitFor();
        await page.locator('#bottom [class*="volume-slider"]').evaluate(el => el.id = 'toolbar-volume');
        await page.addScriptTag({content: shortcuts});
        await page.addScriptTag({content: fork});
        await page.evaluate(() => window.native('display-mode-changed', {mode: 'fit', active: true}));
        if (clock) {await page.clock.runFor(32); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));}
        else await page.waitForFunction(() => document.getElementById('player').hasAttribute('data-stremio-controls'));
        const tick = async milliseconds => clock ? page.clock.runFor(milliseconds) : page.waitForTimeout(milliseconds);
        return {browser, page, errors, tick, popup: page.locator('[class*="volume-change-indicator"]')};
    } catch (error) {await browser.close(); throw error;}
}

test('Real player Up/Down changes volume exactly once without spatial focus movement, including repeats, caps and paused playback', async () => {
    const {browser, page, errors} = await setup();
    try {
        assert.equal(await page.locator('[class*="volume-change-indicator"]').count(), 0, 'No initial popup');
        for (const paused of [false, true]) {
            await page.evaluate(paused => {window.setPaused(paused); document.activeElement.blur(); window.volumeCommands.length = 0;}, paused);
            await page.keyboard.press('ArrowUp');
            assert.deepEqual(await page.evaluate(() => window.volumeCommands), [['volume', paused ? 110 : 105]]);
            assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'Volume cannot focus a newly revealed toolbar button');
        }
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => window.snapshot().volume), 105);
        await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowUp'); await page.keyboard.up('ArrowUp');
        assert.equal(await page.evaluate(() => window.snapshot().volume), 115, 'Held-key repeats retain 5% steps');
        for (const maximum of [225, 75, 175]) {
            await page.evaluate(maximum => {window.setMaximum(maximum); window.setVolume(maximum - 2);}, maximum);
            await page.keyboard.press('ArrowUp');
            assert.equal(await page.evaluate(() => window.snapshot().volume), maximum);
            await page.evaluate(() => window.setVolume(2)); await page.keyboard.press('ArrowDown');
            assert.equal(await page.evaluate(() => window.snapshot().volume), 0);
        }
        await page.evaluate(() => {window.setPaused(false); document.activeElement.blur();});
        await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
        assert.deepEqual(await page.evaluate(() => window.seeks), [10000, 30000], 'Existing seek keys are unchanged');
        await page.keyboard.press('Control+b'); await page.keyboard.press('Control+Shift+f'); await page.keyboard.press('Control+Shift+c');
        for (const name of ['toggle-border-blur', 'cycle-display-mode', 'detect-encoded-bars'])
            assert.equal(await page.evaluate(name => window.messages.filter(message => message.args[0] === name).length, name), 1);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('The real volume popup survives visible controls, pause, mouse movement and Never hide, then uses its own 1500ms timer', async () => {
    const {browser, page, errors, tick, popup} = await setup(true);
    try {
        assert.equal(await popup.count(), 0);
        for (const paused of [false, true]) for (const hidden of [false, true]) {
            await page.evaluate(({paused, hidden}) => {window.setPaused(paused); window.setUpstreamHidden(hidden);}, {paused, hidden});
            await tick(32); await page.keyboard.press('ArrowUp'); await tick(32);
            assert.equal(await popup.count(), 1, `Popup appears with paused=${paused}, upstream hidden=${hidden}`);
            await page.mouse.move(paused ? 630 : 620, hidden ? 330 : 320); await tick(32);
            assert.equal(await popup.count(), 1, 'Showing toolbar/moving mouse does not unmount feedback');
            await tick(1350); assert.equal(await popup.count(), 1);
            await tick(200); assert.equal(await popup.count(), 0, 'Popup expires independently of control timeout');
        }
        await page.evaluate(() => {
            localStorage.setItem('stremio-fork-control-timeout', 'never');
            window.dispatchEvent(new StorageEvent('storage', {key: 'stremio-fork-control-timeout'}));
        });
        await page.keyboard.press('ArrowDown'); await tick(900); await page.keyboard.press('ArrowDown'); await tick(900);
        assert.equal(await popup.count(), 1, 'A second real volume change restarts the popup timer');
        await tick(650); assert.equal(await popup.count(), 0);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'), 'visible', 'Never hide still keeps the toolbar visible');
        assert.ok(await page.locator('#subtitle').isVisible());
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Menus, editors and native range controls keep keyboard navigation; toolbar buttons still support Tab and Enter', async () => {
    const {browser, page, errors} = await setup();
    try {
        await page.evaluate(() => window.setMenu(true));
        await page.locator('#menu-one').focus(); await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-two', 'Actual spatial navigation remains enabled in menus');
        assert.equal(await page.evaluate(() => window.snapshot().volume), 100);
        await page.locator('#editor').fill('Subtitle search'); await page.keyboard.press('ArrowUp');
        assert.equal(await page.locator('#editor').inputValue(), 'Subtitle search');
        await page.locator('#range').focus(); await page.keyboard.press('ArrowUp');
        assert.equal(await page.locator('#range').inputValue(), '51', 'Native range keeps its default arrow action');
        await page.locator('#selection').focus(); await page.keyboard.press('ArrowDown');
        assert.equal(await page.locator('#selection').inputValue(), 'Two');
        assert.equal(await page.evaluate(() => window.volumeCommands.length), 0, 'Menu interaction cannot leak volume commands');
        await page.evaluate(() => window.setMenu(false));
        await page.locator('#pause').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.buttonClicks), 1);
        await page.keyboard.press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement.id), 'pause');
        await page.evaluate(() => window.native('display-mode-changed', {mode: 'fit', active: false}));
        await page.evaluate(() => {const input = document.createElement('input'); input.id = 'outside'; document.body.append(input); input.focus(); window.outsidePrevented = null; input.addEventListener('keydown', event => {window.outsidePrevented = event.defaultPrevented; event.stopPropagation();});});
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.evaluate(() => window.outsidePrevented), false, 'No shortcut interception outside native playback');
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Toolbar dragging and boosted maximum changes stay synchronized with the real popup and both themes', async () => {
    const {browser, page, errors, popup} = await setup();
    try {
        await page.locator('#toolbar-volume').hover();
        const bounds = await page.locator('#toolbar-volume').boundingBox();
        await page.mouse.click(bounds.x + bounds.width * .8, bounds.y + bounds.height / 2);
        assert.ok(Math.abs(await page.evaluate(() => window.snapshot().volume) - 180) < 2);
        await popup.waitFor();
        await page.evaluate(() => window.setMaximum(300));
        await page.waitForFunction(() => document.querySelectorAll('[class*="volume-slider"] [class*="track-after"]').length === 2 &&
            Array.from(document.querySelectorAll('[class*="volume-slider"] [class*="track-after"]')).every(el => el.style.backgroundImage.includes('33.3333')));
        const colors = dark => page.evaluate(dark => {window.native('theme-changed', {dark}); window.setVolume(dark ? 185 : 190);}, dark);
        for (const dark of [true, false]) {
            await colors(dark); await popup.waitFor();
            assert.equal(await popup.evaluate(el => getComputedStyle(el).backgroundColor), dark ? 'rgba(34, 38, 53, 0.1)' : 'rgba(255, 255, 255, 0.05)');
            assert.equal(await popup.locator('[class*="volume-icon"]').evaluate(el => getComputedStyle(el).color), dark ? 'rgb(133, 139, 153)' : 'rgba(255, 255, 255, 0.9)');
        }
        await page.mouse.move(640, 360); await page.locator('#toolbar-volume').hover();
        await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height / 2); await page.mouse.down();
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'), 'visible', 'Do not hide a dragged slider');
        await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2); await page.mouse.up();
        assert.ok(Math.abs(await page.evaluate(() => window.snapshot().volume) - 300) < 2);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});
