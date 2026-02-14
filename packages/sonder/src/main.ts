#!/usr/bin/env node

import { runCommandOnce } from "./cli/run-once.js";
import { runTelegramMode } from "./cli/run-telegram.js";

const args = process.argv.slice(2);
const telegramMode = args.includes("--telegram");
const filteredArgs = args.filter((arg) => arg !== "--telegram");

const exitCode = telegramMode
	? await runTelegramMode(filteredArgs, process.stdout, process.stderr)
	: await runCommandOnce(filteredArgs, process.stdout, process.stderr);

process.exit(exitCode);
