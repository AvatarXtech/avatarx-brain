import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const currentFile =
  fileURLToPath(import.meta.url);

const scriptDir =
  path.dirname(currentFile);

const brainRoot =
  path.resolve(
    scriptDir,
    ".."
  );

const foundationRoot =
  path.resolve(
    brainRoot,
    "..",
    "avatarx-foundation"
  );

const files = [
  "avatarx.ai.request.v1.schema.json",
  "avatarx.ai.result.v1.schema.json",
  "avatarx.ai.trace-context.v1.schema.json",
  "avatarx.ai.error-taxonomy.v1.json",
  "avatarx.ai.service-capabilities.v1.json",
  "avatarx.ai.operations.v1.json",
  "avatarx.ai.execution-context-policy.v1.json",
  "avatarx.ai.delivery-policy.v1.json",
  "avatarx.ai.runtime-contract-set.v1.json"
];

function hash(file) {
  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(file)
    )
    .digest("hex");
}

test(
  "Brain canonical AI core contracts match Foundation",
  () => {
    for (const name of files) {
      const brain =
        path.join(
          brainRoot,
          "contracts",
          "ai",
          "core",
          name
        );

      const foundation =
        path.join(
          foundationRoot,
          "contracts",
          "ai",
          "core",
          name
        );

      assert.equal(
        fs.existsSync(brain),
        true,
        `Brain missing ${name}`
      );

      assert.equal(
        fs.existsSync(foundation),
        true,
        `Foundation missing ${name}`
      );

      assert.equal(
        hash(brain),
        hash(foundation),
        `${name} drifted from Foundation`
      );
    }
  }
);