import { api, wsUrl, setToken, dropToken, tokenVersion, allTokens } from './api.js';
import { connectLive } from './ws.js';
import { esc, cleanMethod, COMMON_METHODS, relTime, debounce, copyText, toast, toCurl, icon } from './utils.js';
import { renderCard, sectionsHtml, sectionContent, sectionCopyText, renderEmpty } from './render.js';
import { toggleJsonNode } from './json-view.js';
import { diffHtml } from './diff.js';
import { download, toJson, toHar, parseImport } from './export.js';
import * as notify from './notify.js';
import { openChannelModal } from './channels.js';

const PAGE = 50; // cards rendered per batch; more load on scroll
const origin = location.origin;

const state = {
    channels: [],
    logs: {},                 // channelId -> logs, newest first
    active: decodeURIComponent(location.hash.slice(2)) || 'open',
    filters: { text: '', method: '', status: '', range: '', starred: false },
    paused: new Set(),        // channel ids whose live feed is paused
    held: new Map(),          // channel id -> Set of log ids received while paused
    expanded: new Set(),      // log ids
    sections: new Map(),      // log id -> Set of open section keys
    selectedId: null,
    compare: []               // up to 2 log ids
};

let visible = [];             // filtered logs of the active channel, in view order
let renderedCount = 0;

const $ = id => document.getElementById(id);
const logsEl = $('logs');
const sentinel = document.createElement('div');
sentinel.className = 'sentinel';

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

function sectionsFor(id) {
    if (!state.sections.has(id)) state.sections.set(id, new Set());
    return state.sections.get(id);
}

function card(log) {
    return renderCard(log, {
        expanded: state.expanded.has(log.id),
        sections: sectionsFor(log.id),
        selected: state.selectedId === log.id,
        compared: state.compare.includes(log.id)
    });
}

const cardEl = id => logsEl.querySelector(`.log[data-id="${Number(id)}"]`);

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

function matches(log) {
    const f = state.filters;
    if (f.method) {
        const m = cleanMethod(log.method);
        if (f.method === 'OTHER' ? COMMON_METHODS.includes(m) : m !== f.method) return false;
    }
    if (f.status && String(log.status)[0] !== f.status) return false;
    if (f.range && Date.now() - new Date(log.time).getTime() > Number(f.range) * 60000) return false;
    if (f.starred && !log.pinned) return false;
    if (f.text && !searchText(log).includes(f.text)) return false;
    return true;
}

const isFiltered = () => {
    const f = state.filters;
    return !!(f.text || f.method || f.status || f.range || f.starred);
};

/* ----------- LIST RENDERING ----------- */
function rebuild() {
    const ch = activeChannel();
    const locked = lockedOut(ch);
    document.querySelector('.filters').hidden = locked;
    $('list-bar').hidden = locked;
    if (locked) {
        visible = [];
        renderedCount = 0;
        logsEl.innerHTML = renderLocked(ch);
        updateCounts();
        logsEl.querySelector('input')?.focus();
        return;
    }

    const held = state.held.get(state.active);
    visible = activeLogs().filter(l => !held?.has(l.id) && matches(l));
    renderedCount = 0;
    logsEl.replaceChildren();
    if (!visible.length) logsEl.innerHTML = renderEmpty(activeChannel(), origin, isFiltered());
    else renderMore();
    updateCounts();
}

function renderLocked(ch) {
    return `
    <form class="locked" id="unlock-form">
      ${icon('lock', 'lock-icon')}
      <h3>${esc(ch.name)} is password protected</h3>
      <p class="muted">Enter the channel password to see its logs. Webhooks are still captured.</p>
      <div class="unlock-row">
        <input type="password" name="password" placeholder="Channel password" autocomplete="current-password" required maxlength="200">
        <button class="btn" type="submit">Unlock</button>
      </div>
      <p class="form-error" id="unlock-error" hidden></p>
    </form>`;
}

