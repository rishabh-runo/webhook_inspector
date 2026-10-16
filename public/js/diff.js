import { esc, cleanMethod, tryParse } from './utils.js';

const MAX_LINES = 2000; // LCS table is n*m; above this fall back to line-by-line

function comparable(log) {
    return {
        method: cleanMethod(log.method),
        url: log.url,
        status: log.status,
        contentType: log.contentType,
        headers: log.headers,
        query: log.query,
        body: log.body,
        response: tryParse(log.response),
        signature: log.signature
    };
}

// Compare lines ignoring a trailing comma, so adding a key doesn't flag its neighbour
const norm = line => line.replace(/,$/, '');

function lcsOps(a, b) {
    const na = a.map(norm);
    const nb = b.map(norm);
    const n = a.length;
    const m = b.length;
    const ops = [];

    if (n > MAX_LINES || m > MAX_LINES) {
        for (let i = 0; i < Math.max(n, m); i++) {
            if (na[i] === nb[i]) ops.push(['eq', a[i], b[i]]);
            else {
                if (i < n) ops.push(['del', a[i]]);
                if (i < m) ops.push(['ins', b[i]]);
            }
        }
        return ops;
    }

    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i * w + j] = na[i] === nb[j]
                ? dp[(i + 1) * w + j + 1] + 1
                : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
        }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (na[i] === nb[j]) { ops.push(['eq', a[i], b[j]]); i++; j++; }
        else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push(['del', a[i++]]);
        else ops.push(['ins', b[j++]]);
    }
    while (i < n) ops.push(['del', a[i++]]);
    while (j < m) ops.push(['ins', b[j++]]);
    return ops;
}

/* Pair runs of deletions/insertions into side-by-side rows */
function toRows(ops) {
    const rows = [];
    let dels = [];
    let ins = [];
    const flush = () => {
        for (let k = 0; k < Math.max(dels.length, ins.length); k++) {
            rows.push({ type: 'chg', left: dels[k] ?? null, right: ins[k] ?? null });
        }
        dels = [];
        ins = [];
    };
    for (const [op, x, y] of ops) {
        if (op === 'eq') { flush(); rows.push({ type: 'eq', left: x, right: y }); }
        else if (op === 'del') dels.push(x);
        else ins.push(x);
    }
    flush();
    return rows;
}

export function diffHtml(a, b) {
    const la = JSON.stringify(comparable(a), null, 2).split('\n');
    const lb = JSON.stringify(comparable(b), null, 2).split('\n');
    const rows = toRows(lcsOps(la, lb));
    const changes = rows.filter(r => r.type !== 'eq').length;

    let ln = 0;
    let rn = 0;
    const body = rows.map(r => {
        const lCls = r.left === null ? 'blank' : r.type === 'chg' ? 'del' : '';
        const rCls = r.right === null ? 'blank' : r.type === 'chg' ? 'add' : '';
        const lNum = r.left === null ? '' : ++ln;
        const rNum = r.right === null ? '' : ++rn;
        return `<tr class="${r.type}"><td class="ln">${lNum}</td><td class="${lCls}">${esc(r.left ?? '')}</td>` +
            `<td class="ln">${rNum}</td><td class="${rCls}">${esc(r.right ?? '')}</td></tr>`;
    }).join('');

    const label = log => `#${log.id} · ${esc(cleanMethod(log.method))} ${esc(log.url)} · ${esc(new Date(log.time).toLocaleString())}`;

    return `
    <div class="diff-meta"><div>A: ${label(a)}</div><div>B: ${label(b)}</div></div>
    <div class="muted" style="margin-bottom:8px">${changes ? `${changes} changed line${changes > 1 ? 's' : ''}` : 'Identical'}</div>
    <div class="diff-wrap"><table class="diff" id="diff-table">${body}</table></div>`;
}
