const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {collect, files, zip} = require('../src/webview/fork-backup');

function item(id, name = id, extra = {}) {
    return {_id: id, name, type: 'series', removed: false, temp: false, _mtime: '2026-10-26T10:00:00Z',
        state: {timeOffset: 12000, duration: 30000, video_id: id + ':3:2', watched: 'encoded-watched-state', timesWatched: 2}, ...extra};
}
function fixture() {
    return {
        profile: {auth: {key: 'LOGIN-TOKEN-MUST-NOT-EXPORT', user: {_id: 'test-user', email: 'PRIVATE-EMAIL', trakt: {access_token: 'TRAKT-SECRET'}}},
            settings: {secret: 'PRIVATE-SETTINGS'}, addons: [
                {manifest: {id: 'addon-1', name: 'My add-on', version: '1.2.3'}, transportUrl: 'https://addon.example/PRIVATE-ADDON-KEY/manifest.json', flags: {official: false}},
                {manifest: {id: 'addon-1', name: 'Second configuration', version: '1.2.3'}, transportUrl: 'https://addon.example/SECOND-CONFIG/manifest.json', flags: {official: false}}
            ]},
        library: {uid: 'test-user', items: {'older-title': item('older-title', '犬夜叉 — Inuyasha'), duplicate: item('duplicate', 'Old duplicate', {_mtime: '2026-01-01T00:00:00Z'}),
            deleted: item('deleted', 'Deleted title', {removed: true}), temporary: item('temporary', 'Not saved', {temp: true})}},
        library_recent: {uid: 'test-user', items: {new: item('new', 'New title'), duplicate: item('duplicate', 'New duplicate')}}
    };
}
function storage(data) {
    return {getItem(key) { return Object.hasOwn(data, key) ? JSON.stringify(data[key]) : null; }};
}
const now = new Date('2026-10-26T12:30:40Z');

test('Complete split library, current membership, newest duplicate, watch state, add-on order/configurations, no login credentials', () => {
    const data = fixture();
    const before = JSON.stringify(data);
    const backup = collect(storage(data), now);
    assert.deepEqual(backup.counts, {savedTitles: 3, libraryRecords: 5, addons: 2});
    assert.equal(backup.libraryItems.find(i => i._id === 'duplicate').name, 'New duplicate');
    assert.equal(backup.libraryItems.find(i => i._id === 'older-title').state.watched, 'encoded-watched-state');
    assert.equal(backup.addons[1].manifest.name, 'Second configuration');
    assert.match(backup.addons[0].transportUrl, /PRIVATE-ADDON-KEY/);
    assert.equal(JSON.stringify(data), before, 'No mutations');
    const output = files(backup);
    const serialized = JSON.stringify(output);
    for (const secret of ['LOGIN-TOKEN-MUST-NOT-EXPORT', 'PRIVATE-EMAIL', 'TRAKT-SECRET', 'PRIVATE-SETTINGS', 'test-user']) assert.ok(!serialized.includes(secret));
    assert.ok(!output['Library.html'].includes('PRIVATE-ADDON-KEY'));
    assert.ok(!output['Library.csv'].includes('PRIVATE-ADDON-KEY'));
    assert.ok(!output['Addons.csv'].includes('PRIVATE-ADDON-KEY'));
    assert.ok(!output['Library.csv'].includes('Deleted title'));
    assert.ok(!output['Library.csv'].includes('Not saved'));
    assert.match(output['Library.html'], /Local snapshot/);
    assert.match(output['Library.html'], /Account synchronization was not checked/);
});

test('Large libraries include older entries beyond the 200 recent records; empty and local guest profiles work', () => {
    const data = fixture();
    data.library.items = Object.fromEntries(Array.from({length: 2400}, (_, i) => ['old-' + i, item('old-' + i)]));
    data.library_recent.items = Object.fromEntries(Array.from({length: 200}, (_, i) => ['new-' + i, item('new-' + i)]));
    assert.equal(collect(storage(data)).counts.savedTitles, 2600);
    data.profile.auth = null; data.profile.addons = [];
    data.library = {uid: null, items: {}}; data.library_recent = {uid: null, items: {}};
    const backup = collect(storage(data));
    assert.deepEqual(backup.counts, {savedTitles: 0, libraryRecords: 0, addons: 0});
    assert.match(files(backup)['Library.html'], /No saved titles/);
});

test('Refuses unreadable data, account mismatches, locked add-ons, or unsupported records instead of silently truncating', () => {
    const data = fixture();
    assert.throws(() => collect({getItem() {return '{broken';}}), /cannot be read/);
    assert.throws(() => collect(storage({})), /profile is not ready/);
    data.library.uid = 'another-account';
    assert.throws(() => collect(storage(data)), /account is still changing/);
    data.library.uid = 'test-user'; data.profile.addonsLocked = true;
    assert.throws(() => collect(storage(data)), /add-on list is unavailable/);
    data.profile.addonsLocked = false; data.library.items.invalid = {};
    assert.throws(() => collect(storage(data)), /Unrecognized library record/);
    delete data.library.items.invalid; delete data.library; delete data.library_recent;
    assert.throws(() => collect(storage(data)), /No library data/);
});

test('A missing library part is explicitly labeled and only the expected three storage entries are read', () => {
    const data = fixture(); delete data.library;
    const reads = [];
    const backup = collect({getItem(key) { reads.push(key); return storage(data).getItem(key); }});
    assert.deepEqual(reads, ['profile', 'library', 'library_recent']);
    assert.equal(backup.localLibraryParts, 1);
    assert.match(backup.notes.join(' '), /titles may be missing/);
    assert.match(files(backup)['Library.html'], /titles may be missing/);
});

test('CSV is UTF-8 with BOM, quotes newlines/commas, and neutralizes spreadsheet formulas; HTML escapes untrusted text', () => {
    const data = fixture();
    data.library.items = {unsafe: item('unsafe', '=HYPERLINK("https://example.com")'),
        html: item('html', '<img src=x onerror=alert(1)>'), newline: item('newline', '日本語, "quote"\nline')};
    data.library_recent.items = {};
    data.profile.addons[0].manifest.name = '\t+danger';
    const output = files(collect(storage(data), now));
    assert.equal(output['Library.csv'][0], '\ufeff');
    assert.ok(output['Library.csv'].includes('"\'=HYPERLINK(""https://example.com"")"'));
    assert.ok(output['Library.csv'].includes('"日本語, ""quote""\nline"'));
    assert.ok(output['Addons.csv'].includes("'\t+danger"));
    assert.ok(!output['Library.html'].includes('<img'));
    assert.ok(output['Library.html'].includes('&lt;img'));
    assert.ok(output['Library.html'].includes("default-src 'none'"));
});

test('Generated ZIP extracts using Python standard library, passes all CRCs, and preserves exact Unicode file bytes', async () => {
    const entries = files(collect(storage(fixture()), now));
    const buffer = Buffer.from(await zip(entries).arrayBuffer());
    const python = process.env.STREMIO_TEST_PYTHON || 'python';
    const check = spawnSync(python, ['-c', 'import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode("utf-8") for n in z.namelist()}))'], {input: buffer, encoding: 'utf8'});
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(JSON.parse(check.stdout), entries);
});

module.exports = {fixture, storage, item};