function renderMore() {
    const frag = document.createDocumentFragment();
    const end = Math.min(renderedCount + PAGE, visible.length);
    for (let i = renderedCount; i < end; i++) frag.appendChild(card(visible[i]));
    renderedCount = end;
    sentinel.remove();
    logsEl.appendChild(frag);
    if (renderedCount < visible.length) {
        logsEl.appendChild(sentinel);
        requestAnimationFrame(checkSentinel);
    }
}

function checkSentinel() {
    if (sentinel.isConnected && sentinel.getBoundingClientRect().top < innerHeight + 600) renderMore();
}

new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) renderMore();
}, { rootMargin: '600px' }).observe(sentinel);

function insertNew(log) {
    if (!matches(log)) return;
    if (!visible.length) return rebuild();
    visible.unshift(log);
    renderedCount++;
    logsEl.prepend(card(log));
}

function removeFromView(id) {
    const idx = visible.findIndex(l => l.id === id);
    if (idx === -1) return;
    visible.splice(idx, 1);
    const el = cardEl(id);
    if (el) {
        el.remove();
        renderedCount--;
    }
    if (!visible.length) rebuild();
}

function replaceInView(log) {
    const idx = visible.findIndex(l => l.id === log.id);
    if (idx === -1) return;
    if (!matches(log)) return removeFromView(log.id);
    visible[idx] = log;
    cardEl(log.id)?.replaceWith(card(log));
}

function updateCounts() {
    const total = activeLogs().length;
    $('count').innerHTML = isFiltered()
        ? `<strong>${visible.length}</strong> of ${total} logs`
        : `<strong>${total}</strong> log${total === 1 ? '' : 's'}`;
    $('starred-count').textContent = activeLogs().filter(l => l.pinned).length;
    $('btn-reset-filters').hidden = !isFiltered();
    state.channels.forEach(ch => {
        const badge = document.querySelector(`.tab[data-channel="${CSS.escape(ch.id)}"] .badge`);
        if (badge) badge.textContent = (state.logs[ch.id] || []).length;
    });
}

/* ----------- CHANNELS UI ----------- */
function renderTabs() {
    $('tabs').innerHTML = state.channels.map(ch => {
        const active = ch.id === state.active;
        const alerts = notify.getAlerts(ch.id);
        const alertIcons = `${alerts.notify ? icon('bell') : ''}${alerts.sound ? icon('volume') : ''}`;
        return `
    <div class="tab${active ? ' active' : ''}" role="tab" tabindex="0" aria-selected="${active}"
         data-channel="${esc(ch.id)}" title="${esc(ch.name)} · /hook/${esc(ch.id)}">
      ${ch.locked ? `<span class="tab-icon" title="${lockedOut(ch) ? 'Password protected' : 'Password protected (unlocked here)'}">${icon(lockedOut(ch) ? 'lock' : 'lock-open')}</span>` : ''}
      ${ch.requireAuth ? `<span class="tab-icon" title="Senders need the auth-key header">${icon('key')}</span>` : ''}
      <span class="tab-text">
        <span class="tab-name">${esc(ch.name)}</span>
        <span class="tab-path">/hook/${esc(ch.id)}</span>
      </span>
      ${alertIcons ? `<span class="tab-icon accent" title="Alerts on for this channel">${alertIcons}</span>` : ''}
      ${state.paused.has(ch.id) ? `<span class="tab-icon warn" title="Live feed paused">${icon('pause')}</span>` : ''}
      ${lockedOut(ch) ? '' : `<span class="badge">${(state.logs[ch.id] || []).length}</span>`}
      ${ch.builtin || lockedOut(ch) ? '' : `<button class="tab-close" data-action="close" title="Delete channel" aria-label="Delete channel ${esc(ch.name)}">${icon('x')}</button>`}
    </div>`;
    }).join('') +
        `<button class="tab-new" data-action="new-channel" title="New channel" aria-label="New channel">${icon('plus')}<span class="tab-new-label">New channel</span></button>`;
}

