# Avatar X Brain — Phase 9

The federated cognitive-mesh control plane for the Avatar X AI ecosystem. It orchestrates six local services while enabling signed, consent-bound collaboration with independently deployed peers through portable evidence, reasoning, inference, and trace envelopes.

Phase 7 adds cryptographic node identities, peer capability negotiation, remote task delegation, selective memory disclosure, federated evidence exchange, trust-weighted quorum, signed inference envelopes, and portable trace stitching. Earlier trust and verification controls remain mandatory at every federation boundary.

Phase 8 is the production-readiness layer. Every backend now validates strong secrets before serving production traffic, applies bounded HTTP timeouts, emits structured lifecycle events, and drains gracefully. The production Compose overlay adds health-gated startup, process and logging limits, and no-new-privileges hardening. Brain also includes an offline configuration gate and CI build checks.

Phase 9 establishes the shared platform/data boundary and a service-owned `brain` PostgreSQL schema for orchestration runs and session bindings. Every AI repository owns its migrations and credential scope; services exchange data only through authenticated APIs or domain events.

Phase 10 activates PostgreSQL runtime persistence for Agents, Analytics, Knowledge and Memory in the hardened production overlay. File stores remain development and rollback sources; checksum-verified backfill must complete before traffic cutover.

The next production slices activate Neuron and Intelligence PostgreSQL runtimes. Neuron provides horizontally consistent tenant profiles, atomic budget accounting, usage reservations, and leased idempotency. Intelligence persists tenant-isolated decisions, hourly routing performance, and governed active policy versions. Local development retains in-memory adapters.

## Run the ecosystem

Place the seven repositories in the same parent directory. Install the website once:

```bash
cd avatarx-brain/apps/website
npm install
cd ../..
npm run dev:ecosystem
```

Open `http://localhost:3000`. All backend services are dependency-free Node.js applications. The console has a safe local fallback when one is unavailable.

For the containerized stack, copy `.env.compose.example` to `.env`, replace the secrets, then run `docker compose up --build`. Persistent knowledge, memory, and analytics volumes are included.

Validate production secrets and start the hardened overlay with:

```bash
npm run validate:production
docker compose -f docker-compose.yml -f docker-compose.production.yml up --build
```

Create an atomic, SHA-256-manifested backup of the durable Agents, Analytics, Knowledge, and Memory state with `npm run backup:state`. Override individual source paths or `BACKUP_OUTPUT` for mounted production volumes.

## Verify

Run each repository's tests, then the cross-service smoke test:

```bash
for repo in ../avatarx-agents ../avatarx-analytics ../avatarx-intelligence ../avatarx-knowledge ../avatarx-memory ../avatarx-neuron; do npm --prefix "$repo" test; done
npm run test:ecosystem
```

## Configure a model

`avatarx-neuron` uses a deterministic local provider by default. Set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` in the runtime environment to use a compatible hosted model. Secrets must never be committed.

Service URLs can be overridden with the variables documented in `apps/website/.env.example`.

## Security model

- Browser identity is derived from a signed bearer session when `AUTH_SECRET` is set; request body user IDs are ignored in secured mode.
- Internal calls use timestamped HMAC signatures when `SERVICE_AUTH_SECRET` is set.
- Development remains frictionless when secrets are omitted, but production deployments must set two distinct high-entropy secrets.
- The model credential is available only to `avatarx-neuron` and never enters the browser bundle.
