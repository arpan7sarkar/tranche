export type DatabaseProof = {
  containerId: string;
  inspectedId: string;
  running: boolean;
  image: string;
  expectedImage: string;
  imageName: string;
  containerName: string;
  marker: string;
  containerMarker: string;
  databaseMarker: string;
  databaseName: string;
  port: number;
  bindings: { HostIp: string; HostPort: string }[];
};

export function assertOwnedDatabase(proof: DatabaseProof): void {
  if (
    !/^[a-f0-9]{64}$/.test(proof.containerId) ||
    proof.inspectedId !== proof.containerId ||
    !proof.running ||
    !/^sha256:[a-f0-9]{64}$/.test(proof.expectedImage) ||
    proof.image !== proof.expectedImage ||
    proof.imageName !== "postgres:18" ||
    !/^[a-f0-9]{32}$/.test(proof.marker) ||
    proof.containerName !== `tranche-e2e-${proof.marker}` ||
    proof.containerMarker !== proof.marker ||
    proof.databaseMarker !== proof.marker ||
    proof.databaseName !== "postgres" ||
    !Number.isInteger(proof.port) ||
    proof.port < 1 ||
    proof.port > 65535 ||
    proof.port === 55432 ||
    proof.bindings.length !== 1 ||
    proof.bindings[0]?.HostIp !== "127.0.0.1" ||
    proof.bindings[0]?.HostPort !== String(proof.port)
  ) {
    throw new Error("e2e_database_ownership_mismatch");
  }
}
