import { api, wsUrl, setToken, dropToken, tokenVersion, allTokens } from './api.js';
import { connectLive } from './ws.js';
import { esc, cleanMethod, COMMON_METHODS, relTime, debounce, copyText, toast, toCurl, icon, resendRequest } from './utils.js';
import { renderCard, inspectorHtml, tabCopyText, renderEmpty, TABS } from './render.js';
import { createListView } from './list-view.js';
import { togglePopover, closePopover } from './popover.js';
import { diffHtml } from './diff.js';
import { download, toJson, toHar, parseImport } from './export.js';
import * as notify from './notify.js';
import { openChannelModal } from './channels.js';

const origin = location.origin;
const THROUGHPUT_WINDOW_MS = 5000;
const SAMPLE_PAYLOAD = { event: 'user.signup', status: 'success' };

// method/status: any of the chosen values; range: one time window; starred: only starred
function emptyFilters() {
    return { text: '', method: new Set(), status: new Set(), range: '', starred: false };
}

const state = {
    channels: [],
    logs: {},                 // channelId -> logs, newest first
    active: decodeURIComponent(location.hash.slice(2)) || 'open',
    filters: emptyFilters(),
    paused: new Set(),        // channel ids whose live feed is paused
    held: new Map(),          // channel id -> Set of log ids received while paused
    expanded: new Set(),      // log ids with an open inspector
    tabs: new Map(),          // log id -> open inspector tab
    bodyMode: new Map(),      // log id -> 'parsed' | 'raw'
    selectedId: null,
    compare: [],              // up to 2 log ids
    arrivals: []              // timestamps of recent requests, for req/s
};

const $ = id => document.getElementById(id);
const logsEl = $('logs');

/* ----------- HELPERS ----------- */
const activeChannel = () => state.channels.find(c => c.id === state.active);
const activeLogs = () => state.logs[state.active] || [];
// Password-protected channel this browser hasn't unlocked (its logs were never loaded)
const lockedOut = ch => !!ch && ch.locked && state.logs[ch.id] === undefined;

// Logs that arrived while a channel was paused stay hidden until resume
function heldSet(id) {
    if (!state.held.has(id)) state.held.set(id, new Set());
    return state.held.get(id);
}

// Keep only held ids that still exist (after deletes, clears, reloads)
function pruneHeld(id) {
    const held = state.held.get(id);
    if (!held?.size) return;
    const ids = new Set((state.logs[id] || []).map(l => l.id));
    held.forEach(logId => { if (!ids.has(logId)) held.delete(logId); });
}

// On reload of a paused channel, logs we hadn't seen yet are held too
function holdUnseen(id, before) {
    if (!state.paused.has(id) || !before) return;
    const seen = new Set(before.map(l => l.id));
    (state.logs[id] || []).forEach(l => { if (!seen.has(l.id)) heldSet(id).add(l.id); });
    pruneHeld(id);
}

let live = null;
const sendAuth = () => live?.send({ type: 'AUTH', tokens: allTokens() });

function findLog(id) {
    for (const logs of Object.values(state.logs)) {
        const log = logs.find(l => l.id === id);
        if (log) return log;
    }
    return null;
}

function viewOf(log) {
    return {
        expanded: state.expanded.has(log.id),
        tab: state.tabs.get(log.id) || 'summary',
        bodyMode: state.bodyMode.get(log.id) || 'parsed',
        selected: state.selectedId === log.id,
        compared: state.compare.includes(log.id)
    };
}

const card = log => renderCard(log, viewOf(log));
const list = createListView(logsEl, { render: card });
const cardEl = id => list.element(id);

/* ----------- FILTERS ----------- */
const searchCache = new WeakMap();

function searchText(log) {
    let s = searchCache.get(log);
    if (s === undefined) {
        s = [
            log.method, log.url, log.status, log.ip,
            JSON.stringify(log.headers), JSON.stringify(log.query),
            log.rawEncoding === 'base64' ? '' : log.rawBody,
            typeof log.response === 'string' ? log.response : ''
        ].join('\n').toLowerCase();
        searchCache.set(log, s);
    }
    return s;
}

// Method chip a log belongs to (anything outside the common five is OTHER)
const methodKey = log => {
    const m = cleanMethod(log.method);
    return COMMON_METHODS.includes(m) ? m : 'OTHER';
};

function matches(log) {
    const f = state.filters;
    if (f.method.size && !f.method.has(methodKey(log))) return false;
    if (f.status.size && !f.status.has(String(log.status)[0])) return false;
    if (f.range && Date.now() - new Date(log.time).getTime() > Number(f.range) * 60000) return false;
    if (f.starred && !log.pinned) return false;
    if (f.text && !searchText(log).includes(f.text)) return false;
    return true;
}

