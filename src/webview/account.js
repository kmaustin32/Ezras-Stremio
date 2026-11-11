(() => {
    'use strict';
    const model = window.__ezraProfileModel;
    if (!model) return;
    const view = window.chrome.webview;
    const {call, send} = model.bridge(view);
    const $ = id => document.getElementById(id);
    let state = {data: {}}, chosen, selected, active, remoteResults = [], remoteQuery = '', requestNumber = 0;
    const manifests = new Map();
    const notice = message => {$('notice').textContent = message;};
    const syncStatus = message => {$('sync-status').textContent = message;};
    const byPrefix = prefix => Object.entries(state.data).filter(([key]) => key.startsWith(prefix));
    const element = (tag, text) => {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        return node;
    };
    const button = (label, action) => {
        const node = element('button', label);
        node.type = 'button';
        node.onclick = () => Promise.resolve().then(action).catch(error => notice(error.message));
        return node;
    };
    const pending = new Set();
    let writes = Promise.resolve();
    function save(action, data, message) {
        const operation = writes.then(async () => {
            pending.add(action);
            try {
                state = await call(action, data);
                render();
                if (message || state.syncWarning) syncStatus(state.syncWarning || message);
                return state;
            } finally {pending.delete(action);}
        });
        writes = operation.catch(() => {});
        return operation;
    }

    function render() {
        const lists = byPrefix('list/').map(([, list]) => list).filter(list => typeof list.name === 'string' && Array.isArray(list.items));
        const activeList = $('list').value;
        $('list').replaceChildren(new Option('All saved titles', ''), ...lists.sort((a, b) => a.order - b.order).map(list => new Option(list.name, list.id)));
        $('list').value = lists.some(list => list.id === activeList) ? activeList : '';
        const chosenList = lists.find(list => list.id === $('list').value);
        const query = $('query').value.trim().toLocaleLowerCase();
        const local = byPrefix('title/').map(([, item]) => model.title(item)).filter(Boolean)
            .filter(item => (!chosenList || chosenList.items.includes(item.id)) && item.name.toLocaleLowerCase().includes(query))
            .sort((a, b) => a.name.localeCompare(b.name));
        const online = remoteQuery === query && !chosenList ? remoteResults : [];
        const found = new Map();
        for (const item of [...local, ...online]) {
            const key = model.titleKey(item.type, item.id);
            if (!found.has(key)) found.set(key, item);
        }
        $('results-title').textContent = online.length ? 'Search results' : chosenList?.name || 'Saved Library';
        $('results').replaceChildren(...Array.from(found.values(), item => {
            const row = element('li');
            const card = button('', () => openTitle(item));
            const image = element(item.poster ? 'img' : 'span');
            if (item.poster) {image.src = item.poster; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';}
            else image.className = 'poster';
            const caption = element('span', item.name);
            caption.append(element('br'), element('small', item.year || (item.type === 'series' ? 'Series' : 'Movie')));
            card.append(image, caption); row.append(card);
            return row;
        }));
        $('enable').textContent = state.enabled ? 'Stop Stremio copying' : 'Enable Stremio copying';
        $('sync').disabled = $('disconnect').disabled = !state.connected;
        $('folder').textContent = chosen || state.folder || '';
        $('addons').replaceChildren(...byPrefix('addon/').sort(([, a], [, b]) => a.order - b.order).map(([key, addon]) => {
            const item = element('li', addon.name || 'Add-on');
            item.append(' ', button('Remove', () => save('edit', {data: {[key]: null}})));
            return item;
        }));
    }

    async function json(url) {
        const response = await fetch(url, {credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000)});
        if (!response.ok) throw new Error('The catalog did not respond.');
        return response.json();
    }

    async function providers() {
        const urls = new Set([...byPrefix('addon/').map(([, addon]) => addon.url), ...model.defaults.map(item => item.url)]
            .map(model.manifestUrl).filter(Boolean));
        const results = await Promise.allSettled([...urls].map(async url => {
            if (!manifests.has(url)) manifests.set(url, await json(url));
            return {url, manifest: manifests.get(url)};
        }));
        return results.filter(result => result.status === 'fulfilled').map(result => result.value);
    }

    async function search(event) {
        event.preventDefault();
        const query = $('query').value.trim();
        if (!query) return;
        const request = ++requestNumber;
        $('list').value = '';
        notice('Searching catalogs…');
        const online = await providers();
        const catalogs = online.flatMap(({url, manifest}) => (Array.isArray(manifest?.catalogs) ? manifest.catalogs : [])
            .filter(model.canSearch).slice(0, 6).map(catalog => ({url, catalog})));
        const results = await Promise.allSettled(catalogs.map(async ({url, catalog}) => {
            const data = await json(model.endpoint(url, 'catalog', catalog.type, catalog.id, query));
            return Array.isArray(data.metas) ? data.metas.slice(0, 60).map(item => model.title(item, catalog.type)).filter(Boolean) : [];
        }));
        if (request !== requestNumber || $('query').value.trim() !== query) return;
        remoteQuery = query.toLocaleLowerCase();
        remoteResults = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        notice(results.some(result => result.status === 'fulfilled')
            ? (remoteResults.length ? '' : 'No matching titles in the available catalogs.') : 'Online catalogs are unavailable. You can still search your saved Library.');
        render();
    }

    function openTitle(item) {
        selected = item;
        const key = model.titleKey(item.type, item.id);
        const panel = $('details'); panel.hidden = false;
        const saved = Boolean(state.data[key]);
        const actions = element('div'); actions.className = 'row';
        actions.append(button(saved ? 'Remove from Library' : 'Save to Library', async () => {
            await save('edit', {data: {[key]: saved ? null : item}});
            if (selected === item) openTitle(item);
        }), button(item.type === 'movie' ? 'Find playback sources' : 'Find episodes', () => findEpisodes(item)));
        const lists = byPrefix('list/').filter(([, list]) => Array.isArray(list.items));
        if (lists.length) {
            const list = element('select');
            list.setAttribute('aria-label', 'Custom list');
            list.append(...lists.map(([key, value]) => new Option(value.name, key)));
            actions.append(list, button('Add to list', async () => {
                const current = state.data[list.value];
                if (current && !current.items.includes(item.id)) await save('edit', {data: {
                    [key]: item, [list.value]: {...current, items: [...current.items, item.id]}
                }});
                notice('Saved to list.');
            }));
        }
        panel.replaceChildren(element('h2', item.name), element('p', item.description), actions);
        panel.scrollIntoView({block: 'nearest'});
    }

    async function findEpisodes(item) {
        notice(item.type === 'movie' ? 'Looking for playback sources…' : 'Looking for episodes…');
        const online = await providers();
        if (selected !== item) return;
        if (item.type === 'movie') {await findStreams(item, item.id, item.imdb ? [item.imdb] : [], online); return;}
        const results = await Promise.allSettled(online.filter(({manifest}) => model.hasResource(manifest, 'meta', item.type, item.id))
            .map(async ({url}) => (await json(model.endpoint(url, 'meta', item.type, item.id))).meta));
        if (selected !== item) return;
        const meta = results.find(result => result.status === 'fulfilled' && Array.isArray(result.value?.videos))?.value;
        if (!meta) {notice('No available catalog returned episodes for this show.'); return;}
        $('episodes')?.remove();
        const group = element('div'); group.id = 'episodes'; group.className = 'row';
        for (const video of meta.videos) {
            if (typeof video?.id !== 'string' || video.id.length > 160) continue;
            const imdb = item.imdb || (/^tt\d+$/.test(meta.imdb_id) ? meta.imdb_id : '');
            const alternatives = imdb && Number.isInteger(video.season) && Number.isInteger(video.episode) ? [`${imdb}:${video.season}:${video.episode}`] : [];
            group.append(button(video.title || video.id, () => findStreams(item, video.id, alternatives, online)));
        }
        $('details').append(group);
        notice(group.childElementCount ? '' : 'No episodes are available.');
    }

    async function findStreams(item, video, alternatives, online) {
        notice('Looking for playback sources…');
        const queries = online.flatMap(({url, manifest}) => {
            const id = [video, ...alternatives].find(candidate => model.hasResource(manifest, 'stream', item.type, candidate));
            return id ? [{url, manifest, id}] : [];
        });
        const results = await Promise.allSettled(queries.map(async ({url, manifest, id}) => {
            const result = await json(model.endpoint(url, 'stream', item.type, id));
            return Array.isArray(result.streams) ? result.streams.slice(0, 100).map(stream => ({stream, label: manifest.name})) : [];
        }));
        if (selected !== item) return;
        $('sources')?.remove();
        const group = element('div'); group.id = 'sources'; group.className = 'row';
        for (const {stream, label} of results.flatMap(result => result.status === 'fulfilled' ? result.value : [])) {
            const url = model.urlOf(stream?.url, false);
            if (url && !stream.behaviorHints?.proxyHeaders) group.append(button(stream.name || stream.title || label || 'Play source', () => play(item, video, url.href)));
        }
        $('details').append(group);
        notice(group.childElementCount ? '' : 'No direct playable links were returned by the available add-ons.');
    }

    function play(item, video, url) {
        const key = model.progressKey(item.type, item.id, video), previous = state.data[key];
        active = {key, item, video, seconds: previous?.seconds || 0, duration: previous?.duration || 0, ready: false};
        document.body.classList.add('playing');
        send('player', {command: 'load', url, resume: previous?.watched ? 0 : active.seconds});
    }

    function remember(watched = false) {
        if (!active?.ready || active.seconds < 1) return;
        const {key, item, video, seconds, duration} = active;
        save('edit', {data: {[key]: model.progress(item.type, item.id, video, Math.floor(seconds), duration,
            watched || state.data[key]?.watched || (duration > 0 && seconds / duration > .95))}}).catch(error => syncStatus(error.message));
    }

    function stop() {
        remember();
        active = null;
        send('player', {command: 'stop'});
        document.body.classList.remove('playing');
    }

    view.addEventListener('message', event => {
        let payload;
        try {payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;} catch {return;}
        const [name, data] = payload?.args || [];
        if (!active) return;
        if (name === 'fork-file-loaded') active.ready = true;
        if (name === 'mpv-event-ended') {
            remember(data.reason === 'quit'); active = null; document.body.classList.remove('playing');
            if (data.reason === 'error') notice('Playback failed. Choose another source.');
        }
        if (name !== 'mpv-prop-change') return;
        if (data.name === 'duration' && Number.isFinite(data.data)) active.duration = data.data;
        if (data.name === 'time-pos' && Number.isFinite(data.data)) {
            active.seconds = data.data;
            $('time').textContent = Math.floor(active.seconds / 60) + ':' + String(Math.floor(active.seconds % 60)).padStart(2, '0');
        }
        if (data.name === 'pause') $('pause').textContent = data.data ? 'Resume' : 'Pause';
    });

    $('search').onsubmit = search;
    $('query').oninput = () => {++requestNumber; notice(''); render();};
    $('list').onchange = render;
    $('online').onclick = () => send('online');
    $('back').onclick = stop;
    $('pause').onclick = () => send('player', {command: 'pause'});
    $('fullscreen').onclick = () => send('player', {command: 'fullscreen'});
    document.addEventListener('keydown', event => {if (event.key === 'Escape' && active) stop();});
    $('enable').onclick = () => {
        const action = state.enabled ? 'disable' : 'enable';
        save(action, {}, state.enabled ? 'Stremio copying paused. Your local profile is still available.' :
            'Open Stremio while signed in to copy your account data to this PC.').catch(error => syncStatus(error.message));
    };
    $('pick').onclick = async () => {
        try {const result = await call('pick'); if (result.folder) {$('folder').textContent = result.folder; chosen = result.folder;}}
        catch (error) {syncStatus(error.message);}
    };
    $('connect').onsubmit = async event => {
        event.preventDefault();
        if (!chosen) {syncStatus('Choose a sync folder first.'); return;}
        try {await save('connect', {passphrase: $('passphrase').value}, 'Encrypted sync is connected.'); $('passphrase').value = '';}
        catch (error) {syncStatus(error.message);}
    };
    $('sync').onclick = () => save('sync', {}, 'Sync complete.').catch(error => syncStatus(error.message));
    $('disconnect').onclick = () => save('disconnect', {}, 'Folder disconnected. Your local profile is still available.').catch(error => syncStatus(error.message));
    $('import').onclick = () => $('file').click();
    $('file').onchange = async () => {
        const file = $('file').files[0]; $('file').value = '';
        if (!file) return;
        try {
            if (file.size > 24 * 1024 * 1024) throw new Error('This backup is too large.');
            const data = await model.snapshot(JSON.parse(await file.text()));
            await save('import', {data}, 'Imported missing titles, lists, add-ons, and available watch progress.');
        } catch (error) {syncStatus(error.message);}
    };
    $('addon').onsubmit = async event => {
        event.preventDefault();
        const url = model.manifestUrl($('manifest').value);
        if (!url) {notice('Enter an HTTPS add-on manifest URL.'); return;}
        try {
            const manifest = await json(url);
            if (typeof manifest.name !== 'string') throw new Error('This address did not return an add-on manifest.');
            manifests.set(url, manifest);
            await save('edit', {data: {['addon/' + await model.digest(url)]: {url, name: manifest.name.slice(0, 512), order: byPrefix('addon/').length}}});
            $('manifest').value = '';
        } catch (error) {notice(error.message);}
    };

    send('ready');
    save('status').then(() => {
        if (state.connected) return save('sync');
        if (!state.hasProfile) $('sync-settings').open = true;
    }).catch(error => notice(error.message));
    setInterval(() => {if (active && !pending.has('edit')) remember();}, 15000);
    setInterval(() => {if (state.connected && !active && !pending.size) save('sync').catch(error => syncStatus(error.message));}, 60000);
})();
