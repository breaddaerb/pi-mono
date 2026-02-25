import type { Annotation, DialogueTurn, Item } from "../types.js";

export interface AskContextInput {
	item: Item;
	annotations: Annotation[];
	dialogueTurns: DialogueTurn[];
	canonicalMarkdown: string;
	maxExtractedTextCharacters?: number;
}

export interface AskContext {
	item: Item;
	annotationEvidence: Annotation[];
	dialogueHistory: DialogueTurn[];
	extractedText: string;
}

export const DEFAULT_MAX_EXTRACTED_TEXT_CHARACTERS = 50_000;

function readCanonicalText(markdown: string, maxCharacters: number): string {
	if (!markdown) {
		return "";
	}
	if (markdown.length <= maxCharacters) {
		return markdown;
	}
	return markdown.slice(0, maxCharacters);
}

export function buildAskContext(input: AskContextInput): AskContext {
	const maxCharacters = input.maxExtractedTextCharacters ?? DEFAULT_MAX_EXTRACTED_TEXT_CHARACTERS;
	return {
		item: input.item,
		annotationEvidence: input.annotations,
		dialogueHistory: input.dialogueTurns,
		extractedText: readCanonicalText(input.canonicalMarkdown, maxCharacters),
	};
}

export function renderAskPrompt(question: string, context: AskContext): string {
	const annotationLines = context.annotationEvidence.map((annotation) => {
		const text = annotation.text ?? "";
		const comment = annotation.comment ? ` | comment: ${annotation.comment}` : "";
		return `- [ann:${annotation.id}] (${annotation.type}) ${text}${comment}`.trim();
	});

	const dialogueLines = context.dialogueHistory.map((turn) => {
		const status = turn.status === "completed" ? "" : `:${turn.status}`;
		const content =
			turn.status === "failed" ? (turn.errorMessage ? `(failed: ${turn.errorMessage})` : "(failed)") : turn.content;
		return `- (${turn.role}${status}) ${content}`;
	});

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
		"Canonical markdown:",
		context.extractedText || "(empty)",
		"",
		`Question: ${question}`,
		"Use item context naturally. Cite evidence only when it materially helps clarity.",
	].join("\n");
}
