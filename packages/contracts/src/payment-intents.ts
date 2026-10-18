import { z } from "zod";
import { Money } from "./money";
import { HoldMechanism } from "./states";

export const FundingOrderIntent = z.object({
  mechanism: HoldMechanism,
  amount: Money,
  platformFee: Money,
  payeeMerchantId: z.string().min(1),
  milestoneId: z.uuid(),
  vaultId: z.string().nullable(),
  returnUrl: z.url(),
  cancelUrl: z.url(),
});
export const FundingOrderResponse = z.object({
  orderId: z.string().min(1),
  approveUrl: z.url().nullable(),
  status: z.string().min(1),
});
export const SellerReferralIntent = z.object({
  trackingId: z.uuid(),
  returnUrl: z.url(),
  mechanism: HoldMechanism,
});
export const SellerReferralResponse = z.object({ actionUrl: z.url() });
export const WebhookRegistrationIntent = z.object({
  url: z.url(),
  events: z.array(z.string().min(1)).min(1),
});
