const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {inflateSync} = require('node:zlib');
const {chromium} = require('playwright');
const forkScript = fs.readFileSync('src/webview/fork-player.js', 'utf8');
const listsScript = fs.readFileSync('src/webview/fork-lists.js', 'utf8');
const {decodeLists, libraryRecords, itemProps, imdbIds, classifyLists, moveTitles, streamRecords, cachedPlayerLink} = require('../src/webview/fork-lists');
const executablePath = [process.env.STREMIO_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(path => path && fs.existsSync(path));
let assets;

async function setup(withAppearance = false, withLists = false, listFixture = {}) {
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
    else if (withLists) assert.ok(native.includes('__stremioForkCustomListsPatched=true;'),
        'Run the native bundle patcher before testing custom lists');
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1280, height: 800}}), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (withLists) page.setDefaultTimeout(10000);
        const indexRequests = [];
        const store = new Map();
        if (withLists) await page.exposeFunction('fixtureLibraryStore', ({requestId, action, uid, legacy, revision, lists}) => {
            let record = store.get(uid);
            if (!record) {
                record = {...(legacy ?? {version: 1, lists: []}), revision: legacy ? 1 : 0};
                store.set(uid, record);
            }
            if (action === 'save') {
                if (record.revision !== revision) return {requestId, record, conflict: true};
                record = {version: 1, revision: revision + 1, lists};
                store.set(uid, record);
            }
            return {requestId, record};
        });
        if (withLists) await page.route('https://raw.githubusercontent.com/Fribb/anime-lists/master/indices/imdb_index.json', async route => {
            indexRequests.push({url: route.request().url(), method: route.request().method(), headers: await route.request().allHeaders()});
            if (listFixture.offline) return route.abort();
            const entries = Array.from({length: 1000}, (_, i) => ['[tt' + (100000 + i) + ']', {'anime-list': [i]}]);
            entries.push(['[tt300]', {'anime-list': [1]}]);
            return route.fulfill({headers: {'access-control-allow-origin': '*'}, json: Object.fromEntries(entries)});
        });
        const fixturePage = route => route.fulfill({contentType: 'text/html', body: `<html><head><style>${css}</style><style>body{margin:0;background:#222635;color:white}#app{height:100vh}.fixture-page{height:100vh;padding:30px}#details,#sources{padding:50px}#details [class*="video-container"]{width:400px}#sources [class*="stream-container"]{width:600px;min-height:100px}</style></head><body><div id="app"></div></body></html>`});
        await page.route('https://stremio.zarg.me/**', fixturePage);
        if (withLists) await page.route('https://zaarrg.github.io/stremio-web-shell-fixes/**', fixturePage);
        await page.addInitScript(seed => {
            localStorage.setItem('localProfile', '{"maxVolume":"225","keep":"unchanged"}');
            localStorage.setItem('profile', '{"fixture":"account-storage-unchanged"}');
            if (seed && location.hostname === 'stremio.zarg.me' && localStorage.getItem('stremio-fork-custom-lists:test') === null)
                localStorage.setItem('stremio-fork-custom-lists:test', JSON.stringify(seed));
        }, listFixture.seed);
        await page.goto('https://stremio.zarg.me/' + (listFixture.home ? '#/' : '#/library/series'));
        const fixture = ({withAppearance, withLists}) => {
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
            const nav = ({children, className}) => h('div', {className: 'fixture-page ' + className},
                withAppearance && h(components.SearchBar, {title: 'Search', onChange: value => {window.searchValue = value;}}), children);
            const Video = load(Object.values(window.modules).find(fn => fn.toString().includes('seasonWatched') && fn.toString().includes('video-container')),
                {73582: translation, 75394: {useRouteFocused: () => true}, 52600: () => ({settings: {hideSpoilers: false, interfaceLanguage: 'en'}})});
            const Stream = load(Object.values(window.modules).find(fn => fn.toString().includes('["stream-container"]') && fn.toString().includes('externalPlayer')),
                {31187: {useServices: () => ({core})}, 75394: {useRouteFocused: () => true}, 32462: {t: key => key},
                    60350: {...hooks, useProfile: () => ({settings: {playerType: null}}), usePlatform: () => ({name: 'windows'}), useToast: () => ({show: () => {}})}});
            let Library;
            load(Object.values(window.modules).find(fn => fn.toString().includes('removable:"library"===') && fn.toString().includes('catalog.map')), {
                73582: translation,
                60350: {useProfile: () => withLists ? window.fixtureProfile : ({auth: {user: {id: 'test'}}}), useNotifications: () => ({items: {tt100: [1, 2]}}), routesRegexp: {},
                    useOnScrollToBottom: () => () => {}, withCoreSuspender: component => {Library = component; return component;}},
                78811: (_, params) => [{selected: {type: withLists ? params.type : 'Ready', request: {page: 1}}, catalog: window.fixtureItems}, () => window.morePages++],
                72715: () => {
                    if (withLists) {
                        const [path, query] = location.hash.split('?');
                        const sort = new URLSearchParams(query).get('sort') || 'lastwatched';
                        const link = (prefix, value) => prefix + '?sort=' + value;
                        const navigate = value => {location.hash = value;};
                        const typePath = ['#/library/series', '#/library/movie'].includes(path) ? path : '#/library';
                        return [{value: link(typePath, sort), onSelect: navigate,
                            options: [['', 'All'], ['/movie', 'Movie'], ['/series', 'Series']]
                                .map(([type, label]) => ({value: link('#/library' + type, sort), label}))},
                        {selected: [link(typePath, sort)], onSelect: navigate,
                            options: [['lastwatched', 'Last Watched'], ['name', 'A–Z'], ['namereverse', 'Z–A'],
                                ['timeswatched', 'Most Watched'], ['watched', 'Watched'], ['notwatched', 'Unwatched']]
                                .map(([value, label]) => ({value: link(typePath, value), label}))}, true];
                    }
                    const [type, setType] = React.useState('series');
                    const [sort, setSort] = React.useState('lastWatched');
                    return [{value: type, onSelect: setType, options: [{value: 'series', label: 'Series'}, {value: 'movie', label: 'Movies'}]},
                        {selected: [sort], onSelect: setSort, options: [{value: 'lastWatched', label: 'Last Watched'}, {value: 'name', label: 'Name'}]}, false];
                },
                84902: {...components, LibItem, MainNavBars: nav,
                    Chips: withAppearance || withLists ? components.Chips : () => null,
                    MultiselectMenu: withAppearance || withLists ? components.MultiselectMenu : () => null,
                    DelayedRenderer: ({children}) => children}
            });
            const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#7272c2"/></svg>');
            window.fixtureItems = [{_id: 'tt100', type: 'series', name: 'Fixture Show', poster, posterShape: 'poster', progress: 37, watched: false,
                deepLinks: {player: '#/player/cached-source', metaDetailsVideos: '#/detail/series/tt100', metaDetailsStreams: '#/detail/series/tt100/tt100%3A3%3A7'}}];
            let Board;
            if (withLists) {
                const saved = (id, name, watched, type = 'series') => ({_id: id, name, type, poster, posterShape: 'poster',
                    removed: false, temp: false, _mtime: '2024-01-01', state: {timesWatched: watched}});
                const recent = {tt100: saved('tt100', 'Fixture Show', 0), tt200: saved('tt200', 'Another Show', 1)};
                const older = {tt300: saved('tt300', 'Older Movie', 4, 'movie'), tt400: saved('tt400', 'Older Unwatched', 0)};
                window.fixtureItems.push({...recent.tt200, watched: true, deepLinks: {metaDetailsVideos: '#/detail/series/tt200'}});
                window.setFixtureAccount = uid => {
                    window.fixtureProfile = {auth: {user: {_id: uid}}, settings: {streamingServerWarningDismissed: new Date(0)}};
                    localStorage.setItem('profile', JSON.stringify(window.fixtureProfile));
                    if (uid === 'test') {
                        localStorage.setItem('library', JSON.stringify({uid, items: older}));
                        localStorage.setItem('library_recent', JSON.stringify({uid, items: recent}));
                    }
                };
                window.setFixtureAccount('test');
                const translate = {string: key => key, catalogTitle: catalog => catalog.name + ' ' + (catalog.type === 'movie' ? 'Movies' : 'Series')};
                const row = load(find('CATALOG_PREVIEW_SIZE-c.length'), {20107: () => translate});
                const featuredItem = window.fixtureItems[0];
                const catalog = (name, type) => ({name, type, content: {type: 'Ready', content: [featuredItem]}});
                const boardFactory = Object.values(window.modules).find(factory => factory.toString().includes('["board-content"]') && factory.toString().includes('["board-container"]'));
                Board = load(boardFactory, {60350: {...hooks, useProfile: () => window.fixtureProfile,
                    useStreamingServer: () => ({settings: {type: 'Ready'}}), useNotifications: () => ({}),
                    withCoreSuspender: component => component, getVisibleChildrenRange: () => null},
                    84902: {...components, MainNavBars: nav, MetaRow: row, MetaItem, EventModal: () => null},
                    20107: () => translate, 53993: () => ({items: []}),
                    47649: () => [{catalogs: [catalog('Featured', 'series'), catalog('Featured', 'movie'), catalog('Popular', 'movie')]}, () => {}]});
            }
            function App() {
                const [hash, setHash] = React.useState(location.hash), [model, setModel] = React.useState('library');
                const [revision, update] = React.useState(0);
                window.showLibrary = (newModel = 'library', items) => {if (items) window.fixtureItems = items; setModel(newModel); update(value => value + 1); location.hash = newModel === 'library' ? '#/library/series' : '#/continuewatching';};
                window.rerenderItems = items => {window.fixtureItems = items; update(value => value + 1);};
                React.useEffect(() => {const changed = () => {setHash(location.hash); if (location.hash.startsWith('#/player/')) window.playRequests.push(location.hash);}; window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);}, []);
                if (hash.startsWith('#/player/')) return h('div', {id: 'player-request'}, hash);
                if (Board && hash === '#/') return h(Board);
                if (hash.startsWith('#/detail/')) {
                    if (hash.split('/').length >= 5) return h('div', {id: 'sources'}, h('h1', null, 'Choose source'), ...['a', 'b'].map((id, index) => h(Stream, {
                        key: id, videoId: 'tt100:3:7', addonName: 'Source ' + id.toUpperCase(), name: 'Source ' + id.toUpperCase(), description: index ? '2160p chosen source' : '1080p alternate source', progress: 37,
                        deepLinks: {player: '#/player/source-' + id}})));
                    return h('div', {id: 'details'}, h('h1', null, 'Fixture Show details'), h(Video, {id: 'tt100:3:7', title: 'Episode 7', season: 3, episode: 7, released: new Date('2020-01-01'), thumbnail: poster,
                        deepLinks: {player: null, metaDetailsStreams: '#/detail/series/tt100/tt100%3A3%3A7'}, onMarkVideoAsWatched: () => {}, onMarkSeasonAsWatched: () => {}}));
                }
                const [path, query] = hash.split('?');
                return h(Library, {model, urlParams: {type: withLists ? path.split('/')[2] : 'series'},
                    queryParams: new URLSearchParams(withLists ? query : 'sort=lastWatched'), 'data-revision': revision});
            }
            ReactDOM.createRoot(document.getElementById('app')).render(h(App));
        };
        async function boot() {
            if (withLists) {
                await page.evaluate(() => {
                    const bridge = new EventTarget();
                    bridge.postMessage = message => {
                        const prefix = 'fork-library-store:';
                        if (!message.startsWith(prefix)) return;
                        window.fixtureLibraryStore(JSON.parse(message.slice(prefix.length))).then(result => {
                            bridge.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({args: ['fork-library-store-result', result]})}));
                        });
                    };
                    window.chrome.webview = bridge;
                });
                await page.addScriptTag({content: listsScript});
            }
            const anchor = '(()=>{var e;o.g.importScripts';
            assert.ok(bundle.includes(anchor));
            await page.addScriptTag({content: bundle.replace(anchor, 'window.req=o;window.modules=a;return;' + anchor)});
            await page.evaluate(fixture, {withAppearance, withLists});
        }
        await boot();
        const card = page.locator('[class*="meta-item-container"]').filter({hasText: 'Fixture Show'});
        if (listFixture.home) await page.locator('[data-fork-home-lists]').waitFor();
        else await card.waitFor();
        return {browser, page, errors, card, indexRequests, boot, store};
    } catch (error) {await browser.close(); throw error;}
}

