import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ENTRANCE_CONFIG, { isSmallScreen } from './entrance.config';
import useEntranceGate, { markEntranceSeen } from './useEntranceGate';
import useEntranceTimeline from './useEntranceTimeline';
import loadSealImage from './loadSealImage';
import createEntranceAudio from './entrance.audio';
import OSAAEntranceFallback from './OSAAEntranceFallback';
import './entrance.css';

/**
 * Wrap the application once, as high up as possible:
 *
 *   <OSAAEntrance>
 *     <App />
 *   </OSAAEntrance>
 *
 * The app renders underneath from the very first frame — it mounts, resolves
 * auth and fetches data while the entrance plays — but is held inert so it
 * cannot take focus or be read out. When the sequence finishes the overlay
 * dissolves and the app is simply already there. No reload, no route change,
 * no layout jump.
 */
export default function OSAAEntrance({ children, onComplete, config }) {
  const cfg = config || ENTRANCE_CONFIG;

  const gateMode = useEntranceGate(cfg);
  const [mode, setMode] = useState(gateMode);
  const [visible, setVisible] = useState(gateMode !== 'off');
  const [SceneComponent, setSceneComponent] = useState(null);
  const [sealImage, setSealImage] = useState(null);

  const appRef = useRef(null);
  const layerRef = useRef(null);
  const finished = useRef(false);
  const audioRef = useRef(null);
  const startedAt = useRef(0);

  /* -------- quality profile ------------------------------------------ */
  const quality = useMemo(() => {
    const mobile = isSmallScreen();
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 8 : 8;
    const memory = typeof navigator !== 'undefined' ? navigator.deviceMemory || 8 : 8;
    const lowPower = cores <= 4 || memory <= 4;

    return {
      isMobile: mobile,
      dpr: mobile || lowPower ? cfg.quality.dprMobile : cfg.quality.dprDesktop,
      shadows: mobile || lowPower ? cfg.quality.shadowsMobile : cfg.quality.shadowsDesktop,
      shadowMapSize: lowPower ? 512 : cfg.quality.shadowMapSize,
    };
  }, [cfg]);

  const playing = mode === 'full' && !!SceneComponent && !!sealImage;

  /* -------- finish ---------------------------------------------------- */
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    audioRef.current?.stop();
    audioRef.current = null;
    markEntranceSeen(cfg);
    setVisible(false);
    onComplete?.();
  }, [cfg, onComplete]);

  const { state, skip } = useEntranceTimeline({ active: playing, onComplete: finish, cfg });

  /* -------- load the 3D chunk and the seal, in parallel --------------- */
  useEffect(() => {
    if (mode !== 'full') return undefined;
    let cancelled = false;

    // three.js and the scene are code-split, so they never weigh down the
    // dashboard bundle for visitors who skip the entrance.
    import('./OSAAEntranceScene')
      .then((module) => {
        if (!cancelled) setSceneComponent(() => module.default);
      })
      .catch(() => {
        if (!cancelled) setMode('reduced');
      });

    const timeout = cfg.assetTimeout * 1000;
    const primary = quality.isMobile ? cfg.assets.sealMobile : cfg.assets.sealDesktop;

    const accept = (image) => {
      if (!cancelled) setSealImage(image);
    };

    loadSealImage(primary, { timeout })
      .then(accept)
      .catch(() =>
        loadSealImage(cfg.assets.sealFallback, { timeout })
          .then(accept)
          .catch(() => {
            if (!cancelled) setMode('reduced');
          }),
      );

    return () => {
      cancelled = true;
    };
  }, [mode, cfg, quality.isMobile]);

  /* -------- sound ------------------------------------------------------ *
   * Plays by itself the moment the sequence starts — there is no button.
   * Browsers only allow sound once the visitor has interacted with the page,
   * so if it is blocked at first, it starts at the visitor's first click, key
   * press or tap, in step with the picture (see entrance.audio.js).
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!playing || !cfg.audio.enabled) return undefined;

    try {
      // An earlier version saved the visitor's on/off choice from a speaker
      // button that no longer exists — forget it so an old "off" can't mute this.
      localStorage.removeItem(cfg.audio.storageKey);
    } catch {
      /* storage blocked — nothing to clear */
    }

    startedAt.current = performance.now();
    const audio = createEntranceAudio(cfg);
    audioRef.current = audio;
    audio.play(() => (performance.now() - startedAt.current) / 1000);

    return () => {
      audio.stop();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [playing, cfg]);

  /* -------- drive the overlay from the same timeline ------------------ */
  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;

    const tick = () => {
      const layer = layerRef.current;
      if (layer) {
        const { overlay } = state.current;
        layer.style.opacity = String(overlay);
        if (cfg.transition.mode === 'dissolve') {
          const out = 1 - overlay;
          layer.style.transform = `scale(${1 + out * (cfg.transition.scaleTo - 1)})`;
        }
        if (overlay < 0.995) layer.style.pointerEvents = 'none';
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, state, cfg.transition]);

  /* -------- release the pre-boot navy painted by index.html ----------- */
  useEffect(() => {
    if (!visible) document.documentElement.classList.remove('osaa-preboot');
  }, [visible]);

  /* -------- hold the app inert while the overlay is up ---------------- */
  useEffect(() => {
    const root = document.documentElement;
    const app = appRef.current;

    if (visible) {
      root.classList.add('osaa-entrance-active');
      if (app) {
        app.setAttribute('aria-hidden', 'true');
        app.setAttribute('inert', '');
        try {
          app.inert = true;
        } catch {
          /* attribute alone is enough on browsers without the property */
        }
      }
    }

    return () => {
      root.classList.remove('osaa-entrance-active');
      if (app) {
        app.removeAttribute('aria-hidden');
        app.removeAttribute('inert');
        try {
          app.inert = false;
        } catch {
          /* no-op */
        }
      }
    };
  }, [visible]);

  /* -------- keyboard: Escape ends the entrance (no on-screen button) ---- */
  const handleSkip = useCallback(() => {
    if (mode === 'reduced') finish();
    else skip();
  }, [mode, finish, skip]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') handleSkip();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, handleSkip]);

  /* -------------------------------------------------------------------- */
  if (mode === 'off' && !visible) return children;

  return (
    <>
      <div ref={appRef} className="osaa-entrance-app">
        {children}
      </div>

      {visible && (
        <div
          ref={layerRef}
          className="osaa-entrance"
          role="dialog"
          aria-modal="true"
          aria-label="OSAA-TRACK is opening"
          style={{
            background: cfg.environment.backgroundCss,
            '--osaa-vignette-mid': cfg.environment.vignette.mid,
            '--osaa-vignette-edge': cfg.environment.vignette.edge,
          }}
        >
          {mode === 'full' && SceneComponent && sealImage && (
            <SceneComponent state={state} sealImage={sealImage} quality={quality} cfg={cfg} />
          )}

          {mode === 'reduced' && <OSAAEntranceFallback onComplete={finish} cfg={cfg} />}

          <div className="osaa-entrance__vignette" aria-hidden="true" />
          <div className="osaa-entrance__grain" aria-hidden="true" />

        </div>
      )}
    </>
  );
}