function renderChannelBar() {
    const ch = activeChannel();
    if (!ch) return;
    $('endpoint-url').textContent = `${origin}/hook/${ch.id}`;
    $('channel-name').textContent = ch.name;

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
    if (ch.builtin) chips.push(`<span class="chip">${icon('pin')}built-in · fixed</span>`);
    if (ch.locked) chips.push(`<span class="chip">${icon('lock')}password</span>`);
    chips.push(ch.requireAuth
        ? `<span class="chip${ch.hasAuthKey ? '' : ' warn'}">${icon('key')}auth-key${ch.hasAuthKey ? '' : ' (AUTH_KEY not set in .env: rejects all)'}</span>`
        : `<span class="chip">${icon('globe')}open</span>`);
    const r = ch.response;
    chips.push(`<span class="chip mono">${icon('reply')}${r.status}${r.delayMs ? ` · ${r.delayMs} ms` : ''}</span>`);
    if (ch.signature.type !== 'none') {
        chips.push(`<span class="chip${ch.signature.hasSecret ? '' : ' warn'}">${icon('pen')}${esc(ch.signature.type)}${ch.signature.hasSecret ? '' : ' (no secret)'}</span>`);
    }
    $('channel-chips').innerHTML = chips.join('');
}

function switchChannel(id) {
    if (!state.channels.some(c => c.id === id)) return;
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
    // Like Chrome: closing the active tab activates its right neighbour (or left if it was last)
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
            }
            else updateCounts();
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
    const labels = { live: 'Live', connecting: 'Connecting', reconnecting: 'Reconnecting…', offline: 'Disconnected' };
    const el = $('conn');
    el.className = `conn ${status}`;
    el.querySelector('.conn-label').textContent = labels[status];
    el.title = status === 'live' ? 'Receiving live updates' : 'Not receiving live updates';
}

/* ----------- ACTIONS ----------- */
function toggleExpand(id) {
    const el = cardEl(id);
    if (!el) return;
    const log = findLog(id);
    if (state.expanded.has(id)) {
        state.expanded.delete(id);
        el.classList.remove('expanded');
    } else {
        state.expanded.add(id);
        el.classList.add('expanded');
        const body = el.querySelector('.log-body');
        if (!body.innerHTML.trim()) body.innerHTML = sectionsHtml(log, sectionsFor(id));
    }
}

function toggleSection(id, sectionEl) {
    const key = sectionEl.dataset.section;
    const open = sectionsFor(id);
    if (open.has(key)) {
        open.delete(key);
        sectionEl.classList.remove('open');
    } else {
        open.add(key);
        sectionEl.classList.add('open');
        const body = sectionEl.querySelector('.section-body');
        if (!body.innerHTML.trim()) body.innerHTML = sectionContent(key, findLog(id));
    }
}

async function copyCurl(id) {
    const log = findLog(id);
    if (log && await copyText(toCurl(log, origin))) toast('cURL copied');
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
    if (id === state.active) updatePauseUi();
}

const togglePause = () => setPaused(state.active, !state.paused.has(state.active));

function updatePauseUi() {
    const paused = state.paused.has(state.active) && !lockedOut(activeChannel());
    const waiting = state.held.get(state.active)?.size || 0;
    const btn = $('btn-pause');
    btn.innerHTML = paused ? `${icon('play')}Resume` : `${icon('pause')}Pause`;
    btn.classList.toggle('on', paused);
    btn.setAttribute('aria-pressed', paused);
    $('paused-banner').hidden = !paused;
    $('paused-text').textContent = waiting
        ? `This channel is paused · ${waiting} new request${waiting > 1 ? 's' : ''} waiting`
        : 'This channel is paused · new requests are held until you resume';
}

