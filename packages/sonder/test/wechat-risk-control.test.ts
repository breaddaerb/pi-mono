import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchWechatWithTrace, WECHAT_IOS_SAFARI_PROFILE, WechatCookieJar } from "../src/sources/wechat-http.js";
import { detectWechatRiskControl } from "../src/sources/wechat-risk-control.js";

interface TestServer {
	baseUrl: string;
	close: () => Promise<void>;
}

async function withServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<TestServer> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Server address is unavailable");
	}
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			}),
	};
}

describe("wechat risk control helpers", () => {
	const cleanup: Array<() => Promise<void>> = [];
	afterEach(async () => {
		for (const close of cleanup) {
			await close();
		}
		cleanup.length = 0;
	});

	it("detects risk_control from captcha final url", () => {
		const detection = detectWechatRiskControl({
			httpStatus: 200,
			contentType: "text/html",
			finalUrl: "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=abc",
			redirectChain: [],
			body: "<html><body>normal</body></html>",
			responseHeaders: new Headers(),
		});
		expect(detection.isRiskControl).toBe(true);
		expect(detection.reasonCode).toBe("WECHAT_CAPTCHA");
	});

	it("detects risk_control from captcha body markers", () => {
		const detection = detectWechatRiskControl({
			httpStatus: 200,
			contentType: "text/html",
			finalUrl: "https://mp.weixin.qq.com/s?x=1",
			redirectChain: [],
			body: "环境异常，请稍后重试，去验证后即可继续访问",
			responseHeaders: new Headers(),
		});
		expect(detection.isRiskControl).toBe(true);
		expect(detection.matchedSignals.length).toBeGreaterThan(0);
	});

	it("traces redirects and replays cookies across hops", async () => {
		const server = await withServer((request, response) => {
			if (request.url === "/start") {
				response.writeHead(302, {
					location: "/hop1",
					"set-cookie": "wxsid=abc; Path=/; HttpOnly",
				});
				response.end();
				return;
			}
			if (request.url === "/hop1") {
				const cookie = request.headers.cookie ?? "";
				if (!cookie.includes("wxsid=abc")) {
					response.writeHead(400, { "content-type": "text/plain" });
					response.end("missing first cookie");
					return;
				}
				response.writeHead(302, {
					location: "/final",
					"set-cookie": "wx_token=xyz; Path=/",
				});
				response.end();
				return;
			}
			if (request.url === "/final") {
				const cookie = request.headers.cookie ?? "";
				if (!cookie.includes("wxsid=abc") || !cookie.includes("wx_token=xyz")) {
					response.writeHead(400, { "content-type": "text/plain" });
					response.end("missing chained cookies");
					return;
				}
				response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
				response.end("<html><body><h1>Article</h1></body></html>");
				return;
			}
			response.writeHead(404, { "content-type": "text/plain" });
			response.end("not found");
		});
		cleanup.push(server.close);

		const trace = await fetchWechatWithTrace({
			url: `${server.baseUrl}/start`,
			profile: WECHAT_IOS_SAFARI_PROFILE,
			cookieJar: new WechatCookieJar(),
			maxRedirects: 5,
		});

		expect(trace.httpStatus).toBe(200);
		expect(trace.finalUrl).toBe(`${server.baseUrl}/final`);
		expect(trace.redirectChain).toEqual([`${server.baseUrl}/hop1`, `${server.baseUrl}/final`]);
		expect(trace.body).toContain("Article");
	});
});
