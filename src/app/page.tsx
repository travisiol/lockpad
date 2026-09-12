import Link from "next/link";
import { Hero } from "@/components/landing/Hero";
import { Locks } from "@/components/landing/Locks";
import { Rule } from "@/components/landing/Rule";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Economics } from "@/components/landing/Economics";
import { Faq } from "@/components/landing/Faq";
import { LaunchList } from "@/components/LaunchList";

export default function Home() {
  return (
    <>
      <Hero />
      <Locks />
      <Rule />
      <HowItWorks />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24" id="launches">
        <div className="reveal flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="label">Live</p>
            <h2 className="display mt-3 text-[36px] text-ink sm:text-[52px]">Launches, read from the chain.</h2>
            <p className="mt-4 text-[15px] text-ink-2">Every card shows both locks as they are right now: how much of the developer buy is still behind the schedule, and where the fees stand.</p>
          </div>
          <Link href="/tokens" className="btn btn-glass w-fit">
            All launches
          </Link>
        </div>
        <div className="mt-10">
          <LaunchList limit={6} compact />
        </div>
      </section>
      <Economics />
      <Faq />
      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6">
        <div className="glass reveal relative overflow-hidden p-8 text-center sm:p-14">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_100%,rgba(255,176,46,0.18),transparent_70%)]" />
          <p className="label relative">Ready</p>
          <h2 className="display relative mt-3 text-[36px] text-ink sm:text-[56px]">Launch it locked.</h2>
          <p className="relative mx-auto mt-4 max-w-lg text-[15px] text-ink-2">Two numbers, one transaction. The rule is read back to you before you sign, and it cannot be edited after.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/launch" className="btn btn-primary">
              Launch a token
            </Link>
            <Link href="/docs" className="btn btn-glass">
              Read the contracts
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
