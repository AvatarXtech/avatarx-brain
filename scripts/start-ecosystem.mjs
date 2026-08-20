import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const services = [["avatarx-agents","src/server.js"], ["avatarx-analytics","src/index.js"], ["avatarx-intelligence","src/index.js"], ["avatarx-knowledge","src/index.js"], ["avatarx-memory","src/server.js"], ["avatarx-neuron","src/index.js"]];
const children = services.map(([name, entry]) => spawn(process.execPath, [entry], { cwd: resolve(root, name), stdio: "inherit", env: process.env }));
children.push(spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev"], { cwd: resolve(root, "avatarx-brain/apps/website"), stdio: "inherit", env: process.env }));
const stop = () => { children.forEach((child) => child.kill("SIGTERM")); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
await Promise.all(children.map((child) => new Promise((done) => child.on("exit", done))));
