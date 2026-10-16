import { esc, cleanMethod, relTime, formatBytes, tryParse, bodyText } from './utils.js';
import { jsonTree } from './json-view.js';

export const SECTIONS = [
    ['headers', 'Headers'],
    ['query', 'Query'],
    ['body', 'Body'],
    ['raw', 'Raw body'],
    ['response', 'Response']
];

/* view: { expanded, sections:Set, selected, compared } */
export function renderCard(log, view) {
    const el = document.createElement('article');
    const status = Number(log.status) || 0;
    const isError = status >= 400;
    const method = cleanMethod(log.method);

    el.className = [
        'log', `m-${method.toLowerCase()}`,
        isError && 'error', view.expanded && 'expanded', view.selected && 'selected', log.pinned && 'pinned'
    ].filter(Boolean).join(' ');
    el.dataset.id = log.id;

    const sig = log.signature
        ? `<span class="sig ${log.signature.valid ? 'ok' : 'bad'}" title="${esc(log.signature.reason)}">${log.signature.valid ? '✓ signed' : '✗ signature'}</span>`
        : '';
    const time = new Date(log.time);

    el.innerHTML = `
    <div class="log-header" data-action="toggle">
      <div class="left">
        <span class="arrow">${view.expanded ? '⯆' : '⯈'}</span>
        <span class="method">${esc(method)}</span>
        <span class="url" title="${esc(log.url)}">${esc(log.url)}</span>
        <span class="status ${isError ? 'error' : 'success'}">${status}</span>
        ${sig}
        ${log.aborted ? '<span class="chip warn">aborted</span>' : ''}
        ${log.imported ? '<span class="chip">imported</span>' : ''}
      </div>
      <div class="right">
        <span class="meta">${formatBytes(log.size)} · ${Number(log.duration) || 0} ms${log.ip ? ` · ${esc(log.ip)}` : ''}</span>
        <span class="rel-time" data-time="${esc(log.time)}" title="${esc(time.toLocaleString())}">${esc(relTime(log.time))}</span>
        <label class="cmp" title="Select for compare (x)"><input type="checkbox" data-action="compare"${view.compared ? ' checked' : ''}></label>
        <button class="icon-btn" data-action="curl" title="Copy as cURL (c)">⧉</button>
        <button class="icon-btn star${log.pinned ? ' on' : ''}" data-action="pin" title="${log.pinned ? 'Unstar' : 'Star'} (s)">${log.pinned ? '★' : '☆'}</button>
        <button class="icon-btn delete" data-action="delete" title="Delete">🗑</button>
      </div>
    </div>
    <div class="log-body">${view.expanded ? sectionsHtml(log, view.sections) : ''}</div>`;

    return el;
}

export function sectionsHtml(log, openSections) {
    return SECTIONS.map(([key, title]) => {
        const open = openSections.has(key);
        return `
      <div class="section${open ? ' open' : ''}" data-section="${key}">
        <div class="section-header" data-action="section">
          <span class="section-title">${open ? '⯆' : '⯈'} ${title}</span>
          <span class="meta">${esc(sectionMeta(key, log))}</span>
          <span class="spacer"></span>
          <button class="icon-btn sm" data-action="copy-section" title="Copy">⧉ Copy</button>
        </div>
        <div class="section-body">${open ? sectionContent(key, log) : ''}</div>
      </div>`;
    }).join('');
}

function sectionMeta(key, log) {
    switch (key) {
        case 'headers': return `${Object.keys(log.headers || {}).length}`;
        case 'query': return `${Object.keys(log.query || {}).length}`;
        case 'body': return log.contentType || '';
        case 'raw': return `${formatBytes(log.size)}${log.rawEncoding === 'base64' ? ' · base64' : ''}`;
        case 'response': return `${log.status}`;
        default: return '';
    }
}

function valueView(value) {
    if (value === null || value === undefined || value === '') return '<div class="muted">Empty</div>';
    if (typeof value === 'object') return jsonTree(value);
    return `<pre>${esc(value)}</pre>`;
}

export function sectionContent(key, log) {
    switch (key) {
        case 'headers': return valueView(log.headers);
        case 'query': return Object.keys(log.query || {}).length ? valueView(log.query) : '<div class="muted">No query parameters</div>';
        case 'body':
            if (log.rawEncoding === 'base64') return `<div class="muted">Binary body (${formatBytes(log.size)}). See Raw body.</div>`;
            return log.body === null || log.body === undefined ? '<div class="muted">No body</div>' : valueView(log.body);
        case 'raw': {
            const raw = bodyText(log);
            if (!raw) return '<div class="muted">Empty</div>';
            return `${log.rawEncoding === 'base64' ? '<div class="sub">base64</div>' : ''}<pre>${esc(raw)}</pre>`;
        }
        case 'response':
            return `<div class="sub">Headers</div>${valueView(log.responseHeaders || {})}` +
                `<div class="sub">Body</div>${valueView(tryParse(log.response))}`;
        default: return '';
    }
}

export function sectionCopyText(key, log) {
    const pretty = v => (typeof v === 'string' ? v : JSON.stringify(v ?? null, null, 2));
    switch (key) {
        case 'headers': return pretty(log.headers || {});
        case 'query': return pretty(log.query || {});
        case 'body': return log.body !== null && typeof log.body === 'object' ? pretty(log.body) : bodyText(log);
        case 'raw': return bodyText(log);
        case 'response': return pretty(tryParse(log.response));
        default: return '';
    }
}

export function renderEmpty(channel, origin, filtered) {
    if (filtered) {
        return `<div class="empty">No logs match the current filters.</div>`;
    }
    const url = channel ? `${origin}/hook/${channel.id}` : '';
    return `
    <div class="empty">
      No requests captured yet.<br>
      <code class="endpoint">${esc(url)}</code>
    </div>`;
}
