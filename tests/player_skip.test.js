const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');

const script = fs.readFileSync('src/webview/fork-player.js', 'utf8');
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
const route = '#/player/stream/stream-addon/meta-addon/series/tt0944947/tt0944947%3A1%3A1';
const body = `<html><style>
    html,body {height:100%;margin:0} .player-container-fixture {position:relative;height:100%;
        background:linear-gradient(135deg,#24445d,#4e1e35)}
    .control-bar-layer-fixture {position:absolute;bottom:0;left:0;right:0;height:7.5rem}
    .seek-bar-container-fixture {height:2.5rem}
    .menu-layer-fixture {position:absolute;bottom:8rem;right:4rem;width:22rem;height:13rem}
</style><body><div class="player-container-fixture">
    <div class="control-bar-layer-fixture"><div class="seek-bar-container-fixture"></div></div>
</div></body></html>`;

async function setup(t, {lookup = false, reducedMotion = 'no-preference'} = {}) {
    const browser = await chromium.launch({executablePath, headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1280, height: 720}, reducedMotion});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.route('https://stremio.zarg.me/**', request => request.fulfill({contentType: 'text/html', body}));
    await page.addInitScript(({lookup}) => {
        if (lookup) localStorage.setItem('stremio-fork-skip-lookup', 'true');
        localStorage.setItem('stremio-fork-control-animation-duration', '0');
        const handlers = [];
        window.messages = [];
        window.native = (name, value) => handlers.forEach(handler => handler({data: {args: [name, value]}}));
        window.chrome = {webview: {
            addEventListener: (_, handler) => handlers.push(handler),
            postMessage: message => window.messages.push(JSON.parse(message).args)
        }};
    }, {lookup});
    await page.goto('https://stremio.zarg.me/' + route);
    await page.addScriptTag({content: script});
    const native = (name, value) => page.evaluate(([name, value]) => window.native(name, value), [name, value]);
    const media = overrides => native('skip-media-changed', {serial: '1', seekable: true, duration: 120,
        'time-pos': 0, chapters: [], ...overrides});
    const time = data => native('mpv-prop-change', {name: 'time-pos', data});
    const prompt = page.locator('#stremio-fork-skip-segment');
    const seeks = () => page.evaluate(() => window.messages.filter(([name]) => name === 'seek-skip-segment'));
    const label = text => page.waitForFunction(text => document.getElementById('stremio-fork-skip-segment')?.textContent === text, text);
    const absent = () => prompt.waitFor({state: 'detached'});
    await native('display-mode-changed', {mode: 'fit', active: true});
    return {page, native, media, time, prompt, seeks, label, absent};
}

