import { site } from "@/lib/site";

const LOCKS = [
  {
    n: "01",
    title: "The developer buy vests.",
    body: `The creator's own buy is delivered to a vesting contract in the launch transaction — it never touches their wallet. It unlocks linearly over the duration they chose (${site.vestDays.min} to ${site.vestDays.max} days) and the countdown is public.`,
    detail: "DevVesting.sol · no admin · no clawback",
  },
  {
    n: "02",
    title: "Creator fees lock until graduation.",
    body: `Every creator fee the curve generates goes to a fee lock, not to the creator. Nothing leaves before the curve graduates; then it unlocks over ${site.feeVestDays} days. Miss the deadline and anyone can bury the lock: the ETH buys the token back and burns it.`,
    detail: "FeeLock.sol · buried locks pay nobody",
  },
  {
    n: "03",
    title: "No exemptions for the creator.",
    body: "Pons taxes early buyers to punish snipers. The only buyer we exempt is the vesting contract itself. A creator's second wallet pays exactly what everyone else pays — the pad cannot be used to front-run its own launch.",
    detail: "empty exempt list · verifiable on the curve",
  },
] as const;

export function Locks() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24" id="locks">
      <div className="reveal max-w-2xl">
        <p className="label">What gets locked</p>
        <h2 className="display mt-3 text-[36px] text-ink sm:text-[52px]">Three locks. No keys.</h2>
        <p className="mt-4 text-lg text-ink-2">
          Other launchpads let a creator promise. Here the promise is a contract deployed in the same transaction as the token,
          with no owner and no override — not even ours.
        </p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {LOCKS.map((l) => (
          <article key={l.n} className="glass reveal flex flex-col p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <span className="mono text-sm text-amber">{l.n}</span>
              <span className="h-2 w-2 rounded-full bg-amber shadow-[0_0_12px_var(--amber)]" />
            </div>
            <h3 className="display mt-8 text-[26px] text-ink">{l.title}</h3>
            <p className="mt-4 flex-1 text-[15px] leading-relaxed text-ink-2">{l.body}</p>
            <p className="label mt-6 normal-case tracking-[0.06em]">{l.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