const isFiltered = () => {
    const f = state.filters;
    return !!(f.text || f.method.size || f.status.size || f.range || f.starred);
};

/* ----------- LIST RENDERING ----------- */
function rebuild() {
    const ch = activeChannel();
    const locked = lockedOut(ch);
    $('list-bar').hidden = locked;
    if (locked) {
        list.clear();
        logsEl.innerHTML = renderLocked(ch);
        updateCounts();
        logsEl.querySelector('input')?.focus();
        return;
    }

    const held = state.held.get(state.active);
    const visible = activeLogs().filter(l => !held?.has(l.id) && matches(l));
    if (visible.length) {
        list.set(visible);
    } else {
        list.clear();
        logsEl.innerHTML = renderEmpty(ch, origin, isFiltered());
    }
    updateCounts();
}

function renderLocked(ch) {
    return `
    <form class="locked" id="unlock-form">
      <span class="empty-icon">${icon('lock')}</span>
      <h3>${esc(ch.name)} is password protected</h3>
      <p>Enter the channel password to see its logs. Webhooks are still captured.</p>
      <div class="unlock-row">
        <input type="password" name="password" placeholder="Channel password" aria-label="Channel password" autocomplete="current-password" required maxlength="200">
        <button class="btn primary" type="submit">Unlock</button>
      </div>
      <p class="form-error" id="unlock-error" role="alert" hidden></p>
    </form>`;
}

function insertNew(log) {
    if (!matches(log)) return;
    if (!list.size()) return rebuild();
    list.prepend(log);
}

function removeFromView(id) {
    if (!list.remove(id)) return;
    if (!list.size()) rebuild();
}

function replaceInView(log) {
    if (!list.has(log.id)) return;
    if (!matches(log)) return removeFromView(log.id);
    list.replace(log);
}

function updateCounts() {
    const total = activeLogs().length;
    $('count').innerHTML = isFiltered()
        ? `<strong>${list.size()}</strong> of ${total} LOGS`
        : `<strong>${total}</strong> ${total === 1 ? 'LOG' : 'LOGS'}`;

    updateFilterBar();

    state.channels.forEach(ch => {
        const badge = document.querySelector(`.tab[data-channel="${CSS.escape(ch.id)}"] .badge`);
        if (badge) badge.textContent = (state.logs[ch.id] || []).length;
    });
}

/* ----------- FILTER BAR ----------- */
function updateFilterBar() {
    const logs = activeLogs();
    const counts = { method: {}, status: {} };
    let starred = 0;
    for (const log of logs) {
        const m = methodKey(log);
        counts.method[m] = (counts.method[m] || 0) + 1;
        const st = String(log.status)[0];
        counts.status[st] = (counts.status[st] || 0) + 1;
        if (log.pinned) starred++;
    }

    const f = state.filters;
    document.querySelectorAll('#filter-bar .fchip').forEach(chip => {
        const { filter, value } = chip.dataset;
        let on;
        let count = null;
        if (filter === 'method' || filter === 'status') {
            // the "All" chip (empty value) is on while the group has no selection
            on = value ? f[filter].has(value) : f[filter].size === 0;
            if (value) count = counts[filter][value] || 0;
        } else if (filter === 'range') {
            on = f.range === value;
        } else {
            on = value ? f.starred : !f.starred;
            if (value) count = starred;
        }
        chip.setAttribute('aria-pressed', on);
        if (count !== null) chip.querySelector('.fcount').textContent = count;
    });
    $('btn-reset-filters').hidden = !isFiltered();
}

function toggleFilter(filter, value) {
    const f = state.filters;
    if (filter === 'method' || filter === 'status') {
        if (!value) f[filter].clear();                 // "All"
        else if (f[filter].has(value)) f[filter].delete(value);
        else f[filter].add(value);
    } else if (filter === 'range') {
        f.range = value && f.range !== value ? value : ''; // one window; click again (or "Any") to clear
    } else if (filter === 'starred') {
        f.starred = value ? !f.starred : false;
    }
    rebuild();
}

function resetFilters() {
    state.filters = emptyFilters();
    $('f-text').value = '';
    $('btn-search-clear').hidden = true;
    rebuild();
}

/* ----------- CHANNEL SIDEBAR ----------- */
function channelState(ch) {
    if (lockedOut(ch)) return ['is-locked', 'Locked'];
    if (state.paused.has(ch.id)) return ['is-paused', 'Paused'];
    return ['is-live', 'Live'];
}

// Icon in front of a channel: password lock (closed / open here), secure (auth-key) or open
function securityOf(ch) {
    const notes = [];
    let name;
    if (ch.locked) {
        name = lockedOut(ch) ? 'lock' : 'lock-open';
        notes.push(lockedOut(ch) ? 'Password protected, locked' : 'Password protected, unlocked on this browser');
    }
    if (ch.requireAuth) {
        name ||= 'shield-check';
        notes.push('Secure: senders need the auth-key header');
    }
    if (!name) {
        name = 'globe';
        notes.push('Open: anyone can send');
    }
    return { name, label: notes.join(' · ') };
}

