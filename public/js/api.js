/* Access tokens for password-protected channels, kept in this browser: { [channelId]: { token, v } } */
const TOKENS_KEY = 'channelTokens';

function loadTokens() {
    try {
        localStorage.removeItem('viewerKey'); // old app-wide key
        return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

let tokens = loadTokens();

function saveTokens() {
    try { localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens)); } catch { }
}

export function getToken(channelId) {
    return tokens[channelId]?.token || '';
}

export function tokenVersion(channelId) {
    return tokens[channelId]?.v;
}

export function setToken(channelId, token, version) {
    tokens[channelId] = { token, v: version };
    saveTokens();
}

export function dropToken(channelId) {
    if (!tokens[channelId]) return;
    delete tokens[channelId];
    saveTokens();
}

export function allTokens() {
    return Object.fromEntries(Object.entries(tokens).map(([id, t]) => [id, t.token]));
}

export class ApiError extends Error {
    constructor(message, status, locked) {
        super(message);
        this.status = status;
        this.locked = !!locked;
    }
}

/* channel: id of a protected channel this call needs access to */
export async function api(url, { json, channel, ...options } = {}) {
    const headers = { ...(options.headers || {}) };
    if (channel && getToken(channel)) headers['channel-token'] = getToken(channel);
    if (json !== undefined) {
        headers['content-type'] = 'application/json';
        options.body = JSON.stringify(json);
    }

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.message || `Request failed (${res.status})`, res.status, data?.locked);
    return data;
}

export function wsUrl() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${location.host}/`;
}
