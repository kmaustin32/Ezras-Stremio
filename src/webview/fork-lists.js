(() => {
    'use strict';
    const storagePrefix = 'stremio-fork-custom-lists:';
    const changeEvent = 'stremio-fork-lists-changed';
    const indexKey = 'stremio-fork-anime-imdb-index-v1';
    const indexUrl = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/indices/imdb_index.json';
    const indexLifetime = 24 * 60 * 60 * 1000;
    const defaults = [
        {id: 'anime', name: 'Anime', items: []},
        {id: 'live-action', name: 'Live Action', items: []}
    ];
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const accountId = profile => {
        const id = profile?.auth?.user?._id ?? profile?.auth?.user?.id;
        return typeof id === 'string' && id ? id : null;
    };
    const storageKey = uid => storagePrefix + encodeURIComponent(uid);
    const newDefaults = () => defaults.map(list => ({...list, items: []}));
    const categoryIds = new Set(defaults.map(list => list.id));
    const smartLists = new Map([['most-watched', 'timeswatched'], ['watched', 'watched'], ['not-watched', 'notwatched']]);
    const sorts = new Set(['lastwatched', 'name', 'namereverse']);

    function decodeLists(raw) {
        if (raw === null) return newDefaults();
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (data?.version !== 1 || !Array.isArray(data.lists)) throw new Error('Saved lists could not be read.');
        const ids = new Set();
        const lists = data.lists.map(list => {
            if (!object(list) || typeof list.id !== 'string' || !/^[a-z0-9-]+$/.test(list.id) ||
                ids.has(list.id) || typeof list.name !== 'string' || !list.name.trim() ||
                !Array.isArray(list.items) || !list.items.every(id => typeof id === 'string' && id))
                throw new Error('Saved lists could not be read.');
            ids.add(list.id);
            return {...list, items: [...new Set(list.items)]};
        });
        for (const [index, list] of newDefaults().entries()) {
            if (!ids.has(list.id)) lists.splice(index, 0, list);
        }
        return lists;
    }

    function previewListImport(current, saved) {
        const incoming = decodeLists(saved);
        const result = current.map(list => ({...list, items: [...list.items]}));
        const rows = [];
        for (const list of incoming) {
            if (list.id === 'all' || smartLists.has(list.id)) throw new Error('A list ID is reserved.');
            if (!categoryIds.has(list.id) && list.name.trim().length > 60) throw new Error('A list name is too long.');
            const target = result.find(item => item.id === list.id || (!categoryIds.has(item.id) &&
                !categoryIds.has(list.id) && item.name.trim().toLowerCase() === list.name.trim().toLowerCase()));
            const members = new Set(target?.items ?? []);
            const otherCategory = categoryIds.has(list.id) && result.find(item => item.id !== list.id && categoryIds.has(item.id));
            const conflicting = new Set(otherCategory?.items ?? []);
            let added = 0;
            for (const id of list.items) {
                if (members.has(id) || conflicting.has(id)) continue;
                members.add(id);
                added++;
            }
            if (target) target.items = [...members];
            else result.push({id: list.id, name: list.name.trim(), home: list.home !== false, items: [...members]});
            if (added || !target) rows.push({name: target?.name ?? list.name.trim(), action: target ? 'Merge' : 'Add', added});
        }
        return {lists: result, rows};
    }

    function libraryRecords(uid, buckets) {
        const byId = new Map();
        let available = false;
        for (const bucket of buckets) {
            if (!uid || bucket?.uid !== uid || !object(bucket.items)) continue;
            available = true;
            for (const [id, item] of Object.entries(bucket.items)) {
                if (!id || item?._id !== id || typeof item.name !== 'string' || typeof item.type !== 'string' ||
                    typeof item.removed !== 'boolean' || typeof item.temp !== 'boolean') continue;
                const previous = byId.get(id);
                if (!previous || (Date.parse(item._mtime) || 0) >= (Date.parse(previous._mtime) || 0)) byId.set(id, item);
            }
        }
        for (const [id, item] of byId) if (item.removed || item.temp) byId.delete(id);
        return {byId, available};
    }

    function parse(raw) {
        try { return JSON.parse(raw); } catch { return null; }
    }

    const pendingStore = new Map(), savedLists = new Map();

    function requestStore(action, uid, extra) {
        return new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timeout = setTimeout(() => {
                pendingStore.delete(requestId);
                reject(new Error('Local Library storage did not respond.'));
            }, 5000);
            pendingStore.set(requestId, result => {
                clearTimeout(timeout);
                if (result.error) reject(new Error(result.error));
                else resolve(result);
            });
            try {window.chrome.webview.postMessage('fork-library-store:' + JSON.stringify({requestId, action, uid, ...extra}));}
            catch (error) {clearTimeout(timeout); pendingStore.delete(requestId); reject(error);}
        });
    }

    function loadLists(uid) {
        let entry = savedLists.get(uid);
        if (entry) return entry;
        entry = {};
        savedLists.set(uid, entry);
        entry.ready = Promise.resolve().then(() => {
            return requestStore('load', uid, {legacy: localStorage.getItem(storageKey(uid))});
        }).then(({record, legacyUnreadable}) => {
            entry.record = record;
            entry.legacyUnreadable = legacyUnreadable === true;
        }).catch(() => {
            entry.error = 'Saved lists could not be read.';
        }).finally(() => window.dispatchEvent(new Event(changeEvent)));
        return entry;
    }

    function streamRecords(uid, raw) {
        const bucket = parse(raw);
        const records = new Map();
        if (!uid || bucket?.uid !== uid || !Array.isArray(bucket.items)) return records;
        for (const pair of bucket.items) {
            if (!Array.isArray(pair)) continue;
            const [key, record] = pair;
            if (typeof key?.metaId !== 'string' || typeof key.videoId !== 'string' ||
                record?.metaId !== key.metaId || record.videoId !== key.videoId || !object(record.stream) ||
                ![record.type, record.streamTransportUrl, record.metaTransportUrl].every(value => typeof value === 'string' && value))
                continue;
            records.set(JSON.stringify([key.metaId, key.videoId]), record);
        }
        return records;
    }

    async function cachedPlayerLink(record, offset) {
        const input = new Blob([JSON.stringify(record.stream)]).stream().pipeThrough(new CompressionStream('deflate'));
        const bytes = new Uint8Array(await new Response(input).arrayBuffer());
        const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
        const segments = [encoded, record.streamTransportUrl, record.metaTransportUrl, record.type, record.metaId, record.videoId];
        const seconds = Math.floor(Number(offset) / 1000);
        return '#/player/' + segments.map(encodeURIComponent).join('/') + (seconds > 0 ? '?position=' + seconds : '');
    }

    function imdbIds(index) {
        const ids = new Set();
        if (object(index)) {
            for (const [key, entry] of Object.entries(index)) {
                if (!Array.isArray(entry?.['anime-list']) || !entry['anime-list'].length) continue;
                for (const id of key.replace(/^\[|\]$/g, '').split(',').map(value => value.trim())) {
                    if (/^tt\d+$/.test(id)) ids.add(id);
                }
            }
        }
        return ids;
    }

    function automaticCategory(item, ids) {
        return item.type === 'anime' || /^(?:kitsu|mal|anilist|anidb):\d+$/.test(item._id) || ids?.has(item._id)
            ? 'anime' : 'live-action';
    }

    function classifyLists(lists, records, ids) {
        const categories = new Map();
        // Beta 1 stored manual picks in the two built-in lists. Honor them
        // directly, with Anime taking priority if a title was in both.
        for (const category of ['live-action', 'anime']) {
            const list = lists.find(list => list.id === category);
            for (const id of list?.items ?? []) categories.set(id, category);
        }
        const members = new Map(defaults.map(list => [list.id, []]));
        for (const item of records.values()) {
            const category = categories.get(item._id) ?? automaticCategory(item, ids);
            categories.set(item._id, category);
            members.get(category).push(item._id);
        }
        return {categories, lists: lists.map(list => members.has(list.id) ? {...list, items: members.get(list.id)} : list)};
    }

    function moveTitles(lists, ids, destination) {
        const moved = new Set(ids);
        for (const list of lists) {
            if (!categoryIds.has(list.id)) continue;
            list.items = list.items.filter(id => !moved.has(id));
            if (list.id === destination) list.items.push(...moved);
        }
    }

    let animeIndex, nextIndexAttempt = 0, indexRequest;
    function refreshAnimeIndex() {
        if (animeIndex === undefined) {
            const saved = parse(localStorage.getItem(indexKey));
            animeIndex = Array.isArray(saved?.ids) ? new Set(saved.ids) : null;
            if (animeIndex && Number.isFinite(saved.fetchedAt)) nextIndexAttempt = saved.fetchedAt + indexLifetime;
        }
        if (indexRequest || Date.now() < nextIndexAttempt) return;
        // Download a public index in one request. The request carries no
        // Library titles, identifiers, or account information.
        indexRequest = fetch(indexUrl, {credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000)})
            .then(async response => {
                if (!response.ok) throw new Error('Anime index is unavailable.');
                const ids = imdbIds(await response.json());
                if (ids.size < 1000) throw new Error('Anime index is incomplete.');
                nextIndexAttempt = Date.now() + indexLifetime;
                animeIndex = ids;
                try {localStorage.setItem(indexKey, JSON.stringify({fetchedAt: Date.now(), ids: [...ids]}));}
                catch { /* Continue with the in-memory index. */ }
                window.dispatchEvent(new Event(changeEvent));
            })
            .catch(() => {nextIndexAttempt = Date.now() + 120000;})
            .finally(() => {indexRequest = null;});
    }

    function useLocalData(React, fixedUid) {
        const [snapshot, setSnapshot] = React.useState(null);
        React.useEffect(() => {
            let previous;
            const refresh = () => {
                try {
                    const uid = fixedUid === undefined ? accountId(parse(localStorage.getItem('profile'))) : fixedUid;
                    if (uid) refreshAnimeIndex();
                    const entry = uid ? loadLists(uid) : null;
                    const parts = uid ? [uid, entry.record, localStorage.getItem('library'), localStorage.getItem('library_recent'),
                         animeIndex, entry.error, fixedUid ? localStorage.getItem('streams') : null, entry.legacyUnreadable] : [null];
                    if (previous && parts.every((part, index) => part === previous[index])) return;
                    previous = parts;
                    let lists, error = entry?.error;
                    try { lists = decodeLists(parts[1] ?? null); }
                    catch { lists = []; error = 'Saved lists could not be read.'; }
                    const records = libraryRecords(uid, [parse(parts[2]), parse(parts[3])]);
                    const classified = error || !uid ? {lists, categories: new Map()} : classifyLists(lists, records.byId, animeIndex);
                     setSnapshot({uid, error, legacyUnreadable: entry?.legacyUnreadable, editable: Boolean(entry?.record && !error),
                         streams: streamRecords(uid, parts[6]), ...records, ...classified});
                } catch {
                    setSnapshot({uid: fixedUid, lists: [], byId: new Map(), error: 'Local storage is unavailable.'});
                }
            };
            refresh();
            // Hosted core can write to localStorage in this window. The
            // storage event only covers writes from a different window.
            const timer = setInterval(refresh, 750);
            window.addEventListener('storage', refresh);
            window.addEventListener(changeEvent, refresh);
            return () => {
                clearInterval(timer);
                window.removeEventListener('storage', refresh);
                window.removeEventListener(changeEvent, refresh);
            };
        }, [fixedUid]);
        return fixedUid === undefined || snapshot?.uid === fixedUid ? snapshot : null;
    }

    async function changeLists(uid, update) {
        const save = async () => {
            const entry = loadLists(uid);
            await entry.ready;
            if (accountId(parse(localStorage.getItem('profile'))) !== uid)
                throw new Error('The signed-in account changed. Open Library and try again.');
            if (!entry.record) throw new Error(entry.error || 'Saved lists could not be read.');
            for (let attempt = 0; attempt < 2; ++attempt) {
                const lists = decodeLists(entry.record);
                update(lists);
                const result = await requestStore('save', uid, {revision: entry.record.revision, lists});
                entry.record = result.record;
                window.dispatchEvent(new Event(changeEvent));
                if (!result.conflict) return;
                if (accountId(parse(localStorage.getItem('profile'))) !== uid)
                    throw new Error('The signed-in account changed. Open Library and try again.');
            }
            throw new Error('The lists changed in another window. Try again.');
        };
        if (navigator.locks) await navigator.locks.request(storageKey(uid), save);
        else await save();
    }

    function listLink(id) {
        return '#/library?forkList=' + encodeURIComponent(id);
    }

    function routeParams(hash = location.hash) {
        const index = hash.indexOf('?');
        return new URLSearchParams(index < 0 ? '' : hash.slice(index + 1));
    }

    function sortValue(value) {
        return routeParams(value).get('sort')?.toLowerCase();
    }

    function viewId(hash) {
        const sort = sortValue(hash);
        return routeParams(hash).get('forkList') ?? (sort === 'unwatched' ? 'not-watched'
            : [...smartLists].find(([, legacySort]) => legacySort === sort)?.[0]);
    }

    function libraryRoute(path, list, sort) {
        const query = new URLSearchParams();
        if (sort) query.set('sort', sort);
        if (list) query.set('forkList', list);
        return path + (query.size ? '?' + query : '');
    }

    function itemProps(item) {
        const details = '#/detail/' + encodeURIComponent(item.type) + '/' + encodeURIComponent(item._id);
        const duration = Number(item.state?.duration);
        return {_id: item._id, name: item.name, type: item.type, poster: item.poster,
            posterShape: ['poster', 'landscape', 'square'].includes(item.posterShape) ? item.posterShape : 'poster',
            watched: Number(item.state?.timesWatched) > 0,
            progress: duration > 0 ? Math.min(100, Math.max(0, 100 * Number(item.state?.timeOffset) / duration || 0)) : 0,
            deepLinks: item.type === 'movie' ? {metaDetailsStreams: details + '/' + encodeURIComponent(item._id)}
                : {metaDetailsVideos: details}};
    }

    function ListDialog({React, mode, lists, count, close, save}) {
        const h = React.createElement;
        const dialog = React.useRef(null);
        const [chosen, setChosen] = React.useState(new Set());
        const [error, setError] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const submitting = React.useRef(false);
        const create = mode === 'create';
        React.useLayoutEffect(() => {
            const element = dialog.current;
            element.showModal();
            return () => {if (element.open) element.close();};
        }, []);
        const dismiss = () => {
            dialog.current?.close();
            close();
        };
        const submit = async event => {
            event.preventDefault();
            if (submitting.current) return;
            const name = new FormData(event.currentTarget).get('name')?.trim();
            if (create && !name) {setError('Enter a name for your list.'); return;}
            submitting.current = true;
            setBusy(true);
            try {await save(create ? name : chosen); dismiss();}
            catch (failure) {
                setError(failure instanceof Error ? failure.message : 'Could not save your lists.');
                submitting.current = false;
                setBusy(false);
            }
        };
        return h('dialog', {ref: dialog, className: 'fork-list-dialog', 'aria-labelledby': 'fork-list-dialog-title',
            onCancel: event => {event.preventDefault(); if (!submitting.current) dismiss();}},
        h('form', {onSubmit: submit},
            h('h2', {id: 'fork-list-dialog-title'}, create ? 'Create list' : 'Add to list'),
            create ? h('label', null, 'List name', h('input', {name: 'name', type: 'text', required: true, maxLength: 60, autoFocus: true}))
                : h('fieldset', null, h('legend', null, 'Choose lists for ' + count + (count === 1 ? ' title' : ' titles')),
                    lists.map(list => h('label', {key: list.id, className: 'fork-list-choice'},
                        h('input', {type: 'checkbox', checked: chosen.has(list.id), onChange: event => {
                            const checked = event.target.checked;
                            setChosen(old => {
                                const next = new Set(old);
                                if (checked) {
                                    if (categoryIds.has(list.id)) for (const id of categoryIds) next.delete(id);
                                    next.add(list.id);
                                } else next.delete(list.id);
                                return next;
                            });
                        }}), list.name))),
            error && h('p', {role: 'alert'}, error),
            h('div', {className: 'fork-list-dialog-actions'},
                h('button', {type: 'button', disabled: busy, onClick: dismiss}, 'Cancel'),
                h('button', {type: 'submit', disabled: busy || (!create && !chosen.size)}, create ? 'Create' : 'Add'))));
    }

    function ManageLists({React, lists, close, save}) {
        const h = React.createElement;
        const [draft, setDraft] = React.useState(() => lists.map(({id, name, home}) => ({id, name, home: home !== false})));
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState('');
        const dialog = React.useRef(null);
        React.useEffect(() => { dialog.current?.showModal(); }, []);
        const edit = (id, values) => setDraft(items => items.map(item => item.id === id ? {...item, ...values} : item));
        const move = (index, direction) => setDraft(items => {
            const next = [...items], destination = index + direction;
            [next[index], next[destination]] = [next[destination], next[index]];
            return next;
        });
        return h('dialog', {ref: dialog, className: 'fork-list-dialog', 'aria-label': 'Manage lists',
            onCancel: event => {event.preventDefault(); if (!busy) close();}},
        h('form', {onSubmit: async event => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            try { await save(draft); close(); }
            catch (failure) {setError(failure.message); setBusy(false);}
        }},
        h('h2', null, 'Manage lists'),
        h('div', {className: 'fork-list-management'}, draft.map((list, index) =>
            h('div', {key: list.id},
                categoryIds.has(list.id) ? h('strong', null, list.name) : h('input', {type: 'text', required: true,
                    maxLength: 60, disabled: busy, value: list.name, 'aria-label': 'List name',
                    onChange: event => edit(list.id, {name: event.target.value})}),
                h('label', {className: 'fork-list-choice'}, h('input', {type: 'checkbox', checked: list.home, disabled: busy,
                    onChange: event => edit(list.id, {home: event.target.checked})}), 'Show on Home'),
                h('div', {className: 'fork-list-dialog-actions'},
                    h('button', {type: 'button', disabled: busy || index === 0, onClick: () => move(index, -1)}, 'Move up'),
                    h('button', {type: 'button', disabled: busy || index === draft.length - 1, onClick: () => move(index, 1)}, 'Move down'),
                    !categoryIds.has(list.id) && h('button', {type: 'button', disabled: busy,
                        onClick: () => setDraft(items => items.filter(item => item.id !== list.id))}, 'Delete'))))),
        draft.length < lists.length && h('p', null, 'Saving removes the deleted lists. Their titles stay in your Library.'),
        error && h('p', {role: 'alert'}, error),
        h('div', {className: 'fork-list-dialog-actions'},
            h('button', {type: 'button', disabled: busy, onClick: close}, 'Cancel'),
            h('button', {type: 'submit', disabled: busy}, 'Save lists'))));
    }

    const menuHandlers = new WeakMap();

    function LibraryLists({React, Nav, LibItem, notifications, styles, navProps, body, uid}) {
        const h = React.createElement;
        const data = useLocalData(React, uid);
        const [hash, setHash] = React.useState(location.hash);
        const [selection, setSelection] = React.useState({key: '', ids: new Set()});
        const [dialog, setDialog] = React.useState(null);
        const [notice, setNotice] = React.useState('');
        React.useEffect(() => {
            const changed = () => setHash(location.hash);
            window.addEventListener('hashchange', changed);
            return () => window.removeEventListener('hashchange', changed);
        }, []);
        const lists = data?.lists ?? newDefaults();
        const requestedSort = sortValue(hash);
        const activeId = viewId(hash) ?? 'all';
        const active = lists.find(list => list.id === activeId);
        const smart = smartLists.has(activeId);
        const sort = sorts.has(requestedSort) ? requestedSort : null;
        const watchFilter = smart ? activeId !== 'not-watched' : null;
        const [toolbar, content] = body.props.children;
        const [dropdown, sorting] = toolbar.props.children;
        const cards = Array.isArray(content?.props.children) ?
            content.props.children.filter(card => card?.type === LibItem && typeof card.props._id === 'string') : [];
        const liveCards = new Map(cards.map(card => [card.props._id, card]));
        const localMode = Boolean(active || smart);
        const canEdit = data?.editable === true;
        const selectionKey = hash.split('?')[0] + '|' + activeId;
        React.useEffect(() => {
            setSelection(previous => previous.key === selectionKey ? previous : {key: selectionKey, ids: new Set()});
            setDialog(null);
        }, [selectionKey]);
        const selected = new Set();
        if (selection.key === selectionKey) {
            for (const id of selection.ids) {
                const saved = data?.byId.get(id);
                const watched = liveCards.get(id)?.props.watched ?? (Number(saved?.state?.timesWatched) > 0);
                if ((!data?.available || saved) && (!active || active.items.includes(id)) &&
                    (watchFilter === null || Boolean(watched) === watchFilter)) selected.add(id);
            }
        }

        const add = ids => {setNotice(''); setDialog({mode: 'add', ids: [...ids]});};
        const decorate = card => {
            const id = card.props._id;
            const category = data?.categories?.get(id) ?? automaticCategory(card.props, animeIndex);
            const destination = category === 'anime' ? 'live-action' : 'anime';
            const saved = data?.byId.get(id);
            const cached = !card.props.deepLinks?.player && data?.streams?.get(JSON.stringify([id, saved?.state?.video_id]));
            const handle = event => {
                if (event.value === 'fork-play-cached' && cached) {
                    const currentHash = location.hash;
                    cachedPlayerLink(cached, saved.state?.timeOffset).then(link => {
                        if (location.hash === currentHash && accountId(parse(localStorage.getItem('profile'))) === uid)
                            location.hash = link;
                    }).catch(() => setNotice('The saved source could not be opened.'));
                } else if (event.value === 'fork-add-to-list') add(selected.has(id) ? selected : [id]);
                else if (event.value === 'fork-move-category') {
                    changeLists(uid, lists => moveTitles(lists, [id], destination)).catch(error => setNotice(error.message));
                }
                else if (event.value === 'fork-remove-from-list' && active) {
                    changeLists(uid, lists => {
                        const list = lists.find(list => list.id === active.id);
                        if (list) list.items = list.items.filter(member => member !== id);
                    }).catch(error => setNotice(error.message));
                } else card.props.optionOnSelect?.(event);
            };
            if (canEdit || cached)
                menuHandlers.set(handle, {cached, destination: canEdit ? destination : null, removable: canEdit && active && !categoryIds.has(active.id)});
            return React.cloneElement(card, {key: id, optionOnSelect: handle,
                'data-fork-list-selected': selected.has(id) || undefined,
                onClick: event => {
                    if (canEdit && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
                        event.preventDefault();
                        const next = new Set(selected);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        setSelection({key: selectionKey, ids: next});
                    } else card.props.onClick?.(event);
                }});
        };
        const options = lists.map(list => ({value: listLink(list.id), label: list.name}));
        const nativeLabel = (value, fallback) => sorting.props.options.find(option => sortValue(option.value) === value)?.label ?? fallback;
        const orderOptions = [['lastwatched', 'Last Watched'], ['name', 'A–Z'], ['namereverse', 'Z–A']]
            .map(([value, fallback]) => ({value: '#/library?sort=' + value, label: nativeLabel(value, fallback)}));
        const quick = [{value: listLink('all'), label: 'All'}, ...options.filter(option => categoryIds.has(routeParams(option.value).get('forkList'))),
            {value: listLink('most-watched'), label: nativeLabel('timeswatched', 'Most Watched')},
            {value: listLink('watched'), label: nativeLabel('watched', 'Watched')},
            {value: listLink('not-watched'), label: nativeLabel('notwatched', 'Unwatched')}];
        const selectList = value => {
            if (routeParams(value).has('forkList')) location.hash = libraryRoute('#/library', routeParams(value).get('forkList'), sort);
            else {
                const targetPath = value.split('?')[0];
                dropdown.props.onSelect(libraryRoute(targetPath, smart ? activeId : null, sort));
            }
        };
        // The hosted chip retains its initial handler. Read the current route
        // so sorting keeps the view and type that are active at click time.
        const selectChip = React.useCallback(value => {
            const query = routeParams(value);
            const list = query.get('forkList');
            const currentPath = location.hash.split('?')[0];
            const currentSort = sortValue(location.hash);
            if (list) {
                const targetPath = smartLists.has(list) ? currentPath : '#/library';
                const keepSort = list !== 'most-watched' && sorts.has(currentSort);
                location.hash = libraryRoute(targetPath, list, keepSort ? currentSort : null);
            } else location.hash = libraryRoute(currentPath, viewId(location.hash), query.get('sort'));
        }, []);
        const selectedChips = [];
        if (sort || activeId !== 'most-watched') selectedChips.push('#/library?sort=' + (sort ?? 'lastwatched'));
        selectedChips.push(listLink(activeId));
        const header = React.cloneElement(toolbar, null,
            React.cloneElement(dropdown, {options: [...dropdown.props.options, ...options],
                value: active ? listLink(active.id) : dropdown.props.value, onSelect: selectList}),
            React.cloneElement(sorting, {options: [...orderOptions, ...quick], selected: selectedChips, onSelect: selectChip}),
            h('div', {className: 'fork-list-toolbar-actions'},
                selected.size > 0 && h('button', {type: 'button', onClick: () => add(selected)}, 'Add to list (' + selected.size + ')'),
                h('button', {type: 'button', disabled: !canEdit, onClick: () => {setNotice(''); setDialog({mode: 'create'});}}, 'Create list'),
                h('button', {type: 'button', disabled: !canEdit,
                    onClick: () => setDialog({mode: 'manage', lists})}, 'Manage lists')));

        let view = content;
        if (localMode) {
            const items = data?.byId ?? new Map();
            const type = hash.split('?')[0].split('/')[2];
            const typeFilter = type ? parseType(type) : '';
            const ids = active ? active.items : [...new Set([...items.keys(), ...liveCards.keys()])];
            const matches = ids.map(id => {
                const original = liveCards.get(id);
                const saved = items.get(id);
                return original || (saved ? h(LibItem, {...itemProps(saved), notifications, removable: true}) : null);
            }).filter(card => card && (active || !typeFilter || card.props.type === typeFilter) &&
                (watchFilter === null || Boolean(card.props.watched) === watchFilter));
            const date = card => Date.parse(items.get(card.props._id)?.state?.lastWatched) || 0;
            const times = card => Number(items.get(card.props._id)?.state?.timesWatched) || 0;
            const name = (a, b) => a.props.name.localeCompare(b.props.name);
            if (sort === 'namereverse') matches.sort((a, b) => name(b, a));
            else if (sort === 'name') matches.sort(name);
            else if (activeId === 'most-watched' && !sort) matches.sort((a, b) => times(b) - times(a) || name(a, b));
            else matches.sort((a, b) => date(b) - date(a) || name(a, b));
            view = matches.length ? h('div', {key: hash, className: styles['meta-items-container']}, matches.map(decorate))
                : h('p', {className: 'fork-list-notice', role: 'status'}, active ? 'This list is empty.' :
                    data?.available || liveCards.size ? 'No matching titles.' : 'Waiting for the saved Library…');
        } else if (cards.length) view = React.cloneElement(content, null, cards.map(decorate));

        return h(Nav, navProps, React.cloneElement(body, null, header, view,
            (data?.error || notice) && h('p', {className: 'fork-list-notice', role: 'alert'}, data?.error || notice),
            data?.legacyUnreadable && h('p', {className: 'fork-list-notice', role: 'status'},
                'Older Library lists could not be imported. Your current lists are available.'),
            dialog?.mode === 'manage' && h(ManageLists, {React, lists: dialog.lists, close: () => setDialog(null),
                save: async draft => {
                    const initial = new Map(dialog.lists.map(list => [list.id, list]));
                    await changeLists(uid, current => {
                        const byId = new Map(current.map(list => [list.id, list]));
                        const ordered = draft.flatMap(list => {
                            const saved = byId.get(list.id), original = initial.get(list.id);
                            if (!saved) return [];
                            return [{...saved, name: list.name === original.name ? saved.name : list.name.trim(),
                                home: list.home === (original.home !== false) ? saved.home : list.home}];
                        });
                        ordered.push(...current.filter(list => !initial.has(list.id)));
                        const names = ordered.map(list => list.name.trim().toLowerCase());
                        if (names.includes('') || new Set(names).size !== names.length)
                            throw new Error('Give each list a distinct name.');
                        current.splice(0, current.length, ...ordered);
                    });
                    if (active && !draft.some(list => list.id === active.id))
                        location.hash = libraryRoute('#/library', 'all', sort);
                }}),
            dialog && dialog.mode !== 'manage' && h(ListDialog, {React, mode: dialog.mode, lists, count: dialog.ids?.length,
                close: () => setDialog(null), save: async value => {
                    let created;
                    await changeLists(uid, lists => {
                        if (dialog.mode === 'create') {
                            if (lists.some(list => list.name.toLowerCase() === value.toLowerCase()))
                                throw new Error('A list with that name already exists.');
                            created = {id: crypto.randomUUID(), name: value, items: []};
                            lists.push(created);
                        } else {
                            const category = [...value].find(id => categoryIds.has(id));
                            if (category) moveTitles(lists, dialog.ids, category);
                            for (const list of lists) if (!categoryIds.has(list.id) && value.has(list.id))
                                list.items = [...new Set([...list.items, ...dialog.ids])];
                        }
                    });
                    if (created) location.hash = listLink(created.id);
                    else setSelection({key: selectionKey, ids: new Set()});
                }})));
    }

    function parseType(type) {
        try { return decodeURIComponent(type); } catch { return type; }
    }

    function HomeLists({React, boardProps, children}) {
        const h = React.createElement;
        const data = useLocalData(React);
        if (!data?.uid || !data.lists.length) return h('div', boardProps, ...children);
        const rows = children.flat().filter(Boolean);
        const featured = rows.findIndex(row => {
            const catalog = row.props?.catalog;
            const title = catalog?.name || row.props?.title;
            return typeof title === 'string' && /^featured(?:\s*[-–]\s*movies?|\s+movies?)?$/i.test(title.trim()) &&
                (catalog?.type === 'movie' || /movies?/i.test(title));
        });
        const template = rows.find(row => row.props?.catalog?.content?.type === 'Ready' && row.props.itemComponent);
        const lists = data.lists.filter(list => list.home !== false).map(list => {
            const items = list.items.map(id => data.byId.get(id)).filter(Boolean).map(itemProps);
            const href = listLink(list.id);
            if (template) return h(template.type, {key: list.id, className: template.props.className,
                title: list.name, catalog: {items, deepLinks: {library: href}}, itemComponent: template.props.itemComponent,
                message: items.length ? null : 'This list is empty.'});
            return h('section', {key: list.id, className: 'fork-list-notice'}, h('h2', null, h('a', {href}, list.name)),
                items.length ? h('ul', null, items.map(item => h('li', {key: item._id}, h('a',
                    {href: item.deepLinks.metaDetailsVideos ?? item.deepLinks.metaDetailsStreams}, item.name)))) : h('p', null, 'This list is empty.'));
        });
        // Keep the hosted Board's direct child indices intact for catalog
        // loading. Lists live inside the slot occupied by Featured Movies.
        const after = featured >= 0 ? featured : rows.length - 1;
        const output = rows.map((row, index) => index === after
            ? h('div', {key: 'fork-home-list-slot', 'data-fork-home-lists': ''}, row, lists)
            : React.cloneElement(row, {key: 'fork-board-' + index}));
        if (after < 0) output.push(h('div', {key: 'fork-home-list-slot', 'data-fork-home-lists': ''}, lists));
        return h('div', boardProps, output);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {decodeLists, libraryRecords, itemProps, imdbIds, classifyLists, moveTitles, streamRecords, cachedPlayerLink, previewListImport};
        return;
    }
    if (window.top !== window.self || !window.chrome?.webview || window.__stremioForkLists ||
        !['stremio.zarg.me', 'zaarrg.github.io'].includes(location.hostname)) return;
    window.__stremioForkLists = {
        async exportLists() {
            const uid = accountId(parse(localStorage.getItem('profile')));
            if (!uid) return null;
            const entry = loadLists(uid);
            await entry.ready;
            if (!entry.record || accountId(parse(localStorage.getItem('profile'))) !== uid)
                throw new Error('Your saved lists are unavailable. Open Library and try again.');
            return {version: 1, lists: decodeLists(entry.record).map(({id, name, items, home}) => ({id, name, items, home}))};
        },
        async previewImport(saved) {
            const uid = accountId(parse(localStorage.getItem('profile')));
            if (!uid) throw new Error('Sign in before importing Library lists.');
            const entry = loadLists(uid);
            await entry.ready;
            if (!entry.record || accountId(parse(localStorage.getItem('profile'))) !== uid)
                throw new Error('Your saved lists are unavailable.');
            const revision = entry.record.revision;
            const preview = previewListImport(decodeLists(entry.record), saved);
            return {rows: preview.rows, apply: () => changeLists(uid, current => {
                if (entry.record.revision !== revision) throw new Error('Your lists changed. Open the backup again to refresh the preview.');
                current.splice(0, current.length, ...preview.lists);
            })};
        },
        hasListRoute() {
            return /^#\/library(?:\/[^/?]*)?\?/.test(location.hash) && routeParams().has('forkList');
        },
        library(React, Nav, LibItem, notifications, styles, profile, navProps, body) {
            const uid = accountId(profile);
            const toolbar = body?.props?.children?.[0]?.props?.children;
            if (!uid || navProps.route !== 'library' || !Array.isArray(toolbar) ||
                !Array.isArray(toolbar[0]?.props?.options) || !Array.isArray(toolbar[1]?.props?.options))
                return React.createElement(Nav, navProps, body);
            return React.createElement(LibraryLists, {key: uid, React, Nav, LibItem, notifications, styles, navProps, body, uid});
        },
        menu(options, handler) {
            const menu = menuHandlers.get(handler);
            if (!menu) return options;
            const result = [...options];
            if (menu.cached) result.unshift({value: 'fork-play-cached', label: 'Play'});
            if (menu.destination) {
                const destination = defaults.find(list => list.id === menu.destination).name;
                result.push({value: 'fork-add-to-list', label: 'Add to list'},
                    {value: 'fork-move-category', label: 'Move to ' + destination});
            }
            if (menu.removable) result.push({value: 'fork-remove-from-list', label: 'Remove from this list'});
            return result;
        },
        home(React, boardProps, ...children) {
            return React.createElement(HomeLists, {React, boardProps, children});
        }
    };
    window.chrome.webview.addEventListener('message', event => {
        const message = typeof event.data === 'string' ? parse(event.data) : event.data;
        const [name, result] = Array.isArray(message?.args) ? message.args : [];
        if (name !== 'fork-library-store-result' || !result) return;
        const receive = pendingStore.get(result.requestId);
        pendingStore.delete(result.requestId);
        receive?.(result);
    });
    function showCompatibilityNotice() {
        if (!document.body) return;
        const unavailable = window.__stremioForkCustomListsPatched === false &&
            /^#\/(?:library(?:[/?]|$)|(?:\?|$))/.test(location.hash || '#/');
        const existing = document.getElementById('fork-list-compatibility');
        if (!unavailable) existing?.remove();
        else if (!existing) {
            const notice = document.createElement('div');
            notice.id = 'fork-list-compatibility';
            notice.setAttribute('role', 'status');
            notice.textContent = 'Custom lists are temporarily unavailable because the web interface changed. Your saved lists are still on this device.';
            document.body.append(notice);
        }
    }
    window.addEventListener('stremio-fork-compatibility', showCompatibilityNotice);
    window.addEventListener('hashchange', showCompatibilityNotice);
    document.addEventListener('DOMContentLoaded', showCompatibilityNotice, {once: true});
    showCompatibilityNotice();
    setTimeout(() => {
        try {if (accountId(parse(localStorage.getItem('profile')))) refreshAnimeIndex();}
        catch { /* Storage errors are shown when the Library opens. */ }
    }, 0);
    const style = document.createElement('style');
    style.textContent = `
        .fork-list-toolbar-actions {display:flex;flex:none;gap:.5rem;margin-left:auto;padding-left:.75rem}
        .fork-list-toolbar-actions button,.fork-list-dialog button {
            border:1px solid #7272c2;border-radius:.75rem;padding:.55rem .85rem;
            color:var(--primary-foreground-color,#fff);background:var(--modal-background-color,#222635);
            font:inherit;white-space:nowrap;cursor:pointer;
        }
        .fork-list-toolbar-actions button:disabled,.fork-list-dialog button:disabled {opacity:.5;cursor:default}
        .fork-list-toolbar-actions button:focus-visible,.fork-list-dialog :focus-visible {outline:2px solid #aaaaf0;outline-offset:2px}
        .fork-list-dialog {width:min(28rem,calc(100vw - 2rem));max-height:calc(100vh - 2rem);overflow:auto;
            margin:auto;padding:1.25rem;border:1px solid #7272c2;border-radius:.75rem;
            color:var(--primary-foreground-color,#fff);background:var(--modal-background-color,#222635)}
        .fork-list-dialog::backdrop {background:#000a}
        .fork-list-dialog h2 {margin:0 0 1rem}
        .fork-list-dialog label {display:block}
        .fork-list-dialog input[type="text"] {display:block;width:100%;padding:.55rem;color:inherit;
            border:1px solid #7272c2;border-radius:.5rem;background:#0004}
        .fork-list-dialog fieldset {min-width:0;border:0;padding:0;max-height:45vh;overflow:auto}
        .fork-list-choice {padding:.35rem;overflow-wrap:anywhere}
        .fork-list-choice input {appearance:auto;margin-right:.5rem;accent-color:#7272c2}
        .fork-list-dialog-actions {display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem}
        .fork-list-notice {padding:1rem 1.5rem;color:var(--primary-foreground-color,#fff)}
        #fork-list-compatibility {position:fixed;bottom:1rem;left:1rem;right:1rem;z-index:20;padding:.75rem 1rem;
            border:1px solid #e6ae60;border-radius:.75rem;background:#222635;color:#fff}
        [data-fork-list-selected] [class*="poster-container-"] {outline:3px solid #aaaaf0;outline-offset:2px}
        [data-fork-home-lists] {overflow:visible}
        @media (max-width:700px) {
            [class*="library-container-"] [class*="selectable-inputs-container-"]:has(.fork-list-toolbar-actions) {
                flex-wrap:wrap;row-gap:.65rem
            }
        }`;
    if (document.head) document.head.append(style);
    else document.addEventListener('DOMContentLoaded', () => document.head.append(style), {once: true});
})();
