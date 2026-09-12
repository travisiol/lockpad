import Link from "next/link";
import { PadlockScene } from "@/components/PadlockScene";
import { LiveCount } from "@/components/LiveCount";
import { site } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6 lg:pt-16">
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="relative z-10">
          <span className="eyebrow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_10px_var(--amber)]" />
            Launchpad · {site.venue} · {site.chain}
          </span>
          <h1 className="display mt-6 text-[44px] text-ink sm:text-[64px] lg:text-[76px]">
            The dev can&apos;t rug.
            <br />
            <span className="text-amber">By construction.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
            {site.name} launches tokens on {site.venue} with the developer&apos;s bag in a vesting contract and the creator&apos;s
            fees locked until the curve graduates. Miss the deadline and the fees are buried — bought back and burned. Every
            rule is a contract you can read; none of them has an owner.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/launch" className="btn btn-primary">
              Launch a token
            </Link>
            <Link href="/docs" className="btn btn-glass">
              Read the rule
            </Link>
          </div>
          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            <Stat label="Locked launches">
              <LiveCount />
            </Stat>
            <Stat label="Pad launch fee">
              <span className="mono text-2xl text-ink">0</span>
              <span className="ml-1 text-sm text-ink-3">+ Pons {site.launchFeeEth}</span>
            </Stat>
            <Stat label="Fee vest">
              <span className="mono text-2xl text-ink">{site.feeVestDays}</span>
              <span className="ml-1 text-sm text-ink-3">days after graduation</span>
            </Stat>
          </dl>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_55%,rgba(255,176,46,0.16),transparent_70%)]" />
          <PadlockScene className="mx-auto aspect-square w-full max-w-[560px]" />
          <p className="label mt-2 text-center">Chrome · lit at runtime · no assets</p>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="panel px-4 py-3">
      <dt className="label">{label}</dt>
      <dd className="mt-1.5 flex items-baseline">{children}</dd>
    </div>
  );
}
