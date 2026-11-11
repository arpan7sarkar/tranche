import { describe, expect, it } from "vitest";
import { assertOwnedDatabase, type DatabaseProof } from "../support/owned-database";

const proof: DatabaseProof = {
  containerId: "a".repeat(64),
  inspectedId: "a".repeat(64),
  running: true,
  image: "sha256:" + "b".repeat(64),
  expectedImage: "sha256:" + "b".repeat(64),
  imageName: "postgres:18",
  containerName: "tranche-e2e-" + "c".repeat(32),
  marker: "c".repeat(32),
  containerMarker: "c".repeat(32),
  databaseMarker: "c".repeat(32),
  databaseName: "postgres",
  port: 49152,
  bindings: [{ HostIp: "127.0.0.1", HostPort: "49152" }],
};

describe("owned E2E database proof", () => {
  it("accepts only the matching running fixture", () => {
    expect(() => assertOwnedDatabase(proof)).not.toThrow();
  });

  it.each([
    { containerId: "invalid" },
    { inspectedId: "d".repeat(64) },
    { running: false },
    { image: "sha256:" + "d".repeat(64) },
    { imageName: "other:18" },
    { containerName: "other" },
    { marker: "invalid" },
    { containerMarker: "d".repeat(32) },
    { databaseMarker: "d".repeat(32) },
    { databaseName: "other" },
    { port: 55432 },
    { bindings: [{ HostIp: "0.0.0.0", HostPort: "49152" }] },
    { bindings: [{ HostIp: "127.0.0.1", HostPort: "49153" }] },
    { bindings: [] },
    {
      bindings: [
        { HostIp: "127.0.0.1", HostPort: "49152" },
        { HostIp: "::", HostPort: "49152" },
      ],
    },
  ])("rejects mismatched ownership evidence %#", (change) => {
    expect(() => assertOwnedDatabase({ ...proof, ...change })).toThrow(
      "e2e_database_ownership_mismatch",
    );
  });
});
