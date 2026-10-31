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
    const features = [
        {key: 'autoplay', edits: [autoplay, countdown], break: [autoplay[0], autoplay[0].replace('function(){', 'function (){')]},
        {key: 'volume', edits: [volume, keyboard, storagePair], break: [volume[0], volume[0].replace('function(', 'function (')]},
        {key: 'episodeBlur', edits: beforeEpisodes.map((source, index) => [source, afterEpisodes[index]]),
            break: [beforeEpisodes[0], beforeEpisodes[0].replaceAll('.blurred,', '.blurred /* upstream changed */,')]},
        {key: 'volumeFeedback', edits: [feedbackPair], break: [feedback, feedback.replace('volume&&', 'volume /* upstream changed */&&')]}
    ];
    for (let mask = 0; mask < 16; mask++) {
        let input = original, expectedBody = fullBody;
        for (let index = 0; index < 4; index++) if (!(mask & (1 << index))) {
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
        for (let index = 0; index < 4; index++)
            assert.equal(context.window.__stremioForkCompatibility[features[index].key], Boolean(mask & (1 << index)));
        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'stremio-fork-compatibility');
        execFileSync(executable, [outputFile, outputFile + '.again', '--allow-partial']);
        assert.equal(fs.readFileSync(outputFile + '.again', 'utf8'), output, 'Reloading must not apply edits twice');
        if (mask !== 15)
            assert.throws(() => execFileSync(executable, [inputFile, outputFile + '.strict'], {stdio: 'pipe'}),
                'Release verification must still reject an incompatible current upstream interface');
    }
});
