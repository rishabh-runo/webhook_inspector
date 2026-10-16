import { cleanMethod, bodyText } from './utils.js';

export function download(filename, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toJson(logs, channel) {
    return JSON.stringify({
        format: 'webhook-inspector',
        version: 1,
        channel: channel?.id,
        exportedAt: new Date().toISOString(),
        logs
    }, null, 2);
}

function kv(obj) {
    const out = [];
    for (const [name, value] of Object.entries(obj || {})) {
        if (Array.isArray(value)) value.forEach(v => out.push({ name, value: String(v) }));
        else out.push({ name, value: typeof value === 'string' ? value : JSON.stringify(value) });
    }
    return out;
}

export function toHar(logs, origin) {
    const entries = logs.map(l => {
        const body = bodyText(l);
        const response = typeof l.response === 'string' ? l.response : JSON.stringify(l.response ?? '');
        return {
            startedDateTime: l.time,
            time: Number(l.duration) || 0,
            request: {
                method: cleanMethod(l.method),
                url: origin + l.url,
                httpVersion: 'HTTP/1.1',
                cookies: [],
                headers: kv(l.headers),
                queryString: kv(l.query),
                ...(body ? { postData: { mimeType: l.contentType || 'application/octet-stream', text: body } } : {}),
                headersSize: -1,
                bodySize: Number(l.size) || 0
            },
            response: {
                status: Number(l.status) || 0,
                statusText: '',
                httpVersion: 'HTTP/1.1',
                cookies: [],
                headers: kv(l.responseHeaders),
                content: {
                    size: response.length,
                    mimeType: l.responseHeaders?.['content-type'] || 'text/plain',
                    text: response
                },
                redirectURL: '',
                headersSize: -1,
                bodySize: -1
            },
            cache: {},
            timings: { send: 0, wait: Number(l.duration) || 0, receive: 0 }
        };
    });

    return JSON.stringify({
        log: { version: '1.2', creator: { name: 'Webhook Inspector', version: '1.4' }, entries }
    }, null, 2);
}

function headerMap(list) {
    const out = {};
    (Array.isArray(list) ? list : []).forEach(h => {
        if (h && h.name) out[String(h.name).toLowerCase()] = String(h.value ?? '');
    });
    return out;
}

function fromHarEntry(e) {
    const req = e?.request || {};
    const res = e?.response || {};
    let url = String(req.url || '/');
    try {
        const u = new URL(url);
        url = u.pathname + u.search;
    } catch { }

    const raw = req.postData?.text || '';
    let body = null;
    if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
    }
    const headers = headerMap(req.headers);

    return {
        method: req.method,
        url,
        headers,
        query: Object.fromEntries((req.queryString || []).map(q => [String(q.name), String(q.value ?? '')])),
        contentType: req.postData?.mimeType || headers['content-type'] || '',
        body,
        rawBody: raw,
        size: raw.length,
        status: res.status,
        response: res.content?.text || '',
        responseHeaders: headerMap(res.headers),
        time: e?.startedDateTime,
        duration: e?.time
    };
}

/* Accepts our JSON export, a plain array of logs, or a HAR file */
export function parseImport(text) {
    const data = JSON.parse(text);
    if (Array.isArray(data?.log?.entries)) return data.log.entries.map(fromHarEntry);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.logs)) return data.logs;
    throw new Error('Unrecognized file: expected a Webhook Inspector JSON export or a HAR file');
}
