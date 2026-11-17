const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const native = fs.readFileSync('src/webview/youtube.cpp', 'utf8');
const readAdapter = name => native.match(new RegExp(name + '\\[\\] = R"JS\\(([\\s\\S]*?)\\)JS";'))[1];
const adapter = readAdapter('popupTabAdapter');
const player = fs.readFileSync('src/webview/fork-player.js', 'utf8');
const mount = player.slice(player.indexOf('    function updateYouTubeTab()'), player.indexOf('    function update()'));

test('YouTube adds one accessible sidebar button and uses the narrow shell message', () => {
    const messages = [];
    const tab = {
        style: {}, firstElementChild: {setAttribute() {}}, lastElementChild: {},
        setAttribute(name, value) { this[name] = value; },
        addEventListener(name, listener) { this[name] = listener; },
    };
    const children = [];
    const neighbor = {
        parentElement: {append: child => children.push(child)},
        classList: ['nav-tab-button-container-123', 'selected'],
        querySelector: () => ({getAttribute: () => 'icon-123'}),
        querySelectorAll: () => [{classList: ['label-123'], className: 'label-123'}],
    };
    const nav = {querySelector: selector => selector.startsWith('#') ? children[0] : neighbor};
    const env = {
        window: {chrome: {webview: {postMessage: message => messages.push(message)}}},
        document: {querySelector: () => nav, createElement: () => tab},
        location: {hostname: 'example.org'},
    };
    vm.runInNewContext(mount + 'updateYouTubeTab();', env);
    assert.equal(children.length, 0);
    env.location.hostname = 'web.stremio.com';
    vm.runInNewContext(mount + 'updateYouTubeTab(); updateYouTubeTab();', env);
    assert.deepEqual(children, [tab]);
    assert.equal(tab['aria-label'], 'YouTube');
    assert.equal(tab.className, 'nav-tab-button-container-123');
    tab.click();
    assert.deepEqual(messages, ['fork-open-youtube']);
});

test('Extension settings aim at the YouTube video tab while the popup has focus', async () => {
    const video = {id: 7, url: 'https://www.youtube.com/watch?v=example'};
    const options = {active: true, currentWindow: true};
    const unrelated = {active: true, currentWindow: false};
    const calls = [];
    const context = {
        URL,
        chrome: {tabs: {query(options, callback) {
            calls.push(options);
            const result = [
                {id: 1, url: 'chrome-extension://test/popup.html'},
                {id: 2, url: 'https://www.youtube.com.example.org/watch'},
                {id: 3, url: 'invalid'},
                video,
            ];
            if (callback) return callback(result);
            return Promise.resolve(result);
        }}},
    };
    vm.runInNewContext(adapter, context);
    const {tabs} = context.chrome;
    assert.deepEqual(Array.from(await tabs.query(options)), [video]);
    assert.deepEqual(Array.from(await new Promise(resolve => tabs.query(options, resolve))), [video]);
    assert.equal((await tabs.query(unrelated)).length, 4);
    assert.equal(Object.keys(calls[0]).length, 0);
    assert.equal(calls[2], unrelated);
});

test('Extension settings cannot select the Stremio or Google sign-in view', async () => {
    const chrome = {tabs: {query: async () => [
        {id: 1, url: 'https://web.stremio.com/#/'},
        {id: 2, url: 'https://accounts.google.com/'},
    ]}};
    vm.runInNewContext(adapter, {chrome, URL});
    assert.equal((await chrome.tabs.query({active: true, currentWindow: true})).length, 0);
});

test('Only the installed extension popup is treated as a toolbar message sender', () => {
    const listeners = new Set();
    const runtime = {
        id: 'test',
        getURL: path => 'chrome-extension://test/' + path,
        onMessage: {
            addListener: listener => listeners.add(listener),
            removeListener: listener => listeners.delete(listener),
            hasListener: listener => listeners.has(listener),
        },
    };
    vm.runInNewContext(readAdapter('extensionSenderAdapter'), {chrome: {runtime}});
    const receive = (_message, sender) => sender.tab?.id;
    runtime.onMessage.addListener(receive);
    assert.equal(runtime.onMessage.hasListener(receive), true);
    const [wrapped] = listeners;
    assert.equal(wrapped({}, {id:'test', url:'chrome-extension://test/popup.html', tab:{id:1}}), undefined);
    assert.equal(wrapped({}, {id:'other', url:'chrome-extension://test/popup.html', tab:{id:2}}), 2);
    assert.equal(wrapped({}, {id:'test', url:'https://www.youtube.com/', tab:{id:3}}), 3);
    runtime.onMessage.removeListener(receive);
    assert.equal(listeners.size, 0);
});
