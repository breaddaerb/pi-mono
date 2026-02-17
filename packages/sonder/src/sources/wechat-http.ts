export interface WechatHttpTrace {
	httpStatus: number;
	contentType: string | null;
	finalUrl: string;
	redirectChain: string[];
	body: string;
	responseHeaders: Headers;
}

export interface WechatFetchProfile {
	name: "ios_safari" | "android_chrome";
	headers: Record<string, string>;
}

export const WECHAT_IOS_SAFARI_PROFILE: WechatFetchProfile = {
	name: "ios_safari",
	headers: {
		accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
		connection: "keep-alive",
		referer: "https://mp.weixin.qq.com/",
		"upgrade-insecure-requests": "1",
		"user-agent":
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
	},
};

export const WECHAT_ANDROID_CHROME_PROFILE: WechatFetchProfile = {
	name: "android_chrome",
	headers: {
		accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
		connection: "keep-alive",
		referer: "https://mp.weixin.qq.com/",
		"upgrade-insecure-requests": "1",
		"user-agent":
			"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
	},
};

export class WechatCookieJar {
	private readonly hostCookies = new Map<string, Map<string, string>>();

	apply(url: string, headers: Headers): void {
		let host = "";
		try {
			host = new URL(url).host.toLowerCase();
		} catch {
			return;
		}
		const cookies = this.hostCookies.get(host);
		if (!cookies || cookies.size === 0) {
			return;
		}
		headers.set(
			"cookie",
			Array.from(cookies.entries())
				.map(([name, value]) => `${name}=${value}`)
				.join("; "),
		);
	}

	store(url: string, headers: Headers): void {
		let host = "";
		try {
			host = new URL(url).host.toLowerCase();
		} catch {
			return;
		}
		const cookies = this.hostCookies.get(host) ?? new Map<string, string>();
		for (const value of readSetCookieValues(headers)) {
			const [cookiePair] = value.split(";", 1);
			if (!cookiePair) {
				continue;
			}
			const separator = cookiePair.indexOf("=");
			if (separator <= 0) {
				continue;
			}
			const name = cookiePair.slice(0, separator).trim();
			const cookieValue = cookiePair.slice(separator + 1).trim();
			if (!name || !cookieValue) {
				continue;
			}
			cookies.set(name, cookieValue);
		}
		this.hostCookies.set(host, cookies);
	}
}

function readSetCookieValues(headers: Headers): string[] {
	const withSetCookie = headers as Headers & { getSetCookie?: () => string[] };
	if (typeof withSetCookie.getSetCookie === "function") {
		return withSetCookie.getSetCookie();
	}
	const combined = headers.get("set-cookie");
	return combined ? [combined] : [];
}

export async function fetchWechatWithTrace(input: {
	url: string;
	fetchImpl?: typeof fetch;
	profile: WechatFetchProfile;
	cookieJar?: WechatCookieJar;
	maxRedirects?: number;
}): Promise<WechatHttpTrace> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const maxRedirects = input.maxRedirects ?? 5;
	let currentUrl = input.url;
	const redirectChain: string[] = [];

	for (let hop = 0; hop <= maxRedirects; hop++) {
		const headers = new Headers(input.profile.headers);
		input.cookieJar?.apply(currentUrl, headers);
		const response = await fetchImpl(currentUrl, {
			method: "GET",
			headers,
			redirect: "manual",
		});
		input.cookieJar?.store(currentUrl, response.headers);

		const status = response.status;
		const location = response.headers.get("location");
		if (status >= 300 && status < 400 && location) {
			const nextUrl = new URL(location, currentUrl).toString();
			redirectChain.push(nextUrl);
			currentUrl = nextUrl;
			continue;
		}

		const body = await response.text();
		const responseHeaders = new Headers(response.headers);
		return {
			httpStatus: status,
			contentType: response.headers.get("content-type"),
			finalUrl: response.url || currentUrl,
			redirectChain,
			body,
			responseHeaders,
		};
	}

	throw new Error(`WECHAT_REDIRECT_LIMIT: exceeded ${maxRedirects} redirects`);
}
