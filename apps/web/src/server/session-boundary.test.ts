import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), headers: vi.fn(), session: vi.fn() }));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("./auth", () => ({ auth: { api: { getSession: mocks.session } } }));

import { getMember, memberOrNull } from "./session";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.session.mockResolvedValue(null);
});

it("waits for request-time rendering before the auth library can read the clock", async () => {
  let enterRequest: () => void = () => {};
  mocks.connection.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        enterRequest = resolve;
      }),
  );
  const result = getMember();
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  enterRequest();
  expect(await result).toBeNull();
  expect(mocks.session).toHaveBeenCalledOnce();
});

it("keeps route-handler authentication bound to the explicit request", async () => {
  const request = new Request("http://localhost/api/deals");
  expect(await memberOrNull(request)).toBeNull();
  expect(mocks.session).toHaveBeenCalledWith({ headers: request.headers });
  expect(mocks.connection).not.toHaveBeenCalled();
});
