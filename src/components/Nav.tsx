"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { ConnectButton } from "@/components/ConnectButton";

const LINKS = [
  { href: "/tokens", label: "Launches" },
  { href: "/docs", label: "The rule" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40">
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
        <div className="glass-2 flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5">
          <Wordmark />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${active(l.href) ? "bg-glass-2 text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <ConnectButton />
            <Link href="/launch" className="btn btn-primary btn-sm">
              Launch a token
            </Link>
          </div>
          <button
            type="button"
            className="btn btn-glass btn-sm md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
        {open ? (
          <div id="mobile-nav" className="glass-2 mt-2 flex flex-col gap-2 p-3 md:hidden">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-xl px-4 py-3 text-sm text-ink-2 hover:bg-glass hover:text-ink" onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
            <Link href="/launch" className="btn btn-primary" onClick={() => setOpen(false)}>
              Launch a token
            </Link>
            <ConnectButton className="px-1 pt-1" />
          </div>
        ) : null}
      </div>
    </header>
  );
}
