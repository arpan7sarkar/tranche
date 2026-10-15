import "server-only";
import { Render } from "@renderinc/sdk";

let render: Render | undefined;

// Best effort: the every-minute cron runs the money tick anyway, this only shortens the wait.
export function kickMoneyTick(): void {
  const slug = process.env.RENDER_WORKFLOW_SLUG;
  if (!slug || !process.env.RENDER_API_KEY) return;
  render ??= new Render();
  render.workflows.startTask(`${slug}/moneyTick`, []).catch((err: unknown) => {
    console.error("kickMoneyTick failed", err);
  });
}
