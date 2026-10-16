/* Per-channel alert prefs, stored in this browser only: { [channelId]: { notify, sound } } */
const KEY = 'channelAlerts';
let baseTitle = document.title;

let prefs = load();
let audioCtx = null;
let unread = 0;

function load() {
    try {
        localStorage.removeItem('notifySettings'); // old global setting
        return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function save() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { }
}

function set(channelId, key, value) {
    const next = { ...getAlerts(channelId), [key]: value };
    if (!next.notify && !next.sound) delete prefs[channelId];
    else prefs[channelId] = next;
    save();
}

const showTitle = () => {
    document.title = unread ? `(${unread}) ${baseTitle}` : baseTitle;
};

/* Page title for the open channel; keeps the unread count in front while the tab is hidden */
export function setBaseTitle(title) {
    baseTitle = title;
    showTitle();
}

export function getAlerts(channelId) {
    return { notify: false, sound: false, ...(prefs[channelId] || {}) };
}

export async function toggleNotify(channelId) {
    const on = !getAlerts(channelId).notify;
    if (on) {
        if (!('Notification' in window)) throw new Error('Notifications are not supported in this browser');
        const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Notification permission was denied');
    }
    set(channelId, 'notify', on);
    return on;
}

export function toggleSound(channelId) {
    const on = !getAlerts(channelId).sound;
    set(channelId, 'sound', on);
    if (on) {
        ensureAudio(); // created inside the click so the browser allows playback later
        beep();
    }
    return on;
}

export function forget(channelId) {
    if (!prefs[channelId]) return;
    delete prefs[channelId];
    save();
}

function ensureAudio() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => { });
}

// Browsers only allow audio after a user gesture; unlock on the first one after a reload
function unlockAudio() {
    if (Object.values(prefs).some(p => p.sound)) ensureAudio();
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { once: true, capture: true }));

function beep() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
}

/* Alerts only for channels that opted in, and not while you're already looking at that channel */
export function onNewLog(log, channel, isViewing, onOpen) {
    if (document.hidden) {
        unread++;
        showTitle();
    }
    if (isViewing && !document.hidden) return;

    const alerts = getAlerts(channel.id);
    if (alerts.notify && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(`${log.method} → ${channel.name}`, {
            body: `${log.status} ${log.url}`,
            tag: `webhook-inspector-${channel.id}`
        });
        n.onclick = () => {
            window.focus();
            onOpen?.();
            n.close();
        };
    }
    if (alerts.sound) {
        ensureAudio();
        beep();
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        unread = 0;
        showTitle();
    }
});
