import { execFileSync } from "node:child_process";
import { createDb } from "@tranche/db";
import { databaseUrl, fixture } from "./environment";
import { assertOwnedDatabase, type DatabaseProof } from "./owned-database";

export async function openFixtureDb() {
  const output = execFileSync("docker", ["inspect", fixture.containerId], {
    env: { HOME: process.env.HOME, PATH: process.env.PATH },
    encoding: "utf8",
  });
  const [container] = JSON.parse(output);
  const proof: DatabaseProof = {
    containerId: fixture.containerId,
    inspectedId: container.Id,
    running: container.State.Running,
    image: container.Image,
    expectedImage: fixture.imageId,
    imageName: container.Config.Image,
    containerName: container.Name.replace(/^\//, ""),
    marker: fixture.marker,
    containerMarker: container.Config.Labels?.["tranche.e2e.marker"],
    databaseMarker: fixture.marker,
    databaseName: "postgres",
    port: fixture.port,
    bindings: container.NetworkSettings.Ports["5432/tcp"] ?? [],
  };
  assertOwnedDatabase(proof);
  const db = createDb(databaseUrl);
  try {
    const [identity] =
      await db.$client`select current_database() as database, current_setting('tranche.e2e_fixture', true) as marker`;
    assertOwnedDatabase({
      ...proof,
      databaseName: identity?.database,
      databaseMarker: identity?.marker,
    });
    return db;
  } catch (error) {
    await db.$client.end();
    throw error;
  }
}
