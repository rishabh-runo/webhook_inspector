/* Keyed list renderer for log rows.
   Up to VIRTUAL_AFTER rows: every row is in the DOM.
   Above that: only rows near the viewport are rendered; spacers keep the scroll height.
   Rows are never re-created or moved unless they change, so open drawers and focus survive. */

const VIRTUAL_AFTER = 100;
const OVERSCAN = 6;
const GAP = 8;          // must match .log { margin-bottom }
const EST_ROW = 44 + GAP;

export function createListView(container, { render }) {
    let items = [];
    let virtual = false;
    let raf = 0;
    const heights = new Map(); // row id (string) -> measured height + gap

    const top = spacer();
    const bottom = spacer();

    const ro = new ResizeObserver(entries => {
        let changed = false;
        for (const entry of entries) {
            const el = entry.target;
            if (!el.isConnected) continue;
            const h = el.offsetHeight + GAP;
            if (heights.get(el.dataset.id) !== h) {
                heights.set(el.dataset.id, h);
                changed = true;
            }
        }
        if (changed && virtual) schedule();
    });

    function spacer() {
        const el = document.createElement('div');
        el.className = 'list-spacer';
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    const key = item => String(item.id);
    const heightOf = item => heights.get(key(item)) ?? EST_ROW;
    const rowEl = id => container.querySelector(`:scope > .log[data-id="${CSS.escape(String(id))}"]`);
    const indexOf = id => items.findIndex(i => i.id === id);

    function range() {
        if (!virtual) return [0, items.length];
        const listTop = container.getBoundingClientRect().top + scrollY;
        const viewTop = scrollY - listTop;
        const viewBottom = viewTop + innerHeight;

        let i = 0;
        let y = 0;
        while (i < items.length && y + heightOf(items[i]) <= viewTop) y += heightOf(items[i++]);
        let j = i;
        while (j < items.length && y < viewBottom) y += heightOf(items[j++]);
        return [Math.max(0, i - OVERSCAN), Math.min(items.length, j + OVERSCAN)];
    }

    function paint() {
        raf = 0;
        if (!top.isConnected || !bottom.isConnected) container.replaceChildren(top, bottom);

        const [s, e] = range();
        let before = 0;
        let after = 0;
        for (let k = 0; k < s; k++) before += heightOf(items[k]);
        for (let k = e; k < items.length; k++) after += heightOf(items[k]);
        top.style.height = `${before}px`;
        bottom.style.height = `${after}px`;

        const wanted = items.slice(s, e);
        const wantedKeys = new Set(wanted.map(key));

        // 1. drop rows that left the window
        container.querySelectorAll(':scope > .log').forEach(el => {
            if (!wantedKeys.has(el.dataset.id)) {
                ro.unobserve(el);
                el.remove();
            }
        });

        // 2. insert missing rows in order, without moving the ones already there
        let cursor = top.nextSibling;
        for (const item of wanted) {
            if (cursor !== bottom && cursor?.dataset?.id === key(item)) {
                cursor = cursor.nextSibling;
                continue;
            }
            let el = rowEl(item.id);
            if (!el) {
                el = render(item);
                if (virtual) ro.observe(el);
            }
            container.insertBefore(el, cursor);
        }
    }

    function schedule() {
        if (!raf) raf = requestAnimationFrame(paint);
    }

    function setVirtual(on) {
        if (on === virtual) return;
        virtual = on;
        container.querySelectorAll(':scope > .log').forEach(el => (on ? ro.observe(el) : ro.unobserve(el)));
    }

    const onViewport = () => { if (virtual) schedule(); };
    addEventListener('scroll', onViewport, { passive: true });
    addEventListener('resize', onViewport);

    return {
        set(list) {
            items = list.slice();
            container.replaceChildren(top, bottom);
            setVirtual(items.length > VIRTUAL_AFTER);
            paint();
        },
        clear() {
            items = [];
            setVirtual(false);
            container.replaceChildren();
        },
        prepend(item) {
            items.unshift(item);
            setVirtual(items.length > VIRTUAL_AFTER);
            paint();
        },
        remove(id) {
            const i = indexOf(id);
            if (i === -1) return false;
            items.splice(i, 1);
            const el = rowEl(id);
            if (el) {
                ro.unobserve(el);
                el.remove();
            }
            heights.delete(String(id));
            setVirtual(items.length > VIRTUAL_AFTER);
            paint();
            return true;
        },
        replace(item) {
            const i = indexOf(item.id);
            if (i === -1) return false;
            items[i] = item;
            const el = rowEl(item.id);
            if (el) {
                const fresh = render(item);
                ro.unobserve(el);
                el.replaceWith(fresh);
                if (virtual) ro.observe(fresh);
            }
            return true;
        },
        has: id => indexOf(id) !== -1,
        size: () => items.length,
        items: () => items,
        indexOf,
        at: i => items[i],
        element: rowEl,
        // Scroll a row into view (rendering it first when virtual) and return its element
        reveal(id) {
            let el = rowEl(id);
            if (!el && virtual) {
                const i = indexOf(id);
                if (i === -1) return null;
                let y = 0;
                for (let k = 0; k < i; k++) y += heightOf(items[k]);
                const listTop = container.getBoundingClientRect().top + scrollY;
                scrollTo({ top: Math.max(0, listTop + y - innerHeight / 3) });
                paint();
                el = rowEl(id);
            }
            el?.scrollIntoView({ block: 'nearest' });
            return el;
        }
    };
}
