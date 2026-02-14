#!/usr/bin/env node

import { runCommandOnce } from "./cli/run-once.js";
import { runTelegramCheckMode, runTelegramMode } from "./cli/run-telegram.js";

const args = process.argv.slice(2);
const telegramMode = args.includes("--telegram");
const telegramCheckMode = args.includes("--telegram-check");
const filteredArgs = args.filter((arg) => arg !== "--telegram" && arg !== "--telegram-check");

const exitCode = telegramCheckMode
	? await runTelegramCheckMode(filteredArgs, process.stdout, process.stderr)
	: telegramMode
		? await runTelegramMode(filteredArgs, process.stdout, process.stderr)
		: await runCommandOnce(filteredArgs, process.stdout, process.stderr);

process.exit(exitCode);
