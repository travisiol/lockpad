import type { Metadata } from "next";
import Link from "next/link";
import { FAQ } from "@/components/landing/Faq";
import { ROUTER_ADDRESS } from "@/lib/contracts";
import { explorer } from "@/lib/chain";
import { percent, site } from "@/lib/site";

export const metadata: Metadata = {
  title: "The rule",
  description: "What Lockpad's contracts do, in full: the developer vesting, the fee lock, burials, and what the pad takes.",
};

const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const PONS_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
      <div className="grid gap-10 lg:grid-cols-[240px_1fr]">
        <nav className="hidden lg:block" aria-label="On this page">
          <ol className="sticky top-28 space-y-2 text-sm text-ink-3">
            {[
              ["#rule", "The rule"],
              ["#vesting", "Developer vesting"],
              ["#feelock", "Fee lock"],
              ["#burial", "Burials"],
              ["#numbers", "The numbers"],
              ["#take", "What the pad takes"],
              ["#contracts", "Contracts"],
              ["#faq", "Questions"],
            ].map(([href, label]) => (
              <li key={href}>
                <a href={href} className="hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="max-w-3xl">
          <p className="label">Documentation</p>
          <h1 className="display mt-3 text-[40px] text-ink sm:text-[56px]">The rule.</h1>
          <p className="mt-4 text-lg text-ink-2">
            Everything below is what the contracts do, not what we intend. Where the site says &ldquo;anyone can&rdquo;, it
            means the function has no access control.
          </p>

          <Section id="rule" title="One rule, fixed at launch">
            <p>
              A launch through {site.name} is one transaction that deploys two contracts and then launches on {site.venue} with
              both wired in. The <strong>fee lock</strong> is registered on Pons as the token&apos;s creator-fee recipient. The{" "}
              <strong>vesting contract</strong> is the recipient of the developer buy. Neither has an owner. The router can
              name their token and curve exactly once, in that same transaction, and never again.
            </p>
            <p>
              The creator chooses two numbers: how long the developer buy vests ({site.vestDays.min}–{site.vestDays.max} days) and
              how long the curve has to graduate ({site.windowDays.min}–{site.windowDays.max} days). Everything else — the{" "}
              {site.feeVestDays}-day fee vest, the {percent.pad} pad share, the burial mechanics — is a constant in the code.
            </p>
          </Section>

          <Section id="vesting" title="Developer vesting">
            <p>
              Pons&apos; launch forwarder can buy the developer allocation in the launch transaction and deliver it to any
              address. {site.name} makes that address a fresh <code>DevVesting</code> contract. The tokens unlock linearly from
              the launch timestamp over the chosen duration; anyone can call <code>release()</code> and it always pays the
              beneficiary. There is no cliff, no clawback and no acceleration.
            </p>
            <p>
              The forwarder exempts its buy recipient from Pons&apos; snipe tax, so the vesting contract buys at the clean
              price. The creator&apos;s wallet is <em>not</em> on the exempt list — the router passes an empty one — so a
              second wallet buying at launch pays the same tax as everybody else.
            </p>
            <p>
              The beneficiary can hand the role to another address in two steps (<code>proposeBeneficiary</code>, then{" "}
              <code>acceptBeneficiary</code> from the new address). That changes who is paid, never when.
            </p>
          </Section>

          <Section id="feelock" title="Fee lock">
            <p>
              Pons collects a {site.tradeFeePct} fee on every curve trade (plus the optional creator tax) and sweeps the
              creator&apos;s share to its fee escrow on its own schedule; graduation triggers a sweep. The lock pulls its escrow
              balance whenever anyone calls it. From there:
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <strong>Before graduation</strong>, nothing leaves. <code>release()</code> reverts.
              </li>
              <li>
                <strong>Graduation is recorded</strong> the first time the lock sees <code>curve.graduated()</code> true —
                through <code>checkpoint()</code> or any release. Anyone can call it; the token page offers the button.
              </li>
              <li>
                <strong>From that moment</strong>, everything the lock has received and will receive unlocks linearly over{" "}
                {site.feeVestDays} days. Each <code>release()</code> pays the unlocked amount: {percent.creator} to the creator,{" "}
                {percent.pad} to the pad treasury. After the vest, releases pass everything through.
              </li>
              <li>
                <strong>If the deadline passes</strong> without graduation, the lock can be buried (below). A buried lock
                never releases again — not to the creator, not to the pad — and everything that arrives later is buried too.
              </li>
            </ol>
            <p>
              Graduation and burial are exclusive: a lock that recorded graduation cannot be buried, and a buried lock ignores
              a later graduation. The creator role has the same two-step hand-over as the vesting.
            </p>
          </Section>

          <Section id="burial" title="Burials, and why they are sliced">
            <p>
              <code>bury()</code> spends the lock&apos;s ETH buying the token back on its own curve and sends the tokens to{" "}
              <code>0x…dEaD</code>. It is an open call on a public curve, so it has to survive being front-run. Instead of a
              slippage parameter — which a hostile caller would set to zero — the size of each burial is bounded: at most{" "}
              {site.burySliceBps / 100}% of the curve&apos;s quote reserve (virtual liquidity included) per call, and calls at
              least {site.buryIntervalHours} hour apart.
            </p>
            <p>
              The bound is what makes it safe. Moving the price by some fraction <em>p</em> takes roughly <em>p</em> × reserves
              of capital and costs the {site.tradeFeePct} fee twice (in and out), about 2% × <em>p</em> × reserves. The most a
              sandwich can extract is <em>p</em> × slice. With the slice under 2% of reserves, the fee exceeds the gain at every{" "}
              <em>p</em>, so the attack loses money. The hourly spacing stops an attacker from recombining the slices into one
              large buy under a single pump.
            </p>
            <p>
              A burial is itself a trade, so 1% of it comes back as a creator fee — into the same lock, to be buried an hour
              later. The series converges; the token page shows the running total.
            </p>
          </Section>

          <Section id="numbers" title="The numbers">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Num k="Developer vesting" v={`${site.vestDays.min}–${site.vestDays.max} days`} note="creator's choice, linear, no cliff" />
              <Num k="Graduation deadline" v={`${site.windowDays.min}–${site.windowDays.max} days`} note="creator's choice, from launch" />
              <Num k="Fee vest" v={`${site.feeVestDays} days`} note="constant, from the recorded graduation" />
              <Num k="Pad share" v={percent.pad} note="of each release, fixed inside the lock" />
              <Num k="Burial slice" v={`${site.burySliceBps / 100}% of quote reserve`} note={`one call per ${site.buryIntervalHours} hour`} />
              <Num k="Pad launch fee" v="0 ETH" note={`Pons charges ${site.launchFeeEth} ETH`} />
              <Num k="Graduation" v={`${site.graduationEth} ETH raised`} note="set by Pons" />
              <Num k="Snipe-tax exemptions" v="vesting contract only" note="the creator's wallet is not exempt" />
            </dl>
          </Section>

          <Section id="take" title="What the pad takes">
            <p>
              {percent.pad} of what the creator unlocks, taken by the lock at release time and sent to the router&apos;s treasury
              address in the same call. Nothing at launch, nothing while fees are locked, nothing from a burial. The share is an
              immutable in each lock; changing the router&apos;s constant would only affect locks created afterwards. The
              router&apos;s owner can pause new launches, move the treasury address, and set a launch fee (zero). That is the
              whole admin surface.
            </p>
          </Section>

          <Section id="contracts" title="Contracts">
            <dl className="mono space-y-2 text-sm">
              <Addr k="LockpadRouter" v={ROUTER_ADDRESS} />
              <Addr k="Pons V2 factory" v={PONS_FACTORY} />
              <Addr k="Pons fee escrow" v={PONS_ESCROW} />
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Chain</dt>
                <dd className="text-ink-2">Robinhood Chain · id 4663</dd>
              </div>
            </dl>
            <p>
              Per-launch addresses (token, curve, fee lock, vesting) are on each token page and in the router&apos;s{" "}
              <code>infoOf(token)</code>. <code>lockStatus(token)</code> returns both locks&apos; state in one read — it is what
              this site renders. Source: <code>contracts/</code> in the repository, with the test suite and the fork rehearsal
              against the live Pons factory.
            </p>
          </Section>

          <Section id="faq" title="Questions">
            <div className="divide-y divide-edge">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="mono shrink-0 text-ink-3 transition-transform group-open:rotate-45" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
                </details>
              ))}
            </div>
          </Section>

          <div className="mt-12 flex flex-wrap gap-3">
            <Link href="/launch" className="btn btn-primary">
              Launch a token
            </Link>
            <Link href="/tokens" className="btn btn-glass">
              See the launches
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-28">
      <h2 className="display text-[28px] text-ink sm:text-[34px]">{title}</h2>
      <div className="prose-lock mt-4 space-y-4 text-[15px] leading-relaxed text-ink-2 [&_code]:rounded [&_code]:bg-glass-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-ink [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}

function Num({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="panel px-4 py-3">
      <dt className="label">{k}</dt>
      <dd className="mono mt-1 text-[15px] text-ink">{v}</dd>
      <dd className="text-xs text-ink-3">{note}</dd>
    </div>
  );
}

function Addr({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
      <dt className="shrink-0 text-ink-3">{k}</dt>
      <dd className="min-w-0 break-all text-ink-2">
        {v ? (
          <a href={explorer.address(v)} target="_blank" rel="noreferrer" className="hover:text-ink">
            {v}
          </a>
        ) : (
          <span className="text-ink-4">TBA</span>
        )}
      </dd>
    </div>
  );
}