test('List storage defaults, latest-record selection, and watched state work with older library records', () => {
    const defaults = decodeLists(null);
    assert.deepEqual(defaults.map(list => list.name), ['Anime', 'Live Action']);
    defaults[0].items.push('id');
    assert.deepEqual(decodeLists(null)[0].items, []);
    const raw = JSON.stringify({version: 1, lists: [{id: 'anime', name: 'Anime', items: ['a', 'a']},
        {id: 'custom', name: 'Weekend', items: ['a']}]});
    assert.deepEqual(decodeLists(raw).map(list => [list.id, list.items]), [['anime', ['a']], ['live-action', []], ['custom', ['a']]]);
    assert.throws(() => decodeLists('{"version":2,"lists":[]}'));
    assert.throws(() => decodeLists('{"version":1,"lists":[{"id":"anime","name":"Anime","items":[1]}]}'));
    const item = (id, date, state = {}) => ({_id: id, type: 'series', name: id, removed: false, temp: false, _mtime: date, state});
    const first = item('a', '2023-01-01');
    const latest = item('a', '2024-01-01', {timesWatched: 1, timeOffset: 30000, duration: 60000});
    const gone = item('gone', '2024-01-01');
    const recent = {uid: 'signed-in', items: {a: latest, gone: {...gone, removed: true}}};
    const older = {uid: 'signed-in', items: {a: first, gone, older: item('older', '2015-01-01'), temp: {...item('temp', '2024-01-01'), temp: true}}};
    const mismatch = {uid: 'someone-else', items: {foreign: item('foreign', '2024-01-01')}};
    const data = libraryRecords('signed-in', [older, recent, mismatch]);
    assert.deepEqual([...data.byId.keys()], ['a', 'older']);
    assert.deepEqual(itemProps(data.byId.get('a')), {...itemProps(first), watched: true, progress: 50});
    assert.equal(itemProps(data.byId.get('older')).watched, false);
    assert.equal(libraryRecords('signed-in', [mismatch]).available, false);
});

