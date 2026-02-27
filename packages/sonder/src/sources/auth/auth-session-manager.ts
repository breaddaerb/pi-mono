import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthSessionRepo } from "../../storage/auth-session-repo.js";
import type { AuthSession, AuthSessionStatus } from "../../types.js";
import { decryptAuthState, encryptAuthState } from "./auth-state-crypto.js";
import { assertAuthEligibleDomain } from "./domain-policy.js";

export interface AuthSessionStatusView {
	domain: string;
	exists: boolean;
	status: AuthSessionStatus | "missing";
	hasEncryptedState: boolean;
	updatedAt: string | null;
	lastValidatedAt: string | null;
	expiresAt: string | null;
	lastError: string | null;
}

export interface AuthSessionManagerOptions {
	authSessionRepo: AuthSessionRepo;
	authStateDir: string;
	encryptionKey: string;
	now?: () => Date;
}

function toStorageStateFilePath(authStateDir: string, domain: string): string {
	return join(authStateDir, `${domain.replaceAll(".", "_")}.storage-state.enc`);
}

function parseStorageStateOrThrow(storageStateJson: string): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(storageStateJson);
	} catch {
		throw new Error("Invalid storage state JSON");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("Invalid storage state JSON");
	}
}

function isExpired(expiresAt: string | null, nowIso: string): boolean {
	if (!expiresAt) {
		return false;
	}
	return expiresAt <= nowIso;
}

export class AuthSessionManager {
	private readonly now: () => Date;

	constructor(private readonly options: AuthSessionManagerOptions) {
		if (options.encryptionKey.trim().length === 0) {
			throw new Error("Auth session manager requires a non-empty encryption key");
		}
		this.now = options.now ?? (() => new Date());
	}

	login(input: { domain: string; storageStateJson: string; expiresAt?: string | null }): AuthSessionStatusView {
		const domain = assertAuthEligibleDomain(input.domain);
		parseStorageStateOrThrow(input.storageStateJson);
		mkdirSync(this.options.authStateDir, { recursive: true });

		const nowIso = this.now().toISOString();
		const existing = this.options.authSessionRepo.findByDomain(domain);
		const storageStatePath = existing?.storageStatePath ?? toStorageStateFilePath(this.options.authStateDir, domain);
		const encrypted = encryptAuthState(input.storageStateJson, this.options.encryptionKey);
		writeFileSync(storageStatePath, encrypted, { encoding: "utf8", mode: 0o600 });

		const session: AuthSession = {
			id: existing?.id ?? randomUUID(),
			domain,
			status: isExpired(input.expiresAt ?? null, nowIso) ? "expired" : "active",
			storageStatePath,
			createdAt: existing?.createdAt ?? nowIso,
			updatedAt: nowIso,
			lastValidatedAt: nowIso,
			expiresAt: input.expiresAt ?? existing?.expiresAt ?? null,
			lastError: null,
		};
		this.options.authSessionRepo.upsert(session);
		return this.toStatusView(session);
	}

	getStatus(inputDomain: string): AuthSessionStatusView {
		const domain = assertAuthEligibleDomain(inputDomain);
		const existing = this.options.authSessionRepo.findByDomain(domain);
		if (!existing) {
			return {
				domain,
				exists: false,
				status: "missing",
				hasEncryptedState: false,
				updatedAt: null,
				lastValidatedAt: null,
				expiresAt: null,
				lastError: null,
			};
		}
		return this.refreshAndReadStatus(existing);
	}

	listStatuses(limit = 20): AuthSessionStatusView[] {
		const sessions = this.options.authSessionRepo.listByUpdatedAt(limit);
		return sessions.map((session) => this.refreshAndReadStatus(session));
	}

	loadStorageState(inputDomain: string): string {
		const domain = assertAuthEligibleDomain(inputDomain);
		const existing = this.options.authSessionRepo.findByDomain(domain);
		if (!existing) {
			throw new Error(`Auth session not found for domain: ${domain}`);
		}
		const refreshed = this.refreshAndReadStatus(existing);
		if (refreshed.status !== "active") {
			throw new Error(`Auth session is not active for domain: ${domain}`);
		}

		try {
			const encrypted = readFileSync(existing.storageStatePath, "utf8");
			const storageState = decryptAuthState(encrypted, this.options.encryptionKey);
			parseStorageStateOrThrow(storageState);
			return storageState;
		} catch (error) {
			this.markSessionError(existing, error instanceof Error ? error.message : "Storage state decode failed");
			throw new Error(`Failed to load auth storage state for domain: ${domain}`);
		}
	}

	logout(inputDomain: string): boolean {
		const domain = assertAuthEligibleDomain(inputDomain);
		const existing = this.options.authSessionRepo.findByDomain(domain);
		if (!existing) {
			return false;
		}

		rmSync(existing.storageStatePath, { force: true });
		const nowIso = this.now().toISOString();
		this.options.authSessionRepo.upsert({
			...existing,
			status: "revoked",
			updatedAt: nowIso,
			lastError: null,
		});
		return true;
	}

	private refreshAndReadStatus(existing: AuthSession): AuthSessionStatusView {
		const nowIso = this.now().toISOString();
		const hasEncryptedState = existsSync(existing.storageStatePath);
		let nextStatus = existing.status;
		let nextLastError = existing.lastError;
		if (nextStatus === "active" && isExpired(existing.expiresAt, nowIso)) {
			nextStatus = "expired";
			nextLastError = "Auth session expired";
		} else if (nextStatus === "active" && !hasEncryptedState) {
			nextStatus = "error";
			nextLastError = "Encrypted auth state file is missing";
		}

		if (nextStatus !== existing.status || nextLastError !== existing.lastError) {
			const updated: AuthSession = {
				...existing,
				status: nextStatus,
				updatedAt: nowIso,
				lastError: nextLastError,
			};
			this.options.authSessionRepo.upsert(updated);
			return this.toStatusView(updated);
		}

		return this.toStatusView(existing);
	}

	private toStatusView(session: AuthSession): AuthSessionStatusView {
		return {
			domain: session.domain,
			exists: true,
			status: session.status,
			hasEncryptedState: existsSync(session.storageStatePath),
			updatedAt: session.updatedAt,
			lastValidatedAt: session.lastValidatedAt,
			expiresAt: session.expiresAt,
			lastError: session.lastError,
		};
	}

	private markSessionError(existing: AuthSession, errorMessage: string): void {
		const nowIso = this.now().toISOString();
		this.options.authSessionRepo.upsert({
			...existing,
			status: "error",
			updatedAt: nowIso,
			lastError: errorMessage,
		});
	}
}
