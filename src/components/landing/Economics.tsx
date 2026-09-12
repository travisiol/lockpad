import { percent, site } from "@/lib/site";

export function Economics() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24" id="economics">
      <div className="glass reveal grid gap-10 p-6 sm:p-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <p className="label">What we take</p>
          <h2 className="display mt-3 text-[36px] text-ink sm:text-[48px]">
            {percent.pad} of what the creator unlocks.
            <br />
            <span className="text-ink-3">Nothing on a buried lock.</span>
          </h2>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-ink-2">
            The pad&apos;s share is taken by the fee lock itself, at release time, from what the creator is being paid. It is
            not a launch fee, it is not skimmed while the fees are locked, and it is never taken from a lock that gets buried
            — if the token dies, the pad earns exactly what the creator earns: nothing. The share is fixed inside each lock at
            launch; the router&apos;s owner cannot raise it on a lock that already exists.
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Row k="Pad launch fee" v="0 ETH" note={`Pons charges its own ${site.launchFeeEth} ETH`} />
          <Row k="Trade fee on the curve" v={site.tradeFeePct} note="set by Pons, 70% of it is the creator fee" />
          <Row k="Of every release" v={`${percent.creator} creator`} note={`${percent.pad} to the pad treasury, in the same call`} />
          <Row k="Of a burial" v="0%" note="100% buys the token back and burns it" />
          <Row k="Fee vest after graduation" v={`${site.feeVestDays} days`} note="linear, from the recorded graduation" />
          <Row k="Burial slice" v={`${site.burySliceBps / 100}% / hour`} note="of the curve's quote reserve — sandwich-proof by fees" />
        </dl>
      </div>
    </section>
  );
}

function Row({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="panel px-4 py-3.5">
      <dt className="label">{k}</dt>
      <dd className="mono mt-1.5 text-lg text-ink">{v}</dd>
      <dd className="mt-0.5 text-xs text-ink-3">{note}</dd>
    </div>
  );
}
