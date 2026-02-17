import type { WechatHttpTrace } from "./wechat-http.js";

const WECHAT_CAPTCHA_URL_MARKERS = ["/mp/wappoc_appmsgcaptcha", "appmsgcaptcha"];
const WECHAT_CAPTCHA_BODY_MARKERS = [
	"环境异常",
	"去验证",
	"验证后即可继续访问",
	"请在微信客户端打开链接",
	"captcha",
	"wappoc_appmsgcaptcha",
];

export interface WechatRiskControlDetection {
	isRiskControl: boolean;
	reasonCode: string | null;
	reasonHint: string | null;
	matchedSignals: string[];
}

export function detectWechatRiskControl(trace: WechatHttpTrace): WechatRiskControlDetection {
	const finalUrlLower = trace.finalUrl.toLowerCase();
	const bodyLower = trace.body.toLowerCase();
	const matchedSignals: string[] = [];

	for (const marker of WECHAT_CAPTCHA_URL_MARKERS) {
		if (finalUrlLower.includes(marker)) {
			matchedSignals.push(`final_url:${marker}`);
		}
	}

	for (const marker of WECHAT_CAPTCHA_BODY_MARKERS) {
		if (bodyLower.includes(marker.toLowerCase())) {
			matchedSignals.push(`body:${marker}`);
		}
	}

	if (matchedSignals.length === 0) {
		return {
			isRiskControl: false,
			reasonCode: null,
			reasonHint: null,
			matchedSignals,
		};
	}

	return {
		isRiskControl: true,
		reasonCode: "WECHAT_CAPTCHA",
		reasonHint: "WeChat returned a verification/captcha wall for this request fingerprint.",
		matchedSignals,
	};
}
