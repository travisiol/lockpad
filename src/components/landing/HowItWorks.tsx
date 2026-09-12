import Link from "next/link";
import { site } from "@/lib/site";

const STEPS = [
  {
    n: "1",
    title: "Name it",
    body: "Name, ticker, image, description, socials — the first screen of any launchpad.",
  },
  {
    n: "2",
    title: "Pick the vesting",
    body: `How long your developer buy takes to unlock: ${site.vestDays.options.join(" / ")} days, or anything from ${site.vestDays.min} to ${site.vestDays.max}.`,
  },
  {
    n: "3",
    title: "Pick the deadline",
    body: `How long the curve has to graduate before your fees can be buried: ${site.windowDays.options.join(" / ")} days.`,
  },
  {
    n: "4",
    title: "Read it back",
    body: "The form reads the rule back in plain words, with the dates. What you read is what the contracts will do.",
  },
  {
    n: "5",
    title: "Launch",
    body: `One transaction deploys both locks and launches on ${site.venue}, with the locks already wired in. The only fee is Pons' ${site.launchFeeEth} ETH.`,
  },
] as const;

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24" id="how">
      <div className="reveal flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="label">How it works</p>
          <h2 className="display mt-3 text-[36px] text-ink sm:text-[52px]">Five screens. One transaction.</h2>
        </div>
        <Link href="/launch" className="btn btn-primary w-fit">
          Launch a token
        </Link>
      </div>
      <ol className="mt-10 grid gap-3 md:grid-cols-5">
        {STEPS.map((s) => (
          <li key={s.n} className="panel reveal p-5">
            <span className="mono text-sm text-amber">{s.n}</span>
            <h3 className="display mt-6 text-[22px] text-ink">{s.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
