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
    const appliedStyles = new WeakMap();
    const playerShortcuts = [
        {key: 'CTRL+b', keys: ['Ctrl', 'B'], label: 'Toggle ambient border blur'},
        {key: 'CTRL+SHIFT+c', keys: ['Ctrl', 'Shift', 'C'], label: 'Detect baked-in black bars / restore framing', detail: 'Use during a clear, playing scene. The detected crop stays for this video; press again to restore. Blur is a separate toggle.'},
        {key: 'CTRL+SHIFT+f', keys: ['Ctrl', 'Shift', 'F'], label: 'Cycle Fit → Crop → Stretch', detail: 'Each new video starts in Fit.'},
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
        }
    }

    function clearControlTimer() {
        clearTimeout(controlTimer);
        controlTimer = null;
    }

    function controlsAreBlocked() {
        if (pointerHeld || document.documentElement.className.includes('active-slider-within')) return true;
        const controls = '[class*="nav-bar-layer"], [class*="control-bar-layer"], [class*="side-drawer-button-layer"]';
        if (keyboardFocus && controlPlayer?.contains(document.activeElement) && document.activeElement.closest(controls)) return true;
        return playerOverlayOpen();
    }

    function playerOverlayOpen() {
        // Never hide a settings/subtitle/speed menu, episode drawer, popup,
        // error or loading state. These elements are owned by the hosted UI.
        const selectors = '[class*="menu-layer"], [class*="side-drawer-layer"], [class*="error-layer"], [class*="buffering-layer"], [class*="context-menu-container"], [role="dialog"], [role="menu"]';
        return Array.from(document.querySelectorAll(selectors)).some(element => {
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
        window.addEventListener('blur', release);
        document.addEventListener('keydown', event => {
            if (volumeArrow(event)) {
                // The community player still handles volume exactly once. Stop
                // only default scrolling and its spatial-navigation polyfill.
                event.preventDefault();
                event.spatialNavigationPrevented = true;
            } else keyboardFocus = true;
            if (controlPlayer?.contains(event.target) || event.target === document.body) controlActivity();
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
                border:1px solid #7272c280;border-radius:.75rem;font:inherit;
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
                border:1px solid #7272c280;border-radius:.75rem;box-sizing:border-box;
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
        style.textContent = `
            html[data-stremio-dark-theme] {
                --primary-background-color:#161A26!important;
                --secondary-background-color:#181C29!important;
                --modal-background-color:#161A26!important;
            }
            html[data-stremio-dark-theme] body {
                background-image:linear-gradient(to right,var(--primary-background-color) 0%,var(--secondary-background-color) 100%)!important;
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
            [class*="video-container"] [class*="watched-container"]:not([class*="upcoming-watched-container"]),
            [class*="meta-item-container"] [class*="watched-icon-layer"] {background-color:#DEA066!important}
            [class*="player-container"] [class*="volume-change-indicator"],
            [class*="player-container"] [class*="volume-change-indicator"] * {pointer-events:none!important}
            html[data-stremio-dark-theme] [class*="volume-change-indicator"] {background-color:rgba(34,38,53,.1)!important}
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
        const player = document.querySelector('[class*="player-container"]');
        updateControls(player);
        updateVolume(player);
        updatePip(player);
        updateCompatibility(player);
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
        if (payload?.args?.[0] === 'mpv-prop-change') {
            const property = payload.args[1];
            if (property?.name === 'volume' && typeof property.data === 'number' && Number.isFinite(property.data))
                volume = property.data;
            else if (property?.name === 'mute' && typeof property.data === 'boolean') muted = property.data;
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
    }
    window.addEventListener('stremio-fork-volume-limit', event => applyVolumeLimit(event.detail));
    window.addEventListener('stremio-fork-compatibility', event => receiveCompatibility(event.detail));
    window.addEventListener('storage', event => {
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
