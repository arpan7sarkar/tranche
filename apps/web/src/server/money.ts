import "server-only";

// ponytail: deep import until feat/h3-outbox publishes `@tranche/agents-service/money`; swap this one line then.
export {
  agreeToPlan,
  decideApproval,
  submitHumanAction,
} from "@tranche/agents-service/src/money/actions";
