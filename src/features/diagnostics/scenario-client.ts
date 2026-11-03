export const DIAGNOSTIC_SCENARIOS = [
  "happy",
  "lost_ack",
  "stale_status",
  "delete_failure",
] as const;

export type DiagnosticScenario = (typeof DIAGNOSTIC_SCENARIOS)[number];

export type ScenarioStatus = {
  mode: DiagnosticScenario;
  createRequests: number;
  newJobs: number;
  duplicateHits: number;
  deleteRequests: number;
};

const SCENARIO_SET = new Set<string>(DIAGNOSTIC_SCENARIOS);

export async function readScenarioStatus(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScenarioStatus> {
  const response = await fetchImpl(`${trimBase(baseUrl)}/__test/state`);
  if (!response.ok)
    throw new Error("The mock diagnostics endpoint did not respond.");
  return parseScenarioStatus(await response.json());
}

export async function resetMockState(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${trimBase(baseUrl)}/__test/reset`, {
    method: "POST",
  });
  if (!response.ok) throw new Error("The mock did not reset.");
}

export async function setScenario(
  baseUrl: string,
  mode: DiagnosticScenario,
  fetchImpl: typeof fetch = fetch,
): Promise<DiagnosticScenario> {
  const response = await fetchImpl(`${trimBase(baseUrl)}/__test/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error("The mock did not accept the scenario.");
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !isScenario((payload as { mode?: unknown }).mode)
  ) {
    throw new Error("The mock returned an unknown scenario.");
  }
  return (payload as { mode: DiagnosticScenario }).mode;
}

export function parseScenarioStatus(payload: unknown): ScenarioStatus {
  if (!payload || typeof payload !== "object")
    throw new Error("The mock returned an unreadable status.");
  const value = payload as { mode?: unknown; stats?: unknown };
  if (
    !isScenario(value.mode) ||
    !value.stats ||
    typeof value.stats !== "object"
  ) {
    throw new Error("The mock returned an unreadable status.");
  }
  const stats = value.stats as Record<string, unknown>;
  return {
    mode: value.mode,
    createRequests: count(stats.createRequests),
    newJobs: count(stats.newJobs),
    duplicateHits: count(stats.duplicateHits),
    deleteRequests: count(stats.deleteRequests),
  };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isScenario(value: unknown): value is DiagnosticScenario {
  return typeof value === "string" && SCENARIO_SET.has(value);
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}
