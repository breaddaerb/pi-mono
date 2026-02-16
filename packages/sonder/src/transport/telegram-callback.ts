export type CallbackAction =
	| "find_open"
	| "find_del"
	| "list_open"
	| "list_del"
	| "model_set"
	| "menu_time"
	| "menu_time_set"
	| "menu_source"
	| "menu_source_set"
	| "menu_tag"
	| "menu_tag_set"
	| "menu_tag_page"
	| "menu_sort"
	| "menu_sort_set"
	| "menu_back"
	| "menu_clear"
	| "menu_prev"
	| "menu_next"
	| "sess_resume"
	| "sess_new"
	| "hist_prev"
	| "hist_next"
	| "hist_back"
	| "hist_full"
	| "ctx_exit"
	| "ctx_viewer"
	| "ctx_del";

export interface CallbackPayload {
	version: "v1";
	action: CallbackAction;
	menuId: string;
	argument: string;
}

const CALLBACK_ACTIONS = new Set<CallbackAction>([
	"find_open",
	"find_del",
	"list_open",
	"list_del",
	"model_set",
	"menu_time",
	"menu_time_set",
	"menu_source",
	"menu_source_set",
	"menu_tag",
	"menu_tag_set",
	"menu_tag_page",
	"menu_sort",
	"menu_sort_set",
	"menu_back",
	"menu_clear",
	"menu_prev",
	"menu_next",
	"sess_resume",
	"sess_new",
	"hist_prev",
	"hist_next",
	"hist_back",
	"hist_full",
	"ctx_exit",
	"ctx_viewer",
	"ctx_del",
]);

export function parseCallbackPayload(data: string): CallbackPayload | null {
	const parts = data.split(":");
	if (parts.length !== 5) {
		return null;
	}
	if (parts[0] !== "sx" || parts[1] !== "v1") {
		return null;
	}
	const action = parts[2] as CallbackAction;
	if (!CALLBACK_ACTIONS.has(action)) {
		return null;
	}
	return {
		version: "v1",
		action,
		menuId: parts[3],
		argument: parts[4],
	};
}

export function buildCallbackPayload(action: CallbackAction, menuId: string, argument: number): string {
	return `sx:v1:${action}:${menuId}:${argument}`;
}
