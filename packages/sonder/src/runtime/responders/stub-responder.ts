import type { AskResponder } from "../index.js";

export function createStubResponder(): AskResponder {
	return async (input) => {
		const citations = input.context.annotationEvidence.slice(0, 2).map((annotation) => `ann:${annotation.id}`);
		const citationSuffix = citations.length > 0 ? ` ${citations.map((citation) => `[${citation}]`).join(" ")}` : "";
		return {
			answer: `Stub response: ${input.question}.${citationSuffix}`.trim(),
			model: "stub-model",
			provider: "stub-provider",
			citations,
		};
	};
}
