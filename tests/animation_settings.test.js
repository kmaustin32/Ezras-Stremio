const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const source = fs.readFileSync('src/webview/fork-player.js', 'utf8');
const key = 'stremio-fork-control-animation-duration';
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
let assets;
async function setup(saved, savedTimeout, useClock = false) {
    if (!assets) assets = (async () => {
        const home = await fetch('https://stremio.zarg.me/'); assert.ok(home.ok);
        const url = (await home.text()).match(/href="([^"\s]+\/styles\/main\.css)"/)[1];
        const response = await fetch(new URL(url, 'https://stremio.zarg.me/')); assert.ok(response.ok);
        return response.text();
    })();
    const css = await assets;
    const settingsCss = css.slice(css.indexOf('.settings-container-'));
    const setting = name => {const match = settingsCss.match(new RegExp(`\\.(${name}-[\\w-]+)`)); assert.ok(match, name); return match[1];};
    const label = settingsCss.match(/\.option-name-container-[\w-]+ \.(label-[\w-]+)/)[1];
    const playerCss = css.slice(css.indexOf('.player-container-'));
    const playerClass = name => {const match = playerCss.match(new RegExp(`\\.(${name}-[\\w-]+)`)); assert.ok(match, name); return match[1];};
    const row = text => `<div class="${setting('option-container')}" data-native-row><div class="${setting('option-name-container')}"><div class="${label}">${text}</div></div><div class="${setting('option-input-container')}"><button>Default</button></div></div>`;
    const settings = `<div id="settings" class="${setting('settings-container')}"><div class="${setting('settings-content')}"><div class="${setting('side-menu-container')}"><button data-section="general">General</button><button data-section="player">Player</button></div><div class="${setting('sections-container')}"><div id="general" class="${setting('section-container')}"><div class="${setting('section-title')}">General</div>${row('Interface language')}</div><div id="player-section" class="${setting('section-container')}"><div class="${setting('section-title')}">Player</div><div class="${setting('section-category-container')}"><div class="${label}">Subtitles</div></div>${row('Subtitle language')}</div></div></div></div>`;
    const player = `<div id="player" class="${playerClass('player-container')}" style="display:none"><div id="frame" class="${playerClass('layer')}">Video</div><div id="top" class="${playerClass('layer')} ${playerClass('nav-bar-layer')}" style="height:72px">Title</div><div id="bottom" class="${playerClass('layer')} ${playerClass('control-bar-layer')}" style="height:100px">Progress and controls</div></div>`;
    const html = `<html><head><style>${css}</style><style>html,body{margin:0;width:100%;height:100%;color:white;background:#191727}#frame{background:linear-gradient(135deg,#286779,#43335d)}button{font:inherit}</style></head><body>${settings}${player}</body></html>`;
    const browser = await chromium.launch({executablePath, headless: true});
    const context = await browser.newContext({viewport: {width: 1280, height: 800}});
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.route('https://stremio.zarg.me/**', route => route.fulfill({body: html, contentType: 'text/html'}));
    await page.goto('https://stremio.zarg.me/#/settings');
    if (useClock) await page.clock.install();
    await page.evaluate(({key, saved, savedTimeout}) => {
        localStorage.setItem('localProfile', '{"maxVolume":"200","unchanged":"keep"}');
        localStorage.setItem('profile', '{"test":"untouched"}');
        if (saved !== undefined) localStorage.setItem(key, saved);
        if (savedTimeout !== undefined) localStorage.setItem('stremio-fork-control-timeout', savedTimeout);
    }, {key, saved, savedTimeout});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const boot = async () => {
        await page.evaluate(() => {
            window.messages = []; window.handlers = [];
            window.chrome = {webview: {postMessage: text => window.messages.push(JSON.parse(text)), addEventListener: (_, handler) => window.handlers.push(handler)}};
            window.native = (event, value) => window.handlers.forEach(handler => handler({data: JSON.stringify({args: [event, value]})}));
        });
        await page.addScriptTag({content: source});
        await page.getByLabel('Control animation speed', {exact: true}).waitFor();
    };
    await boot();
    const select = page.getByLabel('Control animation speed', {exact: true});
    const show = playing => page.evaluate(playing => {
        document.getElementById('settings').style.display = playing ? 'none' : '';
        document.getElementById('player').style.display = playing ? '' : 'none';
    }, playing);
    const overlay = (hidden, capture = false) => page.locator('#player').evaluate((el, {hidden, capture, name}) => {
        el.classList.toggle(name, hidden);
        if (!capture) return;
        // Trigger and inspect in one browser task; a busy runner can otherwise
        // finish the 250ms transition between separate automation calls.
        const slide = document.getElementById('top').getAnimations().find(animation => animation.transitionProperty === 'transform');
        slide?.pause();
        return slide ? slide.effect.getTiming().duration : null;
    }, {hidden, capture, name: playerClass('overlayHidden')});
    const settled = () => page.waitForFunction(() => ['top', 'bottom'].every(id => {
        const el = document.getElementById(id), style = getComputedStyle(el);
        return style.visibility === 'visible' && Math.abs(new DOMMatrixReadOnly(style.transform).m42) < 0.1 && !el.getAnimations().length;
    }));
    return {browser, page, select, boot, show, overlay, settled, errors};
}

test('Player animation setting offers every requested speed, changes real transitions, and survives reload without changing other preferences', async () => {
    const {browser, page, select, boot, show, overlay, settled, errors} = await setup();
    try {
        assert.equal(await select.inputValue(), '0.5');
        assert.deepEqual(await select.locator('option').allTextContents(), ['Off', '0.1', '0.25', '0.5 (default)', '0.75', '1']);
        assert.equal(await select.locator('xpath=ancestor::*[@id="player-section"]').count(), 1);
        for (const value of ['0', '0.1', '0.25', '0.5', '0.75', '1']) {
            await select.selectOption(value);
            assert.equal(await page.evaluate(key => localStorage.getItem(key), key), value);
            await show(true); await settled();
            const animation = await overlay(true, true);
            assert.equal(animation, value === '0' ? null : Number(value) * 1000);
            await page.evaluate(() => ['top', 'bottom'].forEach(id => document.getElementById(id).getAnimations().forEach(animation => animation.finish())));
            await page.locator('#bottom').waitFor({state: 'hidden'});
            await overlay(false); await settled(); await show(false);
        }
        await select.selectOption('0.75');
        await page.reload(); await boot();
        assert.equal(await select.inputValue(), '0.75');
        await page.evaluate(() => window.native('display-mode-changed', {mode: 'fit', active: true}));
        await show(true); await settled();
        await page.evaluate(() => {
            window.pausedSlideDuration = null;
            const player = document.getElementById('player');
            const observer = new MutationObserver(() => {
                if (player.getAttribute('data-stremio-controls') !== 'hidden') return;
                const slide = document.getElementById('top').getAnimations().find(animation => animation.transitionProperty === 'transform');
                slide?.pause();
                window.pausedSlideDuration = slide?.effect.getTiming().duration;
                observer.disconnect();
            });
            observer.observe(player, {attributes:true, attributeFilter:['data-stremio-controls']});
            window.native('mpv-prop-change', {name: 'pause', data: true});
        });
        await page.waitForFunction(() => window.pausedSlideDuration != null);
        assert.equal(await page.evaluate(() => window.pausedSlideDuration), 750);
        assert.deepEqual(await page.evaluate(() => [localStorage.getItem('localProfile'), localStorage.getItem('profile')]), ['{"maxVolume":"200","unchanged":"keep"}', '{"test":"untouched"}']);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Animation setting follows the localized Player section, survives UI recreation, supports keyboard use and fits narrow windows', async () => {
    const {browser, page, select, errors} = await setup();
    try {
        const original = await page.locator('[data-native-row]').evaluateAll(rows => rows.map(row => row.outerHTML));
        await page.evaluate(() => {
            document.querySelector('[data-section="player"]').textContent = 'Reproductor';
            document.querySelector('#player-section > [class*="section-title"]').textContent = 'Reproductor';
            document.getElementById('stremio-fork-animation-setting').remove();
        });
        await select.waitFor();
        await select.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
        await page.waitForFunction(() => document.getElementById('stremio-fork-animation-duration').value === '0.1');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '0.1');
        await page.addScriptTag({content: source});
        assert.equal(await page.locator('#stremio-fork-animation-setting').count(), 1);
        assert.deepEqual(await page.locator('[data-native-row]').evaluateAll(rows => rows.map(row => row.outerHTML)), original);
        fs.mkdirSync('.build-cache/ui-test-evidence', {recursive: true});
        for (const width of [1280, 800, 600, 360]) {
            await page.setViewportSize({width, height: 800});
            await select.scrollIntoViewIfNeeded();
            const bounds = await select.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Selector fits at ${width}px`);
            assert.ok(await page.locator('#stremio-fork-animation-help').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            await page.screenshot({path: `.build-cache/ui-test-evidence/animation-setting-${width}.png`});
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('Invalid or unavailable storage falls back safely; Off cancels a running slide through a real cross-window preference update', async () => {
    const {browser, page, select, show, overlay, settled, errors} = await setup('invalid');
    try {
        assert.equal(await select.inputValue(), '0.5');
        await select.selectOption('1'); await show(true); await settled(); await overlay(true);
        await page.locator('#top').evaluate(el => el.getAnimations().forEach(animation => {animation.pause(); animation.currentTime = 250;}));
        const other = await page.context().newPage();
        await other.route('https://stremio.zarg.me/**', route => route.fulfill({body: '<html></html>', contentType: 'text/html'}));
        await other.goto('https://stremio.zarg.me/#/preference-test');
        await other.evaluate(key => localStorage.setItem(key, '0'), key);
        await page.waitForFunction(() => document.getElementById('stremio-fork-animation-duration').value === '0');
        assert.equal(await page.locator('#top').evaluate(el => el.getAnimations().length), 0);
        assert.equal(await page.locator('#top').isVisible(), false);
        await overlay(false); await settled();
        assert.equal(await page.locator('#top').evaluate(el => el.getAnimations().length), 0);
        await other.evaluate(() => localStorage.clear());
        await page.waitForFunction(() => document.getElementById('stremio-fork-animation-duration').value === '0.5');
        await show(false);
        await page.evaluate(key => {
            const write = Storage.prototype.setItem;
            Storage.prototype.setItem = function(name, value) {if (name === key) throw new DOMException('Unavailable', 'QuotaExceededError'); return write.call(this, name, value);};
        }, key);
        await select.selectOption('0.25');
        await page.waitForFunction(() => document.querySelector('#stremio-fork-animation-setting [role="status"]').textContent.includes('Applied for this session'));
        assert.equal(await select.inputValue(), '0.25');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});


test('Control timeout honors every choice during playing and paused playback after mouse and keyboard activity', async () => {
    const {browser,page,select,show,overlay,errors}=await setup(undefined,undefined,true);
    const timeout=page.getByLabel('Control player timeout',{exact:true});
    try {
        assert.equal(await timeout.inputValue(),'1');
        assert.deepEqual(await timeout.locator('option').allTextContents(),['0.5','1 (default)','2','5','Never hide']);
        assert.ok(await timeout.evaluate(el=>Boolean(document.getElementById('stremio-fork-animation-duration').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)));
        await select.selectOption('0');
        await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
        for (const paused of [false,true]) for (const value of ['0.5','1','2','5']) {
            await timeout.selectOption(value);
            await show(true);
            await page.evaluate(paused=>{window.native('display-mode-changed',{mode:'fit',active:true});window.native('mpv-prop-change',{name:'pause',data:paused});},paused);
            await page.clock.runFor(32);
            await overlay(true);
            await page.clock.runFor(Number(value)*1000-60);
            assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'visible',`Does not hide early for ${value}s`);
            await page.clock.runFor(80);
            assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'hidden',`Hides at ${value}s`);
            await page.mouse.move(300,300);
            assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'visible','Mouse motion resets the timeout');
            await page.clock.runFor(Number(value)*1000+32);
            assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'hidden','Mouse inactivity uses the selected delay');
            await page.evaluate(()=>document.activeElement.blur());
            await page.keyboard.press('k');
            assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'visible','Keyboard activity restarts the same delay');
            await page.clock.runFor(Number(value)*1000-40);
            assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'visible');
            await page.clock.runFor(80);
            assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'hidden');
            for (const type of ['wheel','pointermove']) {
                await page.locator('#player').evaluate((el,type)=>el.dispatchEvent(type==='wheel'?new WheelEvent(type,{bubbles:true}):new PointerEvent(type,{pointerType:'touch',bubbles:true})),type);
                assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'visible',type+' wakes controls');
                await page.clock.runFor(Number(value)*1000+32);
                assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'hidden',type+' follows the selected timeout');
            }
            await page.evaluate(()=>window.native('display-mode-changed',{mode:'fit',active:false}));
            await page.clock.runFor(32); await overlay(false); await show(false);
        }
        await timeout.selectOption('never'); await show(true);
        await page.evaluate(()=>{window.native('display-mode-changed',{mode:'fit',active:true});window.native('mpv-prop-change',{name:'pause',data:true});});
        await page.clock.runFor(60000);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'visible');
        await page.evaluate(()=>window.native('mpv-prop-change',{name:'pause',data:false}));
        await page.clock.runFor(32);
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'visible','Never hide also applies while playing');
        await overlay(true); await page.mouse.move(1,1); await page.clock.runFor(60000);
        assert.equal(await page.locator('#bottom').isVisible(),true,'Upstream hide and mouse leave cannot override Never hide');
        assert.equal(await page.locator('#bottom').evaluate(el=>getComputedStyle(el).pointerEvents),'auto');
        assert.equal(await page.locator('#player').evaluate(el=>getComputedStyle(el).cursor),'auto');
        assert.deepEqual(await page.evaluate(()=>window.messages.filter(m=>m.args[0]==='mpv-command')),[]);
        assert.deepEqual(errors,[]);
    } finally {await browser.close();}
});

test('Control timeout persists through reload, synchronizes another window, falls back safely and reports unavailable storage',async()=>{
    const {browser,page,boot,show,errors}=await setup(undefined,'invalid');
    const timeout=page.getByLabel('Control player timeout',{exact:true});
    const timeoutKey='stremio-fork-control-timeout';
    try {
        assert.equal(await timeout.inputValue(),'1');
        await timeout.selectOption('2');
        await page.reload();await boot();
        assert.equal(await timeout.inputValue(),'2');
        assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('localProfile'),localStorage.getItem('profile')]),['{"maxVolume":"200","unchanged":"keep"}','{"test":"untouched"}']);
        await show(true);
        await page.evaluate(()=>{window.native('display-mode-changed',{mode:'fit',active:true});window.native('mpv-prop-change',{name:'pause',data:true});});
        await page.waitForFunction(()=>document.getElementById('player').getAttribute('data-stremio-controls')==='hidden');
        const other=await page.context().newPage();
        await other.route('https://stremio.zarg.me/**',route=>route.fulfill({body:'<html></html>',contentType:'text/html'}));
        await other.goto('https://stremio.zarg.me/#/timeout-preference-test');
        await other.evaluate(key=>localStorage.setItem(key,'never'),timeoutKey);
        await page.waitForFunction(()=>document.getElementById('stremio-fork-control-timeout').value==='never');
        assert.equal(await page.locator('#player').getAttribute('data-stremio-controls'),'visible','Never hide reveals an already hidden paused toolbar');
        await other.evaluate(key=>localStorage.removeItem(key),timeoutKey);
        await page.waitForFunction(()=>document.getElementById('stremio-fork-control-timeout').value==='1');
        await other.close();
        await page.evaluate(()=>window.native('display-mode-changed',{mode:'fit',active:false}));
        await show(false);
        await page.evaluate(key=>{
            const write=Storage.prototype.setItem;
            Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('Unavailable','QuotaExceededError');return write.call(this,name,value);};
        },timeoutKey);
        await timeout.selectOption('5');
        await page.waitForFunction(()=>document.getElementById('stremio-fork-timeout-status').textContent.includes('Applied for this session'));
        assert.equal(await timeout.inputValue(),'5');
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});
