import { site } from "@/lib/site";

/**
 * The rule as a picture: one timeline, two outcomes. Amber is the locked
 * stretch, ink is money moving to the creator, ash is a burial. The SVG is
 * the same on every screen; it scrolls sideways inside its container on a
 * phone rather than shrinking the type.
 */
export function Rule() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24" id="rule">
      <div className="reveal max-w-2xl">
        <p className="label">The rule</p>
        <h2 className="display mt-3 text-[36px] text-ink sm:text-[52px]">One timeline, two outcomes.</h2>
        <p className="mt-4 text-lg text-ink-2">
          The creator picks two numbers at launch: how long the developer buy vests, and how long the curve has to graduate.
          Everything else is fixed.
        </p>
      </div>

      <div className="glass reveal mt-10 overflow-x-auto p-4 sm:p-8">
        <svg viewBox="0 0 960 330" className="mx-auto block min-w-[760px] max-w-[1040px]" role="img" aria-labelledby="rule-title">
          <title id="rule-title">{`Timeline: at launch the developer buy starts vesting and the creator fees are locked. If the curve graduates before the deadline, the fees unlock over ${site.feeVestDays} days and then flow. If it has not graduated by the deadline, the lock is buried: its ETH buys the token back and burns it.`}</title>
          <defs>
            <linearGradient id="rule-unlock" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#ffb02e" />
              <stop offset="1" stopColor="#f3f4f8" />
            </linearGradient>
            <filter id="rule-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>

          {/* Locked stretch: launch → deadline */}
          <line x1="80" y1="190" x2="470" y2="190" stroke="#ffb02e" strokeWidth="4" strokeLinecap="round" filter="url(#rule-glow)" opacity="0.6" />
          <line x1="80" y1="190" x2="470" y2="190" stroke="#ffb02e" strokeWidth="3" strokeLinecap="round" />

          {/* Outcome A: graduation → unlocking → open */}
          <path d="M340 190 C 385 190, 395 96, 450 96 L 640 96" fill="none" stroke="url(#rule-unlock)" strokeWidth="3" strokeLinecap="round" />
          <line x1="640" y1="96" x2="900" y2="96" stroke="#f3f4f8" strokeWidth="3" strokeLinecap="round" />
          <line x1="450" y1="96" x2="640" y2="96" stroke="#ffb02e" strokeWidth="1" strokeDasharray="2 6" opacity="0.6" />

          {/* Outcome B: deadline → buried */}
          <line x1="470" y1="190" x2="900" y2="190" stroke="#7c818c" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 9" />

          {/* Nodes */}
          <Node x={80} y={190} color="#ffb02e" label="Launch" sub="dev buy vests · fees lock" below />
          <Node x={340} y={190} color="#ffb02e" label="Graduation" sub="4.2 ETH raised" below />
          <Node x={470} y={190} color="#f3f4f8" label="Deadline" sub={`${site.windowDays.min}–${site.windowDays.max} days · creator's choice`} below hollow />
          <Node x={640} y={96} color="#f3f4f8" label={`+${site.feeVestDays} days`} sub="fees fully unlocked" below />
          <Node x={900} y={96} color="#f3f4f8" label="Open" sub="fees pass through, 90 / 10" below />
          <Node x={900} y={190} color="#7c818c" label="Buried" sub="bought back & burned · nobody paid" below />

          {/* Branch labels */}
          <text x="450" y="76" fill="#ffb02e" fontFamily="JetBrains Mono, monospace" fontSize="11" letterSpacing="1.5">
            IF GRADUATED BEFORE THE DEADLINE → UNLOCK LINEARLY
          </text>
          <text x="520" y="176" fill="#7c818c" fontFamily="JetBrains Mono, monospace" fontSize="11" letterSpacing="1.5">
            IF NOT → ANYONE CAN BURY, ONE SLICE PER HOUR
          </text>

          {/* Dev vesting bar, independent of the outcome */}
          <line x1="80" y1="280" x2="620" y2="280" stroke="#ffb02e" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
          <line x1="620" y1="280" x2="900" y2="280" stroke="#f3f4f8" strokeWidth="3" strokeLinecap="round" />
          <circle cx="80" cy="280" r="5" fill="#ffb02e" />
          <circle cx="620" cy="280" r="5" fill="#f3f4f8" />
          <text x="80" y="308" fill="rgba(243,244,248,0.5)" fontFamily="JetBrains Mono, monospace" fontSize="11" letterSpacing="1.5">
            {`DEV BUY · VESTS LINEARLY FROM LAUNCH, ${site.vestDays.min}–${site.vestDays.max} DAYS, WHATEVER THE FEES DO`}
          </text>
          <text x="900" y="308" textAnchor="end" fill="rgba(243,244,248,0.5)" fontFamily="JetBrains Mono, monospace" fontSize="11" letterSpacing="1.5">
            FULLY UNLOCKED
          </text>
        </svg>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Outcome
          tone="ink"
          title="It graduates."
          body={`Graduation is recorded on the lock the first time anyone calls checkpoint. From that moment every fee — already received or still to come — unlocks linearly over ${site.feeVestDays} days. After that, fees pass straight through on each release: ${100 - site.padShareBps / 100}% to the creator, ${site.padShareBps / 100}% to the pad.`}
        />
        <Outcome
          tone="ash"
          title="It doesn't."
          body={`Once the deadline passes without graduation, anyone can bury the lock. Each call spends at most ${site.burySliceBps / 100}% of the curve's quote reserve buying the token back, and sends what it bought to the dead address — one call per hour, so the burial can't be sandwiched at a profit. A buried lock never pays the creator, or us, again.`}
        />
      </div>
    </section>
  );
}

function Node({
  x,
  y,
  color,
  label,
  sub,
  below = false,
  hollow = false,
}: {
  x: number;
  y: number;
  color: string;
  label: string;
  sub: string;
  above?: boolean;
  below?: boolean;
  hollow?: boolean;
}) {
  const ty = below ? y + 26 : y - 30;
  const sy = below ? y + 44 : y - 14;
  const anchor = x > 860 ? "end" : x < 120 ? "start" : "middle";
  return (
    <g>
      {hollow ? (
        <circle cx={x} cy={y} r="7" fill="#07080c" stroke={color} strokeWidth="2.5" />
      ) : (
        <>
          <circle cx={x} cy={y} r="9" fill={color} opacity="0.25" filter="url(#rule-glow)" />
          <circle cx={x} cy={y} r="6" fill={color} />
        </>
      )}
      <text x={x} y={ty} textAnchor={anchor} fill="#f3f4f8" fontFamily="Inter Tight, Inter, sans-serif" fontWeight="600" fontSize="16" letterSpacing="-0.3">
        {label}
      </text>
      <text x={x} y={sy} textAnchor={anchor} fill="rgba(243,244,248,0.55)" fontFamily="Inter, sans-serif" fontSize="12">
        {sub}
      </text>
    </g>
  );
}

function Outcome({ tone, title, body }: { tone: "ink" | "ash"; title: string; body: string }) {
  return (
    <article className="panel reveal p-6">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${tone === "ink" ? "bg-ink" : "bg-ash"}`} />
        <h3 className="display text-[24px] text-ink">{title}</h3>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{body}</p>
    </article>
  );
}
