(() => {
    'use strict';
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const text = (value, max = 512) => typeof value === 'string' ? value.slice(0, max) : '';
    const keyPart = value => encodeURIComponent(value);
    const titleKey = (type, id) => `title/${keyPart(type)}/${keyPart(id)}`;
    const progressKey = (type, id, video) => `progress/${keyPart(type)}/${keyPart(id)}/${keyPart(video)}`;
    const listKey = id => `list/${keyPart(id)}`;
    const defaults = [
        {name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json'},
        {name: 'TMDB Addon', url: 'https://94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json'}
    ];

    function urlOf(value, httpsOnly = true) {
        if (typeof value !== 'string' || value.length > 8192) return null;
        try {
            const url = new URL(value);
            return !url.username && !url.password && (url.protocol === 'https:' || (!httpsOnly && url.protocol === 'http:')) ? url : null;
        } catch {return null;}
    }

    function manifestUrl(value) {
        const url = urlOf(typeof value === 'string' ? value.replace(/^stremio:\/\//i, 'https://') : value);
        return url && url.pathname.endsWith('/manifest.json') && !url.hash ? url.href : '';
    }

    function endpoint(manifest, resource, type, id, query) {
        const url = new URL(manifestUrl(manifest));
        url.pathname = url.pathname.slice(0, -'manifest.json'.length) +
            [resource, type, id].map(keyPart).join('/') + (query ? '/search=' + keyPart(query) : '') + '.json';
        return url.href;
    }

    function title(value, type = value?.type) {
        const id = text(value?.id || value?._id, 160), name = text(value?.name);
        if (!id || !name || !['movie', 'series'].includes(type)) return null;
        const imdb = value.imdb_id || value.imdb;
        return {id, type, name, description: text(value.description, 3000), year: text(value.releaseInfo || value.year, 50),
            poster: urlOf(value.poster)?.href || '', imdb: /^tt\d+$/.test(imdb) ? imdb : ''};
    }

    async function digest(value) {
        const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function progress(type, id, video, seconds, duration, watched = false) {
        const number = value => Number.isFinite(value) && value > 0 ? Math.min(1000000, value) : 0;
        return {type, id, video, seconds: number(seconds), duration: number(duration), watched: watched === true};
    }

    async function snapshot(backup) {
        if (backup?.format !== 'ezras-stremio-backup' || backup.version !== 1 || !Array.isArray(backup.libraryItems) ||
            !Array.isArray(backup.addons)) throw new Error('Choose a Backup.json exported by Ezra’s Stremio.');
        const data = Object.create(null);
        for (const item of backup.libraryItems) {
            const record = title(item);
            if (!record) continue;
            const {type, id} = record;
            if (item.removed === true) data[titleKey(type, id)] = null;
            else if (!item.temp) data[titleKey(type, id)] = record;
            const state = item.state;
            const video = text(state?.video_id, 160) || (type === 'movie' ? id : '');
            if (video && object(state) && (state.timeOffset || state.timesWatched || state.flaggedWatched)) {
                const watched = Boolean(state.flaggedWatched || (type === 'movie' && Number(state.timesWatched) > 0));
                data[progressKey(type, id, video)] = progress(type, id, video, Number(state.timeOffset) / 1000, Number(state.duration) / 1000, watched);
            }
        }
        for (const [order, addon] of backup.addons.entries()) {
            const url = manifestUrl(addon?.transportUrl), name = text(addon?.manifest?.name);
            if (url && name) data['addon/' + await digest(url)] = {url, name, order};
        }
        if (Array.isArray(backup.customLists?.lists)) for (const [order, list] of backup.customLists.lists.entries()) {
            const id = text(list?.id, 100), name = text(list?.name, 100);
            if (id && name && Array.isArray(list.items)) data[listKey(id)] = {id, name, order,
                home: list.home !== false, items: list.items.filter(item => typeof item === 'string' && item.length <= 160)};
        }
        return data;
    }

    function canSearch(catalog) {
        return Boolean(['movie', 'series'].includes(catalog?.type) && typeof catalog.id === 'string' && (
            catalog.extra?.some?.(item => item?.name === 'search' && !catalog.extra.some(other => other?.name !== 'search' && other?.isRequired)) ||
            (catalog.extraSupported?.includes?.('search') && !(catalog.extraRequired || []).some(name => name !== 'search'))));
    }

    function hasResource(manifest, resource, type, id) {
        return manifest?.resources?.some?.(item => typeof item === 'string'
            ? item === resource && (!manifest.types?.length || manifest.types.includes(type)) &&
                (!manifest.idPrefixes?.length || manifest.idPrefixes.some(prefix => id.startsWith(prefix)))
            : item?.name === resource && (!item.types?.length || item.types.includes(type)) &&
                (!item.idPrefixes?.length || item.idPrefixes.some(prefix => id.startsWith(prefix))));
    }

    function bridge(view) {
        const pending = new Map();
        view.addEventListener('message', event => {
            let message;
            try {message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;} catch {return;}
            const [name, result] = message?.args || [];
            if (name !== 'ezra-account-result' || !pending.has(result?.id)) return;
            const {resolve, reject, timer} = pending.get(result.id);
            pending.delete(result.id);
            clearTimeout(timer);
            if (result.error) reject(new Error(result.error));
            else resolve(result);
        });
        function send(action, data = {}, id = crypto.randomUUID()) {
            view.postMessage('ezra-account:' + JSON.stringify({...data, action, id}));
        }
        function call(action, data) {
            const id = crypto.randomUUID();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error('The profile is taking too long to respond. Try again shortly.'));
                }, action === 'pick' ? 120000 : 45000);
                pending.set(id, {resolve, reject, timer});
                try {send(action, data, id);} catch (error) {clearTimeout(timer); pending.delete(id); reject(error);}
            });
        }
        return {call, send};
    }

    const api = {bridge, digest, manifestUrl, endpoint, title, titleKey, progress, progressKey, listKey, snapshot,
        canSearch, hasResource, urlOf, defaults};
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (window.top === window.self && window.chrome?.webview) window.__ezraProfileModel = api;
})();
