import type { Db } from "@tranche/db";
import type { PayPal } from "@tranche/paypal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveMagicLink: vi.fn(),
  memberOrNull: vi.fn(),
  agreeToPlan: vi.fn(),
  submitHumanAction: vi.fn(),
  decideApproval: vi.fn(),
  startDurableFunding: vi.fn(),
  verifyWebhook: vi.fn(),
  createFundingOrder: vi.fn(),
  getOrder: vi.fn(),
  kickMoneyTick: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@tranche/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tranche/db")>()),
  resolveMagicLink: mocks.resolveMagicLink,
}));
vi.mock("@tranche/agents-service/money", () => ({
  agreeToPlan: mocks.agreeToPlan,
  submitHumanAction: mocks.submitHumanAction,
  decideApproval: mocks.decideApproval,
  startDurableFunding: mocks.startDurableFunding,
}));
vi.mock("@/server/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/session", () => ({ memberOrNull: mocks.memberOrNull }));
vi.mock("@/server/kick", () => ({ kickMoneyTick: mocks.kickMoneyTick }));
vi.mock("@/server/paypal", () => ({
  getPayPal: () => ({
    verifyWebhook: mocks.verifyWebhook,
    createFundingOrder: mocks.createFundingOrder,
    getOrder: mocks.getOrder,
  }),
  holdMechanism: () => "authorization",
  appUrl: () => "https://app.test",
}));

import { POST as decideAgency } from "@/app/api/approvals/[id]/decide/route";
import { POST as agree } from "@/app/api/portal/[token]/agree/route";
import { POST as decideClient } from "@/app/api/portal/[token]/approvals/[id]/decide/route";
import { POST as fund } from "@/app/api/portal/[token]/milestones/[milestoneId]/fund/route";
import { POST as release } from "@/app/api/portal/[token]/milestones/[milestoneId]/release/route";
import { POST as orderApproved } from "@/app/api/portal/[token]/orders/[orderId]/approved/route";
import { POST as fakeApprove } from "@/app/api/portal/[token]/orders/[orderId]/fake-approve/route";
import { PATCH as policy } from "@/app/api/portal/[token]/policy/route";
import { POST as webhook } from "@/app/api/webhooks/paypal/route";
import { decideApproval } from "./approvals";
import { confirmApproval, enqueuePlaceHold, startFunding } from "./funding";
import { agreeToPlan, submitHumanAction } from "./money";
import { WebMoneyDisabledError } from "./money-gate";
import {
  agreeFromPortal,
  setAutoRelease,
  submitClientRelease,
  submittedClientReleases,
} from "./portal";

const id = "11111111-1111-4111-8111-111111111111";
const disabledValues = [undefined, "", "false", "TRUE", "1", " true", "true "] as const;
const link = { dealId: id, clientId: id };
const paypal = {
  createFundingOrder: mocks.createFundingOrder,
  getOrder: mocks.getOrder,
} as unknown as PayPal;
const fetchFake = vi.fn();
let rows: unknown[][];
let writes: ReturnType<typeof vi.fn<(value: unknown) => void>>;
let db: Db;

function chain() {
  return Object.assign(
    Promise.resolve().then(() => rows.shift() ?? []),
    {
      from() {
        return this;
      },
      innerJoin() {
        return this;
      },
      leftJoin() {
        return this;
      },
      where() {
        return this;
      },
      for() {
        return this;
      },
      orderBy() {
        return this;
      },
      set() {
        return this;
      },
      values(value: unknown) {
        writes(value);
        return this;
      },
      onConflictDoNothing() {
        return this;
      },
    },
  );
}

function setupDb() {
  const fake = {
    select: vi.fn(() => chain()),
    insert: vi.fn(() => {
      writes("insert");
      return chain();
    }),
    update: vi.fn(() => {
      writes("update");
      return chain();
    }),
    transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(fake)),
  };
  return fake as unknown as Db;
}

