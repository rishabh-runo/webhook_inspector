const MAX_DELAY = 10000;

/* WebSocket with exponential-backoff reconnect.
   onOpen fires on every (re)connect, onReconnect only after a re-open so the caller can resync.
   Returns { send } for messages to the server. */
export function connectLive({ url, onMessage, onStatus, onOpen, onReconnect }) {
    let attempt = 0;
    let opened = false;
    let ws = null;

    function open() {
        onStatus(opened ? 'reconnecting' : 'connecting');
        ws = new WebSocket(url());

        ws.onopen = () => {
            onOpen?.();
            if (opened) onReconnect?.();
            opened = true;
            attempt = 0;
            onStatus('live');
        };

        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            onMessage(msg);
        };

        ws.onclose = () => {
            onStatus('offline');
            const delay = Math.min(1000 * 2 ** attempt, MAX_DELAY);
            attempt++;
            setTimeout(open, delay);
        };
    }

    open();

    return {
        send(msg) {
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        }
    };
}
