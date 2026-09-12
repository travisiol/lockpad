/* eslint-disable @next/next/no-img-element */
import { logoUrl } from "@/lib/pons";

type Props = {
  logo: string | null | undefined;
  symbol: string;
  /** Square size in px. Cards use 44, the token page 64. */
  size?: number;
  className?: string;
};

/** A launch's image, or — when it has none — its first letter on glass. */
export function TokenLogo({ logo, symbol, size = 44, className = "" }: Props) {
  const url = logoUrl(logo);
  const radius = Math.round(size * 0.28);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 border border-edge-2 bg-void-3 object-cover ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`display flex shrink-0 items-center justify-center border border-edge-2 bg-void-3 text-amber ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), borderRadius: radius }}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}
