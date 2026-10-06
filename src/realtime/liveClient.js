/**
 * LIVE UPDATES — the browser side of backend/src/services/realtime.js
 * ───────────────────────────────────────────────────────────────────────
 * One connection per open app. The server pushes a small message ("the
 * announcements changed") whenever anything is created, edited or deleted;
 * every page currently showing that data quietly re-fetches it.
 *
 * Three things keep it dependable rather than merely fast:
 *
 *  1. YOUR OWN changes don't wait for the network round trip through the
 *     stream — the API client tells this module the moment a write succeeds
 *     (notifyLocalWrite), so the page you just saved from refreshes at once.
 *  2. Refreshes are coalesced and serialised per page: a burst of events
 *     becomes one refetch, and if one is already running the next starts
 *     only after it ends — so an older response can never land on top of a
 *     newer one.
 *  3. If the stream drops (server restart, flaky Wi-Fi, a proxy that blocks
 *     streaming) it reconnects with back-off and, in the meantime, polls
 *     every few seconds. After ANY reconnect, or when the tab comes back to
 *     the foreground, everything refreshes once to catch up on what was missed.
 *
 * fetch() is used instead of EventSource so the sign-in token can travel in
 * the Authorization header like every other request — never in a URL.
 */

const POLL_WHILE_DISCONNECTED_MS = 8000;
const MAX_BACKOFF_MS = 15000;
const COALESCE_MS = 60;
const HEALTHY_AFTER_MS = 10000; // a connection must stay up this long before the retry delay resets

export function createLiveClient({ url, getToken, jitterMs = 0, fetchImpl }) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const subs = new Set(); // { topics:Set<string>, run:()=>Promise|void, timer, running, again }

  let running = false;
  let connected = false;
  let everConnected = false;
  let abort = null;
  let backoff = 1000;
  let connectedAt = 0;
  let reconnectTimer = null;
  let pollTimer = null;
  let lastCatchUp = 0;
  let listeners = [];

  const emitStatus = () => listeners.forEach((fn) => fn(connected));

  // ── running a page's refresh ───────────────────────────────────────
  async function execute(sub) {
    if (sub.running) {
      sub.again = true; // run once more after the current one finishes
      return;
    }
    sub.running = true;
    try {
      await sub.run({ background: true });
    } catch {
      /* a failed background refresh must never surface as an error */
    }
    sub.running = false;
    if (sub.again) {
      sub.again = false;
      schedule(sub, 0);
    }
  }

  function schedule(sub, extraJitter = jitterMs) {
    if (sub.timer) return; // already queued — this event is covered by it
    const delay = COALESCE_MS + (extraJitter ? Math.random() * extraJitter : 0);
    sub.timer = setTimeout(() => {
      sub.timer = null;
      execute(sub);
    }, delay);
  }

  function notify(topics, { jitter = jitterMs } = {}) {
    for (const sub of subs) {
      if (topics && !sub.topics.has("*") && !topics.some((t) => sub.topics.has(t))) continue;
      schedule(sub, jitter);
    }
  }

  function catchUp() {
    const now = Date.now();
    if (now - lastCatchUp < 1500) return;
    lastCatchUp = now;
    notify(null); // spread across the jitter window so many clients don't hit the server at once
  }

  // ── the stream ─────────────────────────────────────────────────────
  function handleFrame(frame) {
    let event = "message";
    const data = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue; // heartbeat comment
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (event !== "change" || data.length === 0) return;
    try {
      const payload = JSON.parse(data.join("\n"));
      if (Array.isArray(payload.topics)) notify(payload.topics);
    } catch {
      /* ignore a malformed frame */
    }
  }

  async function connect() {
    if (!running) return;
    const token = getToken();
    if (!token) {
      scheduleReconnect();
      return;
    }
    abort = new AbortController();
    try {
      const res = await doFetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        cache: "no-store",
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream refused (${res.status})`);

      connected = true;
      connectedAt = Date.now();
      // NOTE: the retry delay is deliberately NOT reset here. A connection that
      // opens and then breaks straight away (a proxy that won't stream, say)
      // would otherwise retry every second, forever.
      stopPolling();
      emitStatus();
      // Anything that changed while we were away (first connect, a
      // reconnect after a restart) is picked up right now.
      if (everConnected) catchUp();
      everConnected = true;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let split;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          handleFrame(buffer.slice(0, split));
          buffer = buffer.slice(split + 2);
        }
      }
    } catch {
      /* dropped or refused — handled below */
    }
    if (!running) return;
    if (connected && Date.now() - connectedAt >= HEALTHY_AFTER_MS) backoff = 1000; // it was healthy — retry promptly
    const wasConnected = connected;
    connected = false;
    if (wasConnected) emitStatus();
    startPolling();
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }

  // Safety net while there's no stream: refresh visible pages on a timer.
  function startPolling() {
    if (pollTimer || !running) return;
    pollTimer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") notify(null);
    }, POLL_WHILE_DISCONNECTED_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") catchUp();
  };
  const onOnline = () => {
    backoff = 1000;
    if (!connected) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      connect();
    }
    catchUp();
  };

  return {
    start() {
      if (running) return;
      running = true;
      backoff = 1000;
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
      if (typeof window !== "undefined") window.addEventListener("online", onOnline);
      connect();
    },
    stop() {
      running = false;
      connected = false;
      everConnected = false;
      abort?.abort();
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      stopPolling();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    },
    /** Register a page's refresh function. Returns the unsubscribe function. */
    subscribe(topics, run) {
      const sub = { topics: new Set(topics), run, timer: null, running: false, again: false };
      subs.add(sub);
      return () => {
        clearTimeout(sub.timer);
        subs.delete(sub);
      };
    },
    /** The API client calls this the moment one of YOUR writes succeeds. */
    notifyLocalWrite() {
      notify(null, { jitter: 0 });
    },
    onStatus(fn) {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((l) => l !== fn);
      };
    },
    isConnected: () => connected,
    // exposed for tests
    _notify: notify,
  };
}
