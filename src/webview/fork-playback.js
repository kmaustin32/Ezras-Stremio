(() => {
    'use strict';
    const version = '3.0.1-beta.2';
    const shaderNames = {'1': 'Anime4K A', '2': 'Anime4K B', '3': 'Anime4K C', '4': 'Anime4K A+A',
        '5': 'Anime4K B+B', '6': 'Anime4K C+A', '7': 'FSR', '8': 'Off', custom: 'Custom shaders'};
    const modes = {fit: 'Fit', crop: 'Crop', stretch: 'Stretch'};
    function trackLanguage(value) {
        if (typeof value !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value)) return '';
        try {return Intl.getCanonicalLocales(value)[0].toLowerCase();} catch {return '';}
    }

    function mediaRoute(hash) {
        const path = hash.split('?')[0];
        const parts = path.split('/');
        const [, page, stream, provider, metaProvider, type, id, video] = parts;
        if (page !== 'player' || !stream || provider === undefined || metaProvider === undefined ||
            !['series', 'movie'].includes(type) || !id || !video || parts.length !== 8) return null;
        try {
            return {type, id: decodeURIComponent(id), video: decodeURIComponent(video),
                details: '#/detail/' + type + '/' + encodeURIComponent(decodeURIComponent(id)) + '/' + encodeURIComponent(decodeURIComponent(video))};
        } catch {return null;}
    }

    function shaderMode(data) {
        const files = (Array.isArray(data) ? data : typeof data === 'string' ? data.split(';') : [])
            .filter(value => typeof value === 'string' && value).map(value => value.split(/[\\/]/).pop());
        if (!files.length) return '8';
        if (files.length === 1 && files[0] === 'FSR.glsl') return '7';
        const restore = 'Restore_CNN_VL', soft = 'Restore_CNN_Soft_VL', upscale = 'Upscale_CNN_x2_VL';
        const denoise = 'Upscale_Denoise_CNN_x2_VL', middle = 'Restore_CNN_M';
        const downscale = ['AutoDownscalePre_x2', 'AutoDownscalePre_x4'];
        const patterns = [[restore, upscale, ...downscale], [soft, upscale, ...downscale], [denoise, ...downscale],
            [restore, upscale, middle, ...downscale], [soft, upscale, ...downscale, 'Restore_CNN_Soft_M'],
            [denoise, ...downscale, middle]];
        const index = patterns.findIndex(parts => ['Clamp_Highlights', ...parts, 'Upscale_CNN_x2_M']
            .map(name => 'Anime4K_' + name + '.glsl').join(';') === files.join(';'));
        return index < 0 ? 'custom' : String(index + 1);
    }

    function matchingTrack(tracks, type, language) {
        const lang = trackLanguage(language);
        if (!lang) return null;
        const candidates = tracks.filter(track => track?.type === type && Number.isSafeInteger(track.id) && track.id > 0);
        return (candidates.find(track => trackLanguage(track.lang) === lang) ??
            candidates.find(track => trackLanguage(track.lang).split('-')[0] === lang.split('-')[0]))?.id ?? null;
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = {mediaRoute, shaderMode, matchingTrack};
        return;
    }
    if (window.top !== window.self || !window.chrome?.webview || !window.__stremioForkControls ||
        window.__ezrasPlayback) return;

    const properties = ['glsl-shaders', 'border-background', 'track-list', 'time-pos', 'seekable',
        'paused-for-cache', 'frame-drop-count', 'decoder-frame-drop-count', 'current-vo', 'hwdec-current', 'video-params'];
    const info = Object.create(null);
    const recent = [];
    const shaderRequests = new Map();
    let active = false, mode = 'fit', shader = '8', pending, loaded, recovery, button, dialog;
    let ui = {};
    const send = (event, args = []) => window.chrome.webview.postMessage(JSON.stringify({
        type: 6, object: 'transport', method: 'handleInboundJSON', id: 1020, args: [event, args]
    }));
    const record = (name, data = {}) => {
        recent.push({seconds: Math.round(performance.now() / 100) / 10, event: name, ...data});
        if (recent.length > 40) recent.shift();
    };
    function preferenceKey(route) {
        try {
            const user = JSON.parse(localStorage.getItem('profile') || '{}').auth?.user;
            return 'ezras-stremio-series:' + encodeURIComponent(user?._id ?? user?.id ?? 'local') + ':' + encodeURIComponent(route.id);
        } catch {return null;}
    }
    function readPreference(route) {
        if (route?.type !== 'series') return null;
        try {return JSON.parse(localStorage.getItem(preferenceKey(route)) || 'null');} catch {return null;}
    }
    function applyTracks(tracks) {
        if (!loaded?.preference || loaded.hash !== location.hash || !Array.isArray(tracks)) return;
        for (const [type, prop] of [['audio', 'aid'], ['sub', 'sid']]) {
            const language = loaded.preference[type];
            if (!language || loaded[prop]) continue;
            const id = type === 'sub' && language === 'off' ? 'no' : matchingTrack(tracks, type, language);
            if (id === null) continue;
            loaded[prop] = true;
            send('set-fork-series-track', [loaded.serial, prop, String(id)]);
        }
    }
    function requestShader(key) {
        record('Shader shortcut', {mode: shaderNames[key]});
        const at = performance.now();
        shaderRequests.set(key, at);
        pending = shader === key && !pending ? null : {key, at};
        renderStatus();
        setTimeout(renderStatus, 3000);
    }
    function safeLabel(value) {
        return typeof value === 'string' && /^[a-z0-9-]{1,32}$/i.test(value) ? value : null;
    }
    function report() {
        const video = info['video-params'];
        const number = value => Number.isFinite(value) && value >= 0 ? value : null;
        return JSON.stringify({application: "Ezra's Stremio", version,
            renderer: safeLabel(info['current-vo']), hardwareDecoding: safeLabel(info['hwdec-current']),
            dimensions: {width: number(video?.w), height: number(video?.h)}, shader: shaderNames[shader],
            framing: modes[mode], borderBlur: info['border-background'] === 'blur',
            buffering: info['paused-for-cache'] === true, droppedFrames: number(info['frame-drop-count']),
            decoderDroppedFrames: number(info['decoder-frame-drop-count']), recent}, null, 2);
    }

    function optionMenu(label, choices) {
        const row = document.createElement('label');
        const menu = document.createElement('select');
        menu.setAttribute('aria-label', label);
        for (const [value, name] of Object.entries(choices)) menu.add(new Option(name, value));
        row.append(label, menu);
        dialog.append(row);
        return menu;
    }
    function action(text, handler) {
        const item = document.createElement('button');
        item.type = 'button'; item.textContent = text;
        item.addEventListener('click', handler);
        dialog.append(item);
        return item;
    }
    function status(text) {
        const item = document.createElement('p');
        item.setAttribute('role', 'status');
        item.textContent = text;
        dialog.append(item);
        return item;
    }
    function renderStatus() {
        if (!dialog?.open) return;
        ui.shader.value = shader;
        ui.mode.value = mode;
        ui.blur.checked = info['border-background'] === 'blur';
        ui.shaderStatus.textContent = pending
            ? (performance.now() - pending.at >= 3000 ? 'Waiting for mpv to confirm ' : 'Applying ') + shaderNames[pending.key] + '…'
            : 'Current shaders: ' + shaderNames[shader];
    }
    function addPreferences(route) {
        const old = readPreference(route);
        const languageNames = new Intl.DisplayNames([navigator.language], {type: 'language'});
        const languageOptions = (type, preferred) => {
            const choices = {'': 'App default'};
            if (type === 'sub') choices.off = 'Off';
            for (const track of Array.isArray(info['track-list']) ? info['track-list'] : []) {
                const lang = trackLanguage(track?.lang);
                if (track?.type === type && lang) choices[lang] = languageNames.of(lang);
            }
            const lang = trackLanguage(preferred);
            if (lang) choices[lang] = languageNames.of(lang);
            return choices;
        };
        const audio = optionMenu('Series audio language', languageOptions('audio', old?.audio));
        const subtitles = optionMenu('Series subtitle language', languageOptions('sub', old?.sub));
        audio.value = trackLanguage(old?.audio);
        subtitles.value = old?.sub === 'off' ? 'off' : trackLanguage(old?.sub);
        const picture = document.createElement('input'); picture.type = 'checkbox'; picture.checked = Boolean(old?.picture);
        const remember = document.createElement('label');
        remember.append(picture, 'Remember the current shader and framing for this series');
        dialog.append(remember);
        const result = status('');
        action('Save series preferences', () => {
            const key = preferenceKey(route);
            if (!key || mediaRoute(location.hash)?.details !== route.details) return;
            try {
                if (!audio.value && !subtitles.value && !picture.checked) localStorage.removeItem(key);
                else localStorage.setItem(key, JSON.stringify({audio: audio.value, sub: subtitles.value,
                    picture: picture.checked ? {shader: shader === 'custom' ? '' : shader, mode} : null}));
                result.textContent = 'Saved for the next video in this series.';
            } catch {result.textContent = 'The preferences could not be saved.';}
        });
    }

    function openPicture() {
        if (dialog?.open) return;
        const route = mediaRoute(location.hash);
        dialog = document.createElement('dialog');
        dialog.className = 'fork-list-dialog ezras-picture-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-label', 'Picture and playback');
        for (const event of ['click', 'dblclick', 'mousedown', 'keydown']) dialog.addEventListener(event, ev => ev.stopPropagation());
        dialog.addEventListener('close', () => {dialog.remove(); dialog = null; ui = {};}, {once: true});
        const title = document.createElement('h2'); title.textContent = 'Picture and playback'; dialog.append(title);
        ui.shader = optionMenu('Shaders', shaderNames);
        ui.shader.querySelector('[value="custom"]').disabled = true;
        ui.shader.onchange = () => {
            const key = ui.shader.value;
            requestShader(key);
            send('mpv-command', ['keypress', 'CTRL+' + key]);
        };
        ui.shaderStatus = status('');
        ui.mode = optionMenu('Framing', modes);
        ui.mode.onchange = () => send('set-fork-display-mode', [ui.mode.value]);
        const border = document.createElement('label');
        ui.blur = document.createElement('input'); ui.blur.type = 'checkbox';
        ui.blur.onchange = () => send('toggle-border-blur');
        border.append(ui.blur, ' Ambient border blur');
        dialog.append(border);
        if (route?.type === 'series') addPreferences(route);
        if (route) {
            const resume = document.createElement('input'); resume.type = 'checkbox'; resume.checked = true;
            resume.disabled = info.seekable !== true || !Number.isFinite(info['time-pos']) || info['time-pos'] < 1;
            const label = document.createElement('label'); label.append(resume, ' Resume near the current position');
            dialog.append(label);
            action('Change source', () => {
                if (mediaRoute(location.hash)?.details !== route.details) return;
                recovery = resume.checked && !resume.disabled
                    ? {details: route.details, seconds: Math.floor(info['time-pos']), serial: loaded?.serial} : null;
                dialog.close();
                location.hash = route.details;
            });
        }
        const copyStatus = status('');
        action('Copy playback diagnostics', async () => {
            const data = report();
            const panel = dialog;
            try {await navigator.clipboard.writeText(data); copyStatus.textContent = 'Playback diagnostics copied.';}
            catch {
                if (!panel.open) return;
                let field = panel.querySelector('textarea');
                if (!field) {
                    field = document.createElement('textarea');
                    field.readOnly = true; field.setAttribute('aria-label', 'Playback diagnostics');
                    panel.append(field);
                }
                field.value = data; field.select();
                copyStatus.textContent = 'Copy the selected playback diagnostics.';
            }
        });
        action('Close', () => dialog.close());
        document.body.append(dialog);
        dialog.showModal();
        renderStatus();
    }

    function updateVersion() {
        const settings = document.querySelector('[class*="settings-container"]');
        if (!settings) return;
        const other = settings.querySelector('[class*="version-info-label"]:not(#ezras-stremio-version)');
        const target = other?.parentElement ?? settings.querySelector('[class*="sections-container"]');
        if (!target) return;
        let label = settings.querySelector('#ezras-stremio-version');
        if (!label) {
            label = document.createElement('div'); label.id = 'ezras-stremio-version';
            label.textContent = "Ezra's Stremio " + version;
            label.title = version;
        }
        if (other && label.className !== other.className) label.className = other.className;
        if (label.parentElement !== target) {
            if (other) other.before(label);
            else target.prepend(label);
        }
    }

    window.__ezrasPlayback = {update(player, isActive) {
        updateVersion();
        const toolbar = player?.querySelector('[class*="control-bar-buttons-menu-container"]');
        active = Boolean(isActive && toolbar);
        if (!active) {button?.remove(); return;}
        if (!button) {
            button = document.createElement('button'); button.type = 'button';
            button.id = 'ezras-picture-settings'; button.textContent = 'Picture';
            button.title = 'Picture and playback settings';
            button.addEventListener('click', event => {event.stopPropagation(); openPicture();});
            button.addEventListener('mousedown', event => event.stopPropagation());
        }
        if (button.parentElement !== toolbar) toolbar.append(button);
    }};
    window.addEventListener('hashchange', () => {
        if (recovery && location.hash.split('?')[0] !== recovery.details &&
            mediaRoute(location.hash)?.details !== recovery.details) recovery = null;
        if (loaded?.hash !== location.hash) loaded = null;
        if (dialog?.open) dialog.close();
    }, true);
    window.addEventListener('keydown', event => {
        if (active && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !event.repeat &&
            !event.target?.closest?.('input, select, textarea, [contenteditable], dialog') && /^Digit[1-8]$/.test(event.code))
            requestShader(event.code.at(-1));
    }, true);
    window.chrome.webview.addEventListener('message', event => {
        let payload;
        try {payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;} catch {return;}
        const [name, data] = Array.isArray(payload?.args) ? payload.args : [];
        if (name === 'mpv-prop-change' && properties.includes(data?.name)) {
            info[data.name] = data.data;
            if (data.name === 'glsl-shaders') {
                shader = shaderMode(data.data);
                if (pending?.key === shader) {
                    record('Shader confirmed by mpv', {mode: shaderNames[shader], milliseconds: Math.round(performance.now() - pending.at)});
                    pending = null;
                }
                renderStatus();
            } else if (data.name === 'track-list') applyTracks(data.data);
            else if (data.name === 'border-background') renderStatus();
            else if (data.name === 'paused-for-cache') record(data.data ? 'Buffering began' : 'Buffering ended');
        } else if (name === 'display-mode-changed' && Object.hasOwn(modes, data?.mode)) {
            mode = data.mode; renderStatus();
        } else if (name === 'fork-shader-command' && shaderRequests.has(data?.key)) {
            const milliseconds = Math.round(performance.now() - shaderRequests.get(data.key));
            shaderRequests.delete(data.key);
            record(data.accepted ? 'mpv handled shader key' : 'mpv rejected shader key',
                {mode: shaderNames[data.key], milliseconds});
        } else if (name === 'fork-file-loaded' && typeof data?.serial === 'string') {
            const route = mediaRoute(location.hash);
            if (recovery && route?.details === recovery.details && data.serial !== recovery.serial) {
                send('resume-fork-source', [data.serial, String(recovery.seconds)]);
                recovery = null;
            }
            const preference = readPreference(route);
            loaded = {serial: data.serial, hash: location.hash, preference};
            if (Array.isArray(data.tracks)) info['track-list'] = data.tracks;
            if (preference?.picture) {
                const {shader: key, mode: framing} = preference.picture;
                const selected = /^[1-8]$/.test(key) ? key : '';
                if (selected) requestShader(selected);
                send('set-fork-series-picture', [data.serial, selected, Object.hasOwn(modes, framing) ? framing : '']);
            }
            applyTracks(data.tracks);
        }
    });
    const start = () => {
        const style = document.createElement('style');
        style.textContent = `
            #ezras-picture-settings {background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;padding:0 .55rem}
            #ezras-picture-settings:focus-visible {outline:2px solid #aaaaf0}
            .ezras-picture-dialog {max-height:90vh;max-width:min(32rem,calc(100vw - 2rem));overflow:auto;background:#161a26;color:#fff}
            .ezras-picture-dialog label {display:flex;justify-content:space-between;align-items:center;gap:.75rem;margin:.65rem 0}
            .ezras-picture-dialog select,.ezras-picture-dialog textarea {font:inherit;color:inherit;background:#222635;border:1px solid #7272c2;border-radius:.4rem;padding:.35rem}
            .ezras-picture-dialog button {margin:.35rem .35rem .35rem 0}
            .ezras-picture-dialog textarea {display:block;width:100%;min-height:7rem}
            .fork-list-management > div {padding:.65rem 0;border-bottom:1px solid #7272c255}
            .fork-list-management .fork-list-dialog-actions {flex-wrap:wrap;margin-top:.4rem}`;
        document.head.append(style);
        for (const property of properties) send('mpv-observe-prop', [property]);
        updateVersion();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})();
