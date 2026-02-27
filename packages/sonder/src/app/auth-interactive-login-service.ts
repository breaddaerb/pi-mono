import { chromium } from "playwright-core";
import { assertAuthEligibleDomain, getAuthLoginUrl } from "../sources/auth/domain-policy.js";
import { resolveChromiumExecutablePath } from "../sources/browser-executable.js";
import type { AuthSessionService, AuthSessionStatusResult } from "./auth-session-service.js";

export interface AuthInteractiveLoginStartResult {
	domain: string;
	loginUrl: string;
	alreadyPending: boolean;
	startedAt: string;
}

export interface AuthInteractiveLoginLauncherInput {
	domain: string;
	loginUrl: string;
	browserExecutablePath?: string;
}

export interface AuthInteractiveLoginController {
	captureStorageStateJson: () => Promise<string>;
	close: () => Promise<void>;
}

export type AuthInteractiveLoginLauncher = (
	input: AuthInteractiveLoginLauncherInput,
) => Promise<AuthInteractiveLoginController>;

export interface AuthInteractiveLoginServiceOptions {
	authSessionService: AuthSessionService;
	browserExecutablePath?: string;
	now?: () => Date;
	launcher?: AuthInteractiveLoginLauncher;
}

interface PendingAuthInteractiveLogin {
	domain: string;
	loginUrl: string;
	startedAt: string;
	controller: AuthInteractiveLoginController;
}

interface StorageStateOrigin {
	localStorage?: unknown[];
}

interface StorageStateShape {
	cookies?: unknown[];
	origins?: StorageStateOrigin[];
}

async function defaultLauncher(input: AuthInteractiveLoginLauncherInput): Promise<AuthInteractiveLoginController> {
	const executablePath = resolveChromiumExecutablePath(input.browserExecutablePath);
	let browser: Awaited<ReturnType<typeof chromium.launch>>;
	try {
		browser = await chromium.launch({
			headless: false,
			executablePath,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			[
				`Failed to launch browser for auth login: ${message}`,
				"Install Playwright browser (npx playwright install chromium),",
				"or set SONDER_AUTH_BROWSER_EXECUTABLE_PATH to your local Chrome/Chromium path.",
			].join(" "),
		);
	}
	let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
	try {
		context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(input.loginUrl, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
	} catch (error) {
		if (context) {
			try {
				await context.close();
			} catch {
				// Best-effort cleanup on launch failure.
			}
		}
		try {
			await browser.close();
		} catch {
			// Best-effort cleanup on launch failure.
		}
		throw error;
	}
	if (!context) {
		throw new Error("Failed to create browser context");
	}

	let closed = false;
	return {
		captureStorageStateJson: async () => {
			const storageState = await context.storageState();
			return JSON.stringify(storageState);
		},
		close: async () => {
			if (closed) {
				return;
			}
			closed = true;
			try {
				await context.close();
			} finally {
				await browser.close();
			}
		},
	};
}

function parseStorageStateOrThrow(storageStateJson: string): StorageStateShape {
	let parsed: unknown;
	try {
		parsed = JSON.parse(storageStateJson);
	} catch {
		throw new Error("Invalid storage state JSON");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("Invalid storage state JSON");
	}
	return parsed as StorageStateShape;
}

function hasCapturedAuthSignals(storageStateJson: string): boolean {
	const parsed = parseStorageStateOrThrow(storageStateJson);
	const cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
	if (cookieCount > 0) {
		return true;
	}
	if (!Array.isArray(parsed.origins)) {
		return false;
	}
	for (const origin of parsed.origins) {
		if (!origin || typeof origin !== "object") {
			continue;
		}
		if (Array.isArray(origin.localStorage) && origin.localStorage.length > 0) {
			return true;
		}
	}
	return false;
}

export class AuthInteractiveLoginService {
	private readonly now: () => Date;
	private readonly launcher: AuthInteractiveLoginLauncher;
	private readonly pendingByDomain = new Map<string, PendingAuthInteractiveLogin>();

	constructor(private readonly options: AuthInteractiveLoginServiceOptions) {
		this.now = options.now ?? (() => new Date());
		this.launcher = options.launcher ?? defaultLauncher;
	}

	async start(domainInput: string): Promise<AuthInteractiveLoginStartResult> {
		const domain = assertAuthEligibleDomain(domainInput);
		const existing = this.pendingByDomain.get(domain);
		if (existing) {
			return {
				domain,
				loginUrl: existing.loginUrl,
				alreadyPending: true,
				startedAt: existing.startedAt,
			};
		}

		const loginUrl = getAuthLoginUrl(domain);
		const startedAt = this.now().toISOString();
		const controller = await this.launcher({
			domain,
			loginUrl,
			browserExecutablePath: this.options.browserExecutablePath,
		});
		this.pendingByDomain.set(domain, {
			domain,
			loginUrl,
			startedAt,
			controller,
		});
		return {
			domain,
			loginUrl,
			alreadyPending: false,
			startedAt,
		};
	}

	async done(domainInput: string): Promise<AuthSessionStatusResult> {
		const domain = assertAuthEligibleDomain(domainInput);
		const pending = this.pendingByDomain.get(domain);
		if (!pending) {
			throw new Error(`No pending auth login for domain: ${domain}. Run /auth login <domain> first.`);
		}

		try {
			const storageStateJson = await pending.controller.captureStorageStateJson();
			if (!hasCapturedAuthSignals(storageStateJson)) {
				throw new Error(
					`No login state captured for domain: ${domain}. Complete login in browser, then run /auth done ${domain}.`,
				);
			}
			return this.options.authSessionService.login({
				domain,
				storageStateJson,
			});
		} finally {
			await this.closePending(domain);
		}
	}

	async cancel(domainInput: string): Promise<boolean> {
		const domain = assertAuthEligibleDomain(domainInput);
		if (!this.pendingByDomain.has(domain)) {
			return false;
		}
		await this.closePending(domain);
		return true;
	}

	async closeAll(): Promise<void> {
		const domains = [...this.pendingByDomain.keys()];
		for (const domain of domains) {
			await this.closePending(domain);
		}
	}

	private async closePending(domain: string): Promise<void> {
		const pending = this.pendingByDomain.get(domain);
		if (!pending) {
			return;
		}
		this.pendingByDomain.delete(domain);
		try {
			await pending.controller.close();
		} catch {
			// Best-effort browser cleanup.
		}
	}
}
