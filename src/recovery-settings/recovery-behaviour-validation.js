// Shared form-only validation. The hosted merchant policy remains authoritative.
function validWholeMinutes(value, minimum) {
	return (
		/^(?:0|[1-9]\d*)$/.test(value) &&
		Number(value) >= minimum &&
		Number(value) <= 10080
	);
}

/**
 * Validate local inputs before the explicit Save recovery behaviour action.
 *
 * @param {Object}  draft
 * @param {string}  draft.recoveryDelayMinutes
 * @param {boolean} draft.followUpEnabled
 * @param {string}  draft.followUpDelayMinutes
 * @return {{start: boolean, followUp: boolean}} Flags identifying invalid preview fields.
 */
export function validateRecoveryBehaviourPreview(draft) {
	return {
		start: !validWholeMinutes(draft.recoveryDelayMinutes, 0),
		followUp:
			draft.followUpEnabled &&
			!validWholeMinutes(draft.followUpDelayMinutes, 60),
	};
}

/**
 * Convert persisted merchant preferences into a local, unsaved draft.
 *
 * @param {Object|null} effective
 * @return {{recoveryDelayMinutes: string, followUpEnabled: boolean, followUpDelayMinutes: string}} The local preview state.
 */
export function recoveryBehaviourPreview(effective) {
	return {
		recoveryDelayMinutes: effective
			? String(effective.recoveryDelayMinutes)
			: '',
		followUpEnabled: effective?.followUpEnabled === true,
		followUpDelayMinutes:
			effective?.followUpDelayMinutes === null ||
			effective?.followUpDelayMinutes === undefined
				? ''
				: String(effective.followUpDelayMinutes),
	};
}

/**
 * Only merchant-owned fields participate in dirty detection; active admin
 * overrides and unsupported provider coupon IDs are never submitted.
 *
 * @param {Object} merchant Persisted merchant preferences.
 * @param {Object} draft    Locally edited form values.
 * @return {boolean} Whether the editable fields have changed.
 */
export function recoveryBehaviourChanged(merchant, draft) {
	return (
		String(merchant.recoveryDelayMinutes) !== draft.recoveryDelayMinutes ||
		merchant.followUpEnabled !== draft.followUpEnabled ||
		(draft.followUpEnabled &&
			String(merchant.followUpDelayMinutes ?? '') !==
				draft.followUpDelayMinutes)
	);
}
