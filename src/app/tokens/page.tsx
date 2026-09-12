import type { Metadata } from "next";
import { LaunchList } from "@/components/LaunchList";

export const metadata: Metadata = {
  title: "Launches",
  description: "Every token launched through Lockpad, with both locks read live from Robinhood Chain.",
};

export default function TokensPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
      <p className="label">Launches</p>
      <h1 className="display mt-3 text-[40px] text-ink sm:text-[56px]">Everything launched here.</h1>
      <p className="mt-4 max-w-2xl text-[15px] text-ink-2">
        Newest first, straight from the router. Each card reads the developer vesting and the fee lock as they are at this
        moment — nothing here is cached beyond a few seconds, and nothing is sampled.
      </p>
      <div className="mt-10">
        <LaunchList limit={60} />
      </div>
    </section>
  );
}
