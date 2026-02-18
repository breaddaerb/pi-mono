import type { AskService } from "../runtime/ask-service.js";
import type { DialogueRepo } from "../storage/dialogue-repo.js";
import type { ItemsRepo } from "../storage/items-repo.js";
import type { DialogueTurnStatus } from "../types.js";

export interface DialogueSessionInfo {
	itemId: string;
	sessionId: string;
	created: boolean;
}

export interface DialogueHistoryTurn {
	id: string;
	sessionId: string;
	role: "user" | "assistant" | "system";
	content: string;
	status: DialogueTurnStatus;
	errorMessage: string | null;
	createdAt: string;
}

export interface DialogueServiceOptions {
	itemsRepo: ItemsRepo;
	dialogueRepo: DialogueRepo;
	askService: AskService;
}

export class DialogueService {
	constructor(private readonly options: DialogueServiceOptions) {}

	hasItem(itemId: string): boolean {
		return this.options.itemsRepo.findById(itemId) !== null;
	}

	isSessionForItem(itemId: string, sessionId: string): boolean {
		const session = this.options.dialogueRepo.findSessionById(sessionId);
		return Boolean(session && session.itemId === itemId);
	}

	openItemDialogue(itemId: string, preferredSessionId?: string): DialogueSessionInfo {
		this.ensureItemExists(itemId);
		const ensured = this.options.askService.ensureSession(itemId, preferredSessionId);
		return {
			itemId,
			sessionId: ensured.sessionId,
			created: ensured.created,
		};
	}

	createItemDialogue(itemId: string): DialogueSessionInfo {
		this.ensureItemExists(itemId);
		const created = this.options.askService.createSession(itemId);
		return {
			itemId,
			sessionId: created.sessionId,
			created: true,
		};
	}

	listItemDialogues(itemId: string): Array<{ sessionId: string; createdAt: string; title: string }> {
		this.ensureItemExists(itemId);
		return this.options.dialogueRepo.listSessionsByItemId(itemId).map((session) => ({
			sessionId: session.id,
			createdAt: session.createdAt,
			title: session.title,
		}));
	}

	listDialogueHistory(sessionId: string, limit = 20): DialogueHistoryTurn[] {
		const session = this.options.dialogueRepo.findSessionById(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		const turns = this.options.dialogueRepo.listTurnsBySessionId(sessionId);
		const start = Math.max(0, turns.length - Math.max(1, Math.floor(limit)));
		return turns.slice(start).map((turn) => ({
			id: turn.id,
			sessionId: turn.sessionId,
			role: turn.role,
			content: turn.content,
			status: turn.status,
			errorMessage: turn.errorMessage,
			createdAt: turn.createdAt,
		}));
	}

	resumeItemDialogue(sessionId: string): DialogueSessionInfo {
		const session = this.options.dialogueRepo.findSessionById(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return {
			itemId: session.itemId,
			sessionId: session.id,
			created: false,
		};
	}

	private ensureItemExists(itemId: string): void {
		if (!this.options.itemsRepo.findById(itemId)) {
			throw new Error(`Item not found: ${itemId}`);
		}
	}
}
