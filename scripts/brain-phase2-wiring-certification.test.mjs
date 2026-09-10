import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const current =
  fileURLToPath(import.meta.url);

const root =
  path.resolve(
    path.dirname(current),
    ".."
  );

function read(file) {
  return fs.readFileSync(
    path.join(root, file),
    "utf8"
  );
}

test("production server imports managed orchestration runtime", () => {
  const server =
    read(
      "scripts/brain-orchestration-server.mjs"
    );

  assert.match(
    server,
    /createManagedBrainEndpoint/
  );

  assert.match(
    server,
    /brain-managed-orchestration-runtime\.mjs/
  );

  assert.doesNotMatch(
    server,
    /createBrainOrchestrationEndpoint/
  );
});

test("real managed runtime owns workflow lease lifecycle", () => {
  const runtime =
    read(
      "scripts/brain-managed-orchestration-runtime.mjs"
    );

  assert.match(
    runtime,
    /acquireLease/
  );

  assert.match(
    runtime,
    /heartbeatLease/
  );

  assert.match(
    runtime,
    /releaseLease/
  );
});

test("real runtime persists action checkpoints", () => {
  const runtime =
    read(
      "scripts/brain-managed-orchestration-runtime.mjs"
    );

  assert.match(
    runtime,
    /saveCheckpoint/
  );

  assert.match(
    runtime,
    /listCheckpoints/
  );

  assert.match(
    runtime,
    /checkpoint\?\.status ===\s*"SUCCEEDED"/
  );
});

test("resume inspection cancellation and recovery scan are implemented", () => {
  const runtime =
    read(
      "scripts/brain-managed-orchestration-runtime.mjs"
    );

  for (const marker of [
    "async resume(",
    "async inspect(",
    "async cancel(",
    "async scanRecovery(",
    "/v1/ai/recovery/scan",
    "function parseWorkflowPath("
  ]) {
    assert.equal(
      runtime.includes(marker),
      true,
      `${marker} missing`
    );
  }
});

test("managed workflow migration contains durable workflow state", () => {
  const sql =
    read(
      "db/migrations/0007_brain_managed_workflow_runtime.sql"
    );

  assert.match(
    sql,
    /brain_managed_workflows/
  );

  assert.match(
    sql,
    /brain_managed_action_checkpoints/
  );

  assert.match(
    sql,
    /RECOVERY_REQUIRED/
  );

  assert.match(
    sql,
    /cancellation_requested/
  );

  assert.match(
    sql,
    /request_envelope/
  );

  assert.match(
    sql,
    /core_result_envelope/
  );
});

test("action checkpoint primary key prevents cross-workflow collisions", () => {
  const sql =
    read(
      "db/migrations/0007_brain_managed_workflow_runtime.sql"
    );

  assert.match(
    sql,
    /PRIMARY KEY\s*\(\s*tenant_id,\s*workflow_id,\s*action_id\s*\)/s
  );
});

test("package production orchestration command still targets rewired server", () => {
  const pkg =
    JSON.parse(
      read("package.json")
    );

  assert.equal(
    pkg.scripts[
      "start:brain-orchestration"
    ],
    "node scripts/brain-orchestration-server.mjs"
  );
});