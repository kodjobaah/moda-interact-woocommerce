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
 * Convert the v2 policy into a local draft. The notification preference is
 * top-level merchant data and remains separate from the effective projection.
 *
 * @param {Object|null} policy
 * @return {{recoveryDelayMinutes: string, followUpEnabled: boolean, followUpDelayMinutes: string, notifyOnInitialRecoveryOutreach: boolean}} The local preview state.
 */
export function recoveryBehaviourPreview(policy) {
	const merchant = policy?.merchant;
	return {
		recoveryDelayMinutes: merchant
			? String(merchant.recoveryDelayMinutes)
			: '',
		followUpEnabled: merchant?.followUpEnabled === true,
		followUpDelayMinutes:
			merchant?.followUpDelayMinutes === null ||
			merchant?.followUpDelayMinutes === undefined
				? ''
				: String(merchant.followUpDelayMinutes),
		notifyOnInitialRecoveryOutreach:
			policy?.notifyOnInitialRecoveryOutreach === true,
	};
}

/**
 * Only merchant-owned fields participate in dirty detection; active admin
 * overrides and unsupported provider coupon IDs are never submitted.
 *
 * @param {Object} policy Persisted v2 policy response.
 * @param {Object} draft    Locally edited form values.
 * @return {boolean} Whether the editable fields have changed.
 */
export function recoveryBehaviourChanged(policy, draft) {
	const merchant = policy.merchant;
	return (
		String(merchant.recoveryDelayMinutes) !== draft.recoveryDelayMinutes ||
		merchant.followUpEnabled !== draft.followUpEnabled ||
		(draft.followUpEnabled &&
			String(merchant.followUpDelayMinutes ?? '') !==
				draft.followUpDelayMinutes) ||
		policy.notifyOnInitialRecoveryOutreach !==
		draft.notifyOnInitialRecoveryOutreach
	);
}
