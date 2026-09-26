// `soapay`: headless CLI over @soapay/sdk (distribute, scan). See `soapay help`.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { run } from "./cli.js";

const code = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(`${s}\n`),
  stderr: (s) => process.stderr.write(`${s}\n`),
  env: process.env,
  readFile: (path) => readFile(path, "utf8"),
  async writeFile(path, content) {
    // Write-then-rename so an interrupted run never leaves a truncated pin file.
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  },
});
process.exitCode = code;
