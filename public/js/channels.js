import { api, setToken } from './api.js';

const DEFAULT_SIG_HEADERS = {
    none: '',
    'hmac-sha256': 'x-signature',
    github: 'x-hub-signature-256',
    stripe: 'stripe-signature',
    vonage: 'authorization'
};

const modal = document.getElementById('modal-channel');
const form = document.getElementById('channel-form');
const f = form.elements;
const errorEl = document.getElementById('channel-error');
const deleteBtn = document.getElementById('btn-delete-channel');

let editing = null; // channel being edited, null when creating
let onDone = {};

function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
}

function headersToText(headers) {
    return Object.entries(headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function textToHeaders(text) {
    const out = {};
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const idx = line.indexOf(':');
        if (idx < 1) throw new Error(`Bad header line: "${line.trim().slice(0, 40)}" (use Name: value)`);
        out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return out;
}

function syncSigFields() {
    const type = f.sigType.value;
    f.sigHeader.placeholder = DEFAULT_SIG_HEADERS[type] || '';
    f.sigHeader.disabled = type === 'none';
    f.sigSecret.disabled = type === 'none';
}

function syncAuthFields() {
    f.authKey.disabled = !f.requireAuth.checked;
    f.viewPassword.disabled = !f.protect.checked;
}

f.sigType.addEventListener('change', syncSigFields);
f.requireAuth.addEventListener('change', syncAuthFields);
f.protect.addEventListener('change', syncAuthFields);
modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => modal.close()));

/* channel = null to create a new one */
export function openChannelModal(channel, { onSaved, onDeleted }) {
    editing = channel;
    onDone = { onSaved, onDeleted };
    form.reset();
    showError('');

    document.getElementById('channel-title').textContent = channel ? `Channel settings: ${channel.name}` : 'New channel';
    document.getElementById('id-hint').textContent = channel ? 'cannot be changed' : 'optional, random if empty';
    f.id.disabled = !!channel;
    deleteBtn.hidden = !channel || channel.builtin;

    if (channel) {
        f.name.value = channel.name;
        f.id.value = channel.id;
        f.protect.checked = channel.locked;
        f.viewPassword.placeholder = channel.locked ? '•••••• (unchanged)' : 'enter a password';
        f.requireAuth.checked = channel.requireAuth;
        f.authKey.placeholder = channel.hasAuthKey ? '•••••• (unchanged)' : 'enter a key';
        f.status.value = channel.response.status;
        f.delayMs.value = channel.response.delayMs;
        f.headers.value = headersToText(channel.response.headers);
        f.body.value = channel.response.body;
        f.sigType.value = channel.signature.type;
        f.sigHeader.value = channel.signature.header;
        f.sigSecret.placeholder = channel.signature.hasSecret ? '•••••• (unchanged)' : 'enter the signing secret';
    } else {
        f.authKey.placeholder = 'enter a key';
        f.viewPassword.placeholder = 'enter a password';
        f.body.value = '{"status":"OK"}';
        f.sigSecret.placeholder = 'enter the signing secret';
    }

    syncSigFields();
    syncAuthFields();
    modal.showModal();
    f.name.focus();
}

function buildPayload() {
    const payload = {
        name: f.name.value.trim(),
        response: {
            status: Number(f.status.value || 200),
            delayMs: Number(f.delayMs.value || 0),
            headers: textToHeaders(f.headers.value),
            body: f.body.value
        },
        signature: { type: f.sigType.value, header: f.sigHeader.value.trim() }
    };

    if (!editing && f.id.value.trim()) payload.id = f.id.value.trim();

    // Auth: unchecked clears the key; empty input keeps the existing key
    const key = f.authKey.value;
    if (!f.requireAuth.checked) {
        if (!editing || editing.requireAuth) payload.authKey = '';
    } else if (key) {
        payload.authKey = key;
    } else if (!editing?.hasAuthKey) {
        throw new Error('Enter an auth key or untick "Require auth-key header"');
    }

    // Password: unchecked removes it; empty input keeps the existing one
    const pw = f.viewPassword.value;
    if (!f.protect.checked) {
        if (editing?.locked) payload.viewPassword = '';
    } else if (pw) {
        if (pw.length < 4) throw new Error('Password must be at least 4 characters');
        payload.viewPassword = pw;
    } else if (!editing?.locked) {
        throw new Error('Enter a password or untick "Password-protect"');
    }

    if (f.sigType.value !== 'none' && f.sigSecret.value) payload.signature.secret = f.sigSecret.value;
    return payload;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    try {
        const payload = buildPayload();
        const saved = editing
            ? await api(`/api/channels/${encodeURIComponent(editing.id)}`, { method: 'PATCH', json: payload, channel: editing.id })
            : await api('/api/channels', { method: 'POST', json: payload });
        // The editor stays unlocked after setting or changing the password
        if (saved.token) setToken(saved.id, saved.token, saved.lockVersion);
        modal.close();
        onDone.onSaved?.(saved);
    } catch (err) {
        showError(err.message);
    }
});

deleteBtn.addEventListener('click', async () => {
    if (!editing || !confirm(`Delete channel "${editing.name}" and all its logs?`)) return;
    try {
        await api(`/api/channels/${encodeURIComponent(editing.id)}`, { method: 'DELETE', channel: editing.id });
        modal.close();
        onDone.onDeleted?.(editing);
    } catch (err) {
        showError(err.message);
    }
});
