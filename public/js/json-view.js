import { esc } from './utils.js';

const OPEN_DEPTH = 2;
const MAX_NODES = 5000; // bigger payloads fall back to plain text

/* Collapsible, syntax-coloured JSON. Toggles are handled by a delegated click on .j-toggle */
export function jsonTree(value) {
    const counter = { n: 0 };
    const html = node(value, 0, counter);
    if (counter.n > MAX_NODES) return `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
    return `<div class="jt">${html}</div>`;
}

function node(v, depth, counter) {
    counter.n++;
    if (counter.n > MAX_NODES) return '';
    if (v === null) return '<span class="j-null">null</span>';

    switch (typeof v) {
        case 'string': return `<span class="j-str">"${esc(v)}"</span>`;
        case 'number': return `<span class="j-num">${esc(String(v))}</span>`;
        case 'boolean': return `<span class="j-bool">${v}</span>`;
        case 'object': break;
        default: return `<span class="j-null">${esc(String(v))}</span>`;
    }

    const isArr = Array.isArray(v);
    const entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
    const [open, close] = isArr ? ['[', ']'] : ['{', '}'];
    if (!entries.length) return `<span class="j-brace">${open}${close}</span>`;

    const collapsed = depth >= OPEN_DEPTH;
    const label = `${entries.length} ${isArr ? 'items' : 'keys'}`;
    const kids = entries.map(([k, x], i) => {
        const key = isArr ? '' : `<span class="j-key">"${esc(k)}"</span>: `;
        const comma = i < entries.length - 1 ? ',' : '';
        return `<span class="j-row">${key}${node(x, depth + 1, counter)}${comma}</span>`;
    }).join('');

    return `<span class="j-node${collapsed ? ' collapsed' : ''}">` +
        `<button type="button" class="j-toggle" aria-label="Toggle">${collapsed ? '▸' : '▾'}</button>` +
        `<span class="j-brace">${open}</span><span class="j-count">${label}</span>` +
        `<span class="j-kids">${kids}</span><span class="j-brace">${close}</span></span>`;
}

export function toggleJsonNode(btn) {
    const nodeEl = btn.parentElement;
    const collapsed = nodeEl.classList.toggle('collapsed');
    btn.textContent = collapsed ? '▸' : '▾';
}
