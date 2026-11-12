// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { AuthForm } from "./auth-form";

const mocks = vi.hoisted(() => ({ push: vi.fn(), signIn: vi.fn(async () => ({})) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: mocks.signIn } } }));
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("prevents a pre-hydration submission from putting credentials in the URL", () => {
  const markup = renderToStaticMarkup(<AuthForm mode="sign-in" />);
  const documentCopy = document.createElement("div");
  documentCopy.innerHTML = markup;
  expect(documentCopy.querySelector("form")?.method).toBe("post");
  expect(documentCopy.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
    true,
  );
});
it("enables sign-in after hydration and submits through the auth client", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<AuthForm mode="sign-in" />));
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  const email = container.querySelector<HTMLInputElement>("#email");
  const password = container.querySelector<HTMLInputElement>("#password");
  const form = container.querySelector("form");
  if (!button || !email || !password || !form) throw new Error("Missing form");
  expect(button.disabled).toBe(false);
  email.value = "fictional@example.com";
  password.value = "fictional-test-password";
  const submit = new Event("submit", { bubbles: true, cancelable: true });
  await act(async () => {
    form.dispatchEvent(submit);
  });
  expect(submit.defaultPrevented).toBe(true);
  expect(mocks.signIn).toHaveBeenCalledWith({
    email: "fictional@example.com",
    password: "fictional-test-password",
  });
  expect(mocks.push).toHaveBeenCalledWith("/deals");
});
