const constraints = new Set([
  "$schema",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "multipleOf",
]);

// Keep the provider grammar small; the original Zod schema validates the response.
export function googleOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(googleOutputSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !constraints.has(key))
      .map(([key, child]) => [
        key,
        key === "properties" || key === "$defs" || key === "definitions"
          ? Object.fromEntries(
              Object.entries(child as Record<string, unknown>).map(([name, schema]) => [
                name,
                googleOutputSchema(schema),
              ]),
            )
          : googleOutputSchema(child),
      ]),
  );
}
