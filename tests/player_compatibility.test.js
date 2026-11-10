const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');

// player_autoplay.test.js downloads and verifies the current upstream bundle
// first. Exercise the actual compiled patcher against realistic upstream edits.
test('Every combination of upstream changes preserves other fixes and unrelated bundle bytes', () => {
    const original = fs.readFileSync('.build-cache/player-autoplay/original.js', 'utf8');
    const full = fs.readFileSync('.build-cache/player-autoplay/patched.js', 'utf8');
    const executable = process.env.STREMIO_BUNDLE_PATCH || 'cmake-build-release-x64/player-bundle-patch.exe';
    const folder = '.build-cache/player-compatibility';
    fs.mkdirSync(folder, {recursive: true});
    const footerStart = bundle => bundle.lastIndexOf('\n;window.__stremioForkAutoplayPatched=');
    const fullBody = full.slice(0, footerStart(full));
    function pair(pattern) {
        const before = original.match(pattern)?.[0], after = fullBody.match(pattern)?.[0];
        assert.ok(before && after && before !== after);
        return [before, after];
    }
    const autoplay = pair(/\.useCallback\(function\(\)\{[^{}]*window\.history\.back\(\)[^{}]*\},\[[^\]]+\]\)/);
    const countdown = pair(/\.useEffect\(function\(\)\{[^{}]*\.bingeWatching[^{}]*\},\[[^\]]+\]\)/);
    const volume = pair(/\.useCallback\(function\([\w$]+\)\{[\w$]+\.setProp\("volume",Math\.min\([\w$]+,Number\([\w$]+\.maxVolume\)\)\)\},\[[^\]]*\]\)/);
    const keyboard = pair(/window\.removeEventListener\("wheel",[\w$]+\)\}\},\[[^\]]+\]\)/);
    const storage = original.match(/localStorage\.setItem\("localProfile",JSON\.stringify\(([\w$]+)\)\)/);
    assert.ok(storage);
    const storagePair = [storage[0], storage[0] + `,window.dispatchEvent(new CustomEvent("stremio-fork-volume-limit",{detail:Number(${storage[1]}.maxVolume)}))`];
    assert.ok(fullBody.includes(storagePair[1]));
    function episodeSources(bundle) {
        const context = {window: {}};
        const anchor = '(()=>{var e;o.g.importScripts';
        assert.ok(bundle.includes(anchor));
        vm.runInNewContext(bundle.replace(anchor, 'window.episodeModules=a;return;' + anchor), context);
        return Object.values(context.window.episodeModules).map(factory => factory.toString())
            .filter(source => source.includes('.blurred') && source.includes('renderFallback'));
    }
    const beforeEpisodes = episodeSources(original), afterEpisodes = episodeSources(fullBody);
    assert.equal(beforeEpisodes.length, 2);
    assert.equal(afterEpisodes.length, 2);
    const feedback = original.match(/null!==([\w$]+)\.state\.volume&&[\w$]+\?[\w$]+\.createElement\([\w$]+,\{muted:\1\.state\.muted,volume:\1\.state\.volume\}\):null/)[0];
    const feedbackPair = [feedback, feedback.replace(/&&[\w$]+\?/, '?')];
    assert.ok(fullBody.includes(feedbackPair[1]));
    function moduleSources(bundle) {
        const context = {window: {}};
        const anchor = '(()=>{var e;o.g.importScripts';
        vm.runInNewContext(bundle.replace(anchor, 'window.libraryModules=a;return;' + anchor), context);
        return Object.values(context.window.libraryModules).map(factory => factory.toString());
    }
    const [beforeModules, afterModules] = [moduleSources(original), moduleSources(fullBody)];
    const libraryEdits = [
        source => source.includes('removable:"library"===') && source.includes('catalog.map'),
        source => source.includes('LIBRARY_PLAY') && source.includes('LibraryItemMarkAsWatched'),
        source => source.includes('["board-content"]') && source.includes('["board-container"]')
    ].map(predicate => {
        const before = beforeModules.find(predicate), after = afterModules.find(predicate);
        assert.ok(before && after && before !== after);
        return [before, after];
    });
    const library = libraryEdits[0];
    const features = [
        {key: 'autoplay', edits: [autoplay, countdown], break: [autoplay[0], autoplay[0].replace('function(){', 'function (){')]},
        {key: 'volume', edits: [volume, keyboard, storagePair], break: [volume[0], volume[0].replace('function(', 'function (')]},
        {key: 'episodeBlur', edits: beforeEpisodes.map((source, index) => [source, afterEpisodes[index]]),
            break: [beforeEpisodes[0], beforeEpisodes[0].replaceAll('.blurred,', '.blurred /* upstream changed */,')]},
        {key: 'volumeFeedback', edits: [feedbackPair], break: [feedback, feedback.replace('volume&&', 'volume /* upstream changed */&&')]},
        {key: 'libraryDetails', edits: libraryEdits, break: [library[0], library[0].replace('removable:"library"===', 'removable:/* upstream changed */"library"===')]}
    ];
    for (let mask = 0; mask < 32; mask++) {
        let input = original, expectedBody = fullBody;
        for (let index = 0; index < 5; index++) if (!(mask & (1 << index))) {
            const feature = features[index];
            input = input.replace(...feature.break);
            for (const [before, after] of feature.edits) expectedBody = expectedBody.replace(after, before);
            expectedBody = expectedBody.replace(...feature.break);
        }
        const inputFile = path.join(folder, `input-${mask}.js`), outputFile = path.join(folder, `output-${mask}.js`);
        fs.writeFileSync(inputFile, input);
        execFileSync(executable, [inputFile, outputFile, '--allow-partial']);
        const output = fs.readFileSync(outputFile, 'utf8');
        new vm.Script(output);
        const start = footerStart(output);
        assert.ok(start >= 0);
        assert.equal(output.slice(0, start), expectedBody, `Only compatible feature edits for combination ${mask}`);
        const events = [];
        const context = {window: {dispatchEvent: event => events.push(event)},
            CustomEvent: function(type, data) { this.type = type; this.detail = data.detail; }};
        vm.runInNewContext(output.slice(start), context);
        for (let index = 0; index < 5; index++)
            assert.equal(context.window.__stremioForkCompatibility[features[index].key], Boolean(mask & (1 << index)));
        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'stremio-fork-compatibility');
        execFileSync(executable, [outputFile, outputFile + '.again', '--allow-partial']);
        assert.equal(fs.readFileSync(outputFile + '.again', 'utf8'), output, 'Reloading must not apply edits twice');
        if (mask !== 31)
            assert.throws(() => execFileSync(executable, [inputFile, outputFile + '.strict'], {stdio: 'pipe'}),
                'Release verification must still reject an incompatible current upstream interface');
    }
    const libraryWithoutLists = library[1]
        .replace(/\|\|window\.__stremioForkLists\?\.hasListRoute\(\)/, '')
        .replace(/\(window\.__stremioForkLists\?\.library\.bind\(null,([\w$]+),([\w$]+),[\w$,]+\)\|\|\1\.createElement\.bind\(null,\2\)\)/, '$1.createElement.bind(null,$2)');
    // A previous release's patched cache can be upgraded in place. Build its
    // Library module from the old hook, keeping the detail-route override.
    const oldLibrary = libraryWithoutLists.replace(/([\w$]+)\.createElement\.bind\(null,([\w$]+)\)\(/, '$1.createElement($2,');
    const oldBody = fullBody.replace(library[1], oldLibrary)
        .replace(libraryEdits[1][1], libraryEdits[1][0]).replace(libraryEdits[2][1], libraryEdits[2][0]);
    const oldFooter = full.slice(footerStart(full)).replace(';window.__stremioForkCustomListsPatched=true', '')
        .replace('CompatibilityV6', 'CompatibilityV5');
    const checkPatch = (name, input, options = []) => {
        const from = path.join(folder, name + '.js'), to = from + '.patched';
        fs.writeFileSync(from, input);
        execFileSync(executable, [from, to, ...options], {stdio: 'pipe'});
        return fs.readFileSync(to, 'utf8');
    };
    assert.equal(checkPatch('cache-v5', oldBody + oldFooter), full);
    const originalBoard = libraryEdits[2][0];
    const changedBoard = originalBoard.replace('["board-content"],onScroll:', '["board-content"],onScroll:/* upstream changed */');
    assert.notEqual(changedBoard, originalBoard);
    const changed = original.replace(originalBoard, changedBoard);
    assert.throws(() => checkPatch('changed-board-strict', changed), /Custom Library lists are unavailable/);
    const guarded = checkPatch('changed-board', changed, ['--allow-partial']);
    assert.equal(guarded.slice(0, footerStart(guarded)), oldBody.replace(originalBoard, changedBoard));
    assert.ok(guarded.includes('__stremioForkCustomListsPatched=false;'));
    assert.ok(guarded.includes('__stremioForkLibraryDetailsPatched=true;'));

    const boardHook = originalBoard.match(/[\w$]+\.createElement\("div",\{ref:[\w$]+,className:[\w$]+\["board-content"\],onScroll:[\w$]+\},/)?.[0];
    assert.ok(boardHook);
    const duplicateHook = `\n;void function(){return ${boardHook}null)};`;
    const ambiguous = checkPatch('duplicate-board-hook', original + duplicateHook, ['--allow-partial']);
    assert.equal(ambiguous.slice(0, footerStart(ambiguous)), oldBody + duplicateHook,
        'A duplicate Home hook anywhere in the bundle must leave all custom list hooks untouched');
    assert.ok(ambiguous.includes('__stremioForkCustomListsPatched=false;'));
});