test('Anime classification matches exact IDs and keeps Beta 1 manual choices and custom lists', () => {
    const data = imdbIds({'[tt30, tt31]': {'anime-list': [7]}, '[tt40]': {'anime-list': []}, '[]': {'anime-list': [1]}});
    assert.deepEqual([...data], ['tt30', 'tt31']);
    const saved = decodeLists(JSON.stringify({version: 1, lists: [
        {id: 'anime', name: 'Anime', items: ['tt20']},
        {id: 'live-action', name: 'Live Action', items: ['tt20', 'tt30']},
        {id: 'custom', name: 'Weekend', items: ['tt30', 'kitsu:5']}
    ]}));
    const records = new Map(['tt20', 'tt30', 'tt31', 'tt40', 'kitsu:5', 'special'].map(id =>
        [id, {_id: id, type: id === 'special' ? 'anime' : 'series'}]));
    assert.deepEqual(classifyLists(saved, records, data).lists.map(list => list.items),
        [['tt20', 'tt31', 'kitsu:5', 'special'], ['tt30', 'tt40'], ['tt30', 'kitsu:5']]);
    moveTitles(saved, ['tt20', 'kitsu:5'], 'live-action');
    assert.deepEqual(classifyLists(saved, records, data).lists.map(list => list.items),
        [['tt31', 'special'], ['tt20', 'tt30', 'tt40', 'kitsu:5'], ['tt30', 'kitsu:5']]);
    records.delete('kitsu:5');
    assert.equal(classifyLists(saved, records, data).lists[1].items.includes('kitsu:5'), false);
    assert.deepEqual(saved[2].items, ['tt30', 'kitsu:5']);
});

