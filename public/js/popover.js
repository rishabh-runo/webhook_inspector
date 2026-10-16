/* One floating glass popover at a time (filters, export menu, row "..." menu).
   Positioned next to its trigger, closed by Esc, an outside click, scroll or resize. */

let current = null; // { el, anchor, onClose }

function position(el, anchor) {
    const r = anchor.getBoundingClientRect();
    el.style.left = '0px';
    el.style.top = '0px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    let left = r.right - w;                       // right-align with the trigger
    if (left < 8) left = r.left;                  // not enough room: left-align
    left = Math.max(8, Math.min(left, innerWidth - w - 8));

    let topY = r.bottom + 6;
    if (topY + h > innerHeight - 8 && r.top - h - 6 > 8) topY = r.top - h - 6; // flip above
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(topY)}px`;
}

const focusables = el => [...el.querySelectorAll('button:not([disabled]), select, input, [tabindex="0"]')]
    .filter(n => n.offsetParent !== null);

export function openPopover(el, anchor, { onClose } = {}) {
    closePopover({ restoreFocus: false });
    el.hidden = false;
    position(el, anchor);
    anchor.setAttribute('aria-expanded', 'true');
    current = { el, anchor, onClose };
    requestAnimationFrame(() => focusables(el)[0]?.focus());
}

export function closePopover({ restoreFocus = true } = {}) {
    if (!current) return;
    const { el, anchor, onClose } = current;
    current = null;
    el.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    onClose?.();
    if (restoreFocus && anchor.isConnected) anchor.focus();
}

export function togglePopover(el, anchor, opts) {
    if (current && current.el === el && current.anchor === anchor) closePopover();
    else openPopover(el, anchor, opts);
}

export const isPopoverOpen = () => current !== null;

document.addEventListener('pointerdown', (e) => {
    if (current && !current.el.contains(e.target) && !current.anchor.contains(e.target)) {
        closePopover({ restoreFocus: false });
    }
});

// Capture phase: Esc closes the popover before the page shortcuts see it
document.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePopover();
        return;
    }
    // Arrow keys move through menu items
    if (current.el.getAttribute('role') === 'menu' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const items = focusables(current.el);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0
            : e.key === 'End' ? items.length - 1
                : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

addEventListener('resize', () => closePopover({ restoreFocus: false }));
addEventListener('scroll', (e) => {
    if (current && !(e.target instanceof Node && current.el.contains(e.target))) closePopover({ restoreFocus: false });
}, { capture: true, passive: true });
