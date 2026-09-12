import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TokenView } from "@/components/TokenView";
import { isAddress } from "@/lib/format";
import { shortAddress } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/token/[address]">): Promise<Metadata> {
  const { address } = await params;
  return { title: `Token ${shortAddress(address)}`, description: "Market and locks, read live from Robinhood Chain." };
}

export default async function TokenPage({ params }: PageProps<"/token/[address]">) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <TokenView token={address} />
    </section>
  );
}
