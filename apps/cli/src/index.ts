// `soapay`: headless CLI over @soapay/sdk (distribute, scan). See `soapay help`.
import { readFile } from "node:fs/promises";
import { run } from "./cli.js";

const code = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(`${s}\n`),
  stderr: (s) => process.stderr.write(`${s}\n`),
  env: process.env,
  readFile: (path) => readFile(path, "utf8"),
});
process.exitCode = code;
