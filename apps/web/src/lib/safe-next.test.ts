import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each(["/deals/abc?x=1", "/deals", "/approvals", "/deals/abc#section", "/"])(
    "keeps the same-origin path %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["a relative path without a leading slash", "deals"],
    ["an absolute https URL", "https://evil.com"],
    ["an absolute http URL with a path", "http://evil.com/deals"],
    ["a protocol-relative URL", "//evil.com"],
    ["a protocol-relative URL with a path", "//evil.com/deals"],
    ["a backslash host", "/\\evil.com"],
    ["a backslash after a slash prefix", "/\\/evil.com"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>1</script>"],
    ["a newline", "/deals\n//evil.com"],
    ["a carriage return", "/deals\r\nSet-Cookie: x=1"],
    ["a tab", "/\t/evil.com"],
    ["a NUL byte", "/deals\u0000"],
    ["a leading space before the slash", " /deals"],
  ])("falls back to /deals for %s", (_label, raw) => {
    expect(safeNextPath(raw)).toBe("/deals");
  });

  it("allows /%2F%2Fevil.com because it stays a path on this origin", () => {
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});
