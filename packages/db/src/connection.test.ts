import { afterEach, expect, it, vi } from "vitest";
import { createDb, databaseTlsOptions } from "./index";

afterEach(() => vi.unstubAllEnvs());
it("pins TLS verification to the database DNS hostname", () => {
  vi.stubEnv("DATABASE_SSL", "verify-full");
  vi.stubEnv("DATABASE_CA_CERT", "public-certificate");
  expect(databaseTlsOptions("postgres://user:password@db.example.com/tranche")).toEqual({
    rejectUnauthorized: true,
    servername: "db.example.com",
    ca: "public-certificate",
  });
});
it("rejects IP URLs rather than silently skipping hostname verification", () => {
  vi.stubEnv("DATABASE_SSL", "verify-full");
  for (const host of ["127.0.0.1", "[::1]"]) {
    expect(() => createDb(`postgres://user:password@${host}/tranche`)).toThrow(
      "verified_database_tls_requires_dns_hostname",
    );
  }
});
it("rejects connection-string options that could replace the trusted TLS configuration", () => {
  vi.stubEnv("DATABASE_SSL", "verify-full");
  expect(() =>
    databaseTlsOptions("postgres://user:password@db.example.com/tranche?sslmode=disable"),
  ).toThrow("database_url_tls_overrides_forbidden");
});
