export type PlanVersionMilestone = {
  id: string;
  priceMinor: number;
  startDate: string | null;
  endDate: string | null;
};

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

// What the client saw: currency, then milestone ids, prices and dates in plan order.
// FNV-1a 64 keeps core runtime-free; the version detects edits, it is not a secret.
export function planVersion(currency: string, milestones: readonly PlanVersionMilestone[]): string {
  const shape = milestones.map((m) => [m.id, m.priceMinor, m.startDate, m.endDate]);
  const text = JSON.stringify([currency, shape]);
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}