type Route = (request: Request, context: never) => Promise<Response>;
function call(route: Route, body: unknown = {}) {
  return route(
    new Request("https://app.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({ token: "test-token", id, milestoneId: id, orderId: "ORDER12345" }),
    } as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  writes = vi.fn();
  db = setupDb();
  mocks.getDb.mockReturnValue(db);
  mocks.resolveMagicLink.mockResolvedValue(link);
  mocks.memberOrNull.mockResolvedValue({ userId: "user", workspaceId: id });
  mocks.agreeToPlan.mockResolvedValue("agreed");
  mocks.submitHumanAction.mockResolvedValue({ created: true });
  mocks.decideApproval.mockResolvedValue(undefined);
  mocks.verifyWebhook.mockResolvedValue(true);
  fetchFake.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchFake);
  vi.stubEnv("WEB_MONEY_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_E2E_FAKE_PAYPAL", "1");
  vi.stubEnv("PAYPAL_API_BASE", "http://fake.invalid");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "synthetic-webhook-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("web money interlock", () => {
  it.each(disabledValues)(
    "denies direct money functions for flag %j before writes or provider calls",
    async (value) => {
      vi.stubEnv("WEB_MONEY_ENABLED", value);
      const funding = {
        dealId: id,
        milestoneId: id,
        mechanism: "authorization" as const,
        appUrl: "https://app.test",
        portalToken: "token",
      };
      const attempts = [
        () => startFunding(db, paypal, funding),
        () => confirmApproval(db, paypal, { dealId: id, orderId: "ORDER12345" }),
        () => enqueuePlaceHold(db, id),
        () => agreeToPlan(db, id, "version"),
        () => agreeFromPortal(db, { dealId: id, planVersion: "version" }),
        () => submitHumanAction(db, {} as never),
        () => setAutoRelease(db, { dealId: id, hours: 24 }),
      ];
      for (const attempt of attempts) {
        await expect(async () => {
          await attempt();
        }).rejects.toBeInstanceOf(WebMoneyDisabledError);
      }
      expect(writes).not.toHaveBeenCalled();
      expect(mocks.createFundingOrder).not.toHaveBeenCalled();
      expect(mocks.getOrder).not.toHaveBeenCalled();
      expect(mocks.startDurableFunding).not.toHaveBeenCalled();
      expect(mocks.agreeToPlan).not.toHaveBeenCalled();
      expect(mocks.submitHumanAction).not.toHaveBeenCalled();
    },
  );

  it.each(disabledValues)(
    "denies web routes for flag %j without money side effects",
    async (value) => {
      vi.stubEnv("WEB_MONEY_ENABLED", value);
      const cases: [Route, unknown, unknown[][]][] = [
        [fund as Route, {}, []],
        [orderApproved as Route, {}, []],
        [
          release as Route,
          {},
          [
            [
              {
                state: "release_pending",
                version: 1,
                heldMinor: 100,
                releasedMinor: 0,
                currency: "USD",
              },
            ],
            [{ n: 0 }],
          ],
        ],
        [agree as Route, { planVersion: "version" }, []],
        [decideAgency as Route, { decision: "approved" }, [[{ decision: null }]]],
        [decideClient as Route, { decision: "approved" }, [[{ decision: null }]]],
        [policy as Route, { autoReleaseAfterHours: 24 }, []],
        [fakeApprove as Route, {}, [[{ id }]]],
      ];
      for (const [route, body, resultRows] of cases) {
        rows = resultRows;
        const response = await call(route, body);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: "payments_disabled" });
      }
      expect(writes).not.toHaveBeenCalled();
      expect(mocks.createFundingOrder).not.toHaveBeenCalled();
      expect(mocks.getOrder).not.toHaveBeenCalled();
      expect(mocks.submitHumanAction).not.toHaveBeenCalled();
      expect(mocks.agreeToPlan).not.toHaveBeenCalled();
      expect(mocks.decideApproval).not.toHaveBeenCalled();
      expect(fetchFake).not.toHaveBeenCalled();
    },
  );

  it("denies direct release and approval before their mutations", async () => {
    rows = [
      [{ state: "release_pending", version: 1, heldMinor: 100, releasedMinor: 0, currency: "USD" }],
      [{ n: 0 }],
    ];
    await expect(submitClientRelease(db, { dealId: id, milestoneId: id })).rejects.toBeInstanceOf(
      WebMoneyDisabledError,
    );
    rows = [[{ decision: null }]];
    await expect(
      decideApproval(db, {
        approvalId: id,
        decision: "approved",
        decider: { side: "agency", workspaceId: id, userId: "user" },
      }),
    ).rejects.toBeInstanceOf(WebMoneyDisabledError);
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.submitHumanAction).not.toHaveBeenCalled();
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("only accepts exact true and delegates to the real money boundary", async () => {
    vi.stubEnv("WEB_MONEY_ENABLED", "true");
    await agreeToPlan(db, id, "version");
    expect(mocks.agreeToPlan).toHaveBeenCalledWith(db, id, "version");
    await submitHumanAction(db, {} as never);
    expect(mocks.submitHumanAction).toHaveBeenCalledOnce();
  });

  it.each([decideAgency as Route, decideClient as Route])(
    "allows rejection while payments are disabled",
    async (route) => {
      rows = [[{ decision: null }], [{ decision: "rejected" }]];
      const response = await call(route, { decision: "rejected" });
      expect(response.status).toBe(200);
      expect(mocks.decideApproval).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ decision: "rejected" }),
      );
    },
  );

  it("allows disabling auto-release while payments are disabled", async () => {
    rows = [[{ policy: { autoReleaseAfterHours: 24 } }]];
    const response = await call(policy as Route, { autoReleaseAfterHours: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ policy: { autoReleaseAfterHours: null } });
    expect(writes).toHaveBeenCalledWith("update");
  });

  it("allows read-only release history while payments are disabled", async () => {
    rows = [[{ milestoneId: id }]];
    expect(await submittedClientReleases(db, id)).toEqual(new Set([id]));
    expect(writes).not.toHaveBeenCalled();
  });

  it("accepts verified webhook intake while payments are disabled", async () => {
    const body = JSON.stringify({ id: "event-test", event_type: "TEST.EVENT", resource: {} });
    const response = await webhook(
      new Request("https://app.test/webhook", { method: "POST", body }),
    );
    expect(response.status).toBe(200);
    expect(mocks.verifyWebhook).toHaveBeenCalledWith(expect.objectContaining({ rawBody: body }));
    expect(writes).toHaveBeenCalledWith(
      expect.objectContaining({ source: "paypal", sourceEventId: "event-test" }),
    );
  });

  it("rejects invalid webhook signatures before inbox writes", async () => {
    mocks.verifyWebhook.mockResolvedValue(false);
    const response = await webhook(
      new Request("https://app.test/webhook", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(400);
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.kickMoneyTick).not.toHaveBeenCalled();
  });
});