function renderTabs() {
    $('tabs').innerHTML = state.channels.map(ch => {
        const active = ch.id === state.active;
        const [stateCls, label] = channelState(ch);
        const sec = securityOf(ch);
        return `
    <div class="tab${active ? ' active' : ''}" role="tab" tabindex="0" aria-selected="${active}"
         data-channel="${esc(ch.id)}" title="${esc(ch.name)} · /hook/${esc(ch.id)} · ${label} · ${esc(sec.label)}">
      <span class="tab-icon ${stateCls}" aria-hidden="true">${icon(sec.name)}</span>
      <span class="tab-text">
        <span class="tab-name">${esc(ch.name)}<span class="sr-only"> (${label}; ${esc(sec.label)})</span></span>
        <span class="tab-path">/hook/${esc(ch.id)}</span>
      </span>
      ${state.paused.has(ch.id) && !lockedOut(ch) ? `<span class="tab-pause" title="Live feed paused">${icon('pause')}</span>` : ''}
      ${lockedOut(ch) ? '' : `<span class="tab-end${ch.builtin ? '' : ' has-close'}">
        <span class="badge">${(state.logs[ch.id] || []).length}</span>
        ${ch.builtin ? '' : `<button class="tab-close" data-action="close" title="Delete channel" aria-label="Delete channel ${esc(ch.name)}">${icon('x')}</button>`}
      </span>`}
    </div>`;
    }).join('');
}

/* ----------- WEBHOOK ENDPOINT BANNER ----------- */
function renderChannelBar() {
    const ch = activeChannel();
    if (!ch) return;
    $('endpoint-url').textContent = `${origin}/hook/${ch.id}`;
    $('channel-name').textContent = ch.name;
    notify.setBaseTitle(`${ch.name} · Webhook Inspector`);

    // Built-in channels are fixed; locked channels show nothing until unlocked
    const locked = lockedOut(ch);
    $('btn-channel-settings').hidden = ch.builtin || locked;
    $('btn-pause').hidden = locked;
    $('btn-ch-notify').hidden = locked;
    $('btn-ch-sound').hidden = locked;
    $('btn-lock').hidden = !ch.locked || locked;
    updateAlertButtons();
    updatePauseUi();

    const chips = [];
    const paused = state.paused.has(ch.id);
    if (locked) chips.push(`<span class="chip">${icon('lock')}locked</span>`);
    else chips.push(`<span class="chip${paused ? ' paused' : ''}"><span class="chip-dot"></span>${paused ? 'paused' : 'active'}</span>`);
    chips.push(ch.requireAuth
        ? `<span class="chip${ch.hasAuthKey ? '' : ' warn'}">${icon('key')}auth-key${ch.hasAuthKey ? '' : ' · AUTH_KEY not set, rejects all'}</span>`
        : `<span class="chip">${icon('globe')}open</span>`);
    const r = ch.response;
    chips.push(`<span class="chip">${icon('reply')}${r.status}${r.delayMs ? ` · ${r.delayMs} ms` : ''}</span>`);
    if (ch.builtin) chips.push(`<span class="chip">${icon('pin')}built-in</span>`);
    if (ch.locked) chips.push(`<span class="chip">${icon('lock')}password</span>`);
    if (ch.signature.type !== 'none') {
        chips.push(`<span class="chip${ch.signature.hasSecret ? '' : ' warn'}">${icon('pen')}${esc(ch.signature.type)}${ch.signature.hasSecret ? '' : ' · no secret'}</span>`);
    }
    $('channel-chips').innerHTML = chips.join('');
}

function switchChannel(id) {
    if (!state.channels.some(c => c.id === id)) return;
    closePopover({ restoreFocus: false });
    state.active = id;
    state.selectedId = null;
    history.replaceState(null, '', `#/${encodeURIComponent(id)}`);
    renderTabs();
    renderChannelBar();
    rebuild();
}

function stepChannel(dir) {
    const idx = state.channels.findIndex(c => c.id === state.active);
    const next = state.channels[(idx + dir + state.channels.length) % state.channels.length];
    if (next) switchChannel(next.id);
}

function upsertChannel({ token, ...ch }) {
    const idx = state.channels.findIndex(c => c.id === ch.id);
    const prev = state.channels[idx];
    const wasLockedOut = lockedOut(prev);
    if (idx === -1) state.channels.push(ch);
    else state.channels[idx] = ch;

    if (ch.locked && tokenVersion(ch.id) !== ch.lockVersion) {
        // Password set or changed: a token for the old password no longer works
        dropToken(ch.id);
        delete state.logs[ch.id];
    } else if (state.logs[ch.id] === undefined) {
        // Visible now (password removed, or we just got a token)
        state.logs[ch.id] = [];
        if (prev) reloadChannel(ch.id).catch(() => { });
    }
    if (!ch.locked) dropToken(ch.id);

    renderTabs();
    if (ch.id === state.active) {
        renderChannelBar();
        if (wasLockedOut !== lockedOut(ch)) rebuild();
    }
}

