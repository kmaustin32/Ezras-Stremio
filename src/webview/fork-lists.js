(() => {
    'use strict';
    const storagePrefix = 'stremio-fork-custom-lists:';
    const changeEvent = 'stremio-fork-lists-changed';
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

    function decodeLists(raw) {
        if (raw === null) return newDefaults();
        const data = JSON.parse(raw);
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
        return [...defaults.map(list => lists.find(saved => saved.id === list.id) || {...list, items: []}),
            ...lists.filter(list => !defaults.some(base => base.id === list.id))];
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

    function useLocalData(React, fixedUid) {
        const [snapshot, setSnapshot] = React.useState(null);
        React.useEffect(() => {
            let previous;
            const refresh = () => {
                try {
                    const uid = fixedUid === undefined ? accountId(parse(localStorage.getItem('profile'))) : fixedUid;
                    const parts = uid ? [uid, localStorage.getItem(storageKey(uid)), localStorage.getItem('library'),
                        localStorage.getItem('library_recent')] : [null, null, null, null];
                    if (previous && parts.every((part, index) => part === previous[index])) return;
                    previous = parts;
                    let lists, error;
                    try { lists = decodeLists(parts[1]); }
                    catch { lists = []; error = 'Saved lists could not be read.'; }
                    setSnapshot({uid, lists, error, ...libraryRecords(uid, [parse(parts[2]), parse(parts[3])])});
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
        const key = storageKey(uid);
        const save = () => {
            if (accountId(parse(localStorage.getItem('profile'))) !== uid)
                throw new Error('The signed-in account changed. Open Library and try again.');
            const lists = decodeLists(localStorage.getItem(key));
            update(lists);
            localStorage.setItem(key, JSON.stringify({version: 1, lists}));
            window.dispatchEvent(new Event(changeEvent));
        };
        if (navigator.locks) await navigator.locks.request(key, save);
        else save();
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
                            setChosen(old => {const next = new Set(old); if (checked) next.add(list.id); else next.delete(list.id); return next;});
                        }}), list.name))),
            error && h('p', {role: 'alert'}, error),
            h('div', {className: 'fork-list-dialog-actions'},
                h('button', {type: 'button', disabled: busy, onClick: dismiss}, 'Cancel'),
                h('button', {type: 'submit', disabled: busy || (!create && !chosen.size)}, create ? 'Create' : 'Add'))));
    }

    const menuHandlers = new WeakMap();

    function LibraryLists({React, Nav, LibItem, notifications, styles, navProps, body, uid}) {
        const h = React.createElement;
        const data = useLocalData(React, uid);
        const [hash, setHash] = React.useState(location.hash);
        const [selected, setSelected] = React.useState(new Set());
        const [dialog, setDialog] = React.useState(null);
        const [notice, setNotice] = React.useState('');
        React.useEffect(() => {
            const changed = () => setHash(location.hash);
            window.addEventListener('hashchange', changed);
            return () => window.removeEventListener('hashchange', changed);
        }, []);
        const params = routeParams(hash);
        const lists = data?.lists ?? newDefaults();
        const active = lists.find(list => list.id === params.get('forkList'));
        const sort = sortValue(hash);
        const watchFilter = sort === 'watched' ? true : ['notwatched', 'unwatched'].includes(sort) ? false : null;
        const [toolbar, content] = body.props.children;
        const [dropdown, sorting] = toolbar.props.children;
        const cards = Array.isArray(content?.props.children) ?
            content.props.children.filter(card => card?.type === LibItem && typeof card.props._id === 'string') : [];
        const liveCards = new Map(cards.map(card => [card.props._id, card]));
        const localMode = Boolean(active || watchFilter !== null);
        const canEdit = Boolean(data && !data.error);

        const add = ids => {setNotice(''); setDialog({mode: 'add', ids: [...ids]});};
        const decorate = card => {
            const id = card.props._id;
            const handle = event => {
                if (event.value === 'fork-add-to-list') add(selected.has(id) ? selected : [id]);
                else if (event.value === 'fork-remove-from-list' && active) {
                    changeLists(uid, lists => {
                        const list = lists.find(list => list.id === active.id);
                        if (list) list.items = list.items.filter(member => member !== id);
                    }).catch(error => setNotice(error.message));
                } else card.props.optionOnSelect?.(event);
            };
            if (canEdit) menuHandlers.set(handle, Boolean(active));
            return React.cloneElement(card, {key: id, optionOnSelect: handle,
                'data-fork-list-selected': selected.has(id) || undefined,
                onClick: event => {
                    if (canEdit && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
                        event.preventDefault();
                        setSelected(old => {const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next;});
                    } else card.props.onClick?.(event);
                }});
        };
        const options = lists.map(list => ({value: listLink(list.id), label: list.name}));
        const selectList = value => {
            if (options.some(option => option.value === value)) location.hash = value;
            else dropdown.props.onSelect(value);
        };
        const quick = options.filter(option => defaults.some(list => option.value === listLink(list.id)));
        const sortOptions = [...sorting.props.options];
        const insert = sortOptions.findIndex(option => sortValue(option.value) === 'timeswatched');
        sortOptions.splice(insert < 0 ? sortOptions.length : insert, 0, ...quick);
        // The hosted chip keeps its first callback for a given option. Read
        // the current route when it is activated to keep the selected list.
        const selectSort = React.useCallback(value => {
            const query = routeParams(value);
            const activeId = routeParams().get('forkList');
            if (activeId && !query.has('forkList') && !['watched', 'notwatched', 'unwatched'].includes(sortValue(value))) {
                query.set('forkList', activeId);
                location.hash = '#/library?' + query;
            } else location.hash = value;
        }, []);
        const header = React.cloneElement(toolbar, null,
            React.cloneElement(dropdown, {options: [...dropdown.props.options, ...options],
                value: active ? listLink(active.id) : dropdown.props.value, onSelect: selectList}),
            React.cloneElement(sorting, {options: sortOptions,
                selected: active ? [...(sort ? sorting.props.selected : []), listLink(active.id)] : sorting.props.selected,
                onSelect: selectSort}),
            h('div', {className: 'fork-list-toolbar-actions'},
                selected.size > 0 && h('button', {type: 'button', onClick: () => add(selected)}, 'Add to list (' + selected.size + ')'),
                h('button', {type: 'button', disabled: !canEdit, onClick: () => {setNotice(''); setDialog({mode: 'create'});}}, 'Create list')));

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
            else if (sort === 'timeswatched') matches.sort((a, b) => times(b) - times(a) || name(a, b));
            else if (sort === 'notwatched' || sort === 'unwatched') matches.sort((a, b) => date(a) - date(b) || name(a, b));
            else if (sort) matches.sort((a, b) => date(b) - date(a) || name(a, b));
            view = matches.length ? h('div', {key: hash, className: styles['meta-items-container']}, matches.map(decorate))
                : h('p', {className: 'fork-list-notice', role: 'status'}, active ? 'This list is empty.' :
                    data?.available || liveCards.size ? 'No matching titles.' : 'Waiting for the saved Library…');
        } else if (cards.length) view = React.cloneElement(content, null, cards.map(decorate));

        return h(Nav, navProps, React.cloneElement(body, null, header, view,
            (data?.error || notice) && h('p', {className: 'fork-list-notice', role: 'alert'}, data?.error || notice),
            dialog && h(ListDialog, {React, mode: dialog.mode, lists, count: dialog.ids?.length,
                close: () => setDialog(null), save: async value => {
                    let created;
                    await changeLists(uid, lists => {
                        if (dialog.mode === 'create') {
                            if (lists.some(list => list.name.toLowerCase() === value.toLowerCase()))
                                throw new Error('A list with that name already exists.');
                            created = {id: crypto.randomUUID(), name: value, items: []};
                            lists.push(created);
                        } else {
                            for (const list of lists) if (value.has(list.id))
                                list.items = [...new Set([...list.items, ...dialog.ids])];
                        }
                    });
                    if (created) location.hash = listLink(created.id);
                    else setSelected(new Set());
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
        const lists = data.lists.map(list => {
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
        module.exports = {decodeLists, libraryRecords, itemProps};
        return;
    }
    if (window.top !== window.self || !window.chrome?.webview || window.__stremioForkLists ||
        !['stremio.zarg.me', 'zaarrg.github.io'].includes(location.hostname)) return;
    window.__stremioForkLists = {
        hasListRoute() {
            return location.hash.startsWith('#/library?') && routeParams().has('forkList');
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
            if (!menuHandlers.has(handler)) return options;
            const result = [...options, {value: 'fork-add-to-list', label: 'Add to list'}];
            if (menuHandlers.get(handler)) result.push({value: 'fork-remove-from-list', label: 'Remove from this list'});
            return result;
        },
        home(React, boardProps, ...children) {
            return React.createElement(HomeLists, {React, boardProps, children});
        }
    };
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
