/**
 * The mark: a padlock drawn as two strokes — shackle and body — with the
 * amber lamp in the corner. Same object as the hero, at icon size. Used in
 * the wordmark, the favicon and as the WebGL fallback.
 */
export function PadlockMark({ className = "", lamp = true }: { className?: string; lamp?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id="lp-chrome" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#c9ced9" />
          <stop offset="0.5" stopColor="#8b92a1" />
          <stop offset="0.55" stopColor="#dfe3ea" />
          <stop offset="1" stopColor="#7d8492" />
        </linearGradient>
      </defs>
      <path
        d="M20 30v-8a12 12 0 0 1 24 0v8"
        stroke="url(#lp-chrome)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect x="12" y="28" width="40" height="30" rx="9" fill="url(#lp-chrome)" />
      <rect x="13" y="29" width="38" height="28" rx="8" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <circle cx="32" cy="41" r="3.6" fill="#07080c" />
      <rect x="30.4" y="43" width="3.2" height="7" rx="1.2" fill="#07080c" />
      {lamp ? <circle cx="45" cy="51" r="2.2" fill="#ffb02e" /> : null}
    </svg>
  );
}
