/**
 * Entrance sound design.
 *
 * Everything is synthesised live with the Web Audio API — no mp3s, no extra
 * requests, nothing to keep in sync with the visuals. Cue times are given in
 * master-timeline seconds and divided by `timeScale`, so changing the pace in
 * entrance.config.js moves the sound with the picture automatically.
 *
 * AUTOMATIC PLAYBACK. `play()` starts the sound on its own, with no button.
 * Browsers, though, refuse to make sound until the visitor has interacted with
 * the page (Chrome also relaxes this for sites the visitor regularly plays
 * sound on; Edge and Firefox have a per-site "allow autoplay" setting). So:
 *
 *   1. it tries to start immediately — if the browser allows it, the sound
 *      runs from the very first frame;
 *   2. if the browser says no, it waits for the visitor's first click, key
 *      press or tap ANYWHERE on the page and starts right then — in step with
 *      the picture (only the cues that haven't passed yet are played, and the
 *      low opening bed always is);
 *   3. it never schedules the sound twice, and lets go of everything when the
 *      entrance ends.
 */

const NOISE_SECONDS = 2.5;

function makeNoiseBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Exponentially decaying noise — a plausible small hall, generated in ~1ms. */
function makeReverbImpulse(ctx, seconds = 2.4, decay = 3.2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * (1 - t) ** decay;
    }
  }
  return impulse;
}

