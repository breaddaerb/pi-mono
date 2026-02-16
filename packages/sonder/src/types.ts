export type ItemSourceType = "web";

export interface Item {
	id: string;
	createdAt: string;
	sourceType: ItemSourceType;
	originalUrl: string;
	whyNote: string | null;
	tags: string[];
	topic: string | null;
	space: string | null;
}

export type ArtifactKind =
	| "snapshot-html"
	| "snapshot-assets"
	| "extracted-text"
	| "screenshot-fallback"
	| "evidence-md";

export interface Artifact {
	id: string;
	itemId: string;
	kind: ArtifactKind;
	path: string;
	mimeType: string;
	version: number;
	createdAt: string;
}

export type AnnotationType = "highlight" | "underline" | "note";

export interface Annotation {
	id: string;
	itemId: string;
	artifactId: string;
	type: AnnotationType;
	text: string | null;
	comment: string | null;
	color: string | null;
	tags: string[];
	anchor: string;
	createdAt: string;
	updatedAt: string;
}

export interface DialogueSession {
	id: string;
	itemId: string;
	title: string;
	createdAt: string;
}

export type DialogueTurnRole = "user" | "assistant" | "system";

export type DialogueTurnStatus = "pending" | "failed" | "completed";

export interface DialogueTurn {
	id: string;
	sessionId: string;
	role: DialogueTurnRole;
	content: string;
	model: string;
	provider: string;
	citations: string[];
	thinking: string | null;
	status: DialogueTurnStatus;
	errorMessage: string | null;
	createdAt: string;
}