function select(id, scroll = false) {
    if (state.selectedId !== null) cardEl(state.selectedId)?.classList.remove('selected');
    state.selectedId = id;
    const el = id === null ? null : cardEl(id);
    if (el) {
        el.classList.add('selected');
        if (scroll) el.scrollIntoView({ block: 'nearest' });
    }
}

function moveSelection(dir) {
    const cards = [...logsEl.querySelectorAll('.log')];
    if (!cards.length) return;
    let idx = cards.findIndex(c => Number(c.dataset.id) === state.selectedId);
    idx = idx === -1 ? 0 : idx + dir;
    if (idx >= cards.length && renderedCount < visible.length) {
        renderMore();
        return moveSelection(dir);
    }
    idx = Math.max(0, Math.min(cards.length - 1, idx));
    select(Number(cards[idx].dataset.id), true);
}

function toggleTheme() {
    const current = document.documentElement.dataset.theme || 'dark'; // dark-first
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { }
}

function updateAlertButtons() {
    const ch = activeChannel();
    if (!ch) return;
    const a = notify.getAlerts(ch.id);
    $('btn-ch-notify').innerHTML = a.notify ? `${icon('bell')}Notify on` : `${icon('bell-off')}Notify`;
    $('btn-ch-notify').classList.toggle('on', a.notify);
    $('btn-ch-notify').setAttribute('aria-pressed', a.notify);
    $('btn-ch-sound').innerHTML = a.sound ? `${icon('volume')}Sound on` : `${icon('volume-x')}Sound`;
    $('btn-ch-sound').classList.toggle('on', a.sound);
    $('btn-ch-sound').setAttribute('aria-pressed', a.sound);
}

/* ----------- EVENTS ----------- */
logsEl.addEventListener('click', (e) => {
    const jt = e.target.closest('.j-toggle');
    if (jt) return toggleJsonNode(jt);
    if (e.target.closest('.cmp')) return; // handled by change event

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
        case 'section': {
            if (e.target.closest('[data-action="copy-section"]')) break;
            return toggleSection(id, actionEl.closest('.section'));
        }
        case 'copy-section': {
            const key = actionEl.closest('.section').dataset.section;
            copyText(sectionCopyText(key, findLog(id))).then(ok => ok && toast('Copied'));
            return;
        }
        case 'curl': return copyCurl(id);
        case 'pin': return togglePin(id);
        case 'delete': return deleteLog(id);
    }
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

$('tabs').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="new-channel"]')) return newChannel();
    const tab = e.target.closest('.tab');
    if (!tab) return;
    if (e.target.closest('[data-action="close"]')) return closeChannel(tab.dataset.channel);
    switchChannel(tab.dataset.channel);
});

// Middle-click closes a tab, like Chrome
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
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
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

// Forget this channel's password on this browser
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

$('btn-copy-endpoint').addEventListener('click', async () => {
    if (await copyText($('endpoint-url').textContent)) toast('URL copied');
});

const applyText = debounce(() => {
    state.filters.text = $('f-text').value.trim().toLowerCase();
    rebuild();
}, 150);
$('f-text').addEventListener('input', applyText);

const FILTER_SELECTS = [['f-method', 'method'], ['f-status', 'status'], ['f-range', 'range']];

FILTER_SELECTS.forEach(([elId, key]) => {
    $(elId).addEventListener('change', (e) => {
        state.filters[key] = e.target.value;
        e.target.classList.toggle('is-set', !!e.target.value); // highlight active filters
        rebuild();
    });
});

$('f-starred').addEventListener('click', () => {
    state.filters.starred = !state.filters.starred;
    $('f-starred').setAttribute('aria-pressed', state.filters.starred);
    rebuild();
});

$('btn-reset-filters').addEventListener('click', () => {
    state.filters = { text: '', method: '', status: '', range: '', starred: false };
    $('f-text').value = '';
    FILTER_SELECTS.forEach(([elId]) => {
        $(elId).value = '';
        $(elId).classList.remove('is-set');
    });
    $('f-starred').setAttribute('aria-pressed', 'false');
    rebuild();
});

