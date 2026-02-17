import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureFromSource } from "../src/sources/index.js";

describe("source adapters", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("classifies twitter login wall as unusable", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_twitter",
			url: "https://x.com/example/status/1",
			dataRootDir: root,
			fetchImpl: async () =>
				new Response("<html><body><h1>Log in to X</h1><p>Join X today</p></body></html>", {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
		});
		expect(result.platform).toBe("twitter");
		expect(result.status).toBe("login_required");
		expect(result.usable).toBe(false);
	});

	it("treats r.jina.ai wrapped twitter plain text as usable text evidence", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_twitter_wrapped",
			url: "https://r.jina.ai/https://x.com/karpathy/status/2023476423055601903?s=20",
			dataRootDir: root,
			fetchImpl: async () =>
				new Response("@karpathy: the training environment is the benchmark itself.", {
					status: 200,
					headers: { "content-type": "text/plain; charset=utf-8" },
				}),
		});
		expect(result.platform).toBe("twitter");
		expect(result.status).toBe("ok");
		expect(result.usable).toBe(true);

		const extracted = readFileSync(result.snapshot.extractedTextPath, "utf8");
		expect(extracted).toContain("training environment");
	});

	it("classifies wechat verification page as risk_control", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_wechat",
			url: "https://mp.weixin.qq.com/s/abc",
			dataRootDir: root,
			fetchImpl: async () =>
				new Response("<html><body><h1>环境异常</h1><p>完成验证后即可继续访问</p><p>去验证</p></body></html>", {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
		});
		expect(result.platform).toBe("wechat");
		expect(result.status).toBe("risk_control");
		expect(result.reasonCode).toBe("WECHAT_CAPTCHA");
		expect(result.usable).toBe(false);
	});

	it("keeps xiaohongshu extracted text raw to preserve viewer fidelity", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_xiaohongshu_clean",
			url: "https://www.xiaohongshu.com/discovery/item/clean",
			dataRootDir: root,
			fetchImpl: async () =>
				new Response(
					"<html><body>小红书\n创作中心\n业务合作\n一个真实观点：强化学习环境设计要先简后繁。\n沪ICP备13030189号\n行吟信息科技（上海）有限公司\n另一个段落：奖励函数需要避免被hack。\n加载中</body></html>",
					{
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
					},
				),
		});
		expect(result.platform).toBe("xiaohongshu");
		expect(result.status).toBe("ok");
		expect(result.usable).toBe(true);
		expect(result.reason).toBeNull();

		const extracted = readFileSync(result.snapshot.extractedTextPath, "utf8");
		expect(extracted).toContain("一个真实观点");
		expect(extracted).toContain("另一个段落");
		expect(extracted).toContain("沪ICP备");
		expect(extracted).toContain("行吟信息科技");
	});

	it("classifies xiaohongshu boilerplate-only content as unusable", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_xiaohongshu",
			url: "https://www.xiaohongshu.com/discovery/item/abc",
			dataRootDir: root,
			fetchImpl: async () =>
				new Response(
					"<html><body>小红书 创作中心 业务合作 沪ICP备13030189号 违法不良信息举报 行吟信息科技（上海）有限公司</body></html>",
					{
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
					},
				),
		});
		expect(result.platform).toBe("xiaohongshu");
		expect(result.status).toBe("unsupported");
		expect(result.reasonCode).toBe("XHS_BOILERPLATE_ONLY");
		expect(result.usable).toBe(false);
	});

	it("uses reader proxy fallback when direct fetch is login-gated", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_reader_fallback",
			url: "https://substack.com/home/post/p-187332712",
			dataRootDir: root,
			fetchImpl: async (input) => {
				const requestUrl = String(input);
				if (requestUrl.startsWith("https://r.jina.ai/")) {
					return new Response(
						"Sign up or sign in to personalize your feed.\n\nVisualizing attention can reveal how models route signal through layers, and this post walks through practical steps using bertviz, attention heads, and token-level diagnostics. The article covers setup, rendering pipelines, interpretation caveats, and examples where attention highlights are misleading without gradient-based checks. It also compares notebook flows and production instrumentation for tracing token interactions in longer prompts, then summarizes how to debug prompt failures with layer-by-layer plots and qualitative inspection.",
						{
							status: 200,
							headers: { "content-type": "text/plain; charset=utf-8" },
						},
					);
				}
				return new Response("<html><body><h1>Please login</h1><p>Sign in to continue</p></body></html>", {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			},
		});

		expect(result.platform).toBe("web");
		expect(result.status).toBe("ok");
		expect(result.usable).toBe(true);
		expect(result.acquisitionMethod).toBe("reader_proxy");
		expect(result.attempts).toHaveLength(2);
		expect(result.attempts[0]?.method).toBe("direct_fetch");
		expect(result.attempts[1]?.method).toBe("reader_proxy");
	});

	it("keeps reader proxy login-gated result as non-usable when content is thin", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_reader_login_thin",
			url: "https://medium.com/some/gated-post",
			dataRootDir: root,
			fetchImpl: async (input) => {
				const requestUrl = String(input);
				if (requestUrl.startsWith("https://r.jina.ai/")) {
					return new Response("Sign in to continue reading.", {
						status: 200,
						headers: { "content-type": "text/plain; charset=utf-8" },
					});
				}
				return new Response("<html><body><h1>Forbidden</h1></body></html>", {
					status: 403,
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			},
		});

		expect(result.status).toBe("login_required");
		expect(result.usable).toBe(false);
		expect(result.acquisitionMethod).toBe("direct_fetch");
		expect(result.attempts).toHaveLength(2);
	});

	it("keeps arxiv html as usable", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_arxiv",
			url: "https://arxiv.org/html/2602.04770v2",
			dataRootDir: root,
			fetchImpl: async () =>
				new Response(
					"<html><body><h1>Paper title</h1><p>Long technical abstract text for model evaluation.</p></body></html>",
					{
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
					},
				),
		});
		expect(result.platform).toBe("arxiv");
		expect(result.status).toBe("ok");
		expect(result.usable).toBe(true);
		expect(result.acquisitionMethod).toBe("direct_fetch");
		expect(result.attempts).toHaveLength(1);
	});
});
