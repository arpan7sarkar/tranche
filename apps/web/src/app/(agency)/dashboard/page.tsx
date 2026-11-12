import { DashboardStudio } from "./dashboard-studio";

export default function DashboardPage() {
  return (
    <div className="flex min-w-0 w-full flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-baseline lg:justify-between lg:gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Cash flow</h1>
        <p className="text-sm text-foreground/60">
          Held, released and forecast payments across every deal, plus what your agents did.
        </p>
      </div>
      <DashboardStudio />
    </div>
  );
}
