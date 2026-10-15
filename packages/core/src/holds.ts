import type { HoldMechanism } from "@tranche/contracts";

export const HONOR_DAYS = 3;
export const AUTH_VALID_DAYS = 29;
export const RENEW_AT_DAY = 27;
export const DELAYED_AUTO_DISBURSE_DAY = 27;
export const DELAYED_ALERT_DAY = 25;

const DAY_MS = 86_400_000;

export type RenewalAction =
  | { kind: "none" }
  | { kind: "reauthorize" }
  | { kind: "new_authorization" }
  | { kind: "alert"; daysLeft: number };

function daysSince(anchorAt: string, now: string): number {
  const elapsed = Date.parse(now) - Date.parse(anchorAt);
  if (Number.isNaN(elapsed)) throw new Error(`Invalid timestamp: anchor ${anchorAt}, now ${now}`);
  return elapsed / DAY_MS;
}

export function renewalAction(
  mechanism: HoldMechanism,
  anchorAt: string,
  now: string,
  lastReauthorizedAt?: string | null,
): RenewalAction {
  const elapsedDays = daysSince(anchorAt, now);
  if (mechanism === "delayed_disbursement") {
    return elapsedDays >= DELAYED_ALERT_DAY
      ? {
          kind: "alert",
          daysLeft: Math.max(0, DELAYED_AUTO_DISBURSE_DAY - Math.floor(elapsedDays)),
        }
      : { kind: "none" };
  }
  if (elapsedDays >= RENEW_AT_DAY) return { kind: "new_authorization" };
  if (elapsedDays < HONOR_DAYS + 1) return { kind: "none" };
  if (lastReauthorizedAt) {
    daysSince(lastReauthorizedAt, now);
    return { kind: "none" };
  }
  return { kind: "reauthorize" };
}