test('Embedded chapters show styled, click-to-seek prompts only inside the labeled interval', async t => {
    const {page, native, media, time, prompt, seeks, label, absent} = await setup(t);
    const chapters = [{title: 'Cold Open', time: 0}, {title: 'Opening Credits', time: 12},
        {title: 'Episode', time: 30}, {title: 'End Credits', time: 95}, {title: 'Post-Credits Scene', time: 110}];
    await media({chapters});
    await absent();
    await time(12);
    await label('Skip Intro');
    const setControls = value => page.locator('.player-container-fixture')
        .evaluate((element, value) => element.dataset.stremioControls = value, value);
    await setControls('hidden');
    assert.ok(await prompt.isVisible(), 'The prompt stays reachable while playing with the controls hidden');
    await native('mpv-prop-change', {name: 'pause', data: true});
    await page.waitForFunction(() => document.getElementById('stremio-fork-skip-segment')?.hasAttribute('data-paused'));
    await setControls('hidden');
    await prompt.waitFor({state: 'hidden'});
    await native('mpv-prop-change', {name: 'pause', data: false});
    await prompt.waitFor({state: 'visible'});
    await setControls('visible');
    const style = () => prompt.evaluate(button => {
        const css = getComputedStyle(button);
        return [css.color, css.borderColor, css.backgroundColor, css.animationDuration, css.boxShadow];
    });
    assert.deepEqual((await style()).slice(0, 4), ['rgb(133, 139, 153)', 'rgb(133, 139, 153)', 'rgba(22, 26, 38, 0.62)', '0.25s']);
    assert.notEqual((await style())[4], 'none');
    for (const width of [1280, 560]) {
        await page.setViewportSize({width, height: 720});
        const button = await prompt.boundingBox();
        const bar = await page.locator('.seek-bar-container-fixture').boundingBox();
        assert.ok(button.y + button.height < bar.y && button.x > width / 2 && button.x + button.width < width);
    }
    await native('theme-changed', {dark: false});
    assert.deepEqual((await style()).slice(0, 4), ['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgba(0, 0, 0, 0.48)', '0.25s']);
    assert.deepEqual(await seeks(), [], 'Prompts never seek automatically');
    await prompt.click();
    assert.deepEqual(await seeks(), [['seek-skip-segment', ['1', '12', '30']]]);
    await time(30);
    await absent();
    await time(96);
    await label('Skip Outro');
    await page.evaluate(() => {
        const popup = document.createElement('div');
        popup.className = 'menu-layer-fixture next-video-popup-container-fixture';
        document.querySelector('.player-container-fixture').append(popup);
    });
    await page.waitForFunction(() => {
        const button = document.getElementById('stremio-fork-skip-segment');
        const popup = document.querySelector('.next-video-popup-container-fixture');
        return button?.getBoundingClientRect().bottom < popup.getBoundingClientRect().top;
    });
    await prompt.focus();
    await prompt.press('Enter');
    assert.deepEqual((await seeks()).at(-1), ['seek-skip-segment', ['1', '95', '110']], 'Stops before the post-credits scene');
    await time(110);
    await absent();
    await media({serial: '2', chapters: chapters.slice(0, -1), 'time-pos': 96});
    await label('Skip Outro');
    await prompt.click();
    assert.deepEqual((await seeks()).at(-1), ['seek-skip-segment', ['2', '95', '120']]);
    await page.evaluate(() => {location.hash = '#/player/different-video';});
    await absent();
    await native('skip-media-changed', {serial: '3', seekable: false});
    await time(12);
    await absent();
});

test('Optional TheIntroDB lookup validates the episode and runtime, and fills missing chapter types', async t => {
    const {page, media, time, prompt, label, absent} = await setup(t, {lookup: true, reducedMotion: 'reduce'});
    const requests = [];
    await page.route('https://api.theintrodb.org/**', request => {
        requests.push(request.request());
        return request.fulfill({json: {
            type: 'tv', season: 1, episode: 1, group_duration_ms: 120000,
            intro: [{start_ms: null, end_ms: 10000}], credits: [{start_ms: 105000, end_ms: null}]
        }});
    });
    const firstResponse = page.waitForResponse('https://api.theintrodb.org/**');
    await media({chapters: [{title: 'OP 1', time: 12}, {title: 'Episode', time: 24}], 'time-pos': 5});
    await firstResponse;
    assert.equal(requests.length, 1);
    const query = new URL(requests[0].url()).searchParams;
    assert.deepEqual(Object.fromEntries(query), {imdb_id: 'tt0944947', duration_ms: '120000',
        details: 'true', merge_unknown: 'false', season: '1', episode: '1'});
    assert.equal(requests[0].headers().referer, undefined);
    await absent();
    await time(12);
    await label('Skip Intro');
    assert.equal(await prompt.evaluate(button => getComputedStyle(button).animationName), 'none');
    await time(105);
    await label('Skip Outro');
    const response = page.waitForResponse('https://api.theintrodb.org/**');
    await media({serial: '2', duration: 150, 'time-pos': 106});
    await response;
    await absent();
    await time(108);
    await absent();
});

test('Chapter-only playback sends no timestamp request and hides prompts for ambiguous metadata', async t => {
    const {page, media, time, absent} = await setup(t);
    const requests = [];
    await page.route('https://api.theintrodb.org/**', request => {requests.push(request.request().url()); return request.abort();});
    await media({chapters: [{title: 'Chapter 1', time: 0}, {title: 'Intro', time: 60}], 'time-pos': 65});
    await absent();
    await time(75);
    await absent();
    await media({chapters: [{title: 'Intro', time: 20}, {title: 'Episode', time: 10}], 'time-pos': 22});
    await absent();
    assert.deepEqual(requests, []);
});
