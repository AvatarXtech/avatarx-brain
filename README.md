# Avatar X Brain — Phase 7

The federated cognitive-mesh control plane for the Avatar X AI ecosystem. It orchestrates six local services while enabling signed, consent-bound collaboration with independently deployed peers through portable evidence, reasoning, inference, and trace envelopes.

Phase 7 adds cryptographic node identities, peer capability negotiation, remote task delegation, selective memory disclosure, federated evidence exchange, trust-weighted quorum, signed inference envelopes, and portable trace stitching. Earlier trust and verification controls remain mandatory at every federation boundary.

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
