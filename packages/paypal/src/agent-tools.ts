import { createMCPClient } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/mcp";
import { createTransport, type PayPalConfig } from "./http";

const READ_ONLY_ACTIONS = {
  orders: { get: true },
  disputes: { list: true, get: true },
  transactions: { list: true },
  invoices: { list: true, get: true, search: true },
  insights: { get: true },
  payments: { getRefunds: true },
  shipment: { get: true },
};

export const READ_ONLY_TOOL_NAMES = [
  "get_dispute",
  "get_invoice",
  "get_merchant_insights",
  "get_order",
  "get_refund",
  "get_shipment_tracking",
  "list_disputes",
  "list_invoices",
  "list_transactions",
  "search_invoicing",
] as const;

export async function readOnlyPayPalTools(config: PayPalConfig) {
  const accessToken = await createTransport(config).accessToken();
  const server = new PayPalAgentToolkit({
    accessToken,
    configuration: {
      actions: READ_ONLY_ACTIONS,
      // The toolkit has no base URL override; Tranche is sandbox-only, so never let it pick live.
      context: { sandbox: true },
    },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = await createMCPClient({ transport: clientSide });
  const close = async () => {
    await mcp.close();
    await server.close();
  };

  const tools = await mcp.tools();
  const allowed: readonly string[] = READ_ONLY_TOOL_NAMES;
  const unexpected = Object.keys(tools).filter((name) => !allowed.includes(name));
  if (unexpected.length > 0) {
    await close();
    throw new Error(`Refusing PayPal tools that are not read-only: ${unexpected.join(", ")}`);
  }
  return { tools, close };
}
