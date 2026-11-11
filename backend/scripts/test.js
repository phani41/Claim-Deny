import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbName = "test-" + randomUUID() + ".db";
const dbPath = path.resolve(root, dbName);
const relative = path.relative(root, dbPath);
if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Test database escaped backend directory.");
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: "file:./" + dbName,
  AI_SERVICE_TOKEN: "synthetic-node-ai-service-test-token",
  RUST_LOG: "info"
};
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Command failed: " + args.join(" "));
}

try {
  run(process.execPath, [prismaCli, "migrate", "deploy"]);
  run(process.execPath, [prismaCli, "db", "seed"]);
  run(process.execPath, [prismaCli, "db", "seed"]);
  run(process.execPath, ["--test", "test/api.test.js"]);
} finally {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = dbPath + suffix;
    if (existsSync(file)) rmSync(file);
  }
}
