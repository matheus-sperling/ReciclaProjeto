import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = "matheus-sperling/ReciclaProjeto";
const workflow = ".github/workflows/quality.yml";
const waitLimitMs = 10 * 60 * 1000;
const pollIntervalMs = 30 * 1000;

type Run = {
  id: number;
  run_number: number;
  head_sha: string;
  head_branch: string;
  event: string;
  path: string;
  status: string;
  conclusion: string | null;
  repository: { full_name: string };
  head_repository: { full_name: string };
};
type Dependencies = {
  fetch: typeof globalThis.fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<unknown>;
  log: (message: string) => void;
};

// Git deployments expose these system variables before the build starts.
// Never treat missing production metadata as permission to publish.
export function productionCommit(env: NodeJS.ProcessEnv): string | null {
  if (env.VERCEL_ENV !== "production") {
    if (
      env.VERCEL === "1" &&
      env.VERCEL_ENV !== "preview" &&
      env.VERCEL_ENV !== "development"
    )
      throw new Error(
        "Ambiente Vercel ausente ou desconhecido; publicação bloqueada.",
      );
    return null;
  }
  if (
    env.VERCEL !== "1" ||
    `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` !== repository ||
    env.VERCEL_GIT_COMMIT_REF !== "main" ||
    !/^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || "")
  )
    throw new Error(
      "Produção exige o repositório autorizado, a main e o SHA completo do commit.",
    );
  return env.VERCEL_GIT_COMMIT_SHA!;
}

export function workflowResult(
  body: unknown,
  sha: string,
): "pending" | "success" {
  if (
    !body ||
    typeof body !== "object" ||
    !("workflow_runs" in body) ||
    !Array.isArray(body.workflow_runs)
  )
    throw new Error("Resposta inválida do GitHub; publicação bloqueada.");
  const runs = body.workflow_runs as Run[];
  for (const run of runs)
    if (
      !run ||
      !Number.isSafeInteger(run.id) ||
      !Number.isSafeInteger(run.run_number) ||
      run.head_sha !== sha ||
      run.head_branch !== "main" ||
      run.event !== "push" ||
      run.path !== workflow ||
      run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository
    )
      throw new Error(
        "Verificação do GitHub não corresponde ao commit de produção.",
      );
  const latest = runs.sort(
    (a, b) => b.run_number - a.run_number || b.id - a.id,
  )[0];
  if (!latest) return "pending";
  if (latest.status === "completed") {
    if (latest.conclusion === "success") return "success";
    throw new Error(
      `CI ${latest.conclusion || "sem conclusão"}; publicação bloqueada.`,
    );
  }
  if (
    !["queued", "in_progress", "requested", "waiting", "pending"].includes(
      latest.status,
    )
  )
    throw new Error("Estado de CI desconhecido; publicação bloqueada.");
  return "pending";
}

export async function checkRelease(
  env: NodeJS.ProcessEnv,
  dependencies: Dependencies = {
    fetch: globalThis.fetch,
    now: Date.now,
    sleep,
    log: console.log,
  },
): Promise<void> {
  const sha = productionCommit(env);
  if (!sha) {
    dependencies.log(
      "Guarda de publicação: ambiente local/preview; CI de produção não se aplica.",
    );
    return;
  }
  const url = new URL(
    `https://api.github.com/repos/${repository}/actions/workflows/quality.yml/runs`,
  );
  url.search = new URLSearchParams({
    head_sha: sha,
    event: "push",
    branch: "main",
    per_page: "100",
  }).toString();
  const deadline = dependencies.now() + waitLimitMs;
  while (dependencies.now() < deadline) {
    const response = await dependencies.fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ReciclaProjeto-release-check",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(
        Math.min(10000, deadline - dependencies.now()),
      ),
    });
    if (!response.ok)
      throw new Error(
        `GitHub indisponível (HTTP ${response.status}); publicação bloqueada.`,
      );
    if (workflowResult(await response.json(), sha) === "success") {
      dependencies.log(
        `CI quality.yml aprovada para ${sha}; build de produção liberado.`,
      );
      return;
    }
    dependencies.log(`Aguardando CI quality.yml do commit ${sha}.`);
    await dependencies.sleep(
      Math.min(pollIntervalMs, Math.max(0, deadline - dependencies.now())),
    );
  }
  throw new Error(
    "CI não aprovada em dez minutos; publicação bloqueada. Reexecute o deployment após a aprovação.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  checkRelease(process.env).catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Não foi possível verificar a CI; publicação bloqueada.",
    );
    process.exitCode = 1;
  });
