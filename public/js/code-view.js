import { esc } from './utils.js';

const MAX_CHARS = 200_000;         // bigger bodies are cut in the viewer (Copy still gets everything)
const MAX_HIGHLIGHT_LINES = 5000;  // above this, plain text (no syntax colours)

// One JSON token per match: a string (key when followed by ':'), a boolean, null or a number
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function highlightLine(line) {
    let out = '';
    let last = 0;
    line.replace(TOKEN, (m, str, colon, bool, offset) => {
        out += esc(line.slice(last, offset));
        if (str) out += colon ? `<span class="tk-key">${esc(str)}</span>${esc(colon)}` : `<span class="tk-str">${esc(str)}</span>`;
        else if (bool) out += `<span class="tk-bool">${m}</span>`;
        else if (m === 'null') out += '<span class="tk-null">null</span>';
        else out += `<span class="tk-num">${m}</span>`;
        last = offset + m.length;
        return m;
    });
    return out + esc(line.slice(last));
}

/* Inset dark-glass viewer with line numbers; JSON gets syntax colours */
export function codeView(text, { json = false } = {}) {
    let src = String(text ?? '');
    const cut = src.length > MAX_CHARS;
    if (cut) src = src.slice(0, MAX_CHARS);

    const lines = src.split('\n');
    const colour = json && !cut && lines.length <= MAX_HIGHLIGHT_LINES;
    const body = lines.map(l => `<span class="code-line">${colour ? highlightLine(l) : esc(l)}</span>`).join('');
    const note = cut ? `<div class="code-cut">Showing the first ${Math.round(MAX_CHARS / 1000)} KB. Use Copy to get everything.</div>` : '';

    return `<div class="code-viewer" tabindex="0">${note}<pre class="code"><code>${body}</code></pre></div>`;
}

export function jsonView(value) {
    return codeView(JSON.stringify(value ?? null, null, 2), { json: true });
}
