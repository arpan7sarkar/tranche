import { describe, expect, it } from "vitest";
import { platformFee } from "./fees";

describe("platformFee", () => {
  it("takes 2% rounded down", () => {
    expect(platformFee({ currency: "USD", minor: 100000 })).toEqual({
      currency: "USD",
      minor: 2000,
    });
    expect(platformFee({ currency: "USD", minor: 149 })).toEqual({ currency: "USD", minor: 2 });
    expect(platformFee({ currency: "JPY", minor: 49 })).toEqual({ currency: "JPY", minor: 0 });
  });
});
