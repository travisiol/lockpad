# Lockpad

**The dev can't rug. By construction.**

A launchpad for [Pons V2](https://www.ponsfamily.com) on Robinhood Chain where the developer buy vests on a public schedule and the creator fees stay locked until the curve graduates — or get buried. Every rule is a contract deployed in the same transaction as the token; none of them has an owner.

- Site: Next 16 + Tailwind 4 + wagmi/viem + three.js (the hero padlock is chrome lit by a painted environment, no assets).
- Contracts: `contracts/` — Hardhat 2, OpenZeppelin 5, 35 tests on a mock Pons, plus a rehearsal against the real Pons factory on a fork.

## The rule

A launch is one transaction. The router deploys two locks, then launches on Pons with both wired in:

| Lock | What it holds | What it does |
| --- | --- | --- |
| `DevVesting` | the developer buy — Pons' launch forwarder delivers it here, never to the creator's wallet | unlocks linearly from launch over the creator's chosen duration (7–365 days); no cliff, no clawback, no admin |
| `FeeLock` | the creator fees — registered on Pons as the creator-fee recipient | nothing leaves before graduation; from the recorded graduation everything unlocks over 30 days, then passes through; if the deadline (3–90 days, creator's choice) passes without graduation, anyone can bury it |

**Burial** = the lock's ETH buys the token back on its own curve and sends it to `0x…dEaD`. Burials are sliced (≤ 2 % of the curve's quote reserve per call, one call per hour), which makes them sandwich-proof without a slippage parameter: moving the price by *p* costs ~2 % × *p* × reserves in trade fees and wins at most *p* × slice. A buried lock never pays the creator, or the pad, again.

**No exemptions.** The only address exempted from Pons' snipe tax is the vesting contract (Pons exempts the buy recipient). The router passes an empty exempt list, so the creator's own wallet — or a second one — pays what everyone pays.

**What the pad takes:** 10 % of what the creator unlocks, taken by the lock at release time. Nothing at launch (the only launch fee is Pons' 0.0005 ETH), nothing while fees are locked, nothing from a burial. The share is an immutable in each lock; the router's owner can only pause new launches, move the treasury address and set a (zero) pad launch fee.

Graduation is recorded on the lock when first observed (`checkpoint()`, or any release). Anyone can call it; the token page offers the button.

## Layout

```
contracts/
  contracts/LockpadRouter.sol   launch(), registry, lockStatus(); Ownable2Step
  contracts/LockFactory.sol     deploys the two locks (keeps the router under the size limit)
  contracts/FeeLock.sol         the fee rule: lock → checkpoint → release, or bury
  contracts/DevVesting.sol      linear vesting of the developer buy
  contracts/interfaces/IPonsV2.sol   the Pons surface, verified on a fork
  contracts/mocks/MockPons.sol  constant-product mock for the tests
  test/Lockpad.test.ts          35 tests
  scripts/fork-check.ts         rehearsal against the real factory on a fork
  scripts/serve-fork.ts         seeds a fork with three launches and serves it to the site
  scripts/deploy.ts             LockFactory + router → deployments/<network>.json
src/
  app/                          /, /launch, /tokens, /token/[address], /docs, /api/*
  components/                   PadlockScene (three.js), LaunchForm, TokenView, LaunchList …
  lib/market.ts                 every read the site makes, straight from the chain (no indexer)
  lib/lockmath.ts               schedule arithmetic + the rule preview; checked by scripts/check-lockmath.mts
```

## Run

```bash
npm install
cp .env.example .env.local        # NEXT_PUBLIC_LOCKPAD_ROUTER stays empty until deployed
npm run dev
```

Without a router address the site shows clean empty states and the launch form's interlocks stay open.

```bash
npm run build && npm run lint && npm run check:lockmath
```

## Contracts

```bash
cd contracts
npm install
npm test                                                  # mock Pons
FORK_URL=https://rpc.mainnet.chain.robinhood.com npm run fork:check   # real factory, nothing broadcast
```

The fork rehearsal proves, in order: the developer buy lands in the vesting contract and not the creator's wallet; the vesting contract is snipe-tax exempt and the creator is not; fees accrue for the fee lock; a lock past its deadline can be buried on the real curve (buy + burn); a launch that graduates for real can be checkpointed and released 90/10 through the real fee escrow.

To see the site with data before deploying:

```bash
cd contracts
FORK_URL=https://rpc.mainnet.chain.robinhood.com npx hardhat run scripts/serve-fork.ts
# then, in .env.local:
#   NEXT_PUBLIC_LOCKPAD_ROUTER=<printed>
#   NEXT_PUBLIC_ROBINHOOD_RPC_URL=http://127.0.0.1:8546
#   NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=31337
```

Deploy for real (needs a funded key in `contracts/.env`):

```bash
cd contracts
npm run deploy:robinhood     # writes deployments/robinhood.json, prints NEXT_PUBLIC_LOCKPAD_ROUTER
```

## Verified

- `npm test`: 35 passing (router, fee lock, vesting, lock factory; burials, cooldowns, exclusivity of graduation and burial, two-step hand-overs).
- `fork:check` on a fork of Robinhood Chain at block ~61.21 M: launch with dev buy (6.34 M gas), tokens in vesting, creator not exempt, burial on the real curve burned 1.65 M tokens, a real graduation swept 0.0297 ETH of creator fees into the Pons escrow and a release paid 0.02236 ETH to the creator and 0.00248 ETH to the treasury.
- Site: `next build`, `eslint`, `check:lockmath` clean; no horizontal overflow at 375 px on `/`, `/launch`, `/tokens`, `/docs`; `backdrop-filter` measured on the glass panels; hydration clean.

## Open

- **Not deployed.** `deploy:robinhood` needs a funded key; the site is wired for the router address and shows nothing until it has one.
- **Image upload** needs `PONS_IPFS_UPLOAD_URL`; without it the form answers 501 and asks to remove the image.
- **Sweeps are Pons'.** Creator fees sit on the curve until Pons sweeps them (graduation triggers one). The lock can only act on what has reached the escrow; the token page shows all three figures.
- **Edge:** a buried lock whose curve later graduates can no longer buy on the curve, so any fee arriving after that stays in the lock. It never reaches the creator either.
- **Graduation time is observed, not read.** The curve exposes a flag, not a timestamp, so the vest starts when someone first checkpoints. The site makes that one click; a creator who never does starts late.
- The name, `lockpad.fun` and `@lockpad_` are placeholders in `src/lib/site.ts`; nothing has been registered. RDAP on 2026-09-12: `lockpad.fun`, `.xyz`, `.app` and `.io` are **taken**; `lockpad.trade` and `lockpad.finance` are free.
