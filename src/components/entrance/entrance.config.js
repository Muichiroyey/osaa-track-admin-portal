/**
 * OSAA-TRACK cinematic entrance — single source of truth for every tunable value.
 *
 * Everything you are likely to want to change lives in this file. Nothing else
 * in the entrance folder hard-codes a colour, a duration or a distance.
 */

/* ------------------------------------------------------------------ *
 * Brand palette (extracted from the existing OSAA-TRACK design system)
 * ------------------------------------------------------------------ */
export const PALETTE = {
  deepNavy: '#060E2E',
  darkNavy: '#0B1640',
  primaryNavy: '#111D4E',
  blueNavy: '#1B2A6B',
  mediumNavy: '#2A3D8F',

  indigoDeep: '#1E1B4B',
  indigo: '#312E81',
  indigoLight: '#3730A3',

  gold: '#F5C800',
  goldDark: '#D4A800',
  goldLight: '#F9DA5A',

  skyAccent: '#A8D4F5',
  white: '#FFFFFF',
};

export const ENTRANCE_CONFIG = {
  /* -------------------------------------------------------------- *
   * Lifecycle — when the entrance is allowed to play
   * -------------------------------------------------------------- */
  enabled: true,

  /**
   * 'visit'   — plays every time the site is OPENED (new tab, re-opened, revisited,
   *             address typed again, link or bookmark) and is skipped only on a
   *             page RELOAD (F5 / reload button). Nothing is stored, so it can
   *             never get stuck off. (recommended, and the default)
   * 'session' — once per browser tab session
   * 'daily'   — once per calendar day, per browser
   * 'once'    — once ever, per browser
   * 'always'  — every full page load, reloads included (useful while tuning it)
   */
  playbackPolicy: 'visit',
  storageKey: 'osaa.entrance.seen.v1',

  /** If assets have not loaded within this many seconds, use the simple fallback. */
  assetTimeout: 2.5,

  /* -------------------------------------------------------------- *
   * Assets
   * -------------------------------------------------------------- */
  assets: {
    sealDesktop: '/brand/osaa-seal-1536.webp',
    sealMobile: '/brand/osaa-seal-768.webp',
    sealFallback: '/brand/osaa-seal-1024.png',
  },

  /* -------------------------------------------------------------- *
   * Timeline (seconds). Total runtime = exit.at + exit.duration.
   * Scale the whole thing with `timeScale` instead of editing each cue.
   * -------------------------------------------------------------- */
  /**
   * Playback speed for the whole sequence. >1 is faster.
   * 1.00 → 5.50s (original, stately)
   * 1.30 → 4.23s (current — brisk but the camera move still reads)
   * 1.60 → 3.44s (fast)
   */
  timeScale: 1.3,

  timeline: {
    // Phase 1 — dark opening
    particlesIn: { at: 0.0, duration: 0.9 },

    // Phase 2 — gold light
    glowIn: { at: 0.55, duration: 0.9, to: 0.45 },
    keyLightIn: { at: 0.8, duration: 1.1 },
    envIn: { at: 0.95, duration: 1.2, to: 0.55 },
    revealSweep: { at: 1.1, duration: 1.5, strength: 0.55 },

    // Phase 3 — logo reveal
    logoIn: { at: 1.45, duration: 1.7 },
    rimLightIn: { at: 1.6, duration: 1.2 },
    fillLightIn: { at: 1.9, duration: 1.0 },

    // Phase 4 — hero camera move
    cameraPush: { at: 2.5, duration: 1.6 },
    envFull: { at: 3.0, duration: 1.0, to: 1.0 },
    particlesFull: { at: 3.3, duration: 1.0, to: 0.75 },

    // Phase 5 — final lock + highlight sweep
    settle: { at: 4.0, duration: 0.8 },
    lockSweep: { at: 4.05, duration: 0.85, strength: 1.0 },
    glowFull: { at: 4.2, duration: 0.6, to: 0.85 },

    // Phase 6 — hand over to the website
    exit: { at: 4.85, duration: 0.65 },
    exposureLift: { at: 4.8, duration: 0.6, to: 1.38 },
  },

  /* -------------------------------------------------------------- *
   * Camera
   * -------------------------------------------------------------- */
  camera: {
    fov: 38,
    near: 0.1,
    far: 60,
    startZ: 7.6,
    endZ: 4.4,
    /** extra push during the hand-off, keeps the dissolve moving */
    exitZ: 4.12,
    startX: -0.62,
    startY: 0.5,
    endX: 0.0,
    endY: 0.12,
    /** breathing orbit after the lock — keep tiny or it looks restless */
    idleOrbit: 0.035,
    idleSpeed: 0.22,
  },

  /* -------------------------------------------------------------- *
   * The medallion (3D representation of the seal)
   * -------------------------------------------------------------- */
  logo: {
    radius: 1.0,
    thickness: 0.15,
    bevelSize: 0.055,
    bevelThickness: 0.05,
    bevelSegments: 6,
    curveSegments: 128,

    /** seal artwork radius as a fraction of the medallion radius */
    faceInset: 0.885,
    /** thin gold hairline that frames the artwork */
    hairlineWidth: 0.014,

    /** starting pose — the logo settles out of this */
    startScale: 0.84,
    startZ: -1.15,
    startTiltX: 0.15,
    startTiltY: -0.38,
    restTiltX: 0.0,
    restTiltY: 0.0,
  },

  /* -------------------------------------------------------------- *
   * Materials
   * -------------------------------------------------------------- */
  materials: {
    rim: { color: PALETTE.gold, metalness: 0.96, roughness: 0.26 },
    body: { color: PALETTE.darkNavy, metalness: 0.55, roughness: 0.42 },
    hairline: { color: PALETTE.goldDark, metalness: 0.95, roughness: 0.34 },
    face: { roughness: 0.46, metalness: 0.08, clearcoat: 0.55, clearcoatRoughness: 0.3 },
    /** reflection strength of the procedural studio environment */
    envMapIntensity: 1.15,
  },

  /* -------------------------------------------------------------- *
   * Lighting
   * -------------------------------------------------------------- */
  lights: {
    /** gold key, front-upper-left — also the light that casts the shadow */
    key: {
      color: PALETTE.goldLight,
      intensity: 52,
      position: [-3.1, 3.0, 4.2],
      angle: 0.68,
      penumbra: 0.9,
      decay: 2,
    },
    /** cool rim from behind-right — separates the medallion from the backdrop */
    rim: { color: PALETTE.skyAccent, intensity: 30, position: [4.0, 1.4, -3.0], decay: 2 },
    /** low navy fill — stops the lower half going completely black */
    fill: { color: PALETTE.mediumNavy, intensity: 20, position: [2.2, -2.4, 3.4], decay: 2 },
    /** sits between logo and backdrop, throwing a soft pool of light behind it */
    backdrop: { color: PALETTE.blueNavy, intensity: 13, position: [0, 0.2, -1.4], decay: 2 },
    ambient: { color: PALETTE.mediumNavy, intensity: 0.7 },
  },

  /* -------------------------------------------------------------- *
   * Environment & atmosphere
   * -------------------------------------------------------------- */
  environment: {
    /** Also mirrored in entrance.css so the page is already navy pre-React. */
    backgroundCss:
      'radial-gradient(125% 95% at 50% 43%, #24357E 0%, #1B2A6B 34%, #111D4E 62%, #0B1640 84%, #070E2A 100%)',
    /** Corner darkening. Lower both numbers to open the frame up further. */
    vignette: { mid: 0.24, edge: 0.58 },
    /** Atmospheric haze. Lower = the backdrop reads brighter and further away. */
    fogDensity: 0.03,
    /** Baseline tone-mapping exposure — the cheapest global brightness dial. */
    baseExposure: 1.1,
    backdropZ: -2.8,
    backdropColor: PALETTE.blueNavy,
    /** Opacity of the two drifting haze veils at full environment level. */
    hazeOpacity: [0.15, 0.11],
  },

  glow: {
    color: PALETTE.gold,
    size: 7.2,
    z: -1.05,
  },

  particles: {
    desktop: 220,
    mobile: 90,
    color: PALETTE.goldLight,
    size: 0.055,
    spread: [9, 6, 5],
    driftSpeed: 0.035,
  },

  /* -------------------------------------------------------------- *
   * Quality — automatically stepped down on small / low-power devices
   * -------------------------------------------------------------- */
  quality: {
    dprDesktop: 2,
    dprMobile: 1.5,
    shadowsDesktop: true,
    shadowsMobile: false,
    shadowMapSize: 1024,
    mobileBreakpoint: 768,
  },

  /* -------------------------------------------------------------- *
   * Hand-off to the website
   * -------------------------------------------------------------- */
  transition: {
    /** 'dissolve' scales the layer out slightly, 'fade' is a flat opacity fade */
    mode: 'dissolve',
    scaleTo: 1.06,
  },

  /* -------------------------------------------------------------- *
   * Sound
   *
   * Synthesised live with the Web Audio API — no audio files, no extra
   * requests. Browsers block audio until the visitor has interacted with
   * the site, so this may start silent on a first-ever visit; the speaker
   * button turns it on and the choice is remembered.
   * -------------------------------------------------------------- */
  audio: {
    /** Plays by itself — no button. Browsers only allow sound once the visitor has interacted
     *  with the page, so if it is blocked at first it starts at the first click, key press or tap. */
    enabled: true,
    /** Master level, 0–1. 0.32 is present without being intrusive in an office. */
    volume: 0.32,
    /** Legacy: an earlier version had a speaker button that saved on/off here. The button
     *  is gone, so this is now just cleared on load so an old "off" can't silence the sound. */
    storageKey: 'osaa.entrance.sound.v1',
    /** Wet level of the generated reverb. 0 = dry and close, 0.5 = cathedral. */
    reverb: 0.3,
    /** Cue times, in master-timeline seconds — they scale with timeScale. */
    cues: {
      drone: 0.0,
      riser: 0.55,
      shimmer: 0.85,
      reveal: 1.45,
      push: 2.5,
      lock: 4.05,
      release: 4.85,
    },
  },

  /* -------------------------------------------------------------- *
   * prefers-reduced-motion — no WebGL at all, just a quiet DOM fade
   * -------------------------------------------------------------- */
  reducedMotion: {
    fadeIn: 0.5,
    hold: 0.45,
    fadeOut: 0.5,
  },
};

/** Device probe used by the scene and the gate. */
export function isSmallScreen() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(`(max-width: ${ENTRANCE_CONFIG.quality.mobileBreakpoint}px)`).matches;
}

/** Total runtime of the full cinematic sequence, in seconds. */
export function totalDuration(cfg = ENTRANCE_CONFIG) {
  const { at, duration } = cfg.timeline.exit;
  return (at + duration) / (cfg.timeScale || 1);
}

export default ENTRANCE_CONFIG;
