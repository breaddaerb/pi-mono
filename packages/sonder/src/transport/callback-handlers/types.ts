export type InlineKeyboard = Array<Array<{ text: string; callbackData: string }>>;

export interface ModelMenuStateLike {
	modelIds: string[];
}

export interface SessionMenuStateLike {
	itemId: string;
	sessionIds: string[];
}

export interface DialogueSessionInfoLike {
	itemId: string;
	sessionId: string;
}

export interface ItemMenuStateLike {
	kind: "find" | "list";
	page: number;
	pageSize: number;
	time: "all" | "today" | "7d" | "30d" | "year";
	source: "any" | "web";
	tag: string | null;
	sort: "newest" | "oldest";
	tagPage: number;
}

export interface HistoryMenuStateLike {
	sessionId: string;
	page: number;
	pageSize: number;
}

export interface ContextPanelMenuStateLike {
	sessionId: string;
	page: number;
	pageSize: number;
	rowSemanticTurnIds: string[];
}

export interface DialogueTurnLike {
	role: "user" | "assistant" | "system";
	content: string;
	status: "pending" | "failed" | "completed";
	errorMessage: string | null;
	createdAt: string;
}

export type ChatModeLike =
	| { mode: "item"; itemId: string; sessionId: string }
	| { mode: "general"; sessionId: string; history: Array<{ role: "user" | "assistant"; content: string }> };

export type ChatModeSetter = (chatId: number, mode: { mode: "item"; itemId: string; sessionId: string }) => void;

export type MessageSender = (
	chatId: number,
	text: string,
	options?: { inlineKeyboard?: InlineKeyboard },
) => Promise<void>;
