#!/usr/bin/env node

import { runCommandOnce } from "./cli/run-once.js";

const exitCode = await runCommandOnce(process.argv.slice(2), process.stdout, process.stderr);
process.exit(exitCode);
