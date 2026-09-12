import type { Metadata } from "next";
import { LaunchForm } from "@/components/LaunchForm";

export const metadata: Metadata = {
  title: "Launch a token",
  description: "Launch on Pons V2 with the developer buy vesting and the creator fees locked until graduation.",
};

export default function LaunchPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <LaunchForm />
    </section>
  );
}
