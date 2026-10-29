export const AGENT_TICK_TASKS: readonly { name: string; everyMinutes: number }[] = [
  { name: "consumeAll", everyMinutes: 1 },
  { name: "monitor", everyMinutes: 5 },
  { name: "notifications", everyMinutes: 1 },
];
