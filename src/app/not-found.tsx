import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-7xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <p className="label">404</p>
      <h1 className="display text-[40px] text-ink">Nothing at this address.</h1>
      <p className="max-w-md text-[15px] text-ink-2">Token pages take a 0x address launched through the router. Everything else lives on the pages below.</p>
      <div className="mt-2 flex gap-3">
        <Link href="/" className="btn btn-primary">Home</Link>
        <Link href="/tokens" className="btn btn-glass">Launches</Link>
      </div>
    </section>
  );
}
