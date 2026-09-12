/**
 * A progress ring. `value` is 0..1; the filled arc is amber by default —
 * on this site the arc is what is still locked, so `tone="ink"` is for the
 * one dial that counts the other way (released).
 */
export function Dial({
  value,
  size = 64,
  stroke = 5,
  tone = "amber",
  children,
  className = "",
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: "amber" | "ink" | "ash";
  children?: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone === "amber" ? "var(--amber)" : tone === "ink" ? "var(--ink)" : "var(--ash)";
  return (
    <div className={`relative inline-grid place-items-center ${className}`} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset 600ms ease", filter: tone === "amber" ? "drop-shadow(0 0 6px rgba(255,176,46,0.5))" : undefined }}
        />
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}
