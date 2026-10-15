import { renewHandler } from "./holds-renew";
import type { OutboxHandler } from "./outbox";
import { fundHandler } from "./timers-fund";

export const timerOutboxHandlers: { fund: OutboxHandler; renew_hold: OutboxHandler } = {
  fund: fundHandler,
  renew_hold: renewHandler,
};
