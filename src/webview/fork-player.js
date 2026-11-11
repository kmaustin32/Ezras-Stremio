(() => {
    'use strict';
    if (window.top !== window.self || !window.chrome?.webview || window.__stremioForkControls) return;
    const hosts = new Set(['stremio.zarg.me', 'zaarrg.github.io', 'web.stremio.com']);
    if (!hosts.has(location.hostname)) return;
    window.__stremioForkControls = true;

    const logos = {symbol: '__FORK_SYMBOL__', logo: '__FORK_WORDMARK__', icon: '__FORK_ICON__'};
    const labels = {fit: 'Fit', crop: 'Crop', stretch: 'Stretch'};
    const next = {fit: 'Crop', crop: 'Stretch', stretch: 'Fit'};
    const icons = {fit: '__FORK_FIT_SVG__', crop: '__FORK_CROP_SVG__', stretch: '__FORK_STRETCH_SVG__'};
    let state = {mode: 'fit', active: false};
    let volume = 100;
    let startupVolume = null;
    let muted = false;
    let maximum = 130;
    let pipEnabled = false;
    let scheduled = false;
    let button;
    let pipButton;
    let compatibility = null;
    let compatibilityStatus;
    let paused = false;
    let controlPlayer = null;
    let controlTimer = null;
    let controlsEligible = false;
    let controlsBlocked = true;
    let pointerHeld = false;
    let keyboardFocus = true;
    const animationStorageKey = 'stremio-fork-control-animation-duration';
    const animationDurations = ['0', '0.1', '0.25', '0.5', '0.75', '1'];
    let animationDuration = '0.5';
    let animationStatus = '';
    const timeoutStorageKey = 'stremio-fork-control-timeout';
    const controlTimeouts = ['0.5', '1', '2', '5', 'never'];
    let controlTimeout = '1';
    let timeoutStatus = '';
    const skipLookupKey = 'stremio-fork-skip-lookup';
    let skipLookupEnabled = readSkipLookup();
    let skipMedia = null;
    let skipButton;
    let shownSkip = null;
    const watchedAccentKey = 'stremio-fork-watched-accent';
    const watchedAccents = {
        '#7272C2': 'Purple', '#DEA066': 'Amber', '#61D1C7': 'Teal',
        '#E08EB3': 'Dusty rose', '#B6D283': 'Sage'
    };
    const defaultWatchedAccent = '#DEA066';
    let watchedAccent = defaultWatchedAccent;
    const appliedStyles = new WeakMap();
    const playerShortcuts = [
        {key: 'CTRL+b', keys: ['Ctrl', 'B'], label: 'Toggle ambient border blur'},
        {key: 'CTRL+SHIFT+c', keys: ['Ctrl', 'Shift', 'C'], label: 'Detect baked-in black bars / restore framing', detail: 'Use during a clear, playing scene. The detected crop stays for this video; press again to restore. Blur is a separate toggle.'},
        {key: 'CTRL+SHIFT+f', keys: ['Ctrl', 'Shift', 'F'], label: 'Cycle Fit → Crop → Stretch', detail: 'Each new video starts in Fit.'},
        {key: 'CTRL+s', keys: ['Ctrl', 'S'], label: 'Toggle subtitles', detail: 'Keeps hidden player controls out of view.'},
        {key: 'CTRL+1', keys: ['Ctrl', '1'], label: 'Anime4K: Mode A (HQ)'},
        {key: 'CTRL+2', keys: ['Ctrl', '2'], label: 'Anime4K: Mode B (HQ)'},
        {key: 'CTRL+3', keys: ['Ctrl', '3'], label: 'Anime4K: Mode C (HQ)'},
        {key: 'CTRL+4', keys: ['Ctrl', '4'], label: 'Anime4K: Mode A+A (HQ)'},
        {key: 'CTRL+5', keys: ['Ctrl', '5'], label: 'Anime4K: Mode B+B (HQ)'},
        {key: 'CTRL+6', keys: ['Ctrl', '6'], label: 'Anime4K: Mode C+A (HQ)'},
        {key: 'CTRL+7', keys: ['Ctrl', '7'], label: 'FSR shader'},
        {key: 'CTRL+8', keys: ['Ctrl', '8'], label: 'Clear GLSL shaders'},
        {key: 'F1', keys: ['F1'], label: 'Toggle audio normalization'},
        {key: 'F2', keys: ['F2'], label: 'Cycle subtitle overrides: Force → Strip → No'},
        {key: 'k', keys: ['K'], label: 'Play / pause'},
        {key: 'MBTN_LEFT', keys: ['Left click'], label: 'Play / pause'},
        {key: 'j', keys: ['J'], label: 'Seek backward 10 seconds'},
        {key: 'l', keys: ['L'], label: 'Seek forward 10 seconds'},
        {key: '[', keys: ['['], label: 'Decrease playback speed by 0.25'},
        {key: ']', keys: [']'], label: 'Increase playback speed by 0.25'},
        {key: 'Tab', keys: ['Tab'], label: 'Skip anime intro', detail: 'Use after the intro starts.'}
    ];

    function updatePlayerShortcuts() {
        const sections = document.querySelectorAll('[class*="settings-container"] [class*="section-container"]');
        for (const section of sections) {
            const title = section.querySelector(':scope > [class*="section-title"]');
            const isPlayerShortcuts = title && Array.from(title.childNodes).some(node =>
                node.nodeType === Node.TEXT_NODE && node.textContent.trim() === 'Player Shortcuts');
            const existing = section.querySelector(':scope > .stremio-fork-shortcuts');
            if (!isPlayerShortcuts) {
                if (section.hasAttribute('data-stremio-fork-shortcuts')) section.removeAttribute('data-stremio-fork-shortcuts');
                existing?.remove();
                continue;
            }
            if (existing) continue;
            // Keep React-owned upstream rows intact. Hide them only in this section
            // and append our catalog, so later React updates and navigation remain safe.
            const row = section.querySelector(':scope > [class*="option-container"]');
            const name = row?.querySelector('[class*="option-name-container"]');
            const input = row?.querySelector('[class*="option-input-container"]');
            const label = name?.querySelector('[class*="label"]');
            if (!row || !name || !input || !label) continue;
            const catalog = document.createElement('div');
            catalog.className = 'stremio-fork-shortcuts';
            const note = document.createElement('p');
            note.className = 'stremio-fork-shortcuts-note';
            note.textContent = 'Defaults for the built-in mpv player. Your custom input.conf may change the mpv bindings. Picture-in-Picture is available beside fullscreen in the player.';
            catalog.append(note);
            for (const shortcut of playerShortcuts) {
                const entry = document.createElement('div');
                entry.className = row.className;
                entry.dataset.shortcut = shortcut.key;
                const description = document.createElement('div');
                description.className = name.className;
                const text = document.createElement('div');
                text.className = label.className;
                text.textContent = shortcut.label;
                description.append(text);
                if (shortcut.detail) {
                    const detail = document.createElement('p');
                    detail.className = 'stremio-fork-shortcuts-note';
                    detail.textContent = shortcut.detail;
                    description.append(detail);
                }
                const binding = document.createElement('div');
                binding.className = input.className;
                binding.setAttribute('aria-label', shortcut.keys.join(' + '));
                shortcut.keys.forEach((key, index) => {
                    if (index) {
                        const plus = document.createElement('span');
                        plus.textContent = '+';
                        binding.append(plus);
                    }
                    const kbd = document.createElement('kbd');
                    kbd.textContent = key;
                    binding.append(kbd);
                });
                entry.append(description, binding);
                catalog.append(entry);
            }
            section.setAttribute('data-stremio-fork-shortcuts', '');
            section.append(catalog);
        }
    }

    function setStyle(element, name, value) {
        if (!element) return;
        const saved = appliedStyles.get(element) || {};
        if (saved[name]?.value === value && saved[name].actual === element.style.getPropertyValue(name)) return;
        element.style.setProperty(name, value);
        saved[name] = {value, actual: element.style.getPropertyValue(name)};
        appliedStyles.set(element, saved);
    }

    function updateVolume(player) {
        const sliders = player?.querySelectorAll('[class*="volume-slider"]') || [];
        const threshold = Math.min(100 / maximum * 100, 100);
        const gradient = maximum > 100 ? `linear-gradient(to right, var(--primary-foreground-color,#fff) 0%, var(--primary-foreground-color,#fff) ${threshold}%, #ffa500 ${threshold}%, #ff0000 100%)` : '';
        for (const slider of sliders) {
            for (const track of slider.querySelectorAll('[class*="track-after"], [class*="Slider__track__"], [class*="track-"]:not([class*="track-before"]):not([class*="track-after"])')) {
                setStyle(track, 'background-image', gradient);
            }
            const fraction = maximum > 100 && !muted ? Math.max(0, Math.min((volume - 100) / (maximum - 100), 1)) : 0;
            const color = !muted && volume > 100 && maximum > 100 ?
                `rgb(255, ${Math.round(165 * (1 - fraction))}, 0)` : 'var(--primary-foreground-color,#fff)';
            setStyle(slider.querySelector('[class*="thumb"]'), 'background-color', color);
            slider.setAttribute('aria-label', muted ? 'Volume muted' : `Volume ${Math.round(volume)}%`);
        }
    }

    function send(event, args = []) {
        window.chrome.webview.postMessage(JSON.stringify({
            type: 6, object: 'transport', method: 'handleInboundJSON', id: 1001,
            args: [event, args]
        }));
    }

    function readSkipLookup() {
        try { return localStorage.getItem(skipLookupKey) === 'true'; }
        catch { return false; }
    }

    function chapterSkips(chapters, duration) {
        return chapters.flatMap((chapter, index) => {
            const title = typeof chapter?.title === 'string' ? chapter.title.trim() : '';
            const intro = /^(?:intro(?:duction)?|opening(?: (?:credits|theme))?|op)(?:\s*\d+)?$/i.test(title);
            const outro = /^(?:outro|ending(?: (?:credits|theme))?|end credits|credits|ed)(?:\s*\d+)?$/i.test(title);
            if (!intro && !outro) return [];
            const start = chapter.time;
            const end = index + 1 < chapters.length ? chapters[index + 1]?.time : outro ? duration : null;
            return validSkip(start, end, duration) ? [{kind: intro ? 'intro' : 'outro', start, end}] : [];
        });
    }

    function validSkip(start, end, duration) {
        return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < end && end <= duration;
    }

    function skipLookupQuery(hash, duration) {
        const route = hash.match(/^#\/player\/[^/]+\/[^/]*\/[^/]*\/(series|movie)\/(tt\d{7,12})\/([^/?]+)(?:\?.*)?$/);
        if (!route) return null;
        const [, type, id, video] = route;
        const query = new URLSearchParams({imdb_id: id, duration_ms: String(Math.round(duration * 1000)),
            details: 'true', merge_unknown: 'false'});
        if (type === 'series') {
            let episode;
            try { episode = decodeURIComponent(video).match(/^(tt\d+):(\d{1,4}):(\d{1,5})$/); }
            catch { return null; }
            if (!episode || episode[1] !== id) return null;
            query.set('season', episode[2]);
            query.set('episode', episode[3]);
        } else if (video !== id) return null;
        return query;
    }

    function prepareSkips(media) {
        media.local = chapterSkips(media.chapters, media.duration);
        media.remote = [];
        media.request?.abort();
        const query = skipLookupEnabled && skipLookupQuery(media.hash, media.duration);
        const missing = ['intro', 'outro'].filter(kind => !media.local.some(segment => segment.kind === kind));
        if (!query || !missing.length) return;
        const request = new AbortController();
        media.request = request;
        fetch('https://api.theintrodb.org/v4/media?' + query, {
            credentials: 'omit', referrerPolicy: 'no-referrer',
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)])
        }).then(response => response.ok ? response.json() : null).then(result => {
            if (!result || request.signal.aborted || skipMedia !== media || media.hash !== location.hash ||
                !Number.isFinite(result.group_duration_ms) ||
                Math.abs(result.group_duration_ms - media.duration * 1000) > 1000) return;
            if (query.has('season') && (result.type !== 'tv' || result.season !== Number(query.get('season')) ||
                result.episode !== Number(query.get('episode')))) return;
            if (!query.has('season') && result.type !== 'movie') return;
            for (const kind of missing) {
                const entries = result[kind === 'intro' ? 'intro' : 'credits'];
                if (!Array.isArray(entries)) continue;
                for (const entry of entries) {
                    const start = entry?.start_ms === null && kind === 'intro' ? 0 : entry?.start_ms / 1000;
                    const end = entry?.end_ms === null && kind === 'outro' ? media.duration : entry?.end_ms / 1000;
                    if (entry?.start_ms !== null && !Number.isFinite(entry?.start_ms)) continue;
                    if (entry?.end_ms !== null && !Number.isFinite(entry?.end_ms)) continue;
                    if ((kind === 'outro' && entry.start_ms === null) || (kind === 'intro' && entry.end_ms === null)) continue;
                    if (validSkip(start, end, media.duration) &&
                        !media.local.some(segment => start < segment.end && segment.start < end))
                        media.remote.push({kind, start, end});
                }
            }
            schedule();
        }).catch(() => {}); // A missing or unavailable timestamp never interrupts playback.
    }

    function currentSkip() {
        if (!skipMedia || skipMedia.hash !== location.hash || !Number.isFinite(skipMedia.time)) return null;
        const {local, remote, time} = skipMedia;
        const containsTime = segment => segment.start <= time && time < segment.end;
        return local.find(containsTime) || remote.find(containsTime) || null;
    }

    function updateSkipButton(player) {
        const seekBar = player?.querySelector('[class*="seek-bar-container"]');
        const segment = state.active && seekBar && currentSkip();
        if (!segment || playerOverlayOpen('[class*="next-video-popup-container"]')) {
            skipButton?.remove();
            shownSkip = null;
            return;
        }
        if (segment !== shownSkip || skipButton?.parentElement !== player) {
            skipButton?.remove();
            shownSkip = segment;
            const prompt = document.createElement('button');
            prompt.id = 'stremio-fork-skip-segment';
            prompt.type = 'button';
            prompt.textContent = segment.kind === 'intro' ? 'Skip Intro' : 'Skip Outro';
            for (const type of ['mousedown', 'dblclick'])
                prompt.addEventListener(type, event => event.stopPropagation());
            prompt.addEventListener('click', event => {
                event.stopPropagation();
                if (currentSkip() === segment)
                    send('seek-skip-segment', [skipMedia.serial, String(segment.start), String(segment.end)]);
            });
            prompt.addEventListener('keydown', event => {
                if (event.code !== 'Space' && event.code !== 'Enter') return;
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) prompt.click();
            });
            skipButton = prompt;
            player.append(prompt);
        }
        skipButton.toggleAttribute('data-paused', paused);
        // Ignore the toolbar's slide transform so the prompt stays reachable
        // while the rest of the controls are hidden.
        const bar = seekBar.closest('[class*="control-bar-layer"]');
        const barHeight = bar ? bar.getBoundingClientRect().bottom - seekBar.getBoundingClientRect().top : 0;
        const popup = player.querySelector('[class*="next-video-popup-container"]');
        const popupHeight = popup ? player.getBoundingClientRect().bottom - popup.getBoundingClientRect().top : 0;
        setStyle(skipButton, '--stremio-skip-offset', Math.max(barHeight, popupHeight) + 'px');
    }

    function updateSkipLookup(enabled) {
        skipLookupEnabled = enabled;
        if (skipMedia?.duration > 0 && skipMedia.hash === location.hash) prepareSkips(skipMedia);
        schedule();
    }

    function readAnimationDuration() {
        try {
            const saved = localStorage.getItem(animationStorageKey);
            return animationDurations.includes(saved) ? saved : '0.5';
        } catch { return '0.5'; }
    }

    function applyAnimationDuration(value) {
        animationDuration = animationDurations.includes(value) ? value : '0.5';
        const root = document.documentElement;
        const duration = animationDuration + 's';
        if (root.style.getPropertyValue('--stremio-control-animation-duration') !== duration)
            root.style.setProperty('--stremio-control-animation-duration', duration);
        root.toggleAttribute('data-stremio-control-animation-off', animationDuration === '0');
    }

    function readControlTimeout() {
        try {
            const saved = localStorage.getItem(timeoutStorageKey);
            return controlTimeouts.includes(saved) ? saved : '1';
        } catch { return '1'; }
    }

    function applyControlTimeout(value) {
        controlTimeout = controlTimeouts.includes(value) ? value : '1';
        // Apply immediately to an active video, including revealing
        // controls when Never hide is selected in another window.
        controlActivity();
    }

    function updateControlSettings() {
        for (const settings of document.querySelectorAll('[class*="settings-container"]')) {
            const playerLabel = settings.querySelector('[data-section="player"]')?.textContent.trim();
            if (!playerLabel) continue;
            const section = Array.from(settings.querySelectorAll('[class*="section-container"]')).find(candidate =>
                candidate.querySelector(':scope > [class*="section-title"]')?.textContent.trim() === playerLabel);
            if (!section) continue;
            let group = section.querySelector('#stremio-fork-animation-setting');
            if (!group) {
                const row = section.querySelector(':scope > [class*="option-container"]');
                const name = row?.querySelector('[class*="option-name-container"]');
                const input = row?.querySelector('[class*="option-input-container"]');
                const label = name?.querySelector('[class*="label"]');
                if (!row || !name || !input || !label) continue;
                group = document.createElement('div');
                group.id = 'stremio-fork-animation-setting';
                const category = section.querySelector(':scope > [class*="section-category-container"]');
                if (category) {
                    const heading = document.createElement('div'); heading.className = category.className;
                    const title = document.createElement('div');
                    title.className = category.querySelector('[class*="label"]')?.className || label.className;
                    title.textContent = 'Controls'; heading.append(title); group.append(heading);
                }
                const entry = document.createElement('div'); entry.className = row.className;
                const description = document.createElement('div'); description.className = name.className;
                const title = document.createElement('label'); title.className = label.className;
                title.htmlFor = 'stremio-fork-animation-duration'; title.textContent = 'Control animation speed';
                const help = document.createElement('p'); help.className = 'stremio-fork-shortcuts-note';
                help.id = 'stremio-fork-animation-help';
                help.textContent = 'Choose how quickly player controls slide in and out, in seconds. Off shows and hides them instantly. Reduced motion follows your system preference.';
                description.append(title, help);
                const controls = document.createElement('div');
                controls.className = input.className.split(/\s+/).filter(value => value.includes('option-input-container')).join(' ');
                const select = document.createElement('select'); select.id = title.htmlFor;
                select.setAttribute('aria-describedby', help.id);
                animationDurations.forEach((value, index) => {
                    const option = document.createElement('option'); option.value = value;
                    option.textContent = ['Off', '0.1', '0.25', '0.5 (default)', '0.75', '1'][index];
                    select.append(option);
                });
                select.addEventListener('change', () => {
                    if (!animationDurations.includes(select.value)) return;
                    applyAnimationDuration(select.value);
                    animationStatus = '';
                    try { localStorage.setItem(animationStorageKey, animationDuration); }
                    catch { animationStatus = 'Applied for this session. This device could not save the preference.'; }
                    schedule();
                });
                controls.append(select); entry.append(description, controls); group.append(entry);
                const status = document.createElement('p'); status.setAttribute('role', 'status');
                status.className = 'stremio-fork-shortcuts-note'; group.append(status);
                const timeoutEntry = document.createElement('div'); timeoutEntry.className = row.className;
                const timeoutName = document.createElement('div'); timeoutName.className = name.className;
                const timeoutLabel = document.createElement('label'); timeoutLabel.className = label.className;
                timeoutLabel.htmlFor = 'stremio-fork-control-timeout'; timeoutLabel.textContent = 'Control player timeout';
                const timeoutHelp = document.createElement('p'); timeoutHelp.className = help.className;
                timeoutHelp.id = 'stremio-fork-timeout-help';
                timeoutHelp.textContent = 'Choose how long controls stay visible after mouse or keyboard activity, in seconds, while playing or paused. Never hide keeps controls visible. Open menus, keyboard focus and slider interaction keep controls available.';
                timeoutName.append(timeoutLabel, timeoutHelp);
                const timeoutControls = document.createElement('div'); timeoutControls.className = controls.className;
                const timeoutSelect = document.createElement('select'); timeoutSelect.id = timeoutLabel.htmlFor;
                timeoutSelect.setAttribute('aria-describedby', timeoutHelp.id);
                controlTimeouts.forEach((value, index) => {
                    const option = document.createElement('option'); option.value = value;
                    option.textContent = ['0.5', '1 (default)', '2', '5', 'Never hide'][index];
                    timeoutSelect.append(option);
                });
                timeoutSelect.addEventListener('change', () => {
                    if (!controlTimeouts.includes(timeoutSelect.value)) return;
                    applyControlTimeout(timeoutSelect.value);
                    timeoutStatus = '';
                    try { localStorage.setItem(timeoutStorageKey, controlTimeout); }
                    catch { timeoutStatus = 'Applied for this session. This device could not save the preference.'; }
                    schedule();
                });
                timeoutControls.append(timeoutSelect); timeoutEntry.append(timeoutName, timeoutControls);
                const timeoutNote = document.createElement('p'); timeoutNote.id = 'stremio-fork-timeout-status';
                timeoutNote.setAttribute('role', 'status'); timeoutNote.className = help.className;
                group.append(timeoutEntry, timeoutNote);
                const lookupEntry = document.createElement('div'); lookupEntry.className = row.className;
                const lookupName = document.createElement('div'); lookupName.className = name.className;
                const lookupLabel = document.createElement('label'); lookupLabel.className = label.className;
                lookupLabel.htmlFor = 'stremio-fork-skip-lookup'; lookupLabel.textContent = 'Look up skip timestamps';
                const lookupHelp = document.createElement('p'); lookupHelp.className = help.className;
                lookupHelp.id = 'stremio-fork-skip-help';
                lookupHelp.textContent = 'Use TheIntroDB when the video has no labeled intro or outro chapter. Shares the title ID, episode number and runtime with TheIntroDB.';
                lookupName.append(lookupLabel, lookupHelp);
                const lookupControls = document.createElement('div'); lookupControls.className = controls.className;
                const lookup = document.createElement('input'); lookup.type = 'checkbox'; lookup.id = lookupLabel.htmlFor;
                lookup.setAttribute('aria-describedby', lookupHelp.id);
                lookup.addEventListener('change', () => {
                    try { localStorage.setItem(skipLookupKey, String(lookup.checked)); } catch {}
                    updateSkipLookup(lookup.checked);
                });
                lookupControls.append(lookup); lookupEntry.append(lookupName, lookupControls); group.append(lookupEntry);
                // Append only fork-owned nodes; React retains all native rows.
                section.querySelector(':scope > [class*="section-title"]').after(group);
            }
            const select = group.querySelector('select');
            if (select.value !== animationDuration) select.value = animationDuration;
            const status = group.querySelector('[role="status"]');
            if (status.textContent !== animationStatus) status.textContent = animationStatus;
            status.hidden = !animationStatus;
            const timeoutSelect = group.querySelector('#stremio-fork-control-timeout');
            if (timeoutSelect.value !== controlTimeout) timeoutSelect.value = controlTimeout;
            const timeoutNote = group.querySelector('#stremio-fork-timeout-status');
            if (timeoutNote.textContent !== timeoutStatus) timeoutNote.textContent = timeoutStatus;
            timeoutNote.hidden = !timeoutStatus;
            group.querySelector('#stremio-fork-skip-lookup').checked = skipLookupEnabled;
        }
    }

    function clearControlTimer() {
        clearTimeout(controlTimer);
        controlTimer = null;
    }

    function controlsAreBlocked() {
        if (pointerHeld || document.documentElement.className.includes('active-slider-within')) return true;
        const controls = '[class*="nav-bar-layer"], [class*="control-bar-layer"], [class*="side-drawer-button-layer"], #stremio-fork-skip-segment';
        if (keyboardFocus && controlPlayer?.contains(document.activeElement) && document.activeElement.closest(controls)) return true;
        return playerOverlayOpen();
    }

    function playerOverlayOpen(ignore) {
        // Never hide a settings/subtitle/speed menu, episode drawer, popup,
        // error or loading state. These elements are owned by the hosted UI.
        const selectors = '[class*="menu-layer"], [class*="side-drawer-layer"], [class*="error-layer"], [class*="buffering-layer"], [class*="context-menu-container"], [role="dialog"], [role="menu"]';
        return Array.from(document.querySelectorAll(selectors)).some(element => {
            if (ignore && element.matches(ignore)) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
                style.visibility !== 'hidden' && Number(style.opacity) > 0;
        });
    }

    function volumeArrow(event) {
        if (!state.active || !controlPlayer || !['ArrowUp', 'ArrowDown'].includes(event.code) ||
            event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || pointerHeld ||
            document.documentElement.className.includes('active-slider-within')) return false;
        const target = event.target;
        if (!(target instanceof Element) || (target !== document.body && !controlPlayer.contains(target))) return false;
        if (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="combobox"], [class*="slider-container"], [class*="volume-slider"], [class*="seek-bar"]')) return false;
        return !playerOverlayOpen();
    }

    function showControls() {
        if (controlPlayer?.getAttribute('data-stremio-controls') !== 'visible')
            controlPlayer?.setAttribute('data-stremio-controls', 'visible');
    }

    function armControlTimer() {
        clearControlTimer();
        if (!controlsEligible || controlTimeout === 'never' || controlsAreBlocked()) return;
        controlTimer = setTimeout(() => {
            controlTimer = null;
            if (controlsEligible && controlPlayer?.isConnected && !controlsAreBlocked())
                controlPlayer.setAttribute('data-stremio-controls', 'hidden');
        }, Number(controlTimeout) * 1000);
    }

    function controlActivity() {
        if (!controlsEligible) return;
        showControls();
        armControlTimer();
    }

    function updateControls(player) {
        if (player !== controlPlayer) {
            clearControlTimer();
            controlPlayer?.removeAttribute('data-stremio-controls');
            controlPlayer = player;
            controlsEligible = false;
            controlsBlocked = true;
            pointerHeld = false;
        }
        const eligible = Boolean(player && state.active);
        if (!eligible) {
            clearControlTimer();
            player?.removeAttribute('data-stremio-controls');
            controlsEligible = false;
            controlsBlocked = true;
            return;
        }
        const blocked = controlsAreBlocked();
        if (!controlsEligible || blocked) showControls();
        const shouldArm = !controlsEligible || (controlsBlocked && !blocked);
        controlsEligible = true;
        if (blocked) clearControlTimer();
        else if (shouldArm) armControlTimer();
        controlsBlocked = blocked;
    }

    function startControls() {
        const style = document.createElement('style');
        const player = '[class*="player-container"]';
        const chrome = ':is([class*="nav-bar-layer"], [class*="control-bar-layer"], [class*="side-drawer-button-layer"])';
        // One inactivity policy owns active playback, including paused videos.
        // Fall back to community visibility when no native video is active.
        const hidden = `:is([data-stremio-controls="hidden"], html:not([class*="active-slider-within"]) ${player}[class*="overlayHidden"]:not([data-stremio-controls]))`;
        style.textContent = `
            ${player} {overflow:clip!important}
            [data-stremio-controls="hidden"], [data-stremio-controls="hidden"] * {cursor:none!important}
            [data-stremio-controls="visible"] {cursor:auto!important}
            ${player} ${chrome} {
                opacity:1!important;visibility:visible!important;pointer-events:auto!important;
                transition:transform var(--stremio-control-animation-duration,.5s) ease,opacity var(--stremio-control-animation-duration,.5s) ease,visibility 0s!important;
            }
            ${player} :is([class*="nav-bar-layer"], [class*="control-bar-layer"]) {transform:translateY(0)!important}
            ${hidden} ${chrome} {
                opacity:0!important;visibility:hidden!important;pointer-events:none!important;
                transition-delay:0s,0s,var(--stremio-control-animation-duration,.5s)!important;
            }
            ${hidden} [class*="nav-bar-layer"] {transform:translateY(-100%)!important}
            ${hidden} [class*="control-bar-layer"] {transform:translateY(100%)!important}
            @starting-style {
                ${player} [class*="nav-bar-layer"] {transform:translateY(-100%)!important;opacity:0!important}
                ${player} [class*="control-bar-layer"] {transform:translateY(100%)!important;opacity:0!important}
                ${player} [class*="side-drawer-button-layer"] {opacity:0!important}
            }
            html[data-stremio-control-animation-off] ${player} ${chrome},
            html[data-stremio-control-animation-off] ${hidden} ${chrome} {transition:none!important}
            @media (prefers-reduced-motion:reduce) {
                ${player} ${chrome}, ${hidden} ${chrome} {
                    transition:none!important;
                }
            }`;
        document.head.append(style);
        document.addEventListener('mousemove', event => {
            if (controlPlayer?.contains(event.target)) controlActivity();
        }, true);
        document.addEventListener('pointermove', event => {
            if (event.pointerType !== 'mouse' && controlPlayer?.contains(event.target)) controlActivity();
        }, true);
        document.addEventListener('wheel', event => {
            if (controlPlayer?.contains(event.target)) controlActivity();
        }, {capture: true, passive: true});
        document.addEventListener('pointerdown', event => {
            keyboardFocus = false;
            if (!controlPlayer?.contains(event.target)) return;
            pointerHeld = true;
            controlActivity();
        }, true);
        const release = () => {
            if (!pointerHeld) return;
            pointerHeld = false;
            controlActivity();
        };
        window.addEventListener('pointerup', release, true);
        window.addEventListener('pointercancel', release, true);
        let pendingControlPlayer = null;
        const isPlayerKeyTarget = event => controlPlayer?.contains(event.target) || event.target === document.body;
        window.addEventListener('blur', () => {
            pendingControlPlayer = null;
            release();
        });
        document.addEventListener('keydown', event => {
            const inPlayer = isPlayerKeyTarget(event);
            const plainControl = controlsEligible && inPlayer && event.ctrlKey &&
                !event.shiftKey && !event.altKey && !event.metaKey;
            // The modifier arrives before Ctrl+S. Wait for the next key or
            // modifier release before counting a bare Control as activity.
            if (plainControl && event.key === 'Control') {
                pendingControlPlayer = controlPlayer;
                return;
            }
            pendingControlPlayer = null;
            if (plainControl && (event.code || event.key) === 'KeyS') return;
            if (volumeArrow(event)) {
                // The community player still handles volume exactly once. Stop
                // only default scrolling and its spatial-navigation polyfill.
                event.preventDefault();
                event.spatialNavigationPrevented = true;
            } else keyboardFocus = true;
            if (inPlayer) controlActivity();
        }, true);
        document.addEventListener('keyup', event => {
            if (event.key !== 'Control' || event.ctrlKey) return;
            const player = pendingControlPlayer;
            pendingControlPlayer = null;
            if (!player || player !== controlPlayer || !isPlayerKeyTarget(event)) return;
            keyboardFocus = true;
            controlActivity();
        }, true);
        document.addEventListener('focusin', event => {
            if (controlPlayer?.contains(event.target)) controlActivity();
        }, true);
        document.addEventListener('focusout', () => queueMicrotask(() => {
            if (controlPlayer?.getAttribute('data-stremio-controls') === 'visible') armControlTimer();
        }), true);
        document.addEventListener('transitionend', () => {
            if (controlsEligible) updateControls(controlPlayer);
        }, true);
        send('mpv-observe-prop', ['pause']);
    }

    function applyVolumeLimit(value) {
        const setting = Number(value);
        if (!Number.isFinite(setting) || setting < 1 || setting > 1000) return;
        maximum = setting;
        send('set-volume-limit', [String(maximum)]);
        schedule();
    }

    function updatePip(player) {
        // The top navbar's titled button is fullscreen in every UI language.
        const fullscreen = player?.querySelector('[class*="horizontal-nav-bar-container"] [class*="buttons-container"] > [class*="button-container"][title]:not([class*="menu-button-container"]):not(#stremio-fork-pip):not(#stremio-fork-compatibility)');
        if (!fullscreen || !state.active) {
            pipButton?.remove();
            return;
        }
        if (!pipButton) {
            pipButton = fullscreen.cloneNode(true);
            pipButton.id = 'stremio-fork-pip';
            pipButton.removeAttribute('onclick');
            pipButton.tabIndex = 0;
            pipButton.setAttribute('role', 'button');
            const svg = pipButton.querySelector('svg');
            if (svg) {
                svg.setAttribute('viewBox', '0 0 512 512');
                svg.setAttribute('aria-hidden', 'true');
                svg.innerHTML = '<rect x="100" y="126" width="312" height="260" rx="40" fill="none" stroke="currentColor" stroke-width="34"/><rect x="238" y="240" width="150" height="104" rx="16" fill="currentColor" stroke="none"/>';
            }
            for (const type of ['mousedown', 'dblclick'])
                pipButton.addEventListener(type, event => event.stopPropagation());
            pipButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                send('toggle-picture-in-picture');
            });
            pipButton.addEventListener('keydown', event => {
                if (event.code !== 'Enter' && event.code !== 'Space') return;
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) pipButton.click();
            });
        }
        if (pipButton.className !== fullscreen.className) pipButton.className = fullscreen.className;
        const title = pipEnabled ? 'Exit Picture-in-Picture' : 'Picture-in-Picture';
        if (pipButton.title !== title) {
            pipButton.title = title;
            pipButton.setAttribute('aria-label', title);
        }
        const pressed = String(pipEnabled);
        if (pipButton.getAttribute('aria-pressed') !== pressed) pipButton.setAttribute('aria-pressed', pressed);
        if (pipButton.parentElement !== fullscreen.parentElement || pipButton.nextElementSibling !== fullscreen)
            fullscreen.before(pipButton);
    }

    function receiveCompatibility(value) {
        if (!value || !['autoplay', 'volume', 'episodeBlur', 'volumeFeedback', 'libraryDetails'].every(key => typeof value[key] === 'boolean')) return;
        compatibility = {autoplay: value.autoplay, volume: value.volume, episodeBlur: value.episodeBlur, volumeFeedback: value.volumeFeedback, libraryDetails: value.libraryDetails};
        schedule();
    }

    function updateCompatibility(player) {
        const names = {autoplay: 'Autoplay setting fix', volume: 'Maximum volume fix', episodeBlur: 'Unwatched thumbnail blur fix', volumeFeedback: 'Volume popup fix', libraryDetails: 'Library show details fix'};
        const missing = compatibility && Object.keys(names).filter(key => !compatibility[key]);
        const fullscreen = player?.querySelector('[class*="horizontal-nav-bar-container"] #stremio-fork-pip') ||
            player?.querySelector('[class*="horizontal-nav-bar-container"] [class*="buttons-container"] > [class*="button-container"][title]:not([class*="menu-button-container"]):not(#stremio-fork-compatibility)');
        if (!missing?.length || !fullscreen || !state.active) {
            compatibilityStatus?.remove();
            return;
        }
        if (!compatibilityStatus) {
            compatibilityStatus = document.createElement('span');
            compatibilityStatus.id = 'stremio-fork-compatibility';
            compatibilityStatus.tabIndex = 0;
            compatibilityStatus.setAttribute('role', 'status');
            compatibilityStatus.style.cssText = 'display:flex;align-items:center;justify-content:center;color:#ffa500;';
            compatibilityStatus.innerHTML = '<svg viewBox="0 0 512 512" aria-hidden="true" style="width:2.5rem;height:2.5rem"><path d="M256 60L480 440H32Z" fill="none" stroke="currentColor" stroke-width="32" stroke-linejoin="round"/><path d="M256 185v120" stroke="currentColor" stroke-width="36" stroke-linecap="round"/><circle cx="256" cy="370" r="20" fill="currentColor"/></svg>';
        }
        if (compatibilityStatus.className !== fullscreen.className) compatibilityStatus.className = fullscreen.className;
        const title = `The web interface changed. Unavailable: ${missing.map(key => names[key]).join(', ')}. ${missing.length === Object.keys(names).length ? 'Upstream player behavior is in use.' : 'Other compatible fixes remain active.'}`;
        if (compatibilityStatus.title !== title) {
            compatibilityStatus.title = title;
            compatibilityStatus.setAttribute('aria-label', title);
        }
        if (compatibilityStatus.parentElement !== fullscreen.parentElement || compatibilityStatus.nextElementSibling !== fullscreen)
            fullscreen.before(compatibilityStatus);
    }

    function applyWatchedAccent(value) {
        watchedAccent = Object.hasOwn(watchedAccents, value) ? value : defaultWatchedAccent;
        setStyle(document.documentElement, '--stremio-watched-accent', watchedAccent);
        const select = document.getElementById('stremio-fork-watched-accent');
        if (select) select.value = watchedAccent;
    }

    function loadWatchedAccent() {
        let value;
        try { value = localStorage.getItem(watchedAccentKey); } catch {}
        applyWatchedAccent(value);
    }

    function updateAppearanceSettings() {
        const settings = document.querySelector('[class*="settings-container"]');
        const general = settings?.querySelector('[class*="user-info-option-container-"]')?.parentElement;
        if (!general || general.querySelector('#stremio-fork-watched-accent')) return;
        const template = settings.querySelector('[class*="option-container"]:has(> [class*="option-name-container"]):has(> [class*="option-input-container"])');
        const name = template?.querySelector(':scope > [class*="option-name-container"]');
        const input = template?.querySelector(':scope > [class*="option-input-container"]');
        const label = name?.querySelector('[class*="label"]');
        if (!label) return;

        const row = document.createElement('div');
        row.className = Array.from(template.classList).find(name => name.startsWith('option-container-'));
        const title = document.createElement('div');
        title.className = name.className;
        const caption = document.createElement('label');
        caption.className = label.className;
        caption.htmlFor = 'stremio-fork-watched-accent';
        caption.textContent = 'Secondary color';
        title.append(caption);
        const control = document.createElement('div');
        control.className = Array.from(input.classList).find(name => name.startsWith('option-input-container-'));
        const select = document.createElement('select');
        select.id = caption.htmlFor;
        for (const [color, name] of Object.entries(watchedAccents)) {
            select.add(new Option(`${name} (${color})`, color));
        }
        select.value = watchedAccent;
        select.addEventListener('change', () => {
            applyWatchedAccent(select.value);
            try { localStorage.setItem(watchedAccentKey, watchedAccent); } catch {}
        });
        control.append(select);
        row.append(title, control);
        general.append(row);
    }

    function applyLibraryRoute() {
        document.documentElement.toggleAttribute('data-stremio-library', /^#\/library(?:[/?]|$)/.test(location.hash));
    }

    function adjustSettingsLayout() {
        if (document.getElementById('stremio-fork-settings-layout')) return;
        const style = document.createElement('style');
        style.id = 'stremio-fork-settings-layout';
        style.textContent = `
            [data-stremio-fork-shortcuts] > [class*="option-container"],
            [data-stremio-fork-shortcuts] > [class*="section-title"] [class*="link-container"] {
                display: none !important;
            }
            .stremio-fork-shortcuts-note {
                color: var(--primary-foreground-color, #fff); opacity: .65; font-size: 1rem;
                line-height: 1.5; margin: .5rem 0 1rem; max-width: 46rem;
            }
            .stremio-fork-shortcuts [class*="option-input-container"] {
                flex-wrap: wrap; gap: .5rem; color: var(--primary-foreground-color, #fff);
            }
            .stremio-fork-shortcuts [class*="option-name-container"] {
                flex-direction: column !important; align-items: stretch !important;
            }
            #stremio-fork-animation-setting {margin-bottom:2rem;min-width:0}
            #stremio-fork-animation-setting [class*="option-name-container"] {
                flex-direction:column!important;align-items:stretch!important;
            }
            [class*="settings-container"] [class*="option-input-container"]:has(> select) {padding:0!important}
            #stremio-fork-animation-duration,
            [class*="settings-container"] [class*="option-input-container"] select,
            [class*="settings-container"] [class*="option-input-container"][class*="multiselect-container"] {
                width:100%;max-width:20rem;min-height:3.25rem;padding:.65rem 1rem!important;
                border:1px solid #7272c280;border-radius:var(--stremio-control-radius);font:inherit;
                color:var(--primary-foreground-color,#fff);background:var(--modal-background-color,#272238);
                cursor:pointer;color-scheme:dark;appearance:auto;
                box-sizing:border-box;height:auto;overflow:visible;
            }
            #stremio-fork-animation-duration:focus-visible,
            [class*="settings-container"] [class*="option-input-container"] select:focus-visible,
            [class*="settings-container"] [class*="option-input-container"][class*="multiselect-container"]:focus-visible {
                outline:2px solid #7272c2;outline-offset:3px;
            }
            [class*="settings-container"] [class*="option-input-container"][class*="multiselect-container"] > [class*="menu-container"] {
                border:1px solid #7272c280;border-radius:var(--stremio-control-radius);box-sizing:border-box;
            }
            [class*="settings-container"] [class*="option-container"]:has(> [class*="option-name-container"]) {
                max-width: 46rem !important;
            }
            [class*="settings-container"] [class*="option-container"] > [class*="option-name-container"] {
                flex: 0 1 25rem !important; min-width: 0; margin-right: 3rem !important;
            }
            [class*="settings-container"] [class*="option-name-container"] [class*="label"] {
                white-space: normal !important; overflow: visible !important; text-overflow: clip !important;
                overflow-wrap: anywhere; max-height: none !important;
            }
            [class*="settings-container"] [class*="option-container"] > [class*="option-input-container"] {
                flex: 1 1 18rem !important; min-width: 0;
            }
            @media (max-width: 900px) {
                [class*="settings-container"] [class*="option-container"] > [class*="option-name-container"] {
                    flex-basis: 55% !important; margin-right: 2rem !important;
                }
            }
            @media (max-width: 650px) {
                [class*="settings-container"] [class*="option-container"]:has(> [class*="option-name-container"]) {
                    flex-direction: column !important; align-items: stretch !important;
                }
                [class*="settings-container"] [class*="option-container"] > [class*="option-name-container"],
                [class*="settings-container"] [class*="option-container"] > [class*="option-input-container"] {
                    flex: none !important; width: 100%; margin-right: 0 !important;
                }
            }`;
        document.head.append(style);
    }

    function applyTheme(dark) {
        if (typeof dark !== 'boolean') return;
        window.__stremioForkDarkTheme = dark;
        document.documentElement?.toggleAttribute('data-stremio-dark-theme', dark);
    }

    function startTheme() {
        const style = document.createElement('style');
        style.id = 'stremio-fork-theme';
        const watchedBadge = `:is([class*="video-container"] [class*="watched-container-"]:not([class*="upcoming-watched-container-"]),
            [class*="meta-item-container"] [class*="watched-icon-layer-"])`;
        const poster = '[class*="meta-item-container-"] [class*="poster-container-"]';
        const library = 'html[data-stremio-library] [class*="library-container-"]';
        style.textContent = `
            html {
                --stremio-control-radius:.75rem;
                --stremio-poster-highlight:255 255 255;
            }
            ${poster} [class*="poster-image-layer-"] {transition:transform .18s ease-out}
            @media (hover:hover) {
                ${poster} {transition:box-shadow .18s ease-out}
                [class*="meta-item-container-"]:hover:not(:focus-visible) [class*="poster-container-"] {
                    box-shadow:0 0 0 .125rem rgb(var(--stremio-poster-highlight) / 70%),
                        0 0 .9rem .15rem rgb(var(--stremio-poster-highlight) / 45%);
                }
            }
            @media (prefers-reduced-motion:reduce) {
                ${poster}, ${poster} [class*="poster-image-layer-"] {transition:none}
                ${poster} [class*="poster-image-layer-"] {transform:none!important}
            }
            ${library} :is([class*="search-bar-container-"], [class*="select-input-container-"],
                [class*="multiselect-button-"], [class*="chip-"], [class*="dropdown-"][role="listbox"],
                [class*="search-bar-container-"] > [class*="menu-container-"]) {
                border-radius:var(--stremio-control-radius);
            }
            ${library} :is([class*="search-bar-container-"], [class*="select-input-container-"], [class*="dropdown-"][role="listbox"]) {
                box-shadow:inset 0 0 0 1px #7272c280;
            }
            ${library} [class*="selectable-inputs-container-"] [class*="chip-"] {--quaternary-accent-color:#7272C2}
            ${library} [class*="select-input-container-"] [aria-selected="true"] > [class*="icon-"] {
                --secondary-accent-color:#7272C2;
            }
            html[data-stremio-dark-theme] {
                --stremio-poster-highlight:133 139 153;
                --primary-background-color:#0B0F18!important;
                --secondary-background-color:#161A26!important;
                --modal-background-color:#161A26!important;
            }
            html[data-stremio-dark-theme] body {
                /* ShellVideo sets an inline transparent background to reveal
                   native mpv beneath WebView2. Never override that with !important. */
                background-image:linear-gradient(to bottom right,var(--primary-background-color) 0%,var(--secondary-background-color) 100%);
            }
            html[data-stremio-dark-theme] [class*="intro-container"] > [class*="background-container"] {
                background:none!important;
            }
            [class*="player-container"] [class*="seek-bar"] {
                --primary-accent-color:#7272c2;
            }
            [class*="vertical-nav-bar-container"], [class*="video-container"], [class*="stream-container"] {
                --primary-accent-color:#7272c2;
            }
            [class*="player-container"] {--stremio-player-control-color:#fff}
            html[data-stremio-dark-theme] [class*="player-container"] {--stremio-player-control-color:#858B99}
            [class*="player-container"] :is(
                [class*="nav-bar-layer"], [class*="horizontal-nav-bar-container"],
                [class*="control-bar-layer"], [class*="control-bar-container"], [class*="side-drawer-button-layer"]
            ) svg:not(#stremio-fork-compatibility svg),
            [class*="player-container"] [class*="seek-bar-container"] [class*="label"],
            [class*="player-container"] [class*="horizontal-nav-bar-container"] [class*="title"] {
                color:var(--stremio-player-control-color)!important;
            }
            [class*="addons-loading-bar"] {background-color:#7272c2!important}
            ${watchedBadge} {background-color:var(--stremio-watched-accent,${defaultWatchedAccent})!important}
            ${watchedBadge} > [class*="flag-label-"] {color:#0B0F18!important}
            ${watchedBadge} > :is([class*="flag-icon-"], [class*="watched-icon-"]) {
                color:var(--stremio-watched-accent,${defaultWatchedAccent})!important;
                background:#0B0F18;
                border-radius:50%;
                box-shadow:0 0 0 .08rem #0B0F18;
            }
            [class*="player-container"] [class*="volume-change-indicator"],
            [class*="player-container"] [class*="volume-change-indicator"] * {pointer-events:none!important}
            html[data-stremio-startup-volume] [class*="player-container"] [class*="volume-change-indicator"] {display:none!important}
            [class*="player-container"] [class*="side-drawer-layer-"] {
                background-color:color-mix(in srgb,var(--modal-background-color) 88%,transparent);
            }
            html[data-stremio-dark-theme] [class*="volume-change-indicator"] {background-color:rgba(22,26,38,.1)!important}
            html[data-stremio-dark-theme] [class*="volume-change-indicator"] [class*="volume-icon"] {
                color:#858B99!important;
            }
            [class*="player-container"] [class*="horizontal-nav-bar-container"] svg:not(#stremio-fork-compatibility svg) {
                opacity:1!important;
            }
            [class*="player-container"] [class*="volume-slider"] {
                --primary-foreground-color:var(--stremio-player-control-color);
                --primary-accent-color:var(--stremio-player-control-color);
            }
            #stremio-fork-skip-segment {
                position:absolute;z-index:1;right:1.5rem;
                bottom:min(max(8.25rem,calc(var(--stremio-skip-offset,0px) + .75rem)),calc(100% - 5rem));
                max-width:calc(100% - 3rem);
                padding:.65em 1.25em;border:2px solid currentColor;border-radius:.65rem;
                color:var(--stremio-player-control-color,#fff);background:rgba(0,0,0,.48);
                box-shadow:0 0 .65rem color-mix(in srgb,currentColor 38%,transparent);
                font:inherit;font-size:1.25rem;font-weight:600;cursor:pointer!important;
                animation:stremio-fork-skip-fade .25s ease-out both;
            }
            html[data-stremio-dark-theme] #stremio-fork-skip-segment {background:rgba(22,26,38,.62)}
            #stremio-fork-skip-segment:hover {box-shadow:0 0 .9rem color-mix(in srgb,currentColor 60%,transparent)}
            #stremio-fork-skip-segment:focus-visible {outline:2px solid currentColor;outline-offset:3px}
            [data-stremio-controls="hidden"] > #stremio-fork-skip-segment[data-paused] {display:none}
            @keyframes stremio-fork-skip-fade {from {opacity:0} to {opacity:1}}
            @media (prefers-reduced-motion:reduce) {#stremio-fork-skip-segment {animation:none}}
        `;
        document.head.append(style);
        // Use the shell's saved choice when available; otherwise start in Dark Mode.
        applyTheme(typeof window.__stremioForkDarkTheme === 'boolean' ? window.__stremioForkDarkTheme : true);
    }

    function recolorLogos() {
        for (const image of document.querySelectorAll('img')) {
            let url;
            try { url = new URL(image.getAttribute('src') || '', location.href); } catch { continue; }
            if (!hosts.has(url.hostname) || !/\/images\//.test(url.pathname)) continue;
            const name = url.pathname.split('/').pop();
            const asset = name === 'logo.png' ? logos.logo : name === 'stremio_symbol.png' ? logos.symbol :
                          /^(icon|maskable_icon)\.png$/.test(name) ? logos.icon : null;
            if (asset) {
                image.removeAttribute('srcset');
                image.src = asset;
            }
        }
        for (const link of document.querySelectorAll('link[rel~="icon"]')) {
            if (link.getAttribute('href') !== logos.icon) link.href = logos.icon;
        }
    }

    function update() {
        scheduled = false;
        recolorLogos();
        updatePlayerShortcuts();
        updateControlSettings();
        updateAppearanceSettings();
        const player = document.querySelector('[class*="player-container"]');
        updateControls(player);
        updateVolume(player);
        updatePip(player);
        updateCompatibility(player);
        updateSkipButton(player);
        window.__ezrasPlayback?.update(player, state.active);
        const controls = player?.querySelector('[class*="control-bar-buttons-menu-container"]');
        if (!controls || !state.active) {
            button?.remove();
            return;
        }
        if (!button) {
            button = document.createElement('button');
            button.id = 'stremio-fork-display-mode';
            button.type = 'button';
            button.style.cssText = 'flex:none;width:4rem;height:5rem;padding:0;border:0;background:transparent;color:var(--primary-foreground-color,#fff);font:inherit;display:flex;align-items:center;justify-content:center;cursor:pointer;';
            button.addEventListener('mousedown', event => event.stopPropagation());
            button.addEventListener('dblclick', event => event.stopPropagation());
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                send('cycle-display-mode');
            });
            button.addEventListener('keydown', event => {
                if (event.code !== 'Enter' && event.code !== 'Space') return;
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) button.click();
            });
        }
        const label = labels[state.mode];
        const title = `Display: ${label}. Click for ${next[state.mode]}. Ctrl+Shift+F`;
        if (button.title !== title) {
            button.title = title;
            button.setAttribute('aria-label', title);
            button.dataset.mode = state.mode;
            button.innerHTML = icons[state.mode];
            const icon = button.querySelector('svg');
            icon.setAttribute('aria-hidden', 'true');
            icon.style.cssText = 'flex:none;width:2.5rem;height:2.5rem;';
        }
        const neighbor = Array.from(controls.querySelectorAll('[class*="control-bar-button"]')).find(element => element !== button);
        const classes = neighbor?.className.split(/\s+/).filter(name => name !== 'disabled').join(' ');
        if (classes && button.className !== classes) button.className = classes;
        if (button.parentElement !== controls) controls.prepend(button);
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(update);
    }

    window.chrome.webview.addEventListener('message', event => {
        let payload;
        try { payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
        if (payload?.args?.[0] === 'theme-changed') {
            applyTheme(payload.args[1]?.dark);
            return;
        }
        if (payload?.args?.[0] === 'picture-in-picture-changed') {
            if (typeof payload.args[1]?.enabled !== 'boolean') return;
            pipEnabled = payload.args[1].enabled;
            schedule();
            return;
        }
        if (payload?.args?.[0] === 'fork-file-loaded') {
            const initial = payload.args[1]?.startupVolume;
            if (!Number.isFinite(initial)) return;
            // Let the upstream slider update immediately and keep its popup hidden until volume changes again.
            startupVolume = initial;
            document.documentElement.setAttribute('data-stremio-startup-volume', '');
            return;
        }
        if (payload?.args?.[0] === 'skip-media-changed') {
            skipMedia?.request?.abort();
            const media = payload.args[1];
            skipMedia = media?.seekable === true && typeof media.serial === 'string' ? {
                serial: media.serial, hash: location.hash, time: media['time-pos'], duration: media.duration,
                chapters: Array.isArray(media.chapters) ? media.chapters : [], local: [], remote: []
            } : null;
            if (skipMedia?.duration > 0) prepareSkips(skipMedia);
            schedule();
            return;
        }
        if (payload?.args?.[0] === 'mpv-prop-change') {
            const property = payload.args[1];
            if (property?.name === 'time-pos' && skipMedia) {
                const previous = currentSkip();
                skipMedia.time = property.data;
                if (previous !== currentSkip()) schedule();
                return;
            }
            if (property?.name === 'duration' && skipMedia && !(skipMedia.duration > 0) &&
                Number.isFinite(property.data) && property.data > 0) {
                skipMedia.duration = property.data;
                prepareSkips(skipMedia);
                schedule();
                return;
            }
            if (property?.name === 'volume' && Number.isFinite(property.data)) {
                if (startupVolume !== null && property.data !== startupVolume) {
                    startupVolume = null;
                    document.documentElement.removeAttribute('data-stremio-startup-volume');
                }
                volume = property.data;
            } else if (property?.name === 'mute' && typeof property.data === 'boolean') muted = property.data;
            else if (property?.name === 'pause' && typeof property.data === 'boolean') {
                if (paused !== property.data) controlActivity();
                paused = property.data;
            }
            else return;
            schedule();
            return;
        }
        if (payload?.args?.[0] !== 'display-mode-changed') return;
        const data = payload.args[1];
        if (!data || !Object.hasOwn(labels, data.mode) || typeof data.active !== 'boolean') return;
        state = {mode: data.mode, active: data.active};
        schedule();
    });

    function start() {
        receiveCompatibility(window.__stremioForkCompatibility);
        startTheme();
        adjustSettingsLayout();
        loadWatchedAccent();
        applyLibraryRoute();
        applyAnimationDuration(readAnimationDuration());
        applyControlTimeout(readControlTimeout());
        startControls();
        try { applyVolumeLimit(JSON.parse(localStorage.getItem('localProfile') || '{}').maxVolume ?? 130); }
        catch { applyVolumeLimit(130); }
        const observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'src', 'href', 'style', 'hidden', 'open', 'aria-expanded']});
        schedule();
        send('get-display-mode');
        send('get-picture-in-picture');
        send('get-skip-media');
    }
    window.addEventListener('stremio-fork-volume-limit', event => applyVolumeLimit(event.detail));
    window.addEventListener('stremio-fork-compatibility', event => receiveCompatibility(event.detail));
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', () => {
        startupVolume = null;
        document.documentElement.removeAttribute('data-stremio-startup-volume');
        applyLibraryRoute();
        if (skipMedia?.hash !== location.hash) skipMedia?.request?.abort();
        schedule();
    });
    window.addEventListener('storage', event => {
        if (event.key === watchedAccentKey || event.key === null) loadWatchedAccent();
        if (event.key === skipLookupKey || event.key === null) updateSkipLookup(readSkipLookup());
        if (event.key !== animationStorageKey && event.key !== timeoutStorageKey && event.key !== null) return;
        if (event.key === animationStorageKey || event.key === null) {
            animationStatus = '';
            applyAnimationDuration(readAnimationDuration());
        }
        if (event.key === timeoutStorageKey || event.key === null) {
            timeoutStatus = '';
            applyControlTimeout(readControlTimeout());
        }
        schedule();
    });
    // Ask on every document before DOM readiness, so a reload uses the latest
    // tray choice even when it differs from the shell's startup snapshot.
    send('get-theme');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})();
