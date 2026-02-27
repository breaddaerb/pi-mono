import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const AUTH_STATE_ENVELOPE_VERSION = 1;
const AES_256_GCM_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const SALT_LENGTH_BYTES = 16;

interface AuthStateEnvelopeV1 {
	v: 1;
	alg: "aes-256-gcm";
	kdf: "scrypt";
	salt: string;
	iv: string;
	tag: string;
	data: string;
}

function requireEncryptionKey(key: string): void {
	if (key.trim().length === 0) {
		throw new Error("Auth state encryption key must not be empty");
	}
}

function deriveKey(encryptionKey: string, salt: Buffer): Buffer {
	return scryptSync(encryptionKey, salt, KEY_LENGTH_BYTES);
}

function toBase64(value: Buffer): string {
	return value.toString("base64");
}

function fromBase64(value: string): Buffer {
	return Buffer.from(value, "base64");
}

function parseEnvelope(payload: string): AuthStateEnvelopeV1 {
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		throw new Error("Invalid encrypted auth state payload: not valid JSON");
	}

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("v" in parsed) ||
		!("alg" in parsed) ||
		!("kdf" in parsed) ||
		!("salt" in parsed) ||
		!("iv" in parsed) ||
		!("tag" in parsed) ||
		!("data" in parsed)
	) {
		throw new Error("Invalid encrypted auth state payload: missing envelope fields");
	}

	const envelope = parsed as Record<string, unknown>;
	if (
		envelope.v !== AUTH_STATE_ENVELOPE_VERSION ||
		envelope.alg !== AES_256_GCM_ALGORITHM ||
		envelope.kdf !== "scrypt" ||
		typeof envelope.salt !== "string" ||
		typeof envelope.iv !== "string" ||
		typeof envelope.tag !== "string" ||
		typeof envelope.data !== "string"
	) {
		throw new Error("Invalid encrypted auth state payload: unsupported envelope values");
	}

	return {
		v: 1,
		alg: "aes-256-gcm",
		kdf: "scrypt",
		salt: envelope.salt,
		iv: envelope.iv,
		tag: envelope.tag,
		data: envelope.data,
	};
}

export function encryptAuthState(plaintext: string, encryptionKey: string): string {
	requireEncryptionKey(encryptionKey);
	const salt = randomBytes(SALT_LENGTH_BYTES);
	const iv = randomBytes(IV_LENGTH_BYTES);
	const key = deriveKey(encryptionKey, salt);

	const cipher = createCipheriv(AES_256_GCM_ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();

	const envelope: AuthStateEnvelopeV1 = {
		v: 1,
		alg: "aes-256-gcm",
		kdf: "scrypt",
		salt: toBase64(salt),
		iv: toBase64(iv),
		tag: toBase64(authTag),
		data: toBase64(ciphertext),
	};
	return JSON.stringify(envelope);
}

export function decryptAuthState(payload: string, encryptionKey: string): string {
	requireEncryptionKey(encryptionKey);
	const envelope = parseEnvelope(payload);
	const salt = fromBase64(envelope.salt);
	const iv = fromBase64(envelope.iv);
	const authTag = fromBase64(envelope.tag);
	const ciphertext = fromBase64(envelope.data);

	const key = deriveKey(encryptionKey, salt);
	const decipher = createDecipheriv(AES_256_GCM_ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	try {
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		return plaintext.toString("utf8");
	} catch {
		throw new Error("Failed to decrypt auth state payload");
	}
}
