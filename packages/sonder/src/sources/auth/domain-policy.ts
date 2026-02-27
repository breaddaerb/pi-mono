const CANONICAL_DOMAIN_MAP: Record<string, string> = {
	"www.reddit.com": "reddit.com",
	"old.reddit.com": "reddit.com",
	"www.twitter.com": "x.com",
	"twitter.com": "x.com",
	"www.x.com": "x.com",
	"www.xiaohongshu.com": "xiaohongshu.com",
	"www.mp.weixin.qq.com": "mp.weixin.qq.com",
};

const AUTH_ELIGIBLE_DOMAINS = new Set<string>(["x.com", "reddit.com", "xiaohongshu.com", "mp.weixin.qq.com"]);
const AUTH_LOGIN_URL_BY_DOMAIN: Record<string, string> = {
	"x.com": "https://x.com/i/flow/login",
	"reddit.com": "https://www.reddit.com/login/",
	"xiaohongshu.com": "https://www.xiaohongshu.com",
	"mp.weixin.qq.com": "https://mp.weixin.qq.com/",
};

function normalizeHost(host: string): string {
	const trimmed = host.trim().toLowerCase();
	if (!trimmed) {
		return "";
	}
	return CANONICAL_DOMAIN_MAP[trimmed] ?? trimmed;
}

function extractHost(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		return "";
	}
	try {
		return new URL(trimmed).hostname;
	} catch {
		// Fall through and try host-like parsing below.
	}
	try {
		return new URL(`https://${trimmed}`).hostname;
	} catch {
		return "";
	}
}

export function normalizeAuthDomain(input: string): string {
	const host = extractHost(input);
	return normalizeHost(host);
}

export function isAuthEligibleDomain(input: string): boolean {
	const normalized = normalizeAuthDomain(input);
	if (!normalized) {
		return false;
	}
	if (AUTH_ELIGIBLE_DOMAINS.has(normalized)) {
		return true;
	}
	for (const candidate of AUTH_ELIGIBLE_DOMAINS) {
		if (normalized.endsWith(`.${candidate}`)) {
			return true;
		}
	}
	return false;
}

export function assertAuthEligibleDomain(input: string): string {
	const normalized = normalizeAuthDomain(input);
	if (!normalized) {
		throw new Error(`Invalid auth domain: ${input}`);
	}
	if (!isAuthEligibleDomain(normalized)) {
		throw new Error(`Auth domain is not supported: ${normalized}`);
	}
	return normalized;
}

export function getAuthLoginUrl(input: string): string {
	const domain = assertAuthEligibleDomain(input);
	return AUTH_LOGIN_URL_BY_DOMAIN[domain] ?? `https://${domain}`;
}
