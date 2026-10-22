/** Cryptographic action ID, scoped by the hosted service to the installation Shop. */
export function newSupportActionId() {
	if (typeof globalThis.crypto?.randomUUID !== 'function') {
		throw new Error('secure_action_id_unavailable');
	}
	return globalThis.crypto.randomUUID();
}
