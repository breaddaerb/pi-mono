import { join } from "node:path";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import {
	type AskResponder,
	createCodexModelSelector,
	createCodexResponder,
	createStubResponder,
} from "../runtime/index.js";

export interface RuntimeModelSelector {
	listModels: () => Array<{ id: string }>;
	getSelectedModelId: () => string;
	setSelectedModelId: (modelId: string) => boolean;
}

export interface RuntimeResponderBundle {
	responder: AskResponder;
	modelSelector: RuntimeModelSelector | null;
}

function createCodexTokenResolver(env: NodeJS.ProcessEnv): () => Promise<string | undefined> {
	const explicitToken = env.SONDER_CODEX_TOKEN;
	if (explicitToken) {
		return async () => explicitToken;
	}

	const localAuthPath = env.SONDER_AUTH_PATH ?? join(process.cwd(), ".pi", "auth.json");
	const localAuthStorage = new AuthStorage(localAuthPath);
	const useGlobalAuth = env.SONDER_DISABLE_GLOBAL_AUTH !== "1";
	const globalAuthStorage = useGlobalAuth ? new AuthStorage() : null;

	return async () => {
		const localToken = await localAuthStorage.getApiKey("openai-codex");
		if (localToken) {
			return localToken;
		}
		if (!globalAuthStorage) {
			return undefined;
		}
		return globalAuthStorage.getApiKey("openai-codex");
	};
}

export function createRuntimeResponderFromEnv(env: NodeJS.ProcessEnv): RuntimeResponderBundle {
	const mode = (env.SONDER_RESPONDER ?? "stub").toLowerCase();
	if (mode === "codex") {
		const reasoning = env.SONDER_CODEX_REASONING;
		const modelSelector = createCodexModelSelector(env.SONDER_CODEX_MODEL);
		return {
			responder: createCodexResponder({
				getToken: createCodexTokenResolver(env),
				getModelId: modelSelector.getSelectedModelId,
				reasoning:
					reasoning === "minimal" || reasoning === "low" || reasoning === "medium" || reasoning === "high"
						? reasoning
						: undefined,
			}),
			modelSelector,
		};
	}
	return { responder: createStubResponder(), modelSelector: null };
}

export function createResponderFromEnv(env: NodeJS.ProcessEnv): AskResponder {
	return createRuntimeResponderFromEnv(env).responder;
}
