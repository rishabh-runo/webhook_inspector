import { esc, cleanMethod, relTime, formatBytes, tryParse, bodyText, icon } from './utils.js';
import { codeView, jsonView } from './code-view.js';

export const TABS = [
    ['summary', 'Summary'],
    ['headers', 'Headers'],
    ['query', 'Query'],
    ['body', 'Body (JSON)'],
    ['response', 'Response'],
    ['timing', 'Timing']
];

const hasKeys = obj => !!obj && typeof obj === 'object' && Object.keys(obj).length > 0;
const fullDate = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

/* view: { expanded, tab, bodyMode, selected, compared } */
export function renderCard(log, view) {
    const el = document.createElement('article');
    const status = Number(log.status) || 0;
    const isError = status >= 400;
    const method = cleanMethod(log.method);

    el.className = [
        'log', `m-${method.toLowerCase()}`,
        view.expanded && 'expanded', view.selected && 'selected', log.pinned && 'pinned'
    ].filter(Boolean).join(' ');
    el.dataset.id = log.id;

    const sig = log.signature
        ? `<span class="sig ${log.signature.valid ? 'ok' : 'bad'}" title="${esc(log.signature.reason)}">${icon(log.signature.valid ? 'shield-check' : 'shield-x')}${log.signature.valid ? 'Signed' : 'Bad signature'}</span>`
        : '';

    el.innerHTML = `
    <div class="log-header" data-action="toggle">
      <div class="left">
        <button class="icon-btn xs" data-action="toggle" aria-expanded="${!!view.expanded}" aria-label="Show request details">${icon('chevron-right', 'arrow')}</button>
        <span class="method"><span class="method-dot"></span>${esc(method)}</span>
        <span class="url" title="${esc(log.url)}">${esc(log.url)}</span>
        <span class="status${isError ? ' err' : ''}"><span class="status-dot"></span>${status}</span>
        ${sig}
        ${log.aborted ? `<span class="chip warn">${icon('alert')}aborted</span>` : ''}
        ${log.imported ? '<span class="chip">imported</span>' : ''}
      </div>
      <div class="right">
        <span class="meta">${formatBytes(log.size)} · ${Number(log.duration) || 0} ms${log.ip ? ` · ${esc(log.ip)}` : ''}</span>
        <span class="rel-time" data-time="${esc(log.time)}" title="${esc(fullDate(log.time))}">${esc(relTime(log.time))}</span>
        <label class="cmp" title="Select for compare (x)"><input type="checkbox" data-action="compare" aria-label="Select for compare"${view.compared ? ' checked' : ''}></label>
        <button class="icon-btn sm star" data-action="pin" aria-pressed="${!!log.pinned}" aria-label="Star" title="${log.pinned ? 'Unstar' : 'Star'} (s)">${icon('star')}</button>
        <button class="icon-btn sm" data-action="menu" aria-haspopup="menu" aria-expanded="false" aria-label="More actions" title="More actions">${icon('more')}</button>
      </div>
    </div>
    <div class="log-drawer"${view.expanded ? '' : ' inert'}><div class="drawer-inner">${view.expanded ? inspectorHtml(log, view) : ''}</div></div>`;

    return el;
}

/* ----------- MULTI-TAB PAYLOAD INSPECTOR ----------- */
export function inspectorHtml(log, view) {
    const tab = view.tab || 'summary';
    const id = log.id;
    const tabs = TABS.map(([key, title]) => {
        const on = key === tab;
        return `<button class="itab" role="tab" id="tab-${id}-${key}" aria-selected="${on}" aria-controls="panel-${id}" tabindex="${on ? 0 : -1}" data-action="tab" data-tab="${key}">${title}</button>`;
    }).join('');

    const bodyMode = view.bodyMode || 'parsed';
    const modeSwitch = tab === 'body' && bodyText(log)
        ? `<div class="mini-seg" role="group" aria-label="Body view">
             <button type="button" data-action="body-mode" data-mode="parsed" aria-pressed="${bodyMode === 'parsed'}">Parsed</button>
             <button type="button" data-action="body-mode" data-mode="raw" aria-pressed="${bodyMode === 'raw'}">Raw</button>
           </div>`
        : '';

    return `
    <div class="inspector">
      <div class="inspector-head">
        <div class="itabs" role="tablist" aria-label="Request details">${tabs}</div>
        <div class="inspector-tools">
          ${modeSwitch}
          <button type="button" class="btn xs" data-action="copy-tab" title="Copy this tab">${icon('copy')}Copy</button>
        </div>
      </div>
      <div class="inspector-panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}-${tab}">${tabContent(tab, log, bodyMode)}</div>
    </div>`;
}

function kv(rows) {
    return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function signatureValue(log) {
    if (!log.signature) return 'Not checked';
    const s = log.signature;
    return s.valid
        ? `<span class="ok">${icon('shield-check')}Valid · ${esc(s.reason)}</span>`
        : `<span class="bad">${icon('shield-x')}Invalid · ${esc(s.reason)}</span>`;
}

function flags(log) {
    const list = [log.pinned && 'Starred', log.imported && 'Imported', log.aborted && 'Aborted'].filter(Boolean);
    return list.length ? list.join(', ') : '—';
}

function bodyContent(log, mode) {
    const raw = bodyText(log);
    if (mode === 'raw') {
        if (!raw) return '<div class="note">Empty body.</div>';
        return `${log.rawEncoding === 'base64' ? '<div class="sub-label">base64</div>' : ''}${codeView(raw)}`;
    }
    if (log.rawEncoding === 'base64') return `<div class="note">Binary body (${formatBytes(log.size)}). Switch to Raw to see it as base64.</div>`;
    if (log.body === null || log.body === undefined || log.body === '') return '<div class="note">No body.</div>';
    return typeof log.body === 'object' ? jsonView(log.body) : codeView(log.body);
}

function responseBody(log) {
    const parsed = tryParse(log.response);
    if (parsed === '' || parsed === null || parsed === undefined) return '<div class="note">Empty response body.</div>';
    return typeof parsed === 'object' ? jsonView(parsed) : codeView(parsed);
}

export function tabContent(tab, log, bodyMode = 'parsed') {
    switch (tab) {
        case 'summary':
            return kv([
                ['Method', esc(cleanMethod(log.method))],
                ['URL', esc(log.url)],
                ['Status', String(Number(log.status) || 0)],
                ['Received', esc(fullDate(log.time))],
                ['Duration', `${Number(log.duration) || 0} ms`],
                ['Size', esc(formatBytes(log.size))],
                ['Content type', esc(log.contentType || '—')],
                ['Source IP', esc(log.ip || '—')],
                ['Signature', signatureValue(log)],
                ['Flags', esc(flags(log))]
            ]);
        case 'headers':
            return hasKeys(log.headers) ? jsonView(log.headers) : '<div class="note">No headers.</div>';
        case 'query':
            return hasKeys(log.query) ? jsonView(log.query) : '<div class="note">No query parameters.</div>';
        case 'body':
            return bodyContent(log, bodyMode);
        case 'response':
            return `<div class="sub-label">Status ${Number(log.status) || 0} · Headers</div>${hasKeys(log.responseHeaders) ? jsonView(log.responseHeaders) : '<div class="note">No response headers.</div>'}` +
                `<div class="sub-label">Body</div>${responseBody(log)}`;
        case 'timing':
            return kv([
                ['Received', esc(fullDate(log.time))],
                ['Received (UTC)', esc(new Date(log.time).toISOString())],
                ['Response time', `${Number(log.duration) || 0} ms`],
                ['Completed', log.aborted ? 'No · the sender disconnected before the reply finished' : 'Yes · reply sent']
            ]);
        default:
            return '';
    }
}

/* Plain text of the open tab, for its Copy button */
export function tabCopyText(tab, log, bodyMode = 'parsed') {
    const pretty = v => (typeof v === 'string' ? v : JSON.stringify(v ?? null, null, 2));
    switch (tab) {
        case 'summary':
            return [
                `Method: ${cleanMethod(log.method)}`, `URL: ${log.url}`, `Status: ${log.status}`,
                `Received: ${log.time}`, `Duration: ${Number(log.duration) || 0} ms`, `Size: ${formatBytes(log.size)}`,
                `Content type: ${log.contentType || '-'}`, `Source IP: ${log.ip || '-'}`,
                `Signature: ${log.signature ? `${log.signature.valid ? 'valid' : 'invalid'} (${log.signature.reason})` : 'not checked'}`
            ].join('\n');
        case 'headers': return pretty(log.headers || {});
        case 'query': return pretty(log.query || {});
        case 'body':
            if (bodyMode === 'raw') return bodyText(log);
            return log.body !== null && typeof log.body === 'object' ? pretty(log.body) : bodyText(log);
        case 'response': return pretty(tryParse(log.response));
        case 'timing':
            return [`Received: ${log.time}`, `Response time: ${Number(log.duration) || 0} ms`, `Completed: ${log.aborted ? 'no' : 'yes'}`].join('\n');
        default: return '';
    }
}

/* ----------- EMPTY STATES ----------- */
export function renderEmpty(channel, origin, filtered) {
    if (filtered) {
        return `
    <div class="empty">
      <span class="empty-icon">${icon('search')}</span>
      <h3>No matching requests</h3>
      <p>No logs match the current search or filters.</p>
    </div>`;
    }
    const url = channel ? `${origin}/hook/${channel.id}` : '';
    return `
    <div class="empty">
      <span class="empty-icon">${icon('inbox')}</span>
      <h3>No requests captured yet</h3>
      <p>Send a request to this endpoint, or fire a sample to see it here instantly.</p>
      <code class="endpoint-chip">${esc(url)}</code>
      <button type="button" class="btn primary" data-action="sample">${icon('send')}Send Sample Webhook</button>
      <p class="hint">Sends <code>{"event": "user.signup", "status": "success"}</code></p>
    </div>`;
}
