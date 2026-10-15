import { afterEach, describe, expect, it, vi } from "vitest";
import { READ_ONLY_TOOL_NAMES, readOnlyPayPalTools } from "./agent-tools";
import { CONFIG, mockPayPal } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("readOnlyPayPalTools", () => {
  it("exposes exactly the read-only PayPal tools", async () => {
    mockPayPal([]);
    const { tools, close } = await readOnlyPayPalTools(CONFIG);
    try {
      const names = Object.keys(tools).sort();
      expect(names).toEqual([...READ_ONLY_TOOL_NAMES].sort());
      for (const name of names) expect(name).toMatch(/^(get|list|search)_/);
    } finally {
      await close();
    }
  });
});
