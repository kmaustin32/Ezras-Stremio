const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(path => path && fs.existsSync(path));
let assets;

async function setup() {
    assets ||= (async () => {
        const home = await fetch('https://stremio.zarg.me/'); assert.ok(home.ok);
        const html = await home.text();
        return Promise.all(['scripts/main.js', 'styles/main.css'].map(async suffix => {
            const path = html.match(new RegExp(`(?:src|href)="([^"\\s]+/${suffix.replace('.', '\\.')})"`))[1];
            const response = await fetch(new URL(path, 'https://stremio.zarg.me/')); assert.ok(response.ok); return response.text();
        }));
    })();
    const [original, css] = await assets;
    const nativePath = '.build-cache/player-autoplay/patched.js';
    const native = fs.existsSync(nativePath) ? fs.readFileSync(nativePath, 'utf8') : '';
    const verified = native.includes('__stremioForkLibraryDetailsPatched=true');
    if (process.env.CI) assert.ok(verified, 'CI uses the exact live bundle patched by C++');
    let bundle = verified ? native : original;
    if (!verified && !process.env.STREMIO_LIBRARY_TEST_ORIGINAL) {
        // Local fallback for machines without the native compiler. Release CI
        // independently checks the C++ patch, its guards, and untouched bytes.
        const card = /([\w$]+)\.createElement\(([\w$]+),([\w$]+)\(\{\},([\w$]+),\{notifications:([\w$]+),removable:"library"===([\w$]+),key:([\w$]+)\}\)\)/;
        const matches = [...bundle.matchAll(new RegExp(card.source, 'g'))]; assert.equal(matches.length, 1);
        bundle = bundle.replace(card, (text, react, component, assign, item, notifications, model) => {
            const links = `${item}.deepLinks`, video = `${links}.metaDetailsVideos`, streams = `${links}.metaDetailsStreams`;
            const href = `${links}&&"string"==typeof ${video}&&${video}.length>0?${video}:${links}&&"string"==typeof ${streams}&&${streams}.length>0?${streams}:null`;
            return text.slice(0, -2) + `,"library"===${model}&&${item}&&"series"===${item}.type?{href:${href}}:{}` + text.slice(-2);
        });
    }
    if (process.env.STREMIO_LIBRARY_TEST_ORIGINAL) bundle = original;
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 800}}), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://stremio.zarg.me/**', route => route.fulfill({contentType: 'text/html', body: `<html><head><style>${css}</style><style>body{margin:0;background:#222635;color:white}#app{height:100vh}.fixture-page{height:100vh;padding:30px}#details,#sources{padding:50px}#details [class*="video-container"]{width:400px}#sources [class*="stream-container"]{width:600px;min-height:100px}</style></head><body><div id="app"></div></body></html>`}));
        await page.addInitScript(() => {
            localStorage.setItem('localProfile', '{"maxVolume":"225","keep":"unchanged"}');
            localStorage.setItem('profile', '{"fixture":"account-storage-unchanged"}');
        });
        await page.goto('https://stremio.zarg.me/#/library/series');
        const anchor = '(()=>{var e;o.g.importScripts'; assert.ok(bundle.includes(anchor));
        await page.addScriptTag({content: bundle.replace(anchor, 'window.req=o;window.modules=a;return;' + anchor)});
        await page.evaluate(() => {
            const req = window.req, React = req(30758), ReactDOM = req(99576), h = React.createElement;
            const find = term => Object.values(window.modules).find(fn => fn.toString().includes(term));
            const load = (factory, overrides = {}) => {const module = {exports: {}}; factory(module, module.exports, Object.assign(id => Object.hasOwn(overrides, id) ? overrides[id] : req(id), req)); return module.exports;};
            const translation = {useTranslation: () => ({t: key => key})};
            const core = {transport: {dispatch: (...args) => window.dispatches.push(args)}};
            window.dispatches = []; window.playRequests = []; window.morePages = 0;
            const MetaItem = load(find('displayName="MetaItem"'), {73582: translation});
            const LibItem = load(Object.values(window.modules).find(fn => fn.toString().includes('LIBRARY_PLAY') && fn.toString().includes('LibraryItemMarkAsWatched')),
                {31187: {useServices: () => ({core})}, 63298: MetaItem, 32462: {t: key => key}});
            const components = req(84902), hooks = req(60350);
            const Video = load(Object.values(window.modules).find(fn => fn.toString().includes('seasonWatched') && fn.toString().includes('video-container')),
                {73582: translation, 75394: {useRouteFocused: () => true}, 52600: () => ({settings: {hideSpoilers: false, interfaceLanguage: 'en'}})});
            const Stream = load(Object.values(window.modules).find(fn => fn.toString().includes('["stream-container"]') && fn.toString().includes('externalPlayer')),
                {31187: {useServices: () => ({core})}, 75394: {useRouteFocused: () => true}, 32462: {t: key => key},
                    60350: {...hooks, useProfile: () => ({settings: {playerType: null}}), usePlatform: () => ({name: 'windows'}), useToast: () => ({show: () => {}})}});
            let Library;
            load(Object.values(window.modules).find(fn => fn.toString().includes('removable:"library"===') && fn.toString().includes('catalog.map')), {
                73582: translation,
                60350: {useProfile: () => ({auth: {user: {id: 'test'}}}), useNotifications: () => ({items: {tt100: [1, 2]}}), routesRegexp: {},
                    useOnScrollToBottom: () => () => {}, withCoreSuspender: component => {Library = component; return component;}},
                78811: () => [{selected: {request: {page: 1}}, catalog: window.fixtureItems}, () => window.morePages++],
                72715: () => [{value: null}, {}, false],
                84902: {...components, LibItem, MainNavBars: ({children, className}) => h('div', {className: 'fixture-page ' + className}, children),
                    Chips: () => null, MultiselectMenu: () => null, DelayedRenderer: ({children}) => children}
            });
            const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#7272c2"/></svg>');
            window.fixtureItems = [{_id: 'tt100', type: 'series', name: 'Fixture Show', poster, posterShape: 'poster', progress: 37, watched: false,
                deepLinks: {player: '#/player/cached-source', metaDetailsVideos: '#/detail/series/tt100', metaDetailsStreams: '#/detail/series/tt100/tt100%3A3%3A7'}}];
            function App() {
                const [hash, setHash] = React.useState(location.hash), [model, setModel] = React.useState('library');
                const [revision, update] = React.useState(0);
                window.showLibrary = (newModel = 'library', items) => {if (items) window.fixtureItems = items; setModel(newModel); update(value => value + 1); location.hash = newModel === 'library' ? '#/library/series' : '#/continuewatching';};
                window.rerenderItems = items => {window.fixtureItems = items; update(value => value + 1);};
                React.useEffect(() => {const changed = () => {setHash(location.hash); if (location.hash.startsWith('#/player/')) window.playRequests.push(location.hash);}; window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);}, []);
                if (hash.startsWith('#/player/')) return h('div', {id: 'player-request'}, hash);
                if (hash.startsWith('#/detail/')) {
                    if (hash.split('/').length >= 5) return h('div', {id: 'sources'}, h('h1', null, 'Choose source'), ...['a', 'b'].map((id, index) => h(Stream, {
                        key: id, videoId: 'tt100:3:7', addonName: 'Source ' + id.toUpperCase(), name: 'Source ' + id.toUpperCase(), description: index ? '2160p chosen source' : '1080p alternate source', progress: 37,
                        deepLinks: {player: '#/player/source-' + id}})));
                    return h('div', {id: 'details'}, h('h1', null, 'Fixture Show details'), h(Video, {id: 'tt100:3:7', title: 'Episode 7', season: 3, episode: 7, released: new Date('2020-01-01'), thumbnail: poster,
                        deepLinks: {player: null, metaDetailsStreams: '#/detail/series/tt100/tt100%3A3%3A7'}, onMarkVideoAsWatched: () => {}, onMarkSeasonAsWatched: () => {}}));
                }
                return h(Library, {model, urlParams: {type: 'series'}, queryParams: new URLSearchParams('sort=lastWatched'), 'data-revision': revision});
            }
            ReactDOM.createRoot(document.getElementById('app')).render(h(App));
        });
        const card = page.locator('[class*="meta-item-container"]').filter({hasText: 'Fixture Show'});
        await card.waitFor();
        return {browser, page, errors, card};
    } catch (error) {await browser.close(); throw error;}
}

