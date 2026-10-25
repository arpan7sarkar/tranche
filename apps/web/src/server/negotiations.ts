import "server-only";
import { runNegotiation } from "@tranche/agents";
import { launch } from "@tranche/agents-service/launch";
import { getDb } from "./db";

export { latestNegotiation, loadNegotiationView, startNegotiation } from "@tranche/agents";
export async function kickNegotiation(id: string) {
  try {
    await launch("runNegotiation", [id], `negotiation:${id}`, () => runNegotiation(getDb(), id));
  } catch {
    // The durable negotiation.started event is retried by the consumer.
    console.info(JSON.stringify({ msg: "negotiation.deferred", negotiationId: id }));
  }
}
