import { readFileSync } from "node:fs";
import type { Annotation, DialogueTurn, Item } from "../types.js";

export interface AskContextInput {
	item: Item;
	annotations: Annotation[];
	dialogueTurns: DialogueTurn[];
	extractedTextPath: string | null;
	maxExtractedTextCharacters?: number;
}

export interface AskContext {
	item: Item;
	annotationEvidence: Annotation[];
	dialogueHistory: DialogueTurn[];
	extractedText: string;
}

function readExtractedText(path: string | null, maxCharacters: number): string {
	if (!path) {
		return "";
	}
	try {
		const text = readFileSync(path, "utf8");
		if (text.length <= maxCharacters) {
			return text;
		}
		return text.slice(0, maxCharacters);
	} catch {
		return "";
	}
}

export function buildAskContext(input: AskContextInput): AskContext {
	const maxCharacters = input.maxExtractedTextCharacters ?? 8_000;
	return {
		item: input.item,
		annotationEvidence: input.annotations,
		dialogueHistory: input.dialogueTurns,
		extractedText: readExtractedText(input.extractedTextPath, maxCharacters),
	};
}

export function renderAskPrompt(question: string, context: AskContext): string {
	const annotationLines = context.annotationEvidence.map((annotation) => {
		const text = annotation.text ?? "";
		const comment = annotation.comment ? ` | comment: ${annotation.comment}` : "";
		return `- [ann:${annotation.id}] (${annotation.type}) ${text}${comment}`.trim();
	});

	const dialogueLines = context.dialogueHistory.map((turn) => `- (${turn.role}) ${turn.content}`);

	return [
		`Item: ${context.item.id}`,
		`Source URL: ${context.item.originalUrl}`,
		"",
		"Annotation evidence (priority):",
		annotationLines.length > 0 ? annotationLines.join("\n") : "- (none)",
		"",
		"Prior dialogue:",
		dialogueLines.length > 0 ? dialogueLines.join("\n") : "- (none)",
		"",
		"Extracted text:",
		context.extractedText || "(empty)",
		"",
		`Question: ${question}`,
		"Answer with inline evidence references like [ann:<id>] [art:<id>] when possible.",
	].join("\n");
}
