import { Render } from "@renderinc/sdk";
export async function launch(
  taskName: string,
  args: unknown[],
  idempotencyKey: string,
  inline: () => Promise<unknown>,
): Promise<void> {
  const slug = process.env.RENDER_WORKFLOW_SLUG;
  const key = process.env.RENDER_API_KEY;
  if (!taskName || !idempotencyKey) throw new Error("task_identity_required");
  if (slug || key) {
    if (!slug || !key) throw new Error("incomplete_workflow_configuration");
    await new Render().workflows.startTask(`${slug}/${taskName}`, args, { idempotencyKey });
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("workflow_configuration_required");
    await inline();
  }
}