function removeChannel(id) {
    const idx = state.channels.findIndex(c => c.id === id);
    if (idx === -1) return;
    state.channels.splice(idx, 1);
    delete state.logs[id];
    notify.forget(id);
    dropToken(id);
    state.paused.delete(id);
    state.held.delete(id);
    // Closing the active channel opens its neighbour below (or above if it was last)
    if (state.active === id) switchChannel((state.channels[idx] || state.channels[idx - 1]).id);
    else renderTabs();
}

async function closeChannel(id) {
    const ch = state.channels.find(c => c.id === id);
    if (!ch || ch.builtin) return;
    const count = (state.logs[id] || []).length;
    if (count && !confirm(`Delete channel "${ch.name}" and its ${count} log${count > 1 ? 's' : ''}?`)) return;
    try {
        await api(`/api/channels/${encodeURIComponent(id)}`, { method: 'DELETE', channel: id });
        removeChannel(id);
        toast(`Channel "${ch.name}" deleted`);
    } catch (err) {
        toast(err.message);
    }
}

/* ----------- DATA ----------- */
async function loadAll() {
    const channels = await api('/api/channels');
    const logs = await Promise.all(channels.map(ch => {
        if (ch.locked && tokenVersion(ch.id) !== ch.lockVersion) {
            dropToken(ch.id);
            return null;
        }
        return api(`/logs/${encodeURIComponent(ch.id)}`, { channel: ch.id }).catch(err => {
            if (!err.locked) throw err;
            dropToken(ch.id);
            return null;
        });
    }));
    const before = state.logs;
    state.channels = channels;
    state.logs = {};
    channels.forEach((ch, i) => {
        if (logs[i]) state.logs[ch.id] = logs[i];
        holdUnseen(ch.id, before[ch.id]);
    });
    if (!channels.some(c => c.id === state.active)) {
        state.active = channels[0]?.id;
        history.replaceState(null, '', `#/${encodeURIComponent(state.active)}`);
    }
    renderTabs();
    renderChannelBar();
    rebuild();
}

async function reloadChannel(id) {
    const before = state.logs[id];
    try {
        state.logs[id] = await api(`/logs/${encodeURIComponent(id)}`, { channel: id });
        holdUnseen(id, before);
    } catch (err) {
        if (!err.locked) throw err;
        dropToken(id);
        delete state.logs[id];
    }
    renderTabs();
    if (id === state.active) {
        renderChannelBar();
        rebuild();
    }
}

function dropLogs(channel, ids) {
    if (!ids?.length || !state.logs[channel]) return;
    const set = new Set(ids);
    state.logs[channel] = state.logs[channel].filter(l => !set.has(l.id));
    if (channel === state.active) ids.forEach(removeFromView);
    if (state.held.get(channel)?.size) {
        pruneHeld(channel);
        if (channel === state.active) updatePauseUi();
    }
    state.compare = state.compare.filter(id => !set.has(id));
    updateCompareButton();
}

function handleMessage(msg) {
    if (msg.channel && lockedOut(state.channels.find(c => c.id === msg.channel))) return;
    switch (msg.type) {
        case 'NEW_LOG': {
            state.arrivals.push(Date.now());
            const logs = (state.logs[msg.channel] ||= []);
            logs.unshift(msg.data);
            dropLogs(msg.channel, msg.dropped);
            if (state.paused.has(msg.channel)) {
                heldSet(msg.channel).add(msg.data.id);
                if (msg.channel === state.active) updatePauseUi();
            } else if (msg.channel === state.active) {
                insertNew(msg.data);
            }
            updateCounts();
            const ch = state.channels.find(c => c.id === msg.channel);
            if (ch) notify.onNewLog(msg.data, ch, msg.channel === state.active, () => switchChannel(ch.id));
            break;
        }
        case 'UPDATE_LOG': {
            const logs = state.logs[msg.channel] || [];
            const idx = logs.findIndex(l => l.id === msg.data.id);
            if (idx !== -1) logs[idx] = msg.data;
            if (msg.channel === state.active) {
                replaceInView(msg.data);
                updateCounts();
            }
            break;
        }
        case 'DELETE_LOG':
            dropLogs(msg.channel, [msg.id]);
            updateCounts();
            break;
        case 'CLEAR_LOGS':
            state.logs[msg.channel] = (state.logs[msg.channel] || []).filter(l => l.pinned);
            pruneHeld(msg.channel);
            if (msg.channel === state.active) {
                rebuild();
                updatePauseUi();
            } else updateCounts();
            break;
        case 'RELOAD_CHANNEL':
            reloadChannel(msg.channel).catch(() => { });
            break;
        case 'CHANNEL_UPSERT':
            upsertChannel(msg.data);
            break;
        case 'CHANNEL_DELETE':
            removeChannel(msg.id);
            break;
    }
}

