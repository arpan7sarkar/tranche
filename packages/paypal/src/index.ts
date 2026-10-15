export {
  type AuthorizationRes,
  approveUrlOf,
  type CaptureRes,
  createPayPalClient,
  type Hold,
  holdFromOrder,
  type OrderRes,
  type PayPal,
} from "./client";
export { PayPalError } from "./errors";
export { PLATFORM_FEE_BPS, platformFeeFor } from "./fees";
export { authAssertion, createTransport, type PayPalConfig, type Transport } from "./http";
export * from "./onboarding";
export { PAYPAL_OUTBOX_KINDS, type PayPalOutboxKind, runPayPalOutbox } from "./outbox";
export * from "./protection";
export * from "./sandbox-client";
export { PAYPAL_WEBHOOK_EVENTS } from "./webhook-events";