$('btn-compare').addEventListener('click', openDiff);
$('diff-only-changes').addEventListener('change', (e) => {
    $('diff-table')?.classList.toggle('only-changes', e.target.checked);
});

$('btn-clear').addEventListener('click', () => {
    const ch = activeChannel();
    if (!ch || !confirm(`Clear all unstarred logs in "${ch.name}"?`)) return;
    api(`/logs/${encodeURIComponent(ch.id)}`, { method: 'DELETE', channel: ch.id }).catch(err => toast(err.message));
});

document.querySelectorAll('[data-export]').forEach(btn => btn.addEventListener('click', () => {
    btn.closest('details').open = false;
    const ch = activeChannel();
    const logs = isFiltered() ? visible : activeLogs();
    if (!logs.length) return toast('Nothing to export');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (btn.dataset.export === 'har') download(`webhooks-${ch.id}-${stamp}.har`, toHar(logs, origin));
    else download(`webhooks-${ch.id}-${stamp}.json`, toJson(logs, ch));
    toast(`Exported ${logs.length} log${logs.length > 1 ? 's' : ''}`);
}));

document.addEventListener('click', (e) => {
    document.querySelectorAll('details.menu[open]').forEach(d => {
        if (!d.contains(e.target)) d.open = false;
    });
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

$('btn-pause').addEventListener('click', togglePause);
$('btn-resume').addEventListener('click', () => setPaused(state.active, false));
$('btn-theme').addEventListener('click', toggleTheme);
$('btn-help').addEventListener('click', () => $('modal-help').showModal());
$('btn-ch-notify').addEventListener('click', async () => {
    const ch = activeChannel();
    if (!ch) return;
    try {
        toast((await notify.toggleNotify(ch.id)) ? `Notifications on for "${ch.name}"` : `Notifications off for "${ch.name}"`);
    } catch (err) {
        toast(err.message);
    }
    updateAlertButtons();
    renderTabs();
});
$('btn-ch-sound').addEventListener('click', () => {
    const ch = activeChannel();
    if (!ch) return;
    toast(notify.toggleSound(ch.id) ? `Sound on for "${ch.name}"` : `Sound off for "${ch.name}"`);
    updateAlertButtons();
    renderTabs();
});

document.querySelectorAll('dialog [data-close]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
});

/* ----------- KEYBOARD ----------- */
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return; // dialogs handle their own keys (Esc closes)

    const target = e.target instanceof Element ? e.target : document.body;
    if (target.closest('input, textarea, select')) {
        if (e.key === 'Escape') target.blur();
        return;
    }
    if (e.key === 'Enter' && target.closest('button, a, summary')) return; // keep native activation

    const id = state.selectedId;
    switch (e.key) {
        case 'j': moveSelection(1); break;
        case 'k': moveSelection(-1); break;
        case 'o':
        case 'Enter': if (id !== null) toggleExpand(id); break;
        case 'c': if (id !== null) copyCurl(id); break;
        case 's': if (id !== null) togglePin(id); break;
        case 'x': if (id !== null) toggleCompare(id); break;
        case '/': $('f-text').focus(); break;
        case 'p': togglePause(); break;
        case 't': toggleTheme(); break;
        case 'n': $('btn-ch-notify').click(); break;
        case 'm': $('btn-ch-sound').click(); break;
        case '[': stepChannel(-1); break;
        case ']': stepChannel(1); break;
        case '?': $('modal-help').showModal(); break;
        case 'Escape': select(null); break;
        default: return;
    }
    e.preventDefault();
});

/* ----------- INIT ----------- */
setInterval(() => {
    document.querySelectorAll('.rel-time').forEach(el => { el.textContent = relTime(el.dataset.time); });
}, 10000);

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
        logsEl.innerHTML = `<div class="empty">Could not load logs: ${esc(err.message)}</div>`;
    });