const savedSource = {
    stream: {infoHash: '1234567890123456789012345678901234567890', fileIdx: 3, name: 'Cached torrent'},
    type: 'movie', metaId: 'tt300', videoId: 'tt300',
    streamTransportUrl: 'https://example.invalid/addon/manifest.json',
    metaTransportUrl: 'https://example.invalid/meta/manifest.json'
};

test('Only the matching account and video can resume the exact saved source', async () => {
    const key = {metaId: 'tt300', videoId: 'tt300'};
    const raw = JSON.stringify({uid: 'test', items: [[key, savedSource],
        [{...key, videoId: 'other'}, savedSource]]});
    assert.equal(streamRecords('other', raw).size, 0);
    const records = streamRecords('test', raw);
    assert.equal(records.size, 1);
    const link = await cachedPlayerLink(records.values().next().value, 12650);
    const [encoded, streamUrl, metaUrl, type, meta, video] = link.split('?')[0].split('/').slice(2).map(decodeURIComponent);
    assert.deepEqual(JSON.parse(inflateSync(Buffer.from(encoded, 'base64'))), savedSource.stream);
    assert.deepEqual([streamUrl, metaUrl, type, meta, video],
        [savedSource.streamTransportUrl, savedSource.metaTransportUrl, 'movie', 'tt300', 'tt300']);
    assert.match(link, /\?position=12$/);
    const direct = {...savedSource, stream: {url: 'https://example.invalid/video.mkv', behaviorHints: {proxyHeaders: {request: {Referer: 'https://example.invalid/'}}}}};
    const directLink = await cachedPlayerLink(direct, 0);
    assert.deepEqual(JSON.parse(inflateSync(Buffer.from(decodeURIComponent(directLink.split('/')[2]), 'base64'))), direct.stream);
});

