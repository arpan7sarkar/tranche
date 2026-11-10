import "server-only";

import { agreeToPlan as agree, submitHumanAction as submit } from "@tranche/agents-service/money";
import { requireWebMoneyEnabled } from "./money-gate";

export type { AgreeToPlanResult } from "@tranche/agents-service/money";

export function agreeToPlan(...args: Parameters<typeof agree>): ReturnType<typeof agree> {
  requireWebMoneyEnabled();
  return agree(...args);
}

export function submitHumanAction(...args: Parameters<typeof submit>): ReturnType<typeof submit> {
  requireWebMoneyEnabled();
  return submit(...args);
}
