import { describe, expect, it } from "vitest";
import { buildSemanticTurns } from "../src/runtime/semantic-turn-service.js";
import type { DialogueTurn } from "../src/types.js";

function createTurn(input: {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: string;
	sessionId?: string;
}): DialogueTurn {
	return {
		id: input.id,
		sessionId: input.sessionId ?? "sess-1",
		role: input.role,
		content: input.content,
		model: "stub",
		provider: "stub",
		citations: [],
		thinking: null,
		status: "completed",
		errorMessage: null,
		createdAt: input.createdAt,
	};
}

describe("semantic turn service", () => {
	it("pairs user/assistant turns and uses user turn id as semantic id", () => {
		const semanticTurns = buildSemanticTurns([
			createTurn({ id: "u1", role: "user", content: "hello", createdAt: "2026-02-01T00:00:00.000Z" }),
			createTurn({ id: "a1", role: "assistant", content: "hi", createdAt: "2026-02-01T00:00:01.000Z" }),
		]);

		expect(semanticTurns).toHaveLength(1);
		expect(semanticTurns[0]?.semanticTurnId).toBe("u1");
		expect(semanticTurns[0]?.assistantTurn?.id).toBe("a1");
	});

	it("keeps incomplete user turns when assistant row is missing", () => {
		const semanticTurns = buildSemanticTurns([
			createTurn({ id: "u1", role: "user", content: "first", createdAt: "2026-02-01T00:00:00.000Z" }),
			createTurn({ id: "u2", role: "user", content: "second", createdAt: "2026-02-01T00:00:01.000Z" }),
			createTurn({ id: "a2", role: "assistant", content: "second answer", createdAt: "2026-02-01T00:00:02.000Z" }),
		]);

		expect(semanticTurns).toHaveLength(2);
		expect(semanticTurns[0]?.semanticTurnId).toBe("u1");
		expect(semanticTurns[0]?.assistantTurn).toBeNull();
		expect(semanticTurns[1]?.semanticTurnId).toBe("u2");
		expect(semanticTurns[1]?.assistantTurn?.id).toBe("a2");
	});
});