test('Live Library creates lists, adds multiple titles to multiple lists, and places them after Featured Movies', async () => {
    const {browser, page, errors, card} = await setup(false, true);
    try {
        const select = page.locator('[class*="select-input-container-"] [aria-haspopup="listbox"]');
        const create = page.getByRole('button', {name: 'Create list'});
        const toolbar = page.locator('[class*="selectable-inputs-container-"]');
        const titles = () => page.locator('[class*="meta-item-container-"] [class*="title-label-"]').allTextContents();
        const openList = async name => {
            await select.click();
            await page.getByRole('listbox').getByText(name, {exact: true}).click();
        };
        const chip = name => toolbar.locator('[data-value]').getByText(name, {exact: true});
        const other = page.locator('[class*="meta-item-container-"]').filter({hasText: 'Another Show'});
        assert.deepEqual(await toolbar.locator('[data-value]').allTextContents(),
            ['Last Watched', 'A–Z', 'Z–A', 'All', 'Anime', 'Live Action', 'Most Watched', 'Watched', 'Unwatched']);
        const createBox = await create.boundingBox(), selectBox = await select.boundingBox();
        assert.ok(createBox.x > selectBox.x && Math.abs(createBox.y - selectBox.y) < selectBox.height);
        await create.click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('List name').fill(' anime ');
        await dialog.getByRole('button', {name: 'Create', exact: true}).click();
        await dialog.getByRole('alert').getByText('A list with that name already exists.').waitFor();
        await dialog.getByLabel('List name').fill('Weekend <Picks>');
        await dialog.getByRole('button', {name: 'Create', exact: true}).click();
        await page.getByText('This list is empty.').waitFor();
        assert.match(new URL(page.url()).hash, /forkList=[a-z0-9-]+/);
        await openList('All');
        await card.waitFor();
        await page.keyboard.down('Control');
        await card.locator('[class*="poster-image-layer"]').click();
        await other.locator('[class*="poster-image-layer"]').click();
        await page.keyboard.up('Control');
        await page.bringToFront();
        assert.equal(await page.locator('[data-fork-list-selected]').count(), 2);
        await page.getByRole('button', {name: 'Add to list (2)', exact: true}).click();
        await dialog.getByText('Choose lists for 2 titles').waitFor();
        await dialog.getByRole('checkbox', {name: 'Anime'}).check();
        await dialog.getByRole('checkbox', {name: 'Weekend <Picks>'}).check();
        await dialog.getByRole('button', {name: 'Add', exact: true}).click();
        await dialog.waitFor({state: 'hidden'});
        assert.equal(await page.locator('[data-fork-list-selected]').count(), 0);
        await chip('Anime').click();
        await page.waitForURL(url => new URLSearchParams(url.hash.split('?')[1]).get('forkList') === 'anime');
        await select.getByText('Anime', {exact: true}).waitFor();
        assert.deepEqual(await titles(), ['Another Show', 'Fixture Show', 'Older Movie']);
        await chip('A–Z').click();
        await page.waitForURL('**/#/library?sort=name&forkList=anime');
        await page.waitForFunction(() => document.querySelector('[class*="meta-item-container-"]').title === 'Another Show');
        await openList('Weekend <Picks>');
        await card.waitFor();
        assert.deepEqual(await titles(), ['Another Show', 'Fixture Show']);
        const menu = card.locator('[class*="menu-label-container"]');
        await menu.click();
        await page.getByText('Add to list', {exact: true}).click();
        await dialog.getByText('Choose lists for 1 title').waitFor();
        await dialog.getByRole('checkbox', {name: 'Live Action'}).check();
        await dialog.getByRole('button', {name: 'Add', exact: true}).click();
        await dialog.waitFor({state: 'hidden'});
        await menu.click();
        await page.getByText('Remove from this list', {exact: true}).click();
        await card.waitFor({state: 'detached'});
        await page.evaluate(() => {location.hash = '#/';});
        const slot = page.locator('[data-fork-home-lists]');
        await slot.getByText('Weekend <Picks>', {exact: true}).waitFor();
        assert.deepEqual(await slot.locator('[class*="title-container-"]').allTextContents(),
            ['Featured Movies', 'Anime', 'Live Action', 'Weekend <Picks>']);
        assert.match(await slot.evaluate(node => node.previousElementSibling.innerText), /Featured Series/);
        assert.match(await slot.evaluate(node => node.nextElementSibling.innerText), /Popular Movies/);
        const animeRow = slot.locator('[class*="meta-row-container-"]').filter({hasText: 'Anime'});
        assert.equal(await animeRow.locator('a[title="Another Show"]').getAttribute('href'), '#/detail/series/tt200');
        assert.equal(await animeRow.locator('a[title="Fixture Show"]').count(), 0);
        await animeRow.getByText('BUTTON_SEE_ALL').click();
        await other.waitFor();
        assert.deepEqual(await titles(), ['Another Show', 'Older Movie']);
        assert.deepEqual(await page.evaluate(() => window.playRequests), []);
        assert.deepEqual(await page.evaluate(() => window.dispatches), []);
        await page.setViewportSize({width: 375, height: 800});
        const narrow = await create.boundingBox();
        assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 375);
        assert.deepEqual(errors, []);
    } catch (failure) {
        console.error('List fixture:', page.url(), errors, await page.locator('body').innerText());
        throw failure;
    } finally {await browser.close();}
});

