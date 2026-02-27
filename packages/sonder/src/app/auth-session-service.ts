import { AuthSessionManager, type AuthSessionStatusView } from "../sources/auth/auth-session-manager.js";
import { assertAuthEligibleDomain } from "../sources/auth/domain-policy.js";
import type { AuthSessionRepo } from "../storage/auth-session-repo.js";

export interface AuthSessionServiceOptions {
	authSessionRepo: AuthSessionRepo;
	authStateDir: string;
	encryptionKey: string;
	now?: () => Date;
}

export interface AuthSessionLoginInput {
	domain: string;
	storageStateJson: string;
	expiresAt?: string | null;
}

export type AuthSessionStatusResult = AuthSessionStatusView;

export class AuthSessionService {
	private readonly manager: AuthSessionManager;

	constructor(options: AuthSessionServiceOptions) {
		this.manager = new AuthSessionManager({
			authSessionRepo: options.authSessionRepo,
			authStateDir: options.authStateDir,
			encryptionKey: options.encryptionKey,
			now: options.now,
		});
	}

	login(input: AuthSessionLoginInput): AuthSessionStatusResult {
		return this.manager.login({
			domain: input.domain,
			storageStateJson: input.storageStateJson,
			expiresAt: input.expiresAt ?? null,
		});
	}

	status(domain: string): AuthSessionStatusResult {
		return this.manager.getStatus(assertAuthEligibleDomain(domain));
	}

	list(limit = 20): AuthSessionStatusResult[] {
		return this.manager.listStatuses(limit);
	}

	logout(domain: string): boolean {
		return this.manager.logout(assertAuthEligibleDomain(domain));
	}

	loadStorageState(domain: string): string {
		return this.manager.loadStorageState(assertAuthEligibleDomain(domain));
	}
}
