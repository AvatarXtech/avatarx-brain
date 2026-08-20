"use client";

import { FormEvent, useEffect, useState } from "react";

type Citation = { id: string; title: string; snippet: string; score: number };
type ChatResult = { answer: string; traceId: string; model: string; mode: string; latencyMs: number; citations: Citation[]; quality: { score: number; grounded: boolean; warnings: string[] }; governance?: { decisionId?: string; confidence?: { lower?: number; upper?: number }; abstained?: boolean; action?: string; ensembleCandidates?: number; rationale?: string; policyDecision?: string; risk?: string; safetyFindings?: number }; reasoning?: { artifact?: { premises?: string[]; claims?: string[]; critique?: string[]; verification?: { checks?: string[]; verdict?: string }; verdict?: string }; verification?: { valid?: boolean; confidence?: number; issues?: Array<{ taxonomy?: string; message?: string }> }; debate?: { samples?: number; repairs?: number; calls?: number } } };
type Service = { name: string; status: "online" | "offline"; latencyMs: number | null };
const starters = ["What is the Avatar X AI ecosystem?", "How does secure Avatar federation work?", "Explain the Phase 7 cognitive mesh."];

export function ControlRoom() {
  const [message, setMessage] = useState(starters[0]);
  const [result, setResult] = useState<ChatResult | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [mesh, setMesh] = useState<{ modelPeers?: unknown[]; aggregateNodes?: unknown[]; federationEnabled?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remember, setRemember] = useState(false);
  const [feedback, setFeedback] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => { fetch("/api/system").then((r) => r.json()).then((data) => setServices(data.services ?? [])).catch(() => setServices([])); }, []);
  useEffect(() => { fetch("/api/mesh").then((r) => r.json()).then(setMesh).catch(() => setMesh(null)); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || loading) return;
    setLoading(true); setError(""); setFeedback("idle");
    try {
      const response = await fetch("/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "phase2-pilot", avatarId: "avatarx-assistant-v1", message: message.trim(), remember }) });
      if (!response.ok || !response.body) { const body = await response.json(); throw new Error(body.error?.message ?? "The run failed."); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let streamed = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n"); buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const name = frame.match(/^event: (.+)$/m)?.[1]; const raw = frame.match(/^data: (.+)$/m)?.[1]; if (!raw) continue; const data = JSON.parse(raw);
          if (name === "delta") { streamed += data.text; setResult({ answer: streamed, traceId: "streaming", model: "routing…", mode: "streaming", latencyMs: 0, citations: [], quality: { score: 0, grounded: false, warnings: [] } }); }
          if (name === "done") setResult(data);
          if (name === "error") throw new Error(data.message);
        }
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The run failed."); }
    finally { setLoading(false); }
  }
  async function rate(score: -1 | 1) {
    if (!result || result.traceId === "streaming" || feedback === "saving") return;
    setFeedback("saving");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "phase3-pilot", traceId: result.traceId, model: result.model, score, citationIds: result.citations.map((citation) => citation.id) }) });
      if (!response.ok) throw new Error(); setFeedback("saved");
    } catch { setFeedback("idle"); setError("Feedback could not be recorded."); }
  }
  const online = services.filter((service) => service.status === "online").length;
  return (
    <main className="shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">X</span><span>AVATAR X</span></div><div className="environment"><span className="pulse" /> PHASE 7 · FEDERATED</div><div className="operator">Mesh Console</div></header>
      <section className="hero"><div><p className="eyebrow">FEDERATED COGNITIVE MESH</p><h1>Many minds.<br /><span>One trust fabric.</span></h1><p className="lede">A portable AI mesh with signed node identities, negotiated capabilities, consent-bound disclosure, federated evidence, trust-weighted quorum, and verifiable cross-node traces.</p></div><div className="system-orbit" aria-label="Seven connected AI services"><div className="orbit-core"><strong>AX</strong><span>MESH</span></div>{services.slice(0, 6).map((service, index) => <div className={`orbit-node node-${index + 1}`} key={service.name}><span className={service.status} />{service.name.replace("avatarx-", "")}</div>)}</div></section>
      <section className="status-strip"><div><span className="metric">{services.length ? `${online}/${services.length}` : "—"}</span><span>services online</span></div><div><span className="metric">{result ? `${result.latencyMs}ms` : "—"}</span><span>last run</span></div><div><span className="metric">{result ? Math.round(result.quality.score * 100) : "—"}</span><span>quality score</span></div><div><span className="metric">{(mesh?.modelPeers?.length ?? 0) + (mesh?.aggregateNodes?.length ?? 0)}</span><span>{mesh?.federationEnabled ? "trusted mesh peers" : "mesh peers · local mode"}</span></div></section>
      <section className="workspace">
        <div className="run-panel"><div className="panel-heading"><div><span className="section-number">01</span><h2>Run the brain</h2></div><span className="mode-badge">SAFE PILOT</span></div><form onSubmit={submit}><textarea value={message} onChange={(event) => setMessage(event.target.value)} aria-label="Message to Avatar X" rows={5} /><div className="starter-row">{starters.map((starter) => <button type="button" onClick={() => setMessage(starter)} key={starter}>{starter}</button>)}</div><div className="form-footer"><label className="consent"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Explicitly approve this message for memory</span></label><button className="run-button" disabled={loading}>{loading ? "Reasoning…" : "Execute run"}<span>↗</span></button></div></form>{error && <p className="error">{error}</p>}</div>
        <div className="result-panel"><div className="panel-heading"><div><span className="section-number">02</span><h2>Auditable result</h2></div>{result && <span className={`quality ${result.quality.grounded ? "good" : "warn"}`}>{result.quality.grounded ? "GROUNDED" : "REVIEW"}</span>}</div>{!result ? <div className="empty-state"><div className="empty-glyph">⌁</div><p>Your answer, evidence, model decision, and trace will appear here.</p></div> : <div className="result-content"><p className="answer">{result.answer}</p><div className="run-meta"><span>TRACE <b>{result.traceId.slice(0, 12)}</b></span><span>MODEL <b>{result.model}</b></span><span>MODE <b>{result.mode}</b></span>{result.governance?.confidence && <span>CONFIDENCE <b>{Math.round((result.governance.confidence.lower ?? 0) * 100)}–{Math.round((result.governance.confidence.upper ?? 0) * 100)}%</b></span>}</div>{result.governance && <div className="governance-row"><b>{result.governance.action === "policy-denied" ? "POLICY DENIED" : result.reasoning?.debate ? "VERIFIED DEBATE" : "POLICY APPROVED"}</b><span>risk {result.governance.risk ?? "low"}</span><span>{result.reasoning?.debate?.samples ?? result.governance.ensembleCandidates ?? 1} samples</span><span>{result.reasoning?.debate?.repairs ?? 0} repairs</span><span>{result.governance.safetyFindings ?? 0} safety findings</span></div>}{result.reasoning?.artifact && <div className="reasoning-card"><div><b>Reasoning artifact</b><span>{result.reasoning.artifact.verification?.verdict ?? result.reasoning.artifact.verdict ?? "review"}</span></div>{result.reasoning.artifact.premises?.slice(0, 3).map((premise) => <p key={premise}>Premise · {premise}</p>)}{result.reasoning.artifact.critique?.slice(0, 2).map((critique) => <p key={critique}>Critique · {critique}</p>)}</div>}<div className="feedback-row"><span>{feedback === "saved" ? "Feedback recorded for adaptive routing" : "Improve future routing"}</span><button type="button" onClick={() => rate(1)} disabled={feedback !== "idle"}>Useful</button><button type="button" onClick={() => rate(-1)} disabled={feedback !== "idle"}>Needs work</button></div><h3>Evidence</h3>{result.citations.length ? result.citations.map((citation) => <article className="citation" key={citation.id}><div><b>{citation.title}</b><span>{Math.round(citation.score * 100)}% match</span></div><p>{citation.snippet}</p></article>) : <p className="muted">No matching approved knowledge was found.</p>}{result.quality.warnings.length > 0 && <div className="warnings">{result.quality.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}</div>}</div>
      </section>
      <section className="service-grid"><div className="section-title"><span className="section-number">03</span><div><h2>Ecosystem telemetry</h2><p>Each capability is independently deployable and observable.</p></div></div><div className="cards">{services.map((service, index) => <article key={service.name}><span className="card-index">0{index + 1}</span><div className="service-state"><span className={service.status} />{service.status}</div><h3>{service.name}</h3><p>{service.latencyMs === null ? "Awaiting connection" : `${service.latencyMs}ms health response`}</p></article>)}</div></section>
    </main>
  );
}
