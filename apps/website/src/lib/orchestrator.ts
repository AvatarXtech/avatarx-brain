import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";

const urls = {
  agents: process.env.AGENTS_URL ?? "http://127.0.0.1:4101",
  analytics: process.env.ANALYTICS_URL ?? "http://127.0.0.1:4102",
  intelligence: process.env.INTELLIGENCE_URL ?? "http://127.0.0.1:4103",
  knowledge: process.env.KNOWLEDGE_URL ?? "http://127.0.0.1:4104",
  memory: process.env.MEMORY_URL ?? "http://127.0.0.1:4105",
  neuron: process.env.NEURON_URL ?? "http://127.0.0.1:4106",
};

const fallbackKnowledge = [{ id: "phase3-architecture", title: "Avatar X Phase 3 Architecture", content: "Avatar X Phase 3 connects seven adaptive systems: a cognitive control plane, multi-agent planning, measurable analytics, feedback-aware intelligence routing, reranked knowledge evidence, consent-first adaptive memory, and a resilient Neuron model gateway.", scope: "internal-approved" }, { id: "memory-consent", title: "Avatar X Memory Policy", content: "Long-term memory requires explicit user consent. Memories are isolated by user and Avatar, can be corrected or deleted, and are consolidated with transparent salience and conflict links.", scope: "internal-approved" }];

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T | null> {
  try {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    const timestamp = Date.now().toString();
    const secret = process.env.SERVICE_AUTH_SECRET;
    const authHeaders: Record<string, string> = secret ? {
      "x-avatarx-service": "avatarx-brain",
      "x-avatarx-timestamp": timestamp,
      "x-avatarx-signature": createHmac("sha256", secret).update(`${method}\n${new URL(path, "http://avatarx.local").pathname}\n${timestamp}\n${createHash("sha256").update(body).digest("hex")}`).digest("hex"),
    } : {};
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    for (const [name, value] of Object.entries(authHeaders)) headers.set(name, value);
    const response = await fetch(`${base}${path}`, { ...init, method, signal: AbortSignal.timeout(3500), headers });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch { return null; }
}

function fallbackSearch(query: string) {
  const words = new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return fallbackKnowledge.map((document) => { const tokens = document.content.toLowerCase().match(/[a-z0-9]+/g) ?? []; const hits = tokens.filter((token) => words.has(token)).length; return { id: document.id, title: document.title, snippet: document.content, score: Math.min(1, hits / Math.max(3, words.size)), citation: `knowledge://${document.id}` }; }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}

export async function runAvatar(input: { userId: string; avatarId: string; message: string; remember?: boolean }) {
  const started = Date.now(); const traceId = randomUUID(); const scope = "internal-approved"; const tenant = "avatarx-phase7"; const tenantHeaders = { "x-avatarx-tenant": tenant, "x-avatarx-roles": "reader,operator" };
  const [manifest, memories, search] = await Promise.all([
    request<Record<string, unknown>>(urls.agents, `/v1/avatars/${encodeURIComponent(input.avatarId)}`),
    request<{ memories?: Array<{ content?: string }> }>(urls.memory, `/v1/memories?userId=${encodeURIComponent(input.userId)}&avatarId=${encodeURIComponent(input.avatarId)}`, { headers: tenantHeaders }),
    request<{ evidencePack?: { evidence?: ReturnType<typeof fallbackSearch> } }>(urls.knowledge, "/v1/evidence-packs", { method: "POST", headers: tenantHeaders, body: JSON.stringify({ query: input.message, scope, limit: 3 }) }),
  ]);
  const citations = search?.evidencePack?.evidence?.length ? search.evidencePack.evidence : fallbackSearch(input.message);
  const policyResult = await request<{ classification?: { level?: string; signals?: string[] }; evaluation?: { decision?: string; rationale?: string[] }; approval?: { status?: string } }>(urls.intelligence, "/v1/policy/evaluate", { method: "POST", headers: { "x-avatarx-tenant": tenant }, body: JSON.stringify({ prompt: input.message, context: { operation: "chat", tools: [] } }) });
  if (policyResult?.evaluation?.decision === "deny") {
    const latencyMs = Date.now() - started;
    await request(urls.analytics, "/v1/governance/decisions", { method: "POST", headers: { "x-tenant-id": tenant }, body: JSON.stringify({ traceId, decision: "deny", policy: "trusted-v1", classification: policyResult.classification, rationale: policyResult.evaluation.rationale }) });
    return { answer: "This request was stopped by the Avatar X trust policy and was not sent to a model.", traceId, model: "policy-gate", mode: "governed-denial", latencyMs, citations: [], quality: { score: 1, grounded: true, warnings: policyResult.evaluation.rationale ?? ["Request denied by policy."] }, governance: { abstained: true, action: "policy-denied", ensembleCandidates: 0, rationale: policyResult.classification?.signals?.join(", ") } };
  }
  const evidenceConfidence = citations.length ? citations.reduce((sum, item) => sum + Number(item.score ?? 0), 0) / citations.length : 0;
  const governed = await request<{ decision?: { id?: string; calibration?: { interval?: { lower?: number; upper?: number } }; deliberation?: { candidates?: string[]; maxRounds?: number }; abstention?: { abstain?: boolean; reason?: string | null; requiredAction?: string } } }>(urls.intelligence, "/v1/deliberate", { method: "POST", headers: { "x-avatarx-tenant": tenant }, body: JSON.stringify({ risk: policyResult?.classification?.level ?? "low", confidence: evidenceConfidence, samples: Math.max(1, citations.length), maxRounds: 2 }) });
  const decision = governed?.decision;
  const routing = await request<{ route?: { model?: string; tier?: string } }>(urls.intelligence, "/v1/route", { method: "POST", body: JSON.stringify({ complexity: input.message.length > 180 ? "high" : "medium", risk: "low", budgetUsd: 0.05 }) });
  const route = routing?.route;
  const context = citations.map((item) => `${item.title}: ${item.snippet}`).join("\n");
  const modelPath = decision?.abstention?.abstain ? "/v1/reason/debate" : "/v1/chat";
  const modelResult = await request<{ answer?: string; model?: string; usage?: Record<string, number>; mode?: string; candidates?: unknown[]; judgment?: { rationale?: string }; debate?: { samples?: number; repairs?: number; calls?: number }; artifact?: { premises?: string[]; claims?: string[]; citations?: string[]; critique?: string[]; verification?: { checks?: string[]; verdict?: string }; verdict?: string }; safetyFindings?: { input?: unknown[]; output?: unknown[] }; usageAccounting?: unknown }>(urls.neuron, modelPath, { method: "POST", headers: { "x-tenant-id": tenant }, body: JSON.stringify({ model: route?.model, samples: Math.min(3, Math.max(2, decision?.deliberation?.candidates?.length ?? 2)), maxRepairs: 1, messages: [{ role: "system", content: "You are Avatar X Assistant. Return concise auditable premises, claims, citations, checks, and a verdict. Never expose private chain-of-thought." }, ...(memories?.memories ?? []).slice(-5).map((memory) => ({ role: "system", content: `Approved memory: ${memory.content ?? ""}` })), { role: "user", content: `${input.message}\n\nApproved context:\n${context || "No matching context."}` }] }) });
  const answer = modelResult?.answer ?? (citations.length ? `${citations[0].snippet} [${citations[0].title}]` : "I do not have enough approved knowledge to answer that yet.");
  const premises = (modelResult?.artifact?.premises?.length ? modelResult.artifact.premises : citations.map((item) => item.snippet)).map((text, index) => ({ id: `p${index + 1}`, text, citations: [modelResult?.artifact?.citations?.[index] ?? citations[index]?.citation].filter(Boolean) }));
  const reasoningResult = await request<{ verification?: { valid?: boolean; confidence?: number; issues?: Array<{ taxonomy?: string; message?: string }>; decomposition?: Record<string, number> } }>(urls.intelligence, "/v1/reasoning/verify", { method: "POST", headers: { "x-avatarx-tenant": tenant }, body: JSON.stringify({ premises, conclusion: { id: "conclusion", text: answer, supportedBy: premises.map((premise) => premise.id) } }) });
  const evaluationResult = await request<{ evaluation?: { score?: number; groundedness?: number; warnings?: Array<{ message?: string }> } }>(urls.intelligence, "/v1/evaluate", { method: "POST", body: JSON.stringify({ claims: [{ text: answer, supported: citations.length > 0, citations: citations.map((item) => item.citation) }] }) });
  const evaluation = evaluationResult?.evaluation;
  const reasoning = reasoningResult?.verification;
  const quality = { score: Math.min(evaluation?.score ?? (citations.length ? 0.82 : 0.35), reasoning?.confidence ?? 1), grounded: (evaluation ? (evaluation.groundedness ?? 0) >= 0.8 : citations.length > 0) && reasoning?.valid !== false, warnings: [...(evaluation?.warnings?.map((warning) => warning.message ?? "Evaluation warning") ?? (citations.length ? [] : ["No approved evidence matched this request."])), ...(reasoning?.issues ?? []).map((issue) => `${issue.taxonomy ?? "reasoning"}: ${issue.message ?? "verification issue"}`)] };
  if (input.remember) await request(urls.memory, "/v1/memories", { method: "POST", headers: tenantHeaders, body: JSON.stringify({ tenantId: tenant, userId: input.userId, avatarId: input.avatarId, content: input.message, consent: true, source: "operator-console" }) });
  const latencyMs = Date.now() - started;
  await request(urls.analytics, "/v1/events", { method: "POST", headers: { "x-tenant-id": tenant }, body: JSON.stringify({ traceId, type: "run.completed", timestamp: new Date().toISOString(), latencyMs, success: true, model: modelResult?.model ?? route?.model ?? "avatarx-demo", route: route?.tier ?? "adaptive", quality: quality.score, usage: modelResult?.usage ?? {}, metadata: { avatarId: input.avatarId, manifestLoaded: Boolean(manifest), grounded: quality.grounded, decisionId: decision?.id, debateCalls: modelResult?.debate?.calls ?? 0 } }) });
  await request(urls.analytics, "/v1/reasoning/artifacts", { method: "POST", headers: { "x-tenant-id": tenant }, body: JSON.stringify({ traceId, artifact: modelResult?.artifact ?? { version: "1.0", premises: premises.map((premise) => premise.text), claims: [answer], citations: citations.map((item) => item.citation), verification: reasoning, verdict: reasoning?.valid === false ? "review" : "verified" }, mode: modelResult?.debate ? "debate" : "single", quality: quality.score, cost: 0, release: "phase7", failureCode: reasoning?.issues?.[0]?.taxonomy, dimensions: { grounding: evaluation?.groundedness ?? 0, consistency: reasoning?.decomposition?.consistency ?? reasoning?.confidence ?? 0, calibration: reasoning?.decomposition?.calibration ?? reasoning?.confidence ?? 0, safety: policyResult?.evaluation?.decision === "allow" ? 1 : 0.8 } }) });
  await request(urls.analytics, "/v1/governance/decisions", { method: "POST", headers: { "x-tenant-id": tenant }, body: JSON.stringify({ traceId, decision: decision?.abstention?.abstain ? "debate-review" : "proceed", policy: "verifiable-v1", decisionId: decision?.id, confidence: decision?.calibration?.interval }) });
  await request(urls.intelligence, "/v1/routing-feedback", { method: "POST", body: JSON.stringify({ model: modelResult?.model ?? route?.model, success: true, quality: quality.score, latencyMs, costUsd: 0 }) });
  return { answer, traceId, model: modelResult?.model ?? route?.model ?? "avatarx-demo", mode: modelResult?.debate ? "verified-debate" : modelResult?.mode ?? (modelResult ? "connected" : "safe-demo"), latencyMs, citations: citations.map((item) => ({ id: item.id, title: item.title, snippet: item.snippet, score: item.score })), quality, governance: { decisionId: decision?.id, confidence: decision?.calibration?.interval, abstained: decision?.abstention?.abstain ?? false, action: decision?.abstention?.requiredAction, ensembleCandidates: modelResult?.debate?.samples ?? 1, rationale: modelResult?.artifact?.verdict, policyDecision: policyResult?.evaluation?.decision, risk: policyResult?.classification?.level, safetyFindings: (modelResult?.safetyFindings?.input?.length ?? 0) + (modelResult?.safetyFindings?.output?.length ?? 0) }, reasoning: { artifact: modelResult?.artifact, verification: reasoning, debate: modelResult?.debate } };
}

export async function submitRunFeedback(input: { traceId: string; model: string; score: number; citationIds?: string[]; comment?: string }) {
  const quality = input.score > 0 ? 1 : 0;
  const [analytics] = await Promise.all([
    request(urls.analytics, "/v1/feedback", { method: "POST", headers: { "x-tenant-id": "avatarx-phase7" }, body: JSON.stringify({ ...input, route: "adaptive" }) }),
    request(urls.intelligence, "/v1/routing-feedback", { method: "POST", body: JSON.stringify({ model: input.model, success: input.score > 0, quality, latencyMs: 0, costUsd: 0 }) }),
    ...(input.citationIds ?? []).map((id) => request(urls.knowledge, "/v1/retrieval-feedback", { method: "POST", body: JSON.stringify({ citation: `knowledge://${id}`, score: input.score }) })),
  ]);
  return analytics;
}

export async function adaptiveMetrics() {
  const headers = { "x-tenant-id": "avatarx-phase7" };
  const [scorecards, slo, anomalies, drift, budget, decisions] = await Promise.all([
    request<{ scorecards?: unknown[] }>(urls.analytics, "/v1/scorecards", { headers }),
    request<Record<string, unknown>>(urls.analytics, "/v1/slo", { headers }),
    request<{ anomalies?: unknown[] }>(urls.analytics, "/v1/anomalies", { headers }),
    request<Record<string, unknown>>(urls.analytics, "/v1/drift", { headers }),
    request<Record<string, unknown>>(urls.analytics, "/v1/budgets/forecast?days=30", { headers }),
    request<{ decisions?: unknown[] }>(urls.intelligence, "/v1/decisions"),
  ]);
  return { scorecards: scorecards?.scorecards ?? [], slo, anomalies: anomalies?.anomalies ?? [], drift, budget, decisions: decisions?.decisions ?? [] };
}

export async function trustMetrics() {
  const tenantHeaders = { "x-tenant-id": "avatarx-phase7" };
  const knowledgeHeaders = { "x-avatarx-tenant": "avatarx-phase7", "x-avatarx-roles": "reader,operator" };
  const [ledger, improvements, dataset, quarantine, manifest] = await Promise.all([
    request<Record<string, unknown>>(urls.analytics, "/v1/ledger/verify", { headers: tenantHeaders }),
    request<{ proposals?: unknown[] }>(urls.intelligence, "/v1/improvements", { headers: { "x-avatarx-tenant": "avatarx-phase7" } }),
    request<{ count?: number }>(urls.analytics, "/v1/improvements/dataset", { headers: tenantHeaders }),
    request<{ quarantine?: unknown[] }>(urls.knowledge, "/v1/quarantine", { headers: knowledgeHeaders }),
    request<Record<string, unknown>>(urls.analytics, "/v1/compliance/export", { headers: tenantHeaders }),
  ]);
  return { ledger, improvements: improvements?.proposals ?? [], improvementRunCount: dataset?.count ?? 0, quarantinedSources: quarantine?.quarantine ?? [], compliance: manifest };
}

export async function decideImprovement(input: { id: string; decision: "approved" | "rejected"; decidedBy: string; rationale: string }) {
  return request(urls.intelligence, `/v1/improvements/${encodeURIComponent(input.id)}/decision`, { method: "POST", headers: { "x-avatarx-tenant": "avatarx-phase7" }, body: JSON.stringify({ decision: input.decision, decidedBy: input.decidedBy, rationale: input.rationale }) });
}

export async function reasoningMetrics() {
  const headers = { "x-tenant-id": "avatarx-phase7" };
  const [scorecards, failures, releaseGate, efficiency, benchmarks] = await Promise.all([
    request<Record<string, unknown>>(urls.analytics, "/v1/reasoning/scorecards", { headers }),
    request<Record<string, unknown>>(urls.analytics, "/v1/reasoning/failures", { headers }),
    request<Record<string, unknown>>(urls.analytics, "/v1/releases/gate?candidate=phase7", { headers }),
    request<Record<string, unknown>>(urls.analytics, "/v1/reasoning/debate-efficiency", { headers }),
    request<{ results?: unknown[] }>(urls.intelligence, "/v1/benchmarks/results", { headers: { "x-avatarx-tenant": "avatarx-phase7" } }),
  ]);
  return { scorecards, failures, releaseGate, efficiency, benchmarks: benchmarks?.results ?? [] };
}

export async function meshMetrics() {
  const tenantHeaders = { "x-tenant-id": "avatarx-phase7" };
  const knowledgeHeaders = { "x-avatarx-tenant": "avatarx-phase7", "x-avatarx-roles": "reader,operator" };
  const [models, health, aggregates, traceQuarantine, catalog, knowledgeQuarantine] = await Promise.all([
    request<{ nodeId?: string; peers?: unknown[] }>(urls.neuron, "/v1/federation/peers", { headers: tenantHeaders }),
    request<Record<string, unknown>>(urls.analytics, "/v1/federation/health", { headers: tenantHeaders }),
    request<{ nodes?: unknown[] }>(urls.analytics, "/v1/federation/aggregates", { headers: tenantHeaders }),
    request<{ items?: unknown[] }>(urls.analytics, "/v1/federation/quarantine", { headers: tenantHeaders }),
    request<Record<string, unknown>>(urls.knowledge, "/v1/federation/catalog", { headers: knowledgeHeaders }),
    request<{ quarantine?: unknown[] }>(urls.knowledge, "/v1/federation/quarantine", { headers: knowledgeHeaders }),
  ]);
  return { localNode: models?.nodeId, modelPeers: models?.peers ?? [], health, aggregateNodes: aggregates?.nodes ?? [], quarantinedTransfers: traceQuarantine?.items ?? [], knowledgeCatalog: catalog, quarantinedEvidence: knowledgeQuarantine?.quarantine ?? [], federationEnabled: Boolean(process.env.FEDERATION_SHARED_SECRET) };
}

export async function systemHealth() {
  return Promise.all(Object.entries(urls).map(async ([name, base]) => { const started = Date.now(); const health = await request(base, "/health"); return { name: `avatarx-${name}`, status: health ? "online" as const : "offline" as const, latencyMs: health ? Date.now() - started : null }; }));
}
