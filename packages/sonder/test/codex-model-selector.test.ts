import { getModels } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
	createCodexModelSelector,
	DEFAULT_PREFERRED_CODEX_MODEL_ID,
} from "../src/runtime/responders/codex-responder.js";

describe("createCodexModelSelector", () => {
	it("prefers gpt-5.2 by default when available", () => {
		const modelIds = getModels("openai-codex").map((model) => model.id);
		expect(modelIds.length).toBeGreaterThan(0);
		const selector = createCodexModelSelector();
		const expectedDefault = modelIds.includes(DEFAULT_PREFERRED_CODEX_MODEL_ID)
			? DEFAULT_PREFERRED_CODEX_MODEL_ID
			: modelIds[0];
		expect(selector.getSelectedModelId()).toBe(expectedDefault);
	});

	it("respects explicit initial model id", () => {
		const modelIds = getModels("openai-codex").map((model) => model.id);
		expect(modelIds.length).toBeGreaterThan(0);
		const explicitModelId = modelIds[modelIds.length - 1];
		const selector = createCodexModelSelector(explicitModelId);
		expect(selector.getSelectedModelId()).toBe(explicitModelId);
	});

	it("rejects unknown model id", () => {
		expect(() => createCodexModelSelector("unknown-model-id")).toThrow("Unknown Codex model");
	});
});
