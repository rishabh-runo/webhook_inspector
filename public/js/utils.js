export function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export const COMMON_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/* Inline SVG from the sprite in index.html; decorative, so hidden from screen readers */
export function icon(name, cls = '') {
    return `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function cleanMethod(method) {
    return String(method || '').replace(/[^A-Za-z]/g, '').toUpperCase() || 'GET';
}

export function relTime(iso) {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(s)) return '';
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

export function tryParse(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fallback for non-secure contexts (plain http on a remote host)
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { }
        ta.remove();
        return ok;
    }
}

let toastTimer;
export function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* Body text as originally received (falls back to JSON for imported logs) */
export function bodyText(log) {
    if (log.rawBody) return log.rawBody;
    if (log.body === null || log.body === undefined) return '';
    return typeof log.body === 'string' ? log.body : JSON.stringify(log.body);
}

const SKIP_CURL_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding']);

function shellQuote(s) {
    return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function toCurl(log, origin) {
    const parts = [`curl -X ${cleanMethod(log.method)} ${shellQuote(origin + log.url)}`];
    for (const [name, value] of Object.entries(log.headers || {})) {
        if (!SKIP_CURL_HEADERS.has(name)) parts.push(`-H ${shellQuote(`${name}: ${value}`)}`);
    }

    let prefix = '';
    if (log.rawEncoding === 'base64') {
        prefix = `# binary body (${formatBytes(log.size)}) not included\n`;
    } else {
        const body = bodyText(log);
        if (body) parts.push(`--data-raw ${shellQuote(body)}`);
    }
    return prefix + parts.join(' \\\n  ');
}

// Headers the browser forbids, hop-by-hop ones, and masked secrets are left out of a replay
const SKIP_RESEND_HEADERS = new Set([
    'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
    'expect', 'cookie', 'cookie2', 'origin', 'referer', 'user-agent', 'accept-encoding', 'accept-charset',
    'date', 'dnt', 'via', 'access-control-request-headers', 'access-control-request-method'
]);

/* Re-fires a stored request (method, headers, body) to the same channel URL; resolves to the status code */
export async function resendRequest(log) {
    const headers = {};
    for (const [name, value] of Object.entries(log.headers || {})) {
        const lower = name.toLowerCase();
        if (SKIP_RESEND_HEADERS.has(lower) || lower.startsWith('sec-') || lower.startsWith('proxy-') || value === '***') continue;
        headers[lower] = Array.isArray(value) ? value.join(', ') : String(value);
    }

    const method = cleanMethod(log.method);
    let body;
    if (method !== 'GET' && method !== 'HEAD') {
        body = log.rawEncoding === 'base64' && log.rawBody
            ? Uint8Array.from(atob(log.rawBody), c => c.charCodeAt(0))
            : bodyText(log) || undefined;
    }

    const res = await fetch(log.url, { method, headers, body });
    return res.status;
}