test('Library show opens details and permits choosing an episode and a different source before playback', async () => {
    const {browser, page, errors, card} = await setup();
    try {
        assert.equal(await card.getAttribute('href'), '#/detail/series/tt100', 'Cached playback must not be the Library show target');
        await card.locator('[class*="poster-image-layer"]').click();
        await page.locator('#details').waitFor();
        assert.deepEqual(await page.evaluate(() => window.playRequests), []);
        await page.locator('#details [class*="video-container"]').click();
        await page.locator('#sources').waitFor();
        assert.equal(await page.locator('#sources [class*="stream-container"]').count(), 2);
        assert.deepEqual(await page.evaluate(() => window.playRequests), [], 'Choosing an episode does not start the cached Library stream');
        await page.locator('#sources a[href="#/player/source-b"]').click();
        await page.locator('#player-request').waitFor();
        assert.deepEqual(await page.evaluate(() => window.playRequests), ['#/player/source-b']);
        assert.deepEqual(await page.evaluate(() => window.dispatches), []);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Only Library series-card selection changes; movies, Continue Watching and reused cards keep their native links', async () => {
    const {browser, page, errors, card} = await setup();
    try {
        const saved = await page.evaluate(() => JSON.stringify(window.fixtureItems));
        await card.focus(); await page.keyboard.press('Enter'); await page.locator('#details').waitFor();
        assert.equal(await page.evaluate(() => window.playRequests.length), 0);
        await page.evaluate(() => window.showLibrary('continue_watching'));
        await card.waitFor(); assert.equal(await card.getAttribute('href'), '#/player/cached-source');
        await page.evaluate(() => window.showLibrary('library'));
        await page.waitForFunction(() => document.querySelector('[class*="meta-item-container"]')?.getAttribute('href') === '#/detail/series/tt100');
        await page.evaluate(() => window.rerenderItems(window.fixtureItems.map(item => ({...item, type: 'movie'}))));
        await page.waitForFunction(() => document.querySelector('[class*="meta-item-container"]')?.getAttribute('href') === '#/player/cached-source');
        await page.evaluate(() => window.rerenderItems(window.fixtureItems.map(item => ({...item, type: 'series'}))));
        await page.waitForFunction(() => document.querySelector('[class*="meta-item-container"]')?.getAttribute('href') === '#/detail/series/tt100');
        assert.equal(await page.evaluate(() => JSON.stringify(window.fixtureItems)), saved, 'The navigation change does not rewrite library records');
        assert.deepEqual(await page.evaluate(() => [localStorage.getItem('localProfile'), localStorage.getItem('profile')]), ['{"maxVolume":"225","keep":"unchanged"}', '{"fixture":"account-storage-unchanged"}']);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Library context-menu Play still uses the cached player and watched/remove actions remain available', async () => {
    const {browser, page, errors, card} = await setup();
    try {
        const menu = card.locator('[class*="menu-label-container"]');
        await menu.click();
        await page.getByText('LIBRARY_PLAY', {exact: true}).click();
        await page.locator('#player-request').waitFor();
        assert.deepEqual(await page.evaluate(() => window.playRequests), ['#/player/cached-source'], 'Explicit Play remains an intentional shortcut');
        await page.evaluate(() => window.showLibrary('library')); await card.waitFor();
        await menu.click(); await page.getByText('CTX_MARK_WATCHED', {exact: true}).click();
        assert.equal(await page.evaluate(() => window.dispatches.at(-1)[0].args.action), 'LibraryItemMarkAsWatched');
        await menu.click(); await page.getByText('LIBRARY_REMOVE', {exact: true}).click();
        assert.equal(await page.evaluate(() => window.dispatches.at(-1)[0].args.action), 'RemoveFromLibrary');
        assert.equal(await card.getAttribute('href'), '#/detail/series/tt100');
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Alternate IDs and source-details fallbacks preserve exact links; missing details never silently start a show', async () => {
    const {browser, page, errors, card} = await setup();
    try {
        const sources = '#/detail/series/kitsu%3A123/kitsu%3A123%3A3%3A7?addon=https%3A%2F%2Fexample.test%2Fmanifest.json';
        await page.evaluate(sources => window.rerenderItems(window.fixtureItems.map(item => ({...item, deepLinks: {...item.deepLinks, metaDetailsVideos: '', metaDetailsStreams: sources}}))), sources);
        await page.waitForFunction(sources => document.querySelector('[class*="meta-item-container"]')?.getAttribute('href') === sources, sources);
        assert.equal(await card.getAttribute('href'), sources);
        await page.evaluate(() => window.rerenderItems(window.fixtureItems.map(item => ({...item, deepLinks: {player: '#/player/cached-source'}}))));
        await page.waitForFunction(() => !document.querySelector('[class*="meta-item-container"]')?.hasAttribute('href'));
        await card.click(); assert.equal(await page.evaluate(() => window.playRequests.length), 0);
        for (const deepLinks of [null, {}, {metaDetailsVideos: 17, metaDetailsStreams: false}]) {
            await page.evaluate(deepLinks => window.rerenderItems(window.fixtureItems.map(item => ({...item, deepLinks}))), deepLinks);
            assert.equal(await card.getAttribute('href'), null);
        }
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});
