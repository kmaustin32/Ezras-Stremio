(() => {
    'use strict';

    // An allowlisted local export, never a dump of profile/auth or localStorage.
    // Reads exactly profile/library/library_recent. No API calls or data writes.
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const string = value => typeof value === 'string' ? value : '';
    const quantity = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const fields = (value, names) => Object.fromEntries(names.filter(name => Object.hasOwn(value, name)).map(name => [name, value[name]]));

    function libraryItem(value) {
        if (!object(value) || !string(value._id) || !string(value.name) || !string(value.type) ||
            typeof value.removed !== 'boolean' || typeof value.temp !== 'boolean' || !Number.isFinite(Date.parse(value._mtime)))
            throw new Error('Unrecognized library record. Update the app before exporting.');
        const item = fields(value, ['_id', 'name', 'type', 'poster', 'posterShape', 'removed', 'temp', '_ctime', '_mtime']);
        if (object(value.state)) item.state = fields(value.state, ['lastWatched', 'timeWatched', 'timeOffset', 'overallTimeWatched',
            'timesWatched', 'flaggedWatched', 'duration', 'video_id', 'watched', 'noNotif']);
        return item;
    }

    function addons(value) {
        if (!Array.isArray(value)) throw new Error('Your installed add-on list is not ready. Open Add-ons and try again.');
        return value.map(addon => {
            if (!object(addon) || !object(addon.manifest) || !string(addon.manifest.id) || !string(addon.manifest.name) ||
                !string(addon.transportUrl)) throw new Error('Unrecognized add-on record. Update the app before exporting.');
            // URLs may contain add-on access keys. Keep them only in the private
            // structured backup, where they are needed to recover configuration.
            return {manifest: fields(addon.manifest, ['id', 'name', 'version', 'description', 'resources', 'types', 'catalogs', 'behaviorHints']),
                transportUrl: addon.transportUrl, flags: object(addon.flags) ? fields(addon.flags, ['official', 'protected']) : {}};
        });
    }

    function collect(storage, now = new Date()) {
        const read = key => {
            const raw = storage.getItem(key);
            if (raw === null) return null;
            try { return JSON.parse(raw); }
            catch { throw new Error(`The saved ${key} data cannot be read. Nothing was changed.`); }
        };
        const profile = read('profile');
        if (!object(profile)) throw new Error('Your profile is not ready. Open your library, then try again.');
        // Check ownership without copying credentials into the export model.
        const accountId = profile.auth?.user?._id ?? profile.auth?.user?.id ?? null;
        const items = new Map();
        let buckets = 0;
        for (const key of ['library', 'library_recent']) {
            const bucket = read(key);
            if (bucket === null) continue;
            if (!object(bucket) || !object(bucket.items) || !Object.hasOwn(bucket, 'uid'))
                throw new Error('Unrecognized saved library format. Update the app before exporting.');
            if (bucket.uid !== accountId) throw new Error('Your account is still changing. Open your library, then try again.');
            ++buckets;
            for (const [id, value] of Object.entries(bucket.items)) {
                const item = libraryItem(value);
                if (id !== item._id) throw new Error('The saved library contains an inconsistent identifier.');
                const old = items.get(id);
                if (!old || Date.parse(item._mtime) >= Date.parse(old._mtime)) items.set(id, item);
            }
        }
        if (!buckets) throw new Error('No library data is available to export. Open your library and try again.');
        if (profile.addonsLocked === true) throw new Error('Your installed add-on list is unavailable. Open Add-ons and try again.');
        const installed = addons(profile.addons);
        const libraryItems = [...items.values()].sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id));
        return {format: 'ezras-stremio-backup', version: 1, applicationVersion: '1.3.7-hotfix', exportedAt: now.toISOString(),
            source: 'local snapshot', localLibraryParts: buckets,
            notes: [buckets === 2 ? 'Includes both recent and older library records saved on this device.' :
                'Only one of the two local library parts was available. Recent or older titles may be missing. Open Library while online and export again.',
                'Account synchronization was not checked by the export. Open Library and Add-ons while online before exporting for the latest saved data.'],
            counts: {savedTitles: libraryItems.filter(item => !item.removed && !item.temp).length, libraryRecords: libraryItems.length, addons: installed.length},
            libraryItems, addons: installed};
    }

    function csv(rows) {
        // Quoting alone does not prevent spreadsheet formula execution.
        const cell = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, match => "'" + match).replace(/"/g, '""') + '"';
        return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
    }

    function files(backup) {
        const saved = backup.libraryItems.filter(item => !item.removed && !item.temp);
        const header = ['Title', 'Type', 'ID', 'Last video ID', 'Resume position (seconds)', 'Last watched'];
        const rows = saved.map(item => [item.name, item.type, item._id, item.state?.video_id,
            Math.max(0, Number(item.state?.timeOffset) || 0) / 1000, item.state?.lastWatched]);
        const table = (headers, values) => `<div class="table"><table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${values.map(row => `<tr>${row.map(v => `<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Ezra's Stremio library backup</title><style>
            :root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:1200px;margin:40px auto;padding:0 24px}h1{color:#7272c2}h2{margin-top:36px}.table{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:10px 14px;border-bottom:1px solid #8885;overflow-wrap:anywhere}th{color:#7272c2}aside{border:1px solid #b28b42;border-radius:8px;padding:16px}small{opacity:.8}@media print{body{margin:0;max-width:none}.table{overflow:visible}}</style>
            <h1>Ezra's Stremio library backup</h1><p>Exported ${escape(backup.exportedAt)} · ${quantity(backup.counts.savedTitles, 'saved title')} · ${quantity(backup.counts.addons, 'add-on')}</p>
            <p>This report works offline without your Stremio account. Use your browser's Find command to search for a title, or Print to save a PDF.</p>
            <aside><strong>Local snapshot</strong><p>${escape(backup.notes.join(' '))}</p></aside>
            <h2>Saved shows and movies</h2>${table(header, rows)}${saved.length ? '' : '<p>No saved titles.</p>'}
            <h2>Installed Stremio add-ons</h2>${table(['Order', 'Name', 'Version', 'ID', 'Official'], backup.addons.map((a, i) => [i + 1, a.manifest.name, a.manifest.version, a.manifest.id, a.flags.official ? 'Yes' : 'No']))}
            <h2>Keeping and recovering your list</h2><p>Library.csv opens in a spreadsheet. Backup.json preserves identifiers, available playback/watched state, removed/temporary library records, and configured add-on installation URLs. Automatic restore is not included in this version. A removed or temporary record is not listed as a saved title above.</p>
            <p>Keep the ZIP and Backup.json private: add-on URLs can contain access keys. Your Stremio login token and password are not included. Installation URLs are omitted from this report and the CSV files.</p></html>`;
        return {'Library.html': html, 'Library.csv': csv([header, ...rows]),
            'Addons.csv': csv([['Order', 'Name', 'Version', 'ID', 'Official'], ...backup.addons.map((a, i) => [i + 1, a.manifest.name, a.manifest.version, a.manifest.id, a.flags.official ? 'Yes' : 'No'])]),
            'Backup.json': JSON.stringify(backup, null, 2) + '\n'};
    }

    // Standard ZIP "store" format, UTF-8 contents, standard CRCs, no CDN/library.
    function zip(entries) {
        const encode = new TextEncoder();
        const parts = [], central = [];
        let offset = 0, centralSize = 0;
        const crc = data => {
            let value = 0xffffffff;
            for (const byte of data) {
                value ^= byte;
                for (let i = 0; i < 8; ++i) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
            }
            return (value ^ 0xffffffff) >>> 0;
        };
        const header = size => { const bytes = new Uint8Array(size); return [bytes, new DataView(bytes.buffer)]; };
        for (const [name, content] of Object.entries(entries)) {
            const filename = encode.encode(name), data = encode.encode(content), checksum = crc(data);
            if (data.length > 0xffffffff || offset + data.length > 0xffffffff) throw new Error('Backup exceeds the ZIP size limit.');
            const [bytes, view] = header(30);
            view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
            view.setUint16(12, 33, true); view.setUint32(14, checksum, true);
            view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, filename.length, true);
            parts.push(bytes, filename, data);
            const [directory, dv] = header(46);
            dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x800, true);
            dv.setUint16(14, 33, true); dv.setUint32(16, checksum, true); dv.setUint32(20, data.length, true);
            dv.setUint32(24, data.length, true); dv.setUint16(28, filename.length, true); dv.setUint32(42, offset, true);
            central.push(directory, filename); centralSize += directory.length + filename.length;
            offset += bytes.length + filename.length + data.length;
        }
        const [end, ev] = header(22);
        ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length / 2, true); ev.setUint16(10, central.length / 2, true);
        ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
        return new Blob([...parts, ...central, end], {type: 'application/zip'});
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = {collect, files, zip};
        return;
    }
    if (window.top !== window.self || !window.chrome?.webview || window.__stremioForkBackup ||
        !['stremio.zarg.me', 'zaarrg.github.io', 'web.stremio.com'].includes(location.hostname)) return;
    window.__stremioForkBackup = true;
    let busy = false, statusText = '', problem = false, scheduled = false;

    async function download() {
        if (busy) return;
        busy = true; problem = false; statusText = 'Preparing local backup…'; render();
        try {
            const backup = collect(localStorage);
            const blob = zip(files(backup));
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url; link.download = `Ezras-Stremio-backup-${backup.exportedAt.replace(/[:.]/g, '-')}.zip`;
            link.hidden = true; document.body.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            problem = backup.localLibraryParts !== 2;
            statusText = `Download prepared: ${quantity(backup.counts.savedTitles, 'saved title')} and ${quantity(backup.counts.addons, 'add-on')}. Local snapshot; account synchronization was not checked. ` +
                (problem ? 'One library part was unavailable; titles may be missing. Open Library while online and export again. ' : '') + 'Keep the ZIP private.';
        } catch (error) {
            problem = true;
            statusText = error instanceof Error && /^(Your |The saved |Unrecognized |No library )/.test(error.message)
                ? error.message : 'The backup could not be prepared. Your data was not changed. Please try again.';
        } finally { busy = false; render(); }
    }

    function render() {
        const container = document.querySelector('[class*="settings-container"] [class*="sections-container"]');
        if (!container) return;
        let section = container.querySelector('#stremio-fork-backup');
        if (!section) {
            section = document.createElement('section'); section.id = 'stremio-fork-backup';
            section.style.cssText = 'margin:32px 0;padding:24px;border:1px solid #7272c280;border-radius:12px;min-width:0;line-height:1.5;color:var(--primary-foreground-color,#fff)';
            const title = document.createElement('h2'); title.textContent = 'Library & add-on backup';
            title.style.cssText = 'font:inherit;font-weight:600;margin:0 0 12px';
            const detail = document.createElement('p');
            detail.textContent = 'Save the shows, movies and installed Stremio add-ons stored on this device in one ZIP. Open Library and Add-ons while online first for the latest saved data. Includes an offline report, spreadsheet lists and a structured backup. Keep the ZIP private: add-on URLs may contain access keys. Automatic restore is not included.';
            detail.style.cssText = 'margin:0 0 16px;max-width:70ch;opacity:.85';
            const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Export library & add-ons';
            button.style.cssText = 'font:inherit;white-space:normal;max-width:100%;padding:12px 20px;border:0;border-radius:8px;background:#7272c2;color:white;cursor:pointer';
            button.addEventListener('click', download);
            const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
            status.style.cssText = 'margin:12px 0 0;overflow-wrap:anywhere';
            section.append(title, detail, button, status); container.prepend(section);
        }
        const button = section.querySelector('button');
        if (button.disabled !== busy) button.disabled = busy;
        const text = busy ? 'Preparing backup…' : 'Export library & add-ons';
        if (button.textContent !== text) button.textContent = text;
        const status = section.querySelector('[role="status"]');
        if (status.textContent !== statusText) status.textContent = statusText;
        const color = problem ? '#e8bb77' : 'inherit';
        if (status.style.color !== color) status.style.color = color;
    }

    function start() {
        new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { scheduled = false; render(); });
        }).observe(document.documentElement, {childList: true, subtree: true});
        render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})();
