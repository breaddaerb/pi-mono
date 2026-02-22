import { describe, expect, it } from "vitest";
import { compileContextProjection } from "../src/runtime/context-compiler.js";
import { buildSemanticTurns } from "../src/runtime/semantic-turn-service.js";
import type { DialogueTurn } from "../src/types.js";

function createTurn(input: {
	id: string;
	sessionId?: string;
	role: "user" | "assistant";
	content: string;
	createdAt: string;
	status?: "pending" | "failed" | "completed";
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
		status: input.status ?? "completed",
		errorMessage: null,
		createdAt: input.createdAt,
	};
}

describe("context compiler", () => {
	it("excludes detached semantic turns from included dialogue context", () => {
		const dialogueTurns: DialogueTurn[] = [
			createTurn({ id: "u1", role: "user", content: "first question", createdAt: "2026-02-01T00:00:00.000Z" }),
			createTurn({ id: "a1", role: "assistant", content: "first answer", createdAt: "2026-02-01T00:00:01.000Z" }),
			createTurn({ id: "u2", role: "user", content: "second question", createdAt: "2026-02-01T00:00:02.000Z" }),
			createTurn({ id: "a2", role: "assistant", content: "second answer", createdAt: "2026-02-01T00:00:03.000Z" }),
		];
		const semanticTurns = buildSemanticTurns(dialogueTurns);
		const stateBySemanticTurnId = new Map<string, "ACTIVE" | "DETACHED">([["u1", "DETACHED"]]);
		const compiled = compileContextProjection({
			semanticTurns,
			stateBySemanticTurnId,
			tokenBudget: 1_000,
		});

		expect(compiled.includedTurns.map((turn) => turn.id)).toEqual(["u2", "a2"]);
		expect(compiled.excludedItems).toEqual(
			expect.arrayContaining([expect.objectContaining({ semanticTurnId: "u1", reason: "detached" })]),
		);
	});

	it("prunes oldest active turns first when over budget", () => {
		const dialogueTurns: DialogueTurn[] = [
			createTurn({ id: "u1", role: "user", content: "x".repeat(80), createdAt: "2026-02-01T00:00:00.000Z" }),
			createTurn({ id: "a1", role: "assistant", content: "x".repeat(80), createdAt: "2026-02-01T00:00:01.000Z" }),
			createTurn({ id: "u2", role: "user", content: "x".repeat(80), createdAt: "2026-02-01T00:00:02.000Z" }),
			createTurn({ id: "a2", role: "assistant", content: "x".repeat(80), createdAt: "2026-02-01T00:00:03.000Z" }),
		];
		const semanticTurns = buildSemanticTurns(dialogueTurns);
		const compiled = compileContextProjection({
			semanticTurns,
			stateBySemanticTurnId: new Map(),
			tokenBudget: 50,
		});

		expect(compiled.includedTurns.map((turn) => turn.id)).toEqual(["u2", "a2"]);
		expect(compiled.excludedItems).toEqual(
			expect.arrayContaining([expect.objectContaining({ semanticTurnId: "u1", reason: "pruned_active" })]),
		);
	});
});
