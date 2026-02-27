import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SonderApp } from "../src/app/sonder-app.js";

describe("SonderApp auth session wiring", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("requires auth encryption key configuration before auth APIs are used", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-auth-app-"));
		tempDirs.push(root);
		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "unused",
				model: "gpt-5",
				provider: "openai-codex",
				citations: [],
			}),
		});

		try {
			expect(() =>
				app.loginAuthSession({
					domain: "x.com",
					storageStateJson: '{"cookies":[],"origins":[]}',
				}),
			).toThrow("Auth session service is not configured");
		} finally {
			app.close();
		}
	});

	it("persists and retrieves auth sessions when configured", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-auth-app-"));
		tempDirs.push(root);
		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "unused",
				model: "gpt-5",
				provider: "openai-codex",
				citations: [],
			}),
			auth: {
				encryptionKey: "test-app-auth-key",
			},
		});

		try {
			const login = app.loginAuthSession({
				domain: "twitter.com",
				storageStateJson: '{"cookies":[{"name":"sid","value":"v"}],"origins":[]}',
			});
			expect(login.domain).toBe("x.com");
			expect(login.status).toBe("active");

			expect(app.getAuthSessionStatus("x.com").status).toBe("active");
			expect(app.listAuthSessionStatuses()).toHaveLength(1);

			const storageState = app.loadAuthSessionStorageState("x.com");
			expect(JSON.parse(storageState)).toEqual({
				cookies: [{ name: "sid", value: "v" }],
				origins: [],
			});

			expect(app.logoutAuthSession("x.com")).toBe(true);
			expect(app.getAuthSessionStatus("x.com").status).toBe("revoked");
		} finally {
			app.close();
		}
	});
});
