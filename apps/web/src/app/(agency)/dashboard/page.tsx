import { DashboardStudio } from "./dashboard-studio";

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Cash flow</h1>
        <p className="text-sm text-foreground/60">
          Held, released and forecast payments across every deal, plus what your agents did.
        </p>
      </div>
      <DashboardStudio />
    </main>
  );
}
