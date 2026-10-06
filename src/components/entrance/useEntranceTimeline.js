import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import ENTRANCE_CONFIG from './entrance.config';

/**
 * Builds the six-phase cinematic timeline.
 *
 * GSAP never touches Three.js objects directly. It animates one plain object,
 * and the scene reads that object every frame. That keeps GSAP and the R3F
 * render loop from fighting over the same properties, and makes teardown a
 * single `timeline.kill()`.
 */

export function createEntranceState(cfg = ENTRANCE_CONFIG) {
  const { logo, camera, environment } = cfg;
  return {
    // lighting ramps (0 → 1)
    key: 0,
    rim: 0,
    fill: 0,
    ambient: 0,
    backdrop: 0,
    env: 0,

    // medallion pose
    logoScale: logo.startScale,
    logoZ: logo.startZ,
    logoTiltX: logo.startTiltX,
    logoTiltY: logo.startTiltY,

    // camera
    camX: camera.startX,
    camY: camera.startY,
    camZ: camera.startZ,

    // atmosphere
    glow: 0,
    particles: 0,
    sweep: -0.3,
    sweepStrength: 0,

    // hand-off
    exposure: environment.baseExposure ?? 1,
    overlay: 1,
  };
}

/**
 * @param {object}   opts
 * @param {boolean}  opts.active   start the timeline
 * @param {Function} opts.onComplete
 * @param {object}   opts.cfg
 */
export default function useEntranceTimeline({ active, onComplete, cfg = ENTRANCE_CONFIG }) {
  const state = useRef(createEntranceState(cfg));
  const tl = useRef(null);
  const done = useRef(onComplete);
  done.current = onComplete;

  useEffect(() => {
    if (!active) return undefined;

    const s = state.current;
    const t = cfg.timeline;
    const cam = cfg.camera;
    const logo = cfg.logo;

    const timeline = gsap.timeline({
      paused: true,
      onComplete: () => done.current?.(),
    });
    timeline.timeScale(cfg.timeScale || 1);

    /* ---- Phase 1 · dark opening (0 – 0.8s) --------------------------- */
    timeline.to(s, { particles: 0.35, duration: t.particlesIn.duration, ease: 'sine.out' }, t.particlesIn.at);

    /* ---- Phase 2 · gold light (0.8 – 1.8s) --------------------------- */
    timeline
      .to(s, { glow: t.glowIn.to, duration: t.glowIn.duration, ease: 'sine.inOut' }, t.glowIn.at)
      .to(s, { key: 1, duration: t.keyLightIn.duration, ease: 'power2.out' }, t.keyLightIn.at)
      .to(s, { backdrop: 0.7, duration: t.keyLightIn.duration, ease: 'power2.out' }, t.keyLightIn.at)
      .to(s, { env: t.envIn.to, duration: t.envIn.duration, ease: 'sine.inOut' }, t.envIn.at)
      // the first pass of light literally wipes across the face, revealing it
      .to(s, { sweepStrength: t.revealSweep.strength, duration: 0.3, ease: 'sine.out' }, t.revealSweep.at)
      .to(s, { sweep: 1.3, duration: t.revealSweep.duration, ease: 'sine.inOut' }, t.revealSweep.at)
      .to(s, { sweepStrength: 0, duration: 0.45, ease: 'sine.in' }, t.revealSweep.at + t.revealSweep.duration - 0.45);

    /* ---- Phase 3 · 3D logo reveal (1.5 – 3.0s) ----------------------- */
    timeline
      .to(s, { logoScale: 1, duration: t.logoIn.duration, ease: 'power3.out' }, t.logoIn.at)
      .to(s, { logoZ: 0, duration: t.logoIn.duration, ease: 'power3.out' }, t.logoIn.at)
      .to(s, { logoTiltY: 0.07, duration: t.logoIn.duration + 0.3, ease: 'power2.out' }, t.logoIn.at)
      .to(s, { logoTiltX: 0.03, duration: t.logoIn.duration + 0.3, ease: 'power2.out' }, t.logoIn.at)
      .to(s, { rim: 1, duration: t.rimLightIn.duration, ease: 'power2.out' }, t.rimLightIn.at)
      .to(s, { fill: 1, duration: t.fillLightIn.duration, ease: 'sine.out' }, t.fillLightIn.at)
      .to(s, { ambient: 1, duration: t.fillLightIn.duration, ease: 'sine.out' }, t.fillLightIn.at);

    /* ---- Phase 4 · hero camera movement (2.5 – 4.0s) ----------------- */
    timeline
      .to(s, { camZ: cam.endZ, duration: t.cameraPush.duration, ease: 'power2.inOut' }, t.cameraPush.at)
      .to(s, { camX: cam.endX, duration: t.cameraPush.duration, ease: 'power2.inOut' }, t.cameraPush.at)
      .to(s, { camY: cam.endY, duration: t.cameraPush.duration, ease: 'power2.inOut' }, t.cameraPush.at)
      .to(s, { env: t.envFull.to, duration: t.envFull.duration, ease: 'sine.inOut' }, t.envFull.at)
      .to(s, { backdrop: 1, duration: t.envFull.duration, ease: 'sine.inOut' }, t.envFull.at)
      .to(s, { particles: t.particlesFull.to, duration: t.particlesFull.duration, ease: 'sine.out' }, t.particlesFull.at);

    /* ---- Phase 5 · final lock + highlight sweep (4.0 – 4.8s) --------- */
    timeline
      .to(s, { logoTiltX: logo.restTiltX, logoTiltY: logo.restTiltY, duration: t.settle.duration, ease: 'power2.inOut' }, t.settle.at)
      .set(s, { sweep: -0.3 }, t.lockSweep.at)
      .to(s, { sweepStrength: t.lockSweep.strength, duration: 0.25, ease: 'sine.out' }, t.lockSweep.at)
      .to(s, { sweep: 1.3, duration: t.lockSweep.duration, ease: 'power1.inOut' }, t.lockSweep.at)
      .to(s, { sweepStrength: 0, duration: 0.3, ease: 'sine.in' }, t.lockSweep.at + t.lockSweep.duration - 0.3)
      .to(s, { glow: t.glowFull.to, duration: t.glowFull.duration, ease: 'sine.inOut' }, t.glowFull.at);

    /* ---- Phase 6 · hand over to the website (4.85 – 5.5s) ------------ */
    timeline
      .to(s, { exposure: t.exposureLift.to, duration: t.exposureLift.duration, ease: 'sine.in' }, t.exposureLift.at)
      .to(s, { camZ: cam.exitZ, duration: t.exit.duration + 0.2, ease: 'sine.in' }, t.exit.at - 0.2)
      .to(s, { overlay: 0, duration: t.exit.duration, ease: 'power2.inOut' }, t.exit.at);

    tl.current = timeline;
    timeline.play(0);

    return () => {
      timeline.kill();
      tl.current = null;
    };
  }, [active, cfg]);

  /** Fast-forward to the hand-off — used by the Esc key (there is no on-screen skip button). */
  const skip = () => {
    const timeline = tl.current;
    if (!timeline) {
      done.current?.();
      return;
    }
    const exitAt = cfg.timeline.exit.at;
    if (timeline.time() < exitAt) timeline.seek(exitAt);
    timeline.timeScale((cfg.timeScale || 1) * 1.6);
  };

  return { state, skip };
}
