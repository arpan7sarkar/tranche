export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.TRANCHE_DEPLOYMENT === "1") {
    const { assertDeployment } = await import("@tranche/agents-service/deployment");
    assertDeployment("web");
  }
}
