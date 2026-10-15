import { describe, expect, it, vi } from "vitest";
import {
  checkRelease,
  productionCommit,
  workflowResult,
} from "../scripts/check-release";

const sha = "a".repeat(40);
const env = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_GIT_REPO_OWNER: "matheus-sperling",
  VERCEL_GIT_REPO_SLUG: "ReciclaProjeto",
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_GIT_COMMIT_SHA: sha,
};
const run = {
  id: 123,
  run_number: 1,
  head_sha: sha,
  head_branch: "main",
  event: "push",
  path: ".github/workflows/quality.yml",
  status: "completed",
  conclusion: "success",
  repository: { full_name: "matheus-sperling/ReciclaProjeto" },
  head_repository: { full_name: "matheus-sperling/ReciclaProjeto" },
};

function harness(responses: Response[]) {
  let time = 0;
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return {
    fetch,
    now: () => time,
    sleep: vi.fn(async (ms: number) => {
      time += ms;
    }),
    log: vi.fn(),
  };
}
function response(workflow_runs: object[]) {
  return Response.json({ workflow_runs });
}

describe("Guarda de publicação de produção", () => {
  it("dispensa rede local/preview e exige metadados confiáveis em produção", async () => {
    const dependencies = harness([]);
    await checkRelease({}, dependencies);
    await checkRelease({ VERCEL: "1", VERCEL_ENV: "preview" }, dependencies);
    expect(dependencies.fetch).not.toHaveBeenCalled();
    expect(productionCommit(env)).toBe(sha);
    for (const key of Object.keys(env)) {
      const incomplete: NodeJS.ProcessEnv = { ...env };
      delete incomplete[key];
      expect(() => productionCommit(incomplete)).toThrow();
    }
    for (const changed of [
      { VERCEL_GIT_COMMIT_SHA: "main" },
      { VERCEL_GIT_REPO_OWNER: "outro" },
      { VERCEL_GIT_REPO_SLUG: "outro" },
      { VERCEL_GIT_COMMIT_REF: "outra-branch" },
    ])
      expect(() => productionCommit({ ...env, ...changed })).toThrow();
  });

  it("aguarda execução do push/main do SHA exato e libera somente sucesso", async () => {
    const dependencies = harness([
      response([]),
      response([{ ...run, status: "in_progress", conclusion: null }]),
      response([run]),
    ]);
    await checkRelease(env, dependencies);
    expect(dependencies.sleep).toHaveBeenCalledTimes(2);
    const [url, options] = dependencies.fetch.mock.calls[0]!;
    expect(String(url)).toContain(`head_sha=${sha}&event=push&branch=main`);
    expect(options?.redirect).toBe("error");
    expect(options?.headers).not.toHaveProperty("Authorization");
  });

  it("não aceita aprovação de outro commit, PR, workflow ou repositório", () => {
    for (const changed of [
      { head_sha: "b".repeat(40) },
      { head_branch: "feature" },
      { event: "pull_request" },
      { path: ".github/workflows/outro.yml" },
      { repository: { full_name: "outro/repo" } },
      { head_repository: { full_name: "outro/repo" } },
    ])
      expect(() =>
        workflowResult({ workflow_runs: [{ ...run, ...changed }] }, sha),
      ).toThrow();
    for (const body of [
      null,
      {},
      { workflow_runs: "success" },
      { workflow_runs: [null] },
    ])
      expect(() => workflowResult(body, sha)).toThrow();
  });

  it("bloqueia falha, cancelamento, checks ignorados e falhas na API", async () => {
    for (const conclusion of [
      "failure",
      "cancelled",
      "skipped",
      "neutral",
      "timed_out",
      null,
    ]) {
      const dependencies = harness([response([{ ...run, conclusion }])]);
      await expect(checkRelease(env, dependencies)).rejects.toThrow(
        "publicação bloqueada",
      );
    }
    for (const status of [403, 429, 500])
      await expect(
        checkRelease(env, harness([new Response("", { status })])),
      ).rejects.toThrow(`HTTP ${status}`);
    await expect(
      checkRelease(env, harness([new Response("resposta inválida")])),
    ).rejects.toThrow();
    const disconnected = harness([]);
    disconnected.fetch.mockRejectedValue(new Error("sem rede"));
    await expect(checkRelease(env, disconnected)).rejects.toThrow("sem rede");
  });

  it("considera a execução mais recente e não reutiliza um sucesso anterior", () => {
    expect(() =>
      workflowResult(
        {
          workflow_runs: [
            run,
            { ...run, id: 124, run_number: 2, conclusion: "failure" },
          ],
        },
        sha,
      ),
    ).toThrow();
    expect(
      workflowResult(
        {
          workflow_runs: [
            run,
            {
              ...run,
              id: 124,
              run_number: 2,
              status: "queued",
              conclusion: null,
            },
          ],
        },
        sha,
      ),
    ).toBe("pending");
  });

  it("bloqueia quando nenhum resultado chega até o prazo", async () => {
    const dependencies = harness([]);
    dependencies.fetch.mockImplementation(async () => response([]));
    await expect(checkRelease(env, dependencies)).rejects.toThrow(
      "dez minutos",
    );
    expect(dependencies.fetch).toHaveBeenCalledTimes(20);
  });
});
