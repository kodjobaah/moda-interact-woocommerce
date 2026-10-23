export const SELECTION_PATH =
	'/moda-interact/v1/merchant/customer-recovery-selection';
export const SELECTION_VERSION = 'woo.customer-recovery-selection.v1';
export const isCanonicalPhone = (phone) =>
	typeof phone === 'string' && /^[1-9][0-9]{1,14}$/.test(phone);
export const isTicketReference = (reference) =>
	typeof reference === 'string' &&
	/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(reference);
const revision = (value) =>
	typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value);
const exact = (obj, names) =>
	obj !== null &&
	typeof obj === 'object' &&
	!Array.isArray(obj) &&
	Object.keys(obj).length === names.length &&
	names.every((name) => Object.hasOwn(obj, name));

/** Reject hosted responses with extra PII or fabricated consent status. */
export function parseSelectionStatus(value, hasOutcome = false) {
	const keys = [
		'schemaVersion',
		'consentDecision',
		'suppressed',
		'suppressionReason',
		'noContactRevision',
		'phoneEligibleForRecovery',
		'canReenable',
	];
	if (hasOutcome) {
		keys.push('outcome');
	}
	if (
		!exact(value, keys) ||
		value.schemaVersion !== SELECTION_VERSION ||
		!['UNKNOWN', 'GRANTED', 'REVOKED'].includes(value.consentDecision) ||
		typeof value.suppressed !== 'boolean' ||
		![null, 'MERCHANT_OPT_OUT', 'CUSTOMER_STOP'].includes(
			value.suppressionReason
		) ||
		value.suppressed !== (value.suppressionReason !== null) ||
		!revision(value.noContactRevision) ||
		typeof value.phoneEligibleForRecovery !== 'boolean' ||
		typeof value.canReenable !== 'boolean' ||
		(value.phoneEligibleForRecovery &&
			(value.suppressed || value.consentDecision !== 'GRANTED')) ||
		(value.canReenable &&
			(value.suppressionReason !== 'MERCHANT_OPT_OUT' ||
				value.consentDecision !== 'GRANTED')) ||
		(hasOutcome && !['updated', 'duplicate'].includes(value.outcome))
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return value;
}

export function makeSelectionCommand(status, phone, action, evidenceReference) {
	if (
		!revision(status?.noContactRevision) ||
		!isCanonicalPhone(phone) ||
		!['SUPPRESS', 'REENABLE', 'RECORD_CUSTOMER_STOP'].includes(action) ||
		(action === 'RECORD_CUSTOMER_STOP'
			? !isTicketReference(evidenceReference)
			: evidenceReference !== null)
	) {
		throw new Error('INVALID_REQUEST');
	}
	return {
		schemaVersion: SELECTION_VERSION,
		canonicalPhone: phone,
		action,
		expectedNoContactRevision: status.noContactRevision,
		evidenceReference,
	};
}