test('Watched and Unwatched exclude each other beyond the first page and custom lists stay with their account', async () => {
    const {browser, page, errors} = await setup(false, true);
    try {
        const type = page.locator('[class*="select-input-container-"] [aria-haspopup="listbox"]');
        await type.click();
        await page.getByRole('listbox').getByText('All', {exact: true}).click();
        const titles = () => page.locator('[class*="meta-item-container-"] [class*="title-label-"]').allTextContents();
        const chip = name => page.locator('[class*="selectable-inputs-container-"] [data-value]').getByText(name, {exact: true});
        await chip('Watched').click();
        await page.locator('a[title="Older Movie"]').waitFor();
        assert.deepEqual(await titles(), ['Another Show', 'Older Movie']);
        await chip('Unwatched').click();
        await page.locator('a[title="Older Unwatched"]').waitFor();
        assert.deepEqual(await titles(), ['Fixture Show', 'Older Unwatched']);
        await type.click();
        await page.getByRole('listbox').getByText('Movie', {exact: true}).click();
        await page.getByText('No matching titles.').waitFor();
        assert.deepEqual(await titles(), []);
        await page.getByRole('button', {name: 'Create list'}).click();
        let dialog = page.getByRole('dialog');
        await dialog.getByLabel('List name').fill('Private list');
        await dialog.getByRole('button', {name: 'Create', exact: true}).click();
        await dialog.waitFor({state: 'hidden'});
        const privateRoute = new URL(page.url()).hash;
        await page.evaluate(() => {window.setFixtureAccount('other'); window.rerenderItems([]);});
        await page.waitForFunction(() => !document.querySelector('[aria-haspopup="listbox"]').textContent.includes('Private list'));
        await page.evaluate(() => {location.hash = '#/';});
        await page.locator('[data-fork-home-lists]').getByText('Anime', {exact: true}).waitFor();
        assert.equal(await page.getByText('Private list', {exact: true}).count(), 0);
        await page.evaluate(route => {window.setFixtureAccount('test'); location.hash = route;}, privateRoute);
        await type.getByText('Private list', {exact: true}).waitFor();
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Library chooses one list and one independent sort while cycling through built-in views', async () => {
    const {browser, page, errors} = await setup(false, true);
    try {
        const toolbar = page.locator('[class*="selectable-inputs-container-"]');
        const chip = name => toolbar.locator('[data-value]').getByText(name, {exact: true});
        const highlighted = type => toolbar.locator(`[data-value*="${type}"][class*="active-"]`).allTextContents();
        const waitForHighlight = (type, label) => toolbar.locator(`[data-value*="${type}"][class*="active-"]`)
            .filter({hasText: label}).waitFor();
        const titles = () => page.locator('[class*="meta-item-container-"] [class*="title-label-"]').allTextContents();
        for (const list of ['Anime', 'Live Action', 'Watched', 'Unwatched', 'All', 'Most Watched']) {
            await chip(list).click();
            await waitForHighlight('forkList=', list);
            assert.deepEqual(await highlighted('forkList='), [list]);
        }
        await page.locator('a[title="Older Movie"]').waitFor();
        assert.deepEqual(await titles(), ['Older Movie', 'Another Show']);
        assert.deepEqual(await highlighted('sort='), []);
        for (const [label, expected] of [['A–Z', ['Another Show', 'Older Movie']], ['Z–A', ['Older Movie', 'Another Show']],
            ['Last Watched', ['Another Show', 'Older Movie']]]) {
            await chip(label).click();
            await waitForHighlight('sort=', label);
            assert.deepEqual(await highlighted('sort='), [label]);
            assert.deepEqual(await highlighted('forkList='), ['Most Watched']);
            assert.deepEqual(await titles(), expected);
        }
        await chip('All').click();
        await waitForHighlight('forkList=', 'All');
        assert.deepEqual(await highlighted('forkList='), ['All']);
        assert.deepEqual(await highlighted('sort='), ['Last Watched']);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Switching lists clears hidden selection, and older cards resume their cached source', async () => {
    const {browser, page, card, errors} = await setup(false, true);
    try {
        await page.getByRole('button', {name: 'Create list'}).waitFor();
        await page.waitForFunction(() => !document.querySelector('.fork-list-toolbar-actions button').disabled);
        await page.keyboard.down('Control');
        await card.locator('[class*="poster-image-layer"]').click();
        await page.keyboard.up('Control');
        await page.bringToFront();
        const bulk = page.getByRole('button', {name: 'Add to list (1)'});
        await bulk.waitFor();
        await page.locator('[data-value="#/library?forkList=anime"]').click();
        const older = page.getByTitle('Older Movie', {exact: true});
        await older.waitFor();
        await bulk.waitFor({state: 'detached'});
        await page.locator('[data-value="#/library?forkList=all"]').click();
        await card.waitFor();
        assert.equal(await bulk.count(), 0);
        await page.locator('[data-value="#/library?forkList=anime"]').click();
        await older.waitFor();
        assert.equal(await older.getAttribute('href'), '#/detail/movie/tt300/tt300');
        await page.evaluate(stream => {
            const bucket = JSON.parse(localStorage.getItem('library'));
            Object.assign(bucket.items.tt300.state, {video_id: 'tt300', timeOffset: 12000});
            localStorage.setItem('library', JSON.stringify(bucket));
            localStorage.setItem('streams', JSON.stringify({uid: 'test', items: [[{metaId: 'tt300', videoId: 'tt300'}, stream]]}));
        }, savedSource);
        const menu = older.locator('[class*="menu-label-container"]');
        await page.waitForTimeout(800); // Hosted core writes are picked up on the next storage poll.
        await menu.click();
        await page.getByText('Play', {exact: true}).click();
        await page.waitForURL(/#\/player\/.*\?position=12$/);
        const encoded = decodeURIComponent(new URL(page.url()).hash.split('/')[2]);
        assert.deepEqual(JSON.parse(inflateSync(Buffer.from(encoded, 'base64'))), savedSource.stream);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('A failed Library compatibility patch shows a warning on Library and Home', async () => {
    const {browser, page, errors} = await setup(false, true);
    try {
        await page.evaluate(() => {
            window.__stremioForkCustomListsPatched = false;
            window.dispatchEvent(new Event('stremio-fork-compatibility'));
        });
        const notice = page.locator('#fork-list-compatibility');
        await notice.getByText('Custom lists are temporarily unavailable', {exact: false}).waitFor();
        await page.evaluate(() => {location.hash = '#/';});
        await notice.waitFor();
        await page.evaluate(() => {location.hash = '#/detail/series/tt100';});
        await notice.waitFor({state: 'detached'});
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Automatic lists use the full synced Library, update as records arrive, and keep Beta 1 lists and manual moves on restart', async () => {
    const options = {home: true, seed: {version: 1, lists: [
        {id: 'anime', name: 'Anime', items: ['tt100']},
        {id: 'live-action', name: 'Live Action', items: []},
        {id: 'favorites', name: 'Favorites', items: ['tt100', 'tt400']}
    ]}};
    const {browser, page, errors, indexRequests, boot, store} = await setup(false, true, options);
    try {
        const load = () => store.get('test');
        const chip = name => page.locator('[class*="selectable-inputs-container-"] [data-value]').getByText(name, {exact: true});
        const title = name => page.locator(`a[class*="meta-item-container-"][title="${name}"]`);
        const row = page.locator('[data-fork-home-lists] [class*="meta-row-container-"]').filter({hasText: 'Anime'});
        await row.getByTitle('Older Movie', {exact: true}).waitFor();
        await row.getByText('BUTTON_SEE_ALL', {exact: true}).click();
        await title('Older Movie').waitFor();
        await title('Fixture Show').waitFor();
        assert.deepEqual(load(), {...options.seed, revision: 1});
        assert.equal(indexRequests.length, 1);
        assert.equal(indexRequests[0].method, 'GET');
        assert.equal(indexRequests[0].headers.cookie, undefined);
        assert.equal(indexRequests[0].headers.referer, undefined);
        await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('library_recent'));
            const item = data.items.tt100;
            data.items['kitsu:999'] = {...item, _id: 'kitsu:999', name: 'New Kitsu Show'};
            localStorage.setItem('library_recent', JSON.stringify(data));
        });
        await title('New Kitsu Show').waitFor();
        await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('library_recent'));
            data.items['kitsu:999'].removed = true;
            localStorage.setItem('library_recent', JSON.stringify(data));
        });
        await title('New Kitsu Show').waitFor({state: 'detached'});
        await title('Older Movie').locator('[class*="menu-label-container"]').click();
        await page.getByText('Move to Live Action', {exact: true}).click();
        await title('Older Movie').waitFor({state: 'detached'});
        const saved = load();
        assert.deepEqual(saved.lists[2], options.seed.lists[2]);
        assert.deepEqual(saved.lists[1].items, ['tt300']);
        await page.reload();
        options.offline = true;
        await boot();
        await title('Fixture Show').waitFor();
        assert.equal(await title('Older Movie').count(), 0);
        await chip('Live Action').click();
        await title('Older Movie').waitFor();
        await title('Older Unwatched').waitFor();
        assert.deepEqual(load(), saved);
        assert.equal(indexRequests.length, 1, 'Restart reuses the downloaded index');
        const dropdown = page.locator('[class*="select-input-container-"] [aria-haspopup="listbox"]');
        await dropdown.click();
        await page.getByRole('listbox').getByText('Favorites', {exact: true}).click();
        await title('Fixture Show').waitFor();
        await title('Older Unwatched').waitFor();
        await page.goto('https://zaarrg.github.io/stremio-web-shell-fixes/#/library?forkList=live-action');
        await boot();
        await title('Older Movie').waitFor();
        await title('Older Unwatched').waitFor();
        assert.deepEqual(load(), saved);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});

test('Live Library controls use squared corners and purple selection, and real posters glow on hover', async () => {
    const {browser, page, errors, card} = await setup(true);
    try {
        const search = page.locator('[class*="search-bar-container-"]');
        const sort = page.locator('[data-value="lastWatched"]');
        const type = page.locator('[class*="select-input-container-"] [aria-haspopup="listbox"]');
        const frame = card.locator('[class*="poster-container-"]');
        const cover = card.locator('[class*="poster-image-layer-"]');
        const background = el => el.evaluate(node => getComputedStyle(node).backgroundColor);
        const radius = el => el.evaluate(node => getComputedStyle(node).borderTopLeftRadius);
        const duration = () => cover.evaluate(node => parseFloat(getComputedStyle(node).transitionDuration));
        const waitForSortColor = (value, color) => page.waitForFunction(
            ([value, color]) => getComputedStyle(document.querySelector(`[data-value="${value}"]`)).backgroundColor === color,
            [value, color]);
        const baseline = {radius: await radius(search), selected: await background(sort), zoom: await duration()};
        await page.evaluate(() => {window.chrome = {webview: {
            addEventListener: (_, handler) => {window.setForkTheme = dark => handler({data: {args: ['theme-changed', {dark}]}});},
            postMessage() {}
        }};});
        await page.addScriptTag({content: forkScript});
        await page.locator('html[data-stremio-library]').waitFor({state: 'attached'});
        const purple = 'rgb(114, 114, 194)';
        assert.equal(await sort.evaluate(node => getComputedStyle(node).getPropertyValue('--quaternary-accent-color')), '#7272C2');
        await waitForSortColor('lastWatched', purple);
        const controlRadius = await search.evaluate(node => parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75 + 'px');
        for (const viewport of [{width: 1280, height: 800}, {width: 650, height: 800}, {width: 360, height: 800}]) {
            await page.setViewportSize(viewport);
            for (const control of [search, type, sort, page.locator('[data-value="name"]')])
                assert.equal(await radius(control), controlRadius);
            for (const field of [search, type]) {
                const box = await field.boundingBox();
                assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, 'The search and filter fit the window');
            }
            assert.equal(await background(sort), purple);
            assert.notEqual(await background(page.locator('[data-value="name"]')), purple);
        }
        await page.setViewportSize({width: 1280, height: 800});
        await search.locator('input').fill('sample');
        assert.equal(await search.locator('input').inputValue(), 'sample');
        await type.click();
        const menu = page.getByRole('listbox');
        assert.equal(await radius(menu), controlRadius);
        assert.equal(await background(menu.locator('[aria-selected="true"] [class*="icon-"]')), purple);
        await menu.getByText('Movies', {exact: true}).click();
        assert.equal((await type.innerText()).trim(), 'Movies');
        await page.locator('[data-value="name"]').click();
        await waitForSortColor('name', purple);
        assert.notEqual(await background(sort), purple);
        assert.ok(await duration() > baseline.zoom);
        await frame.hover();
        const waitForGlow = color => page.waitForFunction(color => {
            const shadow = getComputedStyle(document.querySelector('[class*="poster-container-"]')).boxShadow;
            return shadow.includes(`rgba(${color}, 0.7)`) && shadow.includes(`rgba(${color}, 0.45)`);
        }, color);
        await waitForGlow('133, 139, 153');
        await page.evaluate(() => window.setForkTheme(false));
        await waitForGlow('255, 255, 255');
        await page.evaluate(() => window.setForkTheme(true));
        await waitForGlow('133, 139, 153');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[class*="poster-image-layer-"]')).transform === 'matrix(1.05, 0, 0, 1.05, 0, 0)');
        await page.emulateMedia({reducedMotion: 'reduce'});
        assert.equal(await duration(), 0);
        assert.equal(await cover.evaluate(node => getComputedStyle(node).transform), 'none');
        await waitForGlow('133, 139, 153');
        await page.mouse.move(2, 2);
        await page.evaluate(() => window.showLibrary('continue_watching'));
        await page.locator('html[data-stremio-library]').waitFor({state: 'detached'});
        assert.equal(await radius(search), baseline.radius);
        await waitForSortColor('name', baseline.selected);
        await page.evaluate(() => window.showLibrary());
        await page.locator('html[data-stremio-library]').waitFor({state: 'attached'});
        assert.equal(await radius(search), controlRadius);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

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
