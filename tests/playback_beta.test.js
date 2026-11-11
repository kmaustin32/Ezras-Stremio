const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const {shaderMode, matchingTrack} = require('../src/webview/fork-playback');
const {readListBackup, zip} = require('../src/webview/fork-backup');
const {decodeLists, previewListImport} = require('../src/webview/fork-lists');

test('Every shipped shader binding is recognized and subtitle/audio aliases match across sources', () => {
    const input = fs.readFileSync('utils/mpv/anime4k/portable_config/input.conf', 'utf8');
    for (const [, key, files] of input.matchAll(/^CTRL\+([1-7]).*? set "([^"]+)"/gm)) assert.equal(shaderMode(files), key);
    assert.equal(shaderMode(['a.glsl']), 'custom');
    assert.equal(shaderMode([]), '8');
    assert.equal(matchingTrack([{type: 'audio', id: 7, lang: 'jpn'}], 'audio', 'ja'), 7);
    assert.equal(matchingTrack([{type: 'sub', id: 2, lang: 'eng-US'}], 'sub', 'en'), 2);
    assert.equal(matchingTrack([{type: 'audio', id: 7, lang: 'jpn'}], 'audio', 'en'), null);
});

test('A backup round trips local lists and preview preserves conflicting manual choices', async () => {
    const current = decodeLists({version: 1, lists: [{id: 'live-action', name: 'Live Action', items: ['tt10']},
        {id: 'weekend', name: 'Weekend', items: ['tt20']}]});
    const customLists = {version: 1, lists: [{id: 'anime', name: 'Anime', items: ['tt10', 'tt30']},
        {id: 'other-id', name: 'weekend', items: ['tt20', 'tt40']}, {id: 'favorites', name: 'Favorites', home: false, items: ['tt40']}]};
    const data = JSON.stringify({format: 'ezras-stremio-backup', version: 1, customLists});
    const buffer = await zip({'Backup.json': data}).arrayBuffer();
    assert.deepEqual(readListBackup(buffer), customLists);
    assert.deepEqual(readListBackup(new TextEncoder().encode(data).buffer), customLists);
    const preview = previewListImport(current, readListBackup(buffer));
    assert.deepEqual(preview.rows, [{name: 'Anime', action: 'Merge', added: 1}, {name: 'Weekend', action: 'Merge', added: 1},
        {name: 'Favorites', action: 'Add', added: 1}]);
    assert.deepEqual(preview.lists.find(list => list.id === 'anime').items, ['tt30']);
    assert.deepEqual(preview.lists.find(list => list.id === 'weekend').items, ['tt20', 'tt40']);
    assert.equal(preview.lists.find(list => list.id === 'favorites').home, false);
    assert.deepEqual(current.find(list => list.id === 'weekend').items, ['tt20'], 'Preview does not write');
    const damaged = new Uint8Array(buffer.slice(0)); damaged[45] ^= 1;
    assert.throws(() => readListBackup(damaged.buffer), /damaged/);
});

test('The panel shows the fork version, confirms shaders, saves series preferences and resumes only the chosen episode', async t => {
    const executablePath = [process.env.STREMIO_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
    const browser = await chromium.launch({executablePath, headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const html = `<div class="settings-container-fixture"><div id="versions"><div class="version-info-label-fixture">Shell Version: 5.0.22</div></div></div>
        <div id="player"><div class="control-bar-buttons-menu-container-fixture"></div></div>`;
    await page.route('https://stremio.zarg.me/**', route => route.fulfill({contentType: 'text/html', body: html}));
    await page.goto('https://stremio.zarg.me/#/player/old/provider/meta/series/tt100/tt100%3A1%3A2');
    await page.evaluate(() => {
        window.__stremioForkControls = true;
        window.sent = []; window.diagnostics = '';
        const transport = new EventTarget();
        transport.postMessage = message => window.sent.push(JSON.parse(message).args);
        window.chrome.webview = transport;
        window.native = (name, data) => transport.dispatchEvent(new MessageEvent('message', {data: {args: [name, data]}}));
        Object.defineProperty(navigator, 'clipboard', {value: {writeText: async data => {window.diagnostics = data;}}});
    });
    await page.addScriptTag({path: 'src/webview/fork-playback.js'});
    await page.evaluate(() => {
        window.__ezrasPlayback.update(document.getElementById('player'), true);
        window.native('fork-file-loaded', {serial: '1', tracks: [{id: 4, type: 'audio', lang: 'jpn', title: 'secret stream title'}]});
        for (const [name, data] of Object.entries({'time-pos': 93.5, seekable: true, 'current-vo': 'gpu-next'}))
            window.native('mpv-prop-change', {name, data});
    });
    assert.equal(await page.locator('#ezras-stremio-version').innerText(), "Ezra's Stremio 3.0.0-beta.1");
    assert.match(await page.locator('#versions').innerText(), /Shell Version/);
    await page.getByRole('button', {name: 'Picture', exact: true}).click();
    await page.getByLabel('Shaders', {exact: true}).selectOption('7');
    await page.getByText('Applying FSR…').waitFor();
    await page.evaluate(() => window.native('mpv-prop-change', {name: 'glsl-shaders', data: ['C:/private/path/FSR.glsl']}));
    await page.getByText('Current shaders: FSR').waitFor();
    await page.getByLabel('Series audio language').selectOption('ja');
    await page.getByLabel('Remember the current shader and framing for this series').check();
    await page.getByRole('button', {name: 'Save series preferences'}).click();
    await page.getByRole('button', {name: 'Copy playback diagnostics'}).click();
    await page.getByText('Playback diagnostics copied.').waitFor();
    const report = await page.evaluate(() => window.diagnostics);
    assert.match(report, /Shader confirmed by mpv/);
    assert.doesNotMatch(report, /private|secret|tt100|provider/);
    await page.getByRole('button', {name: 'Change source'}).click();
    await page.waitForURL('**/#/detail/series/tt100/tt100%3A1%3A2');
    await page.evaluate(() => { location.hash = '#/player/new/provider/meta/series/tt100/tt100%3A1%3A2'; });
    await page.waitForURL('**/#/player/new/provider/meta/series/tt100/tt100%3A1%3A2');
    await page.evaluate(() => window.native('fork-file-loaded', {serial: '2', tracks: [{id: 9, type: 'audio', lang: 'ja'}]}));
    const commands = await page.evaluate(() => window.sent);
    assert.deepEqual(commands.filter(([name]) => name === 'resume-fork-source'), [['resume-fork-source', ['2', '93']]]);
    assert.ok(commands.some(([name, args]) => name === 'set-fork-series-picture' && args.join() === '2,7,fit'));
    assert.ok(commands.some(([name, args]) => name === 'set-fork-series-track' && args.join() === '2,aid,9'));
});
