import type { HoldMechanism } from "@tranche/contracts";

export const HONOR_DAYS = 3;
export const AUTH_VALID_DAYS = 29;
export const RENEW_AT_DAY = 27;
export const DELAYED_AUTO_DISBURSE_DAY = 28;
export const DELAYED_ALERT_DAY = 25;

const DAY_MS = 86_400_000;

export type RenewalAction =
  | { kind: "none" }
  | { kind: "reauthorize" }
  | { kind: "new_authorization" }
  | { kind: "alert"; daysLeft: number };

export function renewalAction(
  mechanism: HoldMechanism,
  anchorAt: string,
  now: string,
): RenewalAction {
  const elapsedDays = (Date.parse(now) - Date.parse(anchorAt)) / DAY_MS;
  if (mechanism === "delayed_disbursement") {
    return elapsedDays >= DELAYED_ALERT_DAY
      ? {
          kind: "alert",
          daysLeft: Math.max(0, Math.floor(DELAYED_AUTO_DISBURSE_DAY - elapsedDays)),
        }
      : { kind: "none" };
  }
  if (elapsedDays < HONOR_DAYS + 1) return { kind: "none" };
  if (elapsedDays < RENEW_AT_DAY) return { kind: "reauthorize" };
  return { kind: "new_authorization" };
}
