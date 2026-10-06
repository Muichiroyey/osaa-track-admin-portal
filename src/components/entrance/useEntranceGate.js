import { useRef, useState } from 'react';
import ENTRANCE_CONFIG from './entrance.config';

/**
 * Decides, once per page load, whether the entrance should run and how rich it
 * should be. Runs synchronously during the first render so the app never
 * flashes before the overlay appears.
 *
 * Returns 'full' | 'reduced' | 'off'.
 *
 * DEFAULT RULE ('visit'): the entrance plays every time someone OPENS the
 * site — a fresh tab, coming back to it later, re-opening the browser,
 * typing the address again, following a link or bookmark — and is skipped
 * only when the page is being RELOADED (F5 / the reload button / Ctrl+R).
 * The browser itself tells us which it is (Navigation Timing: the entry's
 * `type` is 'navigate' for a visit and 'reload' for a reload), so nothing
 * needs to be remembered between visits and nothing can get "stuck" off.
 * Moving around inside the app never replays it: the component sits outside
 * the router and mounts once per page load.
 */

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function supportsWebGL() {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    // Release the probe context straight away.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Is this page load a reload? Modern browsers expose it through Navigation
 * Timing; very old ones through the legacy performance.navigation API.
 * When neither is available we can't tell, so we treat it as a visit (play).
 */
export function isPageReload() {
  try {
    const entry = performance.getEntriesByType?.('navigation')?.[0];
    if (entry && typeof entry.type === 'string') return entry.type === 'reload';
    if (performance.navigation) return performance.navigation.type === 1; // TYPE_RELOAD
  } catch {
    /* fall through */
  }
  return false;
}

// Set the moment the entrance finishes, so that if this component were ever
// remounted within the SAME page load (a hot-reload while developing, say) it
// would not run a second time. Resets naturally on every real page load.
let finishedThisPageLoad = false;

function readSeen(cfg) {
  const { playbackPolicy, storageKey } = cfg;
  if (finishedThisPageLoad) return true;
  try {
    if (playbackPolicy === 'visit') return isPageReload();
    if (playbackPolicy === 'always') return false;
    if (playbackPolicy === 'session') return sessionStorage.getItem(storageKey) === '1';
    if (playbackPolicy === 'once') return localStorage.getItem(storageKey) === '1';
    if (playbackPolicy === 'daily') return localStorage.getItem(storageKey) === todayStamp();
  } catch {
    // Storage blocked (private mode, strict cookie settings) — fail open and play once.
    return false;
  }
  return false;
}

export function markEntranceSeen(cfg = ENTRANCE_CONFIG) {
  finishedThisPageLoad = true;
  const { playbackPolicy, storageKey } = cfg;
  try {
    if (playbackPolicy === 'session') sessionStorage.setItem(storageKey, '1');
    else if (playbackPolicy === 'once') localStorage.setItem(storageKey, '1');
    else if (playbackPolicy === 'daily') localStorage.setItem(storageKey, todayStamp());
  } catch {
    /* storage unavailable — the entrance simply plays again next load */
  }
}

/** Clear the flag from the console while you are tuning: `resetEntrance()` */
export function resetEntrance(cfg = ENTRANCE_CONFIG) {
  finishedThisPageLoad = false;
  try {
    sessionStorage.removeItem(cfg.storageKey);
    localStorage.removeItem(cfg.storageKey);
  } catch {
    /* no-op */
  }
}

export default function useEntranceGate(cfg = ENTRANCE_CONFIG) {
  const decided = useRef(null);

  const [mode] = useState(() => {
    if (decided.current) return decided.current;

    let result = 'full';

    if (!cfg.enabled) result = 'off';
    else if (typeof window === 'undefined') result = 'off';
    else if (readSeen(cfg)) result = 'off';
    // A tab opened in the background has its rAF loop throttled — the user would
    // come back to a frozen frame, so give them the quiet version instead.
    else if (document.visibilityState === 'hidden') result = 'reduced';
    else if (prefersReducedMotion()) result = 'reduced';
    else if (!supportsWebGL()) result = 'reduced';

    decided.current = result;
    return result;
  });

  return mode;
}
