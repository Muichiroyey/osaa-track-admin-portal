import { useEffect } from 'react';
import ENTRANCE_CONFIG from './entrance.config';

/**
 * Used when the visitor asks for reduced motion, when WebGL is unavailable,
 * when the tab is opened in the background, or when the seal texture fails to
 * load. No Three.js, no GSAP, no canvas — a short CSS fade over the same navy
 * environment, so the brand moment still happens without any movement.
 */
export default function OSAAEntranceFallback({ onComplete, cfg = ENTRANCE_CONFIG }) {
  const { fadeIn, hold, fadeOut } = cfg.reducedMotion;
  const total = fadeIn + hold + fadeOut;

  useEffect(() => {
    const timer = setTimeout(() => onComplete?.(), total * 1000);
    return () => clearTimeout(timer);
  }, [onComplete, total]);

  return (
    <div className="osaa-entrance__quiet">
      <img
        className="osaa-entrance__quiet-seal"
        src={cfg.assets.sealFallback}
        alt=""
        width={512}
        height={512}
        decoding="async"
        style={{
          animationDuration: `${fadeIn}s`,
          animationDelay: '0s',
        }}
      />
    </div>
  );
}
