import { expect, it } from "vitest";
import { googleOutputSchema } from "./google-schema";

it("preserves named fields and union shapes while removing decoder constraints", () => {
  expect(
    googleOutputSchema({
      type: "object",
      required: ["minimum"],
      properties: {
        minimum: { type: "integer", minimum: 1, maximum: 10 },
        choice: { oneOf: [{ type: "string", enum: ["yes"] }, { type: "null" }] },
      },
      additionalProperties: false,
    }),
  ).toEqual({
    type: "object",
    required: ["minimum"],
    properties: {
      minimum: { type: "integer" },
      choice: { oneOf: [{ type: "string", enum: ["yes"] }, { type: "null" }] },
    },
    additionalProperties: false,
  });
});
