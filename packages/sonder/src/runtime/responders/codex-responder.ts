import { type AssistantMessage, completeSimple, getModels, type Message, type Model } from "@mariozechner/pi-ai";
import type { AskResponder } from "../index.js";

function resolveCodexModel(modelId?: string): Model<"openai-codex-responses"> {
	const models = getModels("openai-codex");
	if (models.length === 0) {
		throw new Error("No openai-codex models available in registry.");
	}
	if (!modelId) {
		return models[0];
	}
	const selected = models.find((model) => model.id === modelId);
	if (!selected) {
		throw new Error(`Unknown Codex model: ${modelId}`);
	}
	return selected;
}

function extractTextContent(message: AssistantMessage): string {
	const textBlocks = message.content
		.filter(
			(content): content is Extract<Message, { role: "assistant" }>["content"][number] & { type: "text" } =>
				content.type === "text",
		)
		.map((content) => content.text);
	return textBlocks.join("\n").trim();
}

function extractThinkingContent(message: AssistantMessage): string | undefined {
	const thinkingBlocks = message.content
		.filter(
			(content): content is Extract<Message, { role: "assistant" }>["content"][number] & { type: "thinking" } =>
				content.type === "thinking",
		)
		.map((content) => content.thinking);
	const combined = thinkingBlocks.join("\n").trim();
	return combined.length > 0 ? combined : undefined;
}

function extractCitations(answer: string): string[] {
	const matches = answer.matchAll(/\[(ann:[^\]]+|art:[^\]]+)\]/g);
	const seen = new Set<string>();
	for (const match of matches) {
		const citation = match[1];
		if (citation) {
			seen.add(citation);
		}
	}
	return [...seen];
}

export interface CodexResponderOptions {
	token?: string;
	getToken?: () => Promise<string | undefined>;
	modelId?: string;
	reasoning?: "minimal" | "low" | "medium" | "high";
}

export function createCodexResponder(options: CodexResponderOptions): AskResponder {
	const model = resolveCodexModel(options.modelId);
	return async (input) => {
		const resolvedToken = options.token ?? (options.getToken ? await options.getToken() : undefined);
		if (!resolvedToken) {
			throw new Error("No Codex token available. Set SONDER_CODEX_TOKEN or login via pi OAuth.");
		}

		const response = await completeSimple(
			model,
			{
				systemPrompt: [
					"You are Sonder's dialogue partner. Think with the user, not just for the user.",
					"Help unfold ideas, test assumptions, surface structure, and connect fragments across contexts.",
					"Be precise when discussing technical topics, and exploratory when engaging with literature, emotion, or lived experience.",
					"Do not default to citations or task-oriented answers unless the context clearly requires it.",
				].join(" "),
				messages: [
					{
						role: "user",
						content: input.prompt,
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: resolvedToken,
				reasoning: options.reasoning,
				sessionId: input.itemId,
			},
		);

		if (response.stopReason === "error" || response.stopReason === "aborted") {
			throw new Error(response.errorMessage ?? `Codex request failed with stop reason: ${response.stopReason}`);
		}

		const answer = extractTextContent(response);
		if (answer.length === 0) {
			const contentTypes = response.content.map((content) => content.type).join(", ");
			throw new Error(
				`Codex returned no text content (content types: ${contentTypes || "none"}, stop reason: ${response.stopReason}).`,
			);
		}

		return {
			answer,
			model: response.model,
			provider: response.provider,
			citations: extractCitations(answer),
			thinking: extractThinkingContent(response),
		};
	};
}
