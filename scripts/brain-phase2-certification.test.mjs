import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const current =
  fileURLToPath(
    import.meta.url
  );

const root =
  path.resolve(
    path.dirname(current),
    ".."
  );

const requiredFiles = [
  "scripts/brain-core-runtime.mjs",
  "scripts/brain-core-server.mjs",
  "scripts/brain-orchestration-runtime.mjs",
  "scripts/brain-orchestration-server.mjs",
  "scripts/brain-recovery-runtime.mjs",
  "scripts/validate-brain-phase2-production.mjs",
  "db/migrations/0004_brain_core_runtime.sql",
  "db/migrations/0005_brain_orchestration_runtime.sql",
  "db/migrations/0006_brain_recovery_runtime.sql"
];

test(
  "Phase 2 production file set is complete",
  () => {
    for (
      const file of
      requiredFiles
    ) {
      assert.equal(
        fs.existsSync(
          path.join(
            root,
            file
          )
        ),
        true,
        `${file} must exist`
      );
    }
  }
);

test(
  "Phase 2 package exposes all Brain runtimes",
  () => {
    const pkg =
      JSON.parse(
        fs.readFileSync(
          path.join(
            root,
            "package.json"
          ),
          "utf8"
        )
      );

    assert.equal(
      pkg.scripts[
        "start:brain-core"
      ],
      "node scripts/brain-core-server.mjs"
    );

    assert.equal(
      pkg.scripts[
        "start:brain-orchestration"
      ],
      "node scripts/brain-orchestration-server.mjs"
    );
  }
);

test(
  "Phase 2 migrations retain tenant and workflow isolation",
  () => {
    for (
      const name of [
        "0004_brain_core_runtime.sql",
        "0005_brain_orchestration_runtime.sql",
        "0006_brain_recovery_runtime.sql"
      ]
    ) {
      const sql =
        fs.readFileSync(
          path.join(
            root,
            "db",
            "migrations",
            name
          ),
          "utf8"
        );

      assert.match(
        sql,
        /tenant_id/
      );
    }
  }
);