import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthSessionManager } from "../src/sources/auth/auth-session-manager.js";
import { AuthSessionRepo, createDatabase } from "../src/storage/index.js";

describe("AuthSessionManager", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("supports login/status/load/logout flow with encrypted storage state", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-auth-manager-"));
		tempDirs.push(root);

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const authSessionRepo = new AuthSessionRepo(database);
		const manager = new AuthSessionManager({
			authSessionRepo,
			authStateDir: join(root, "auth-state"),
			encryptionKey: "test-auth-key",
			now: () => new Date("2026-02-26T01:00:00.000Z"),
		});

		const storageStateJson = JSON.stringify({
			cookies: [{ name: "sessionid", value: "secret-cookie", domain: ".x.com", path: "/" }],
			origins: [],
		});

		try {
			const loginStatus = manager.login({
				domain: "https://twitter.com/home",
				storageStateJson,
			});
			expect(loginStatus.domain).toBe("x.com");
			expect(loginStatus.exists).toBe(true);
			expect(loginStatus.status).toBe("active");

			const persisted = authSessionRepo.findByDomain("x.com");
			expect(persisted).not.toBeNull();
			expect(persisted?.storageStatePath.endsWith("x_com.storage-state.enc")).toBe(true);

			const encrypted = readFileSync(persisted?.storageStatePath ?? "", "utf8");
			expect(encrypted).not.toContain("secret-cookie");

			expect(manager.getStatus("x.com")).toMatchObject({
				domain: "x.com",
				exists: true,
				status: "active",
				hasEncryptedState: true,
			});
			expect(manager.listStatuses()).toHaveLength(1);
			expect(JSON.parse(manager.loadStorageState("x.com"))).toEqual(JSON.parse(storageStateJson));

			expect(manager.logout("x.com")).toBe(true);
			expect(manager.getStatus("x.com").status).toBe("revoked");
			expect(manager.getStatus("x.com").hasEncryptedState).toBe(false);
		} finally {
			database.close();
		}
	});

	it("marks missing auth-state files as error and rejects unsupported domains", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-auth-manager-"));
		tempDirs.push(root);

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const authSessionRepo = new AuthSessionRepo(database);
		const manager = new AuthSessionManager({
			authSessionRepo,
			authStateDir: join(root, "auth-state"),
			encryptionKey: "test-auth-key",
			now: () => new Date("2026-02-26T01:30:00.000Z"),
		});

		try {
			expect(() =>
				manager.login({
					domain: "example.com",
					storageStateJson: '{"cookies":[],"origins":[]}',
				}),
			).toThrow("Auth domain is not supported");

			manager.login({
				domain: "reddit.com",
				storageStateJson: '{"cookies":[],"origins":[]}',
			});
			const session = authSessionRepo.findByDomain("reddit.com");
			expect(session).not.toBeNull();

			rmSync(session?.storageStatePath ?? "", { force: true });
			const status = manager.getStatus("reddit.com");
			expect(status.status).toBe("error");
			expect(status.lastError).toContain("missing");
			expect(() => manager.loadStorageState("reddit.com")).toThrow("Auth session is not active");
		} finally {
			database.close();
		}
	});

	it("marks session as expired when expiry has passed", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-auth-manager-"));
		tempDirs.push(root);

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const authSessionRepo = new AuthSessionRepo(database);
		const manager = new AuthSessionManager({
			authSessionRepo,
			authStateDir: join(root, "auth-state"),
			encryptionKey: "test-auth-key",
			now: () => new Date("2026-02-26T02:00:00.000Z"),
		});

		try {
			const status = manager.login({
				domain: "xiaohongshu.com",
				storageStateJson: '{"cookies":[],"origins":[]}',
				expiresAt: "2026-02-26T01:00:00.000Z",
			});
			expect(status.status).toBe("expired");
			expect(manager.getStatus("xiaohongshu.com").status).toBe("expired");
		} finally {
			database.close();
		}
	});
});