export default function createEntranceAudio(cfg) {
  const settings = cfg.audio;
  const rate = cfg.timeScale || 1;
  const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);

  if (!settings?.enabled || !AudioCtx) {
    return { play: () => {}, stop: () => {}, isPlaying: () => false };
  }

  let ctx = null;
  let master = null;
  let wet = null;
  let noiseBuffer = null;
  let stopped = false;
  const voices = [];

  /* ---------------------------------------------------------------- */
  function build() {
    ctx = new AudioCtx();
    noiseBuffer = makeNoiseBuffer(ctx);

    master = ctx.createGain();
    master.gain.value = settings.volume;

    // Takes the edge off the noise layers without sounding muffled.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 11000;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 20;
    glue.ratio.value = 3;
    glue.attack.value = 0.005;
    glue.release.value = 0.25;

    const convolver = ctx.createConvolver();
    convolver.buffer = makeReverbImpulse(ctx);
    wet = ctx.createGain();
    wet.gain.value = settings.reverb;

    master.connect(tone);
    tone.connect(glue);
    tone.connect(wet);
    wet.connect(convolver);
    convolver.connect(glue);
    glue.connect(ctx.destination);
  }

  /* -------- small helpers ------------------------------------------ */
  function gainNode(value = 0) {
    const node = ctx.createGain();
    node.gain.value = value;
    node.connect(master);
    return node;
  }

  function osc(type, frequency, target) {
    const node = ctx.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.connect(target);
    voices.push(node);
    return node;
  }

  function noise(target) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    source.connect(target);
    voices.push(source);
    return source;
  }

  function band(type, frequency, q, target) {
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    if (q != null) filter.Q.value = q;
    filter.connect(target);
    return filter;
  }

  /* -------- cues ---------------------------------------------------- */

  /** Low bed of air under the whole sequence. */
  function drone(at, until) {
    const out = gainNode(0);
    const low = band('lowpass', 340, 0.7, out);
    [
      [55, 'sine', 1.0],
      [82.41, 'sine', 0.55],
      [110, 'triangle', 0.22],
    ].forEach(([frequency, type, level]) => {
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = level;
      voiceGain.connect(low);
      const o = osc(type, frequency, voiceGain);
      // a couple of cents of drift keeps it from sounding like a test tone
      o.detune.setValueAtTime(-4 + Math.random() * 8, at);
      o.start(at);
      o.stop(until + 1.2);
    });

    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(0.1, at + 1.4 / rate);
    out.gain.setValueAtTime(0.1, until);
    out.gain.exponentialRampToValueAtTime(0.0001, until + 0.9 / rate);
  }

  /** Filtered-noise swell that climbs through the reveal. */
  function riser(at, duration) {
    const out = gainNode(0);
    const bp = band('bandpass', 240, 1.1, out);
    const source = noise(bp);

    bp.frequency.setValueAtTime(240, at);
    bp.frequency.exponentialRampToValueAtTime(5400, at + duration);

    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(0.075, at + duration * 0.82);
    out.gain.exponentialRampToValueAtTime(0.0001, at + duration + 0.5 / rate);

    source.start(at);
    source.stop(at + duration + 0.8 / rate);
  }

  /** Airy wipe as the gold light crosses the face. */
  function shimmer(at) {
    const out = gainNode(0);
    const hp = band('highpass', 2400, 0.8, out);
    const source = noise(hp);

    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(0.055, at + 0.09 / rate);
    out.gain.exponentialRampToValueAtTime(0.0001, at + 1.3 / rate);

    source.start(at);
    source.stop(at + 1.5 / rate);
  }

  /** Soft bloom as the medallion comes forward. */
  function reveal(at) {
    const out = gainNode(0);
    const sub = osc('sine', 120, out);
    sub.frequency.setValueAtTime(120, at);
    sub.frequency.exponentialRampToValueAtTime(52, at + 0.95 / rate);

    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(0.13, at + 0.06 / rate);
    out.gain.exponentialRampToValueAtTime(0.0001, at + 1.5 / rate);

    sub.start(at);
    sub.stop(at + 1.7 / rate);
  }

  /** Weight under the camera move. */
  function push(at) {
    const out = gainNode(0);
    const sub = osc('sine', 44, out);
    sub.frequency.setValueAtTime(44, at);
    sub.frequency.linearRampToValueAtTime(30, at + 1.5 / rate);

    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(0.07, at + 0.5 / rate);
    out.gain.exponentialRampToValueAtTime(0.0001, at + 1.8 / rate);

    sub.start(at);
    sub.stop(at + 2.0 / rate);
  }

  /**
   * The moment the medallion locks. Inharmonic partials — the ratios a struck
   * metal disc actually produces, rather than a musical chord. Decay times are
   * NOT scaled by timeScale: a bell rings for as long as a bell rings.
   */
  function lock(at) {
    const partials = [
      [1.0, 0.5, 3.4],
      [2.0, 0.28, 2.6],
      [2.99, 0.18, 2.0],
      [4.24, 0.11, 1.4],
      [5.61, 0.07, 1.0],
      [7.42, 0.04, 0.7],
    ];
    const fundamental = 523.25; // C5

    partials.forEach(([ratio, level, decay]) => {
      const out = gainNode(0);
      const o = osc('sine', fundamental * ratio, out);
      out.gain.setValueAtTime(0, at);
      out.gain.linearRampToValueAtTime(level * 0.42, at + 0.006);
      out.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      o.start(at);
      o.stop(at + decay + 0.1);
    });

    // strike transient
    const hit = gainNode(0);
    const bp = band('bandpass', 3600, 1.6, hit);
    const source = noise(bp);
    hit.gain.setValueAtTime(0, at);
    hit.gain.linearRampToValueAtTime(0.14, at + 0.004);
    hit.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    source.start(at);
    source.stop(at + 0.3);

    // low thud so the lock has body
    const body = gainNode(0);
    const thud = osc('sine', 86, body);
    thud.frequency.setValueAtTime(86, at);
    thud.frequency.exponentialRampToValueAtTime(44, at + 0.26);
    body.gain.setValueAtTime(0, at);
    body.gain.linearRampToValueAtTime(0.16, at + 0.008);
    body.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    thud.start(at);
    thud.stop(at + 0.8);
  }

  /** Duck everything as the overlay dissolves into the app. */
  function release(at) {
    master.gain.cancelScheduledValues(at);
    master.gain.setValueAtTime(settings.volume, at);
    master.gain.exponentialRampToValueAtTime(0.0001, at + 0.75 / rate);
  }

  /* ---------------------------------------------------------------- */
  /** Schedule the cues. Only called once the browser has let the context run. */
  function schedule(elapsed) {
    const c = settings.cues;
    const t0 = ctx.currentTime + 0.04;
    const at = (cue) => t0 + Math.max(0, cue / rate - elapsed);
    const due = (cue) => cue / rate >= elapsed - 0.15;

    const endsAt = at(c.release);

    // The low bed under the whole sequence is always played — even when the
    // sound is unlocked part-way through — so a late start isn't thin.
    drone(at(c.drone), endsAt);
    if (due(c.riser)) riser(at(c.riser), 3.1 / rate);
    if (due(c.shimmer)) shimmer(at(c.shimmer));
    if (due(c.reveal)) reveal(at(c.reveal));
    if (due(c.push)) push(at(c.push));
    if (due(c.lock)) lock(at(c.lock));
    release(endsAt);
  }

  const UNLOCK_EVENTS = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'touchend', 'click'];
  let disarm = () => {};

  /**
   * Start the sound as soon as the browser permits it.
   * @param {() => number} getElapsed  seconds of the sequence already played —
   *        asked at the instant the sound really begins, so it stays in step
   *        with the picture even if the browser only allows it later.
   */
  function play(getElapsed) {
    if (stopped) return;
    if (!ctx) build();
    let scheduled = false;

    const begin = () => {
      if (scheduled || stopped || !ctx || ctx.state !== 'running') return;
      scheduled = true;
      disarm();
      schedule(Math.max(0, Number(getElapsed()) || 0));
    };

    // Asking to resume is what starts a suspended context. Outside a user
    // gesture a strict browser leaves the request waiting (or refuses) —
    // either way `begin` runs the moment it does become allowed.
    const tryResume = () => {
      if (!ctx || scheduled || stopped) return;
      try {
        const request = ctx.resume();
        if (request && typeof request.then === 'function') request.then(begin, () => {});
      } catch {
        /* not allowed yet — the next gesture tries again */
      }
      begin();
    };

    ctx.addEventListener?.('statechange', begin);
    UNLOCK_EVENTS.forEach((name) => window.addEventListener(name, tryResume, { capture: true, passive: true }));
    disarm = () => {
      UNLOCK_EVENTS.forEach((name) => window.removeEventListener(name, tryResume, { capture: true }));
      ctx?.removeEventListener?.('statechange', begin);
    };

    tryResume(); // 1. straight away — works when the browser already trusts this site
  }

  function stop() {
    stopped = true;
    disarm();
    if (!ctx) return;
    const now = ctx.currentTime;
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    } catch {
      /* graph may already be torn down */
    }
    voices.forEach((voice) => {
      try {
        voice.stop(now + 0.14);
      } catch {
        /* already stopped */
      }
    });
    setTimeout(() => {
      ctx?.close().catch(() => {});
      ctx = null;
    }, 220);
  }

  return { play, stop, isPlaying: () => ctx?.state === 'running' };
}
