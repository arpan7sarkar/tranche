import "server-only";

// decideApproval stays out on purpose: use the scoped wrapper in ./approvals.
export {
  type AgreeToPlanResult,
  agreeToPlan,
  submitHumanAction,
} from "@tranche/agents-service/money";
