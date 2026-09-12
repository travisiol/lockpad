import Link from "next/link";
import { PadlockMark } from "@/components/PadlockMark";
import { site } from "@/lib/site";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2.5 ${className}`} aria-label={`${site.name} — home`}>
      <PadlockMark className="h-7 w-7" />
      <span className="display text-[22px] tracking-[-0.03em]">
        <span className="text-ink">{site.wordmark[0]}</span>
        <span className="text-amber">{site.wordmark[1]}</span>
      </span>
    </Link>
  );
}
