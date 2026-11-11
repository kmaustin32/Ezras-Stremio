const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const model = require('../src/webview/account-model.js');

const backup = {format: 'ezras-stremio-backup', version: 1, auth: {key: 'must-never-sync'},
    libraryItems: [{_id: 'tt1', name: 'Saved Film', type: 'movie', state: {timeOffset: 91000, duration: 120000}},
        {_id: 'tt2', name: 'Removed Film', type: 'movie', removed: true}],
    addons: [{manifest: {name: 'My source'}, transportUrl: 'https://sources.invalid/config/manifest.json'}],
    customLists: {lists: [{id: 'favorites', name: 'Favorites', items: ['tt1']}]}};

test('Local snapshots retain selected account data and source identities, while excluding login credentials', async () => {
    const data = await model.snapshot(backup);
    assert.equal(data['title/movie/tt1'].name, 'Saved Film');
    assert.equal(data['title/movie/tt2'], null);
    assert.equal(data['progress/movie/tt1/tt1'].seconds, 91);
    assert.deepEqual(data['list/favorites'].items, ['tt1']);
    assert.equal(data['addon/' + await model.digest(backup.addons[0].transportUrl)].name, 'My source');
    assert.doesNotMatch(JSON.stringify(data), /must-never-sync/);
    assert.equal(model.endpoint('https://sources.invalid/config/manifest.json?key=private', 'catalog', 'movie', 'top', 'A & B'),
        'https://sources.invalid/config/catalog/movie/top/search=A%20%26%20B.json?key=private');
    assert.equal(model.manifestUrl('https://name:key@sources.invalid/manifest.json'), '');
    assert.equal(model.canSearch({id: 'film', type: 'movie', extra: [{name: 'search'}, {name: 'genre', isRequired: true}]}), false);
});

test('Bundled search and profile settings work without Stremio, using an independent catalog and a selected folder', async t => {
    const executablePath = [process.env.STREMIO_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
    const browser = await chromium.launch({executablePath, headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const html = fs.readFileSync('src/webview/account.html', 'utf8');
    const script = ['account-model.js', 'account.js'].map(file => fs.readFileSync('src/webview/' + file, 'utf8')).join('\n');
    await page.route('https://ezras-stremio.invalid/**', route => route.fulfill(route.request().url().endsWith('/profile.js')
        ? {contentType: 'application/javascript', body: script} : {contentType: 'text/html', body: html}));
    await page.route('https://v3-cinemeta.strem.io/**', route => route.abort());
    await page.route('https://94c8cb9f702d-tmdb-addon.baby-beamup.club/**', route => route.fulfill({
        headers: {'Access-Control-Allow-Origin': '*'}, json: route.request().url().includes('/manifest.json')
            ? {catalogs: [{type: 'movie', id: 'searchable', extra: [{name: 'search'}]}]} : {metas: [{id: 'tt55', name: 'Independent Film'}]}
    }));
    const data = await model.snapshot(backup);
    await page.addInitScript(records => {
        const view = new EventTarget();
        const state = {enabled: false, connected: false, hasProfile: true, data: records};
        window.profileRequests = [];
        view.postMessage = message => {
            const request = JSON.parse(message.slice('ezra-account:'.length));
            window.profileRequests.push(request.action);
            if (request.action === 'connect') state.connected = true;
            if (request.action === 'enable') state.enabled = true;
            if (request.action === 'edit') Object.assign(state.data, request.data);
            const result = request.action === 'pick' ? {folder: 'G:\\My Drive\\Ezra'} : {...state};
            setTimeout(() => view.dispatchEvent(new MessageEvent('message', {data: {args: ['ezra-account-result', {id: request.id, ...result}]}})));
        };
        window.chrome.webview = view;
    }, data);
    await page.goto('https://ezras-stremio.invalid/');
    await page.getByRole('button', {name: /Saved Film/}).waitFor();
    await page.getByRole('searchbox').fill('Independent');
    await page.getByRole('button', {name: 'Search catalogs'}).click();
    await page.getByRole('button', {name: /Independent Film/}).click();
    await page.getByRole('button', {name: 'Save to Library'}).click();
    await page.getByRole('button', {name: 'Remove from Library'}).waitFor();
    await page.getByText('Profile and sync', {exact: true}).click();
    await page.getByRole('button', {name: 'Choose folder'}).click();
    await page.getByText(/My Drive/).waitFor();
    await page.getByLabel('Sync passphrase').fill('testing-only-passphrase');
    await page.getByRole('button', {name: 'Connect and sync'}).click();
    await page.getByText('Encrypted sync is connected.').waitFor();
    assert.deepEqual(errors, []);
});
