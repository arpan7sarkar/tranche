import type { HoldMechanism, Money } from "@tranche/contracts";
import type { Db } from "@tranche/db";

// Local stand-in for `PayPal` from @tranche/paypal (H2 Tasks 2-4). Replace with
// `import type { PayPal } from "@tranche/paypal"` once H2 merges.
type Hold = {
  status: "active";
  captureId: string | null;
  authorizationId: string | null;
  expiresAt: string;
  honorExpiresAt: string | null;
  vaultId: string | null;
};
type PendingHold = {
  status: "pending";
  captureId: string | null;
  authorizationId: string | null;
  vaultId: string | null;
};
type PlacedHold = Hold | PendingHold;
export type PayPal = {
  getOrder(orderId: string): Promise<{
    id: string;
    status: string;
    links?: Array<{ href: string; rel: string }>;
  }>;
  createFundingOrder(input: {
    requestId: string;
    mechanism: HoldMechanism;
    amount: Money;
    platformFee: Money;
    payeeMerchantId: string;
    milestoneId: string;
    vaultId: string | null;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ orderId: string; approveUrl: string | null; status: string }>;
  placeHold(input: {
    requestId: string;
    orderId: string;
    mechanism: HoldMechanism;
  }): Promise<PlacedHold>;
  renewHold(input: {
    requestId: string;
    authorizationId: string;
    amount: Money;
    payeeMerchantId?: string;
  }): Promise<{ authorizationId: string; expiresAt: string; honorExpiresAt: string }>;
  releaseHold(input: {
    requestId: string;
    mechanism: HoldMechanism;
    captureId: string | null;
    authorizationId: string | null;
    amount: Money;
    platformFee?: Money;
    payeeMerchantId?: string;
  }): Promise<{ releaseRef: string }>;
  voidHold(input: {
    requestId: string;
    mechanism: HoldMechanism;
    authorizationId: string | null;
    captureId: string | null;
    platformFee?: Money;
    payeeMerchantId?: string;
  }): Promise<void>;
  sendPayouts(input: {
    requestId: string;
    items: Array<{ email: string; amount: Money; note: string }>;
  }): Promise<{ batchId: string }>;
  verifyWebhook(input: {
    headers: Record<string, string>;
    rawBody: string;
    webhookId: string;
  }): Promise<boolean>;
  submitDisputeEvidence(input: {
    requestId: string;
    disputeId: string;
    notes: string;
    payeeMerchantId?: string;
  }): Promise<void>;
};

export type Deps = { db: Db; paypal: PayPal; now: () => Date };
