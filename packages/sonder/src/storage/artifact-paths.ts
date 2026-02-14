import { join } from "node:path";

export function getItemArtifactDirectory(dataRootDir: string, itemId: string): string {
	return join(dataRootDir, "items", itemId);
}

export function getArtifactFilePath(dataRootDir: string, itemId: string, relativeFileName: string): string {
	return join(getItemArtifactDirectory(dataRootDir, itemId), relativeFileName);
}