function setConnStatus(status) {
    const labels = { live: 'LIVE', connecting: 'CONNECTING', reconnecting: 'RECONNECTING', offline: 'OFFLINE' };
    const el = $('conn');
    el.className = `status-pill conn ${status}`;
    el.querySelector('.conn-label').textContent = labels[status];
    el.title = status === 'live' ? 'Receiving live updates' : 'Not receiving live updates';
}

/* High-volume buffer indicator: requests per second over the last 5 s */
function updateThroughput() {
    const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
    while (state.arrivals.length && state.arrivals[0] < cutoff) state.arrivals.shift();
    const rate = state.arrivals.length / (THROUGHPUT_WINDOW_MS / 1000);
    const text = rate === 0 ? '0' : rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
    $('throughput-value').textContent = `${text} req/s`;
}

/* ----------- INSPECTION DRAWER ----------- */
function setExpanded(id, open) {
    const el = cardEl(id);
    if (open) state.expanded.add(id);
    else state.expanded.delete(id);
    updateCollapseButton();
    if (!el) return;

    const inner = el.querySelector('.drawer-inner');
    if (open && !inner.innerHTML.trim()) inner.innerHTML = inspectorHtml(findLog(id), viewOf(findLog(id)));
    el.querySelector('.log-drawer').inert = !open;
    el.querySelector('.log-header [data-action="toggle"]').setAttribute('aria-expanded', open);
    el.classList.toggle('expanded', open);
}

const toggleExpand = id => setExpanded(id, !state.expanded.has(id));

function collapseAll() {
    if (!state.expanded.size) return;
    [...state.expanded].forEach(id => setExpanded(id, false));
    updateCollapseButton();
}

function updateCollapseButton() {
    $('btn-collapse-all').disabled = state.expanded.size === 0;
}

function refreshInspector(id, focusTab = false) {
    const el = cardEl(id);
    const log = findLog(id);
    if (!el || !log || !state.expanded.has(id)) return;
    el.querySelector('.drawer-inner').innerHTML = inspectorHtml(log, viewOf(log));
    if (focusTab) el.querySelector('.itab[aria-selected="true"]')?.focus();
}

function switchTab(id, tab, focus = false) {
    state.tabs.set(id, tab);
    refreshInspector(id, focus);
}

/* ----------- ROW ACTIONS ----------- */
let menuLogId = null;

async function copyCurl(id) {
    const log = findLog(id);
    if (log && await copyText(toCurl(log, origin))) toast('cURL copied');
}

async function resend(id) {
    const log = findLog(id);
    if (!log) return;
    try {
        const status = await resendRequest(log);
        const ch = state.channels.find(c => c.id === log.channel);
        const masked = status === 401 && ch?.requireAuth;
        toast(masked ? `Resent · 401 (the auth-key is masked, so it can't be replayed)` : `Request resent · ${status}`);
    } catch (err) {
        toast(`Resend failed: ${err.message}`);
    }
}

function togglePin(id) {
    const log = findLog(id);
    if (!log) return;
    const channel = log.channel || state.active;
    api(`/logs/${encodeURIComponent(channel)}/${id}`, { method: 'PATCH', json: { pinned: !log.pinned }, channel })
        .catch(err => toast(err.message));
}

function deleteLog(id) {
    const log = findLog(id);
    const channel = log?.channel || state.active;
    api(`/logs/${encodeURIComponent(channel)}/${id}`, { method: 'DELETE', channel })
        .catch(err => toast(err.message));
}

function toggleCompare(id, on = !state.compare.includes(id)) {
    state.compare = state.compare.filter(x => x !== id);
    if (on) {
        state.compare.push(id);
        if (state.compare.length > 2) {
            const dropped = state.compare.shift();
            const box = cardEl(dropped)?.querySelector('[data-action="compare"]');
            if (box) box.checked = false;
        }
    }
    const box = cardEl(id)?.querySelector('[data-action="compare"]');
    if (box) box.checked = on;
    updateCompareButton();
}

function updateCompareButton() {
    const btn = $('btn-compare');
    btn.innerHTML = `${icon('compare')}Compare ${state.compare.length}/2`;
    btn.disabled = state.compare.length !== 2;
}

function openDiff() {
    const [a, b] = state.compare.map(findLog);
    if (!a || !b) return;
    $('diff-body').innerHTML = diffHtml(a, b);
    $('diff-only-changes').checked = false;
    $('modal-diff').showModal();
}

