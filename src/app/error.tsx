"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto flex max-w-7xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <p className="label">Error</p>
      <h1 className="display text-[40px] text-ink">Something broke on our side.</h1>
      <p className="mono max-w-lg break-words text-xs text-ink-3">{error.message}</p>
      <button type="button" className="btn btn-glass" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
