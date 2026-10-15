// What to do with a milestone's pending PayPal order before starting a new one.
// Shared by the portal fund route and the timer fund handler so both decide the same way.
export type PendingOrderVerdict =
  | "reuse" // still waiting for the buyer
  | "confirming" // paid at PayPal, our hold is not settled yet: enqueue place_hold, never fail it
  | "wait" // a state we do not act on: create nothing
  | "dead"; // safe to mark failed and create a new order

const AWAITING_BUYER = new Set(["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"]);

export function pendingOrderVerdict(
  orderStatus: string | null,
  holdExpiresAt: Date,
  now: Date,
): PendingOrderVerdict {
  if (orderStatus === null || orderStatus === "VOIDED") return "dead";
  if (orderStatus === "COMPLETED") return "confirming";
  if (AWAITING_BUYER.has(orderStatus)) return holdExpiresAt <= now ? "dead" : "reuse";
  return "wait";
}
