import { site } from "@/lib/site";

export const FAQ = [
  {
    q: "Can the creator still rug with another wallet?",
    a: `Partly, and it is worth being exact. What the locks stop: dumping the developer buy (it is vesting, in public) and taking the creator fees early (they are locked until graduation, and buried if it never comes). What they do not stop: the creator buying from a second wallet like anyone else and selling later. That second wallet gets no exemption from Pons' snipe tax — the only exempt buyer is the vesting contract — so it pays what every other early buyer pays. ${site.name} makes a rug expensive and visible, not impossible.`,
  },
  {
    q: "What exactly happens at graduation?",
    a: `Pons graduates a curve when it has raised ${site.graduationEth} ETH and moves the market to a pool. The fee lock does not know about that until someone calls checkpoint — anyone can, and the token page does it for you. From the recorded moment, everything the lock has received and everything it receives later unlocks linearly over ${site.feeVestDays} days. After that, each release pays out whatever has arrived.`,
  },
  {
    q: "Why record graduation instead of reading it live?",
    a: "Because a vesting schedule needs a start time, and the curve reports a flag, not a timestamp. Recording it on the lock when first observed gives every later calculation one fixed reference that nobody can move. The cost is that a creator who forgets to checkpoint starts their vest late — which is why the site makes it a one-click call that anyone can make.",
  },
  {
    q: "What does 'buried' mean, precisely?",
    a: `Once the creator's deadline passes and the curve has not graduated, anyone can call bury. The lock pulls whatever Pons has swept to it, spends at most ${site.burySliceBps / 100}% of the curve's quote reserve buying the token on the curve, and sends the tokens to the dead address. It can be called again an hour later, and again, until the lock is empty. A buried lock never releases to the creator or to the pad — including fees that arrive afterwards.`,
  },
  {
    q: "Why bury in slices instead of all at once?",
    a: `Because a burial is an open call on a public curve. Moving the price by some fraction costs an attacker about twice the ${site.tradeFeePct} trade fee on the capital it takes to move it, and wins them at most that fraction of the slice. When a slice is under 2% of the reserves the fees exceed the gain, so sandwiching a burial loses money — regardless of any slippage setting, which is why the call has none.`,
  },
  {
    q: "Where are the fees before they reach the lock?",
    a: "On the curve. Pons collects the trade fee on every buy and sell and sweeps the creator's share to its fee escrow on its own schedule (graduation triggers a sweep too). The token page shows three figures: accruing on the curve, pending in the escrow, and held by the lock. Only the third is subject to the schedule; the first two are still Pons' to move.",
  },
  {
    q: "Can the router's owner change a lock?",
    a: "No. The router has an owner for three things: pausing new launches, moving the pad's own treasury address, and setting a pad launch fee (zero). Each lock is a separate contract with no owner at all; its deadline, vest duration and pad share are fixed at deployment. The router can name a lock's token and curve exactly once, in the launch transaction, and never again.",
  },
  {
    q: "What if the creator loses their wallet?",
    a: "Both locks let the current creator propose a new address, which must accept — a two-step hand-over, so a typo cannot lose the role. It changes who is paid; it never changes when or how much.",
  },
  {
    q: `Is ${site.name} a Pons product?`,
    a: `No. ${site.name} is middleware: the router calls Pons' public factory and forwarder, which accept launches from any address. Pons takes its usual fee and runs the market; ${site.name} only decides where the creator fees and the developer buy land. Nothing about the token itself is different — same curve, same graduation, same pool.`,
  },
] as const;

export function Faq() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24" id="faq">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="reveal">
          <p className="label">Questions</p>
          <h2 className="display mt-3 text-[36px] text-ink sm:text-[48px]">The unflattering ones first.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            A lock is only as good as what it does not cover. These answers say exactly where the line is.
          </p>
        </div>
        <div className="reveal divide-y divide-edge">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-[17px] font-medium text-ink [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="mono shrink-0 text-ink-3 transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
