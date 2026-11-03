import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const STATUS_COPY = {
	QUEUED: __('Branding sync is queued. Moda has not accepted it yet.', 'moda-interact'),
	RETRYING: __('Moda could not accept the branding yet. A retry is scheduled.', 'moda-interact'),
	FAILED: __('Branding sync failed. Review the connection, then try again.', 'moda-interact'),
	NEVER_SYNCED: __('Not synchronised yet.', 'moda-interact'),
};

function formatTimestamp(value) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function StoreBrandPanel({ state, onRefresh, onSync }) {
	const data = state?.data;
	const status = data?.status;
	const busy = state?.commandPending || state?.status === 'REQUESTING';
	const unresolved = ['QUEUED', 'RETRYING'].includes(status);
	const accepted = formatTimestamp(data?.lastAcceptedAt);
	let errorCopy = null;
	if (state?.error) {
		const messages = {
			RECONNECT_REQUIRED: __('Reconnect Moda Interact before synchronising branding.', 'moda-interact'),
			SITE_URL_CHANGED: __('The site address changed. Reconnect Moda Interact to continue.', 'moda-interact'),
			LOCAL_STATE_INVALID: __('The local connection settings are invalid. Reconnect Moda Interact.', 'moda-interact'),
			SYNC_UNAVAILABLE: __('The sync could not be queued. Check that Action Scheduler is available, then retry.', 'moda-interact'),
			SYNC_STATUS_UNAVAILABLE: __('Sync status could not be loaded. Refresh to retry.', 'moda-interact'),
		};
		errorCopy = messages[state.error] ?? __('Branding sync could not be completed. Refresh status or try again.', 'moda-interact');
	}
	const liveCopy = busy ? __('Requesting a branding sync…', 'moda-interact') :
		status === 'ACCEPTED' ? __('Moda accepted these brand details. Background image processing may still be pending.', 'moda-interact') :
		STATUS_COPY[status] ?? (state?.status === 'LOADING' ? __('Loading sync status…', 'moda-interact') : null);
	return createElement('section', {
		className: 'moda-interact-recovery__panel moda-interact-store-brand',
		'aria-labelledby': 'moda-interact-store-brand-title',
		'aria-busy': busy || state?.status === 'LOADING',
	},
	createElement('div', { className: 'moda-interact-store-brand__heading' },
		createElement('h2', { id: 'moda-interact-store-brand-title' }, __('Store branding', 'moda-interact')),
		createElement('p', null, __('Edit your Site Name, Site Logo and Site Icon in WordPress Settings → General or Appearance → Editor. When you are ready, choose Sync branding to send the current details to Moda Interact.', 'moda-interact'))),
	createElement('p', null,
		createElement('strong', null, __('Last synchronised:', 'moda-interact')),
		' ', accepted ?? __('Not synchronised yet', 'moda-interact')),
	accepted ? createElement('p', null, __('This time is when Moda accepted the brand details. Background image processing may still be pending.', 'moda-interact')) : null,
	liveCopy ? createElement('p', { role: status === 'FAILED' ? 'alert' : 'status', className: 'moda-interact-store-brand__status' }, liveCopy) : null,
	errorCopy ? createElement('p', { role: 'alert', className: 'moda-interact-store-brand__status' }, errorCopy) : null,
	createElement('div', { className: 'moda-interact-store-brand__actions' },
		createElement('button', { type: 'button', className: 'button button-primary', onClick: onSync, disabled: busy || unresolved }, __('Sync branding', 'moda-interact')),
		createElement('button', { type: 'button', className: 'button', onClick: onRefresh, disabled: busy || state?.status === 'LOADING' }, __('Refresh status', 'moda-interact'))));
}
