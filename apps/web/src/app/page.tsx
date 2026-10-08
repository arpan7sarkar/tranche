import { MilestoneState } from "@tranche/contracts";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Tranche</h1>
      <p className="text-lg text-foreground/70">
        Milestone-protected payments, run by an AI agent, settled on PayPal.
      </p>
      <p className="font-mono text-sm text-foreground/50">
        {MilestoneState.options.length} milestone states wired from @tranche/contracts
      </p>
    </main>
  );
}