async function sendSample() {
    const ch = activeChannel();
    if (!ch) return;
    try {
        const res = await fetch(`/hook/${encodeURIComponent(ch.id)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(SAMPLE_PAYLOAD)
        });
        toast(res.status === 401 ? 'Sample sent · 401 (this channel needs an auth-key)' : 'Sample webhook sent');
    } catch (err) {
        toast(`Sample failed: ${err.message}`);
    }
}

/* ----------- QUICK TOGGLES ----------- */
function setPaused(id, paused) {
    if (!id) return;
    if (paused) {
        state.paused.add(id);
    } else {
        state.paused.delete(id);
        state.held.delete(id);
        if (id === state.active) rebuild(); // show what was held
    }
    renderTabs();
    if (id === state.active) renderChannelBar();
}

const togglePause = () => setPaused(state.active, !state.paused.has(state.active));

function updatePauseUi() {
    const paused = state.paused.has(state.active) && !lockedOut(activeChannel());
    const waiting = state.held.get(state.active)?.size || 0;
    const btn = $('btn-pause');
    btn.innerHTML = paused ? `${icon('play')}Resume Listener` : `${icon('pause')}Pause Listener`;
    btn.setAttribute('aria-pressed', paused);
    $('paused-banner').hidden = !paused;
    $('paused-text').textContent = waiting
        ? `This channel is paused · ${waiting} new request${waiting > 1 ? 's' : ''} waiting`
        : 'This channel is paused · new requests are held until you resume';
}

function updateAlertButtons() {
    const ch = activeChannel();
    if (!ch) return;
    const a = notify.getAlerts(ch.id);
    $('btn-ch-notify').innerHTML = `${icon(a.notify ? 'bell' : 'bell-off')}Notifications`;
    $('btn-ch-notify').setAttribute('aria-pressed', a.notify);
    $('btn-ch-sound').innerHTML = `${icon(a.sound ? 'volume' : 'volume-x')}Sound Alerts`;
    $('btn-ch-sound').setAttribute('aria-pressed', a.sound);
}

/* ----------- SELECTION & NAVIGATION ----------- */
function select(id) {
    if (state.selectedId !== null) cardEl(state.selectedId)?.classList.remove('selected');
    state.selectedId = id;
    if (id !== null) cardEl(id)?.classList.add('selected');
}

function moveSelection(dir) {
    if (!list.size()) return;
    const idx = list.indexOf(state.selectedId);
    const next = idx === -1 ? 0 : Math.max(0, Math.min(list.size() - 1, idx + dir));
    const item = list.at(next);
    list.reveal(item.id);
    select(item.id);
}

function toggleTheme() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.classList.add('theme-anim');
    root.dataset.theme = next;
    setTimeout(() => root.classList.remove('theme-anim'), 300);
    try { localStorage.setItem('theme', next); } catch { }
}

let copiedTimer;
async function copyEndpoint() {
    if (!(await copyText($('endpoint-url').textContent))) return;
    const btn = $('btn-copy-endpoint');
    btn.classList.add('copied');
    btn.innerHTML = `${icon('check')}<span>Copied!</span>`;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `${icon('copy')}<span>Copy</span>`;
    }, 1500);
}

const focusSearch = () => {
    $('f-text').focus();
    $('f-text').select();
};

/* ----------- EVENTS: LOG LIST ----------- */
logsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="sample"]')) return sendSample();
    if (e.target.closest('.cmp')) return; // handled by the change event

    const el = e.target.closest('.log');
    if (!el) return;
    const id = Number(el.dataset.id);
    const actionEl = e.target.closest('[data-action]');
    const action = actionEl?.dataset.action;

    // Don't toggle while the user is selecting text inside a header
    if (action === 'toggle' && getSelection().toString()) return;
    select(id);

    switch (action) {
        case 'toggle': return toggleExpand(id);
        case 'tab': return switchTab(id, actionEl.dataset.tab);
        case 'body-mode':
            state.bodyMode.set(id, actionEl.dataset.mode);
            return refreshInspector(id);
        case 'copy-tab': {
            const log = findLog(id);
            const tab = state.tabs.get(id) || 'summary';
            copyText(tabCopyText(tab, log, state.bodyMode.get(id))).then(ok => ok && toast('Copied'));
            return;
        }
        case 'pin': return togglePin(id);
        case 'menu':
            menuLogId = id;
            return togglePopover($('row-menu'), actionEl);
    }
});

// Inspector tabs: arrow keys move between tabs
logsEl.addEventListener('keydown', (e) => {
    const tabBtn = e.target.closest('.itab');
    if (!tabBtn || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const id = Number(tabBtn.closest('.log').dataset.id);
    const keys = TABS.map(([k]) => k);
    const i = keys.indexOf(tabBtn.dataset.tab);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1
        : (i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    switchTab(id, keys[next], true);
    e.preventDefault();
    e.stopPropagation();
});

logsEl.addEventListener('submit', async (e) => {
    if (e.target.id !== 'unlock-form') return;
    e.preventDefault();
    const ch = activeChannel();
    const input = e.target.elements.password;
    const errEl = e.target.querySelector('#unlock-error');
    try {
        const { token } = await api(`/api/channels/${encodeURIComponent(ch.id)}/unlock`, {
            method: 'POST',
            json: { password: input.value }
        });
        setToken(ch.id, token, ch.lockVersion);
        sendAuth();
        await reloadChannel(ch.id);
        toast(`"${ch.name}" unlocked`);
    } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        input.select();
    }
});

logsEl.addEventListener('change', (e) => {
    if (e.target.dataset.action !== 'compare') return;
    toggleCompare(Number(e.target.closest('.log').dataset.id), e.target.checked);
});

/* Row "..." menu */
$('row-menu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-menu]');
    if (!item || menuLogId === null) return;
    const id = menuLogId;
    closePopover();
    if (item.dataset.menu === 'curl') copyCurl(id);
    else if (item.dataset.menu === 'resend') resend(id);
    else if (item.dataset.menu === 'delete') deleteLog(id);
});

/* ----------- EVENTS: SIDEBAR ----------- */
$('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    if (e.target.closest('[data-action="close"]')) return closeChannel(tab.dataset.channel);
    switchChannel(tab.dataset.channel);
});

// Middle-click deletes a channel
$('tabs').addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // stop Windows autoscroll
});
$('tabs').addEventListener('auxclick', (e) => {
    const tab = e.target.closest('.tab');
    if (e.button === 1 && tab) closeChannel(tab.dataset.channel);
});

$('tabs').addEventListener('keydown', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || e.target !== tab) return;
    if (e.key === 'Enter' || e.key === ' ') {
        switchChannel(tab.dataset.channel);
        document.querySelector(`.tab[data-channel="${CSS.escape(tab.dataset.channel)}"]`)?.focus();
    } else if (e.key === 'Delete') closeChannel(tab.dataset.channel);
    else if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) {
        const tabs = [...$('tabs').querySelectorAll('.tab')];
        const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation(); // keep the global shortcuts from also handling it
});

function newChannel() {
    openChannelModal(null, {
        onSaved: ch => {
            sendAuth();
            upsertChannel(ch);
            switchChannel(ch.id);
            toast(`Channel "${ch.name}" created`);
        }
    });
}

$('btn-new-channel').addEventListener('click', newChannel);

/* ----------- EVENTS: BANNER ----------- */
$('btn-channel-settings').addEventListener('click', () => {
    const ch = activeChannel();
    if (!ch || ch.builtin) return;
    openChannelModal(ch, {
        onSaved: saved => {
            sendAuth();
            upsertChannel(saved);
            toast('Settings saved');
        },
        onDeleted: deleted => {
            removeChannel(deleted.id);
            toast(`Channel "${deleted.name}" deleted`);
        }
    });
});

// Lock Channel: forget this channel's password on this browser
$('btn-lock').addEventListener('click', () => {
    const ch = activeChannel();
    if (!ch?.locked) return;
    dropToken(ch.id);
    delete state.logs[ch.id];
    sendAuth();
    renderTabs();
    renderChannelBar();
    rebuild();
    toast(`"${ch.name}" locked`);
});

$('btn-copy-endpoint').addEventListener('click', copyEndpoint);
$('btn-pause').addEventListener('click', togglePause);
$('btn-resume').addEventListener('click', () => setPaused(state.active, false));

$('btn-ch-notify').addEventListener('click', async () => {
    const ch = activeChannel();
    if (!ch) return;
    try {
        toast((await notify.toggleNotify(ch.id)) ? `Notifications on for "${ch.name}"` : `Notifications off for "${ch.name}"`);
    } catch (err) {
        toast(err.message);
    }
    updateAlertButtons();
});

$('btn-ch-sound').addEventListener('click', () => {
    const ch = activeChannel();
    if (!ch) return;
    toast(notify.toggleSound(ch.id) ? `Sound alerts on for "${ch.name}"` : `Sound alerts off for "${ch.name}"`);
    updateAlertButtons();
});

/* ----------- EVENTS: SEARCH & FILTERS ----------- */
const applyText = debounce(() => {
    state.filters.text = $('f-text').value.trim().toLowerCase();
    rebuild();
}, 150);

$('f-text').addEventListener('input', () => {
    $('btn-search-clear').hidden = !$('f-text').value;
    applyText();
});

$('btn-search-clear').addEventListener('click', () => {
    $('f-text').value = '';
    $('btn-search-clear').hidden = true;
    state.filters.text = '';
    rebuild();
    $('f-text').focus();
});

$('filter-bar').addEventListener('click', (e) => {
    const chip = e.target.closest('.fchip');
    if (chip) toggleFilter(chip.dataset.filter, chip.dataset.value);
});

$('btn-reset-filters').addEventListener('click', resetFilters);
$('btn-collapse-all').addEventListener('click', collapseAll);

/* ----------- EVENTS: LIST ACTIONS ----------- */
$('btn-compare').addEventListener('click', openDiff);
$('diff-only-changes').addEventListener('change', (e) => {
    $('diff-table')?.classList.toggle('only-changes', e.target.checked);
});

$('btn-clear').addEventListener('click', () => {
    const ch = activeChannel();
    if (!ch || !confirm(`Clear all unstarred logs in "${ch.name}"?`)) return;
    api(`/logs/${encodeURIComponent(ch.id)}`, { method: 'DELETE', channel: ch.id }).catch(err => toast(err.message));
});

$('btn-export').addEventListener('click', () => togglePopover($('export-menu'), $('btn-export')));

$('export-menu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-export]');
    if (!item) return;
    closePopover();
    const ch = activeChannel();
    const logs = isFiltered() ? list.items() : activeLogs();
    if (!logs.length) return toast('Nothing to export');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (item.dataset.export === 'har') download(`webhooks-${ch.id}-${stamp}.har`, toHar(logs, origin));
    else download(`webhooks-${ch.id}-${stamp}.json`, toJson(logs, ch));
    toast(`Exported ${logs.length} log${logs.length > 1 ? 's' : ''}`);
});

$('btn-import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        const logs = parseImport(await file.text());
        const res = await api(`/logs/${encodeURIComponent(state.active)}/import`, { method: 'POST', json: { logs }, channel: state.active });
        toast(`Imported ${res.imported} log${res.imported === 1 ? '' : 's'}`);
    } catch (err) {
        toast(`Import failed: ${err.message}`);
    }
});

/* ----------- EVENTS: HEADER ----------- */
$('btn-theme').addEventListener('click', toggleTheme);
$('btn-help').addEventListener('click', () => $('modal-help').showModal());

document.querySelectorAll('dialog [data-close]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
});

/* ----------- KEYBOARD SHORTCUTS ----------- */
document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return; // dialogs handle their own keys (Esc closes)

    // Ctrl K / ⌘K: focus search from anywhere
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusSearch();
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const target = e.target instanceof Element ? e.target : document.body;
    if (target.closest('input, textarea, select')) {
        if (e.key === 'Escape') target.blur();
        return;
    }
    // Keep native activation of focused buttons and links
    if ((e.key === 'Enter' || e.key === ' ') && target.closest('button, a, summary, label')) return;

    if (e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        collapseAll();
        return;
    }

    const id = state.selectedId;
    switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
        case 'j': moveSelection(1); break;
        case 'k': moveSelection(-1); break;
        case ' ':
        case 'o':
        case 'Enter':
            if (id === null) return;
            toggleExpand(id);
            break;
        case 'c': copyEndpoint(); break;
        case 's': if (id !== null) togglePin(id); break;
        case 'x': if (id !== null) toggleCompare(id); break;
        case '/': focusSearch(); break;
        case 'p': togglePause(); break;
        case 't': toggleTheme(); break;
        case 'n': $('btn-ch-notify').click(); break;
        case 'm': $('btn-ch-sound').click(); break;
        case '[': stepChannel(-1); break;
        case ']': stepChannel(1); break;
        case '?': $('modal-help').showModal(); break;
        case 'Escape':
            // Close the selected request's drawer first, then clear the selection
            if (id !== null && state.expanded.has(id)) setExpanded(id, false);
            else select(null);
            break;
        default: return;
    }
    e.preventDefault();
});

/* ----------- INIT ----------- */
setInterval(() => {
    document.querySelectorAll('.rel-time').forEach(el => { el.textContent = relTime(el.dataset.time); });
}, 10000);
setInterval(updateThroughput, 1000);

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
$('search-key').textContent = isMac ? '⌘K' : 'Ctrl K';

updatePauseUi();
updateCompareButton();
$('year').textContent = new Date().getFullYear();

loadAll()
    .then(() => {
        live = connectLive({
            url: wsUrl,
            onMessage: handleMessage,
            onStatus: setConnStatus,
            onOpen: sendAuth,
            onReconnect: () => loadAll().catch(() => { })
        });
    })
    .catch(err => {
        setConnStatus('offline');
        logsEl.innerHTML = `<div class="empty"><span class="empty-icon">${icon('alert')}</span><h3>Could not load logs</h3><p>${esc(err.message)}</p></div>`;
    });
