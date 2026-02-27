import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFromSource } from "../src/sources/index.js";

vi.mock("../src/sources/wechat-browser.js", () => ({
	fetchWechatInBrowser: async () => {
		throw new Error("wechat-browser-disabled-in-tests");
	},
}));

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

	it("falls back to reader proxy when twitter direct fetch is low-signal", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_twitter_low_signal",
			url: "https://x.com/example/status/123",
			dataRootDir: root,
			fetchImpl: async (input) => {
				const requestUrl = String(input);
				if (requestUrl.startsWith("https://r.jina.ai/")) {
					return new Response(
						"Title: Example post\n\nMarkdown Content:\nThis is the useful post content recovered from reader proxy. It includes concrete claims and enough detail for retrieval and dialogue grounding.",
						{
							status: 200,
							headers: { "content-type": "text/plain; charset=utf-8" },
						},
					);
				}
				return new Response(
					"<html><body>X. it's what's happening. Join X today. Terms of Service Privacy Policy Cookie Policy Ads info Trending Grok.</body></html>",
					{
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
					},
				);
			},
		});
		expect(result.platform).toBe("twitter");
		expect(result.status).toBe("ok");
		expect(result.usable).toBe(true);
		expect(result.acquisitionMethod).toBe("reader_proxy");
		expect(result.attempts).toHaveLength(2);
		expect(result.attempts[0]?.status).not.toBe("ok");
		expect(["TWITTER_LOW_SIGNAL_CONTENT", "TWITTER_LOGIN_WALL", "LOGIN_REQUIRED"]).toContain(
			result.attempts[0]?.reasonCode,
		);
		expect(result.attempts[1]?.method).toBe("reader_proxy");
	});

	it("falls back to reader proxy when twitter direct fetch returns error page", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_twitter_error_page",
			url: "https://x.com/example/status/456",
			dataRootDir: root,
			fetchImpl: async (input) => {
				const requestUrl = String(input);
				if (requestUrl.startsWith("https://r.jina.ai/")) {
					return new Response(
						"Title: Recovered post\n\nMarkdown Content:\nRecovered content from reader proxy with enough context for use.",
						{
							status: 200,
							headers: { "content-type": "text/plain; charset=utf-8" },
						},
					);
				}
				return new Response(
					"Something went wrong, but don’t fret — let’s give it another shot. Try again. Some privacy related extensions may cause issues on x.com.",
					{
						status: 200,
						headers: { "content-type": "text/plain; charset=utf-8" },
					},
				);
			},
		});
		expect(result.platform).toBe("twitter");
		expect(result.status).toBe("ok");
		expect(result.usable).toBe(true);
		expect(result.acquisitionMethod).toBe("reader_proxy");
		expect(result.attempts).toHaveLength(2);
		expect(result.attempts[0]?.status).toBe("unsupported");
		expect(result.attempts[0]?.reasonCode).toBe("TWITTER_ERROR_PAGE");
		expect(result.attempts[1]?.method).toBe("reader_proxy");
	});

	it("treats r.jina.ai wrapped twitter plain text as usable text evidence", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_twitter_wrapped",
			url: "https://r.jina.ai/https://x.com/karpathy/status/2023476423055601903?s=20",
			dataRootDir: root,
			fetchImpl: async () =>
				new Response(
					"@karpathy: the training environment is the benchmark itself. This wrapped text includes enough concrete detail to exceed short-snippet heuristics and should remain usable as first-class text evidence for downstream retrieval and dialogue context.",
					{
						status: 200,
						headers: { "content-type": "text/plain; charset=utf-8" },
					},
				),
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

	it("falls back to auth browser fetch when reader proxy remains unusable", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_auth_browser_fallback",
			url: "https://x.com/example/status/987",
			dataRootDir: root,
			authStorageStateJson: '{"cookies":[{"name":"sid","value":"x"}],"origins":[]}',
			authBrowserFetchImpl: async () => ({
				httpStatus: 200,
				contentType: "text/html; charset=utf-8",
				finalUrl: "https://x.com/example/status/987",
				redirectChain: ["https://x.com/example/status/987"],
				html: "<html><body><article><p>Recovered authenticated post with concrete details and enough grounding text.</p></article></body></html>",
			}),
			fetchImpl: async (input) => {
				const requestUrl = String(input);
				if (requestUrl.startsWith("https://r.jina.ai/")) {
					return new Response("Sign in to continue reading.", {
						status: 200,
						headers: { "content-type": "text/plain; charset=utf-8" },
					});
				}
				return new Response("<html><body><h1>Log in to X</h1><p>Sign in required.</p></body></html>", {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			},
		});

		expect(result.platform).toBe("twitter");
		expect(result.status).toBe("ok");
		expect(result.usable).toBe(true);
		expect(result.acquisitionMethod).toBe("auth_browser_fetch");
		expect(result.attempts).toHaveLength(3);
		expect(result.attempts[0]?.method).toBe("direct_fetch");
		expect(result.attempts[1]?.method).toBe("reader_proxy");
		expect(result.attempts[2]?.method).toBe("auth_browser_fetch");
	});

	it("accepts authenticated xiaohongshu capture when full content exists despite incidental login text", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-source-"));
		tempDirs.push(root);

		const result = await captureFromSource({
			itemId: "item_auth_browser_xhs_content",
			url: "https://www.xiaohongshu.com/discovery/item/abc",
			dataRootDir: root,
			authStorageStateJson: '{"cookies":[{"name":"sid","value":"x"}],"origins":[]}',
			authBrowserFetchImpl: async () => ({
				httpStatus: 200,
				contentType: "text/html; charset=utf-8",
				finalUrl: "https://www.xiaohongshu.com/explore/abc",
				redirectChain: [
					"https://www.xiaohongshu.com/discovery/item/abc",
					"https://www.xiaohongshu.com/explore/abc",
				],
				html: [
					"<html><body>",
					"<h1>小红书笔记</h1>",
					"<p>登录后可发布内容。</p>",
					"<p>真正正文：强化学习环境设计要先简后繁，奖励函数要阶段化并规避作弊路径。</p>",
					"<p>进一步说明：先离散动作空间再连续控制，能显著降低早期训练不稳定性。</p>",
					"</body></html>",
				].join(""),
			}),
			fetchImpl: async (input) => {
				const requestUrl = String(input);
				if (requestUrl.startsWith("https://r.jina.ai/")) {
					return new Response("Sign in to continue reading.", {
						status: 200,
						headers: { "content-type": "text/plain; charset=utf-8" },
					});
				}
				return new Response("<html><body><h1>请登录后继续访问</h1></body></html>", {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			},
		});

		expect(result.platform).toBe("xiaohongshu");
		expect(result.status).toBe("ok");
		expect(result.usable).toBe(true);
		expect(result.acquisitionMethod).toBe("auth_browser_fetch");
		expect(result.attempts).toHaveLength(3);
		expect(result.attempts[2]?.method).toBe("auth_browser_fetch");
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
