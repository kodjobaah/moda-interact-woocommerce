import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/** Connected-merchant consent, separate from billing and Moda installation state. */
export function ReadAccessPanel({ state, onStart, onRefresh, onRevoke }) {
	const { status, grantStatus, pendingAction, authorizationUrl, providerRevocationRequired, approvalNotCompleted } = state;
	const busy = !!pendingAction || status === 'LOADING';
	const connected = grantStatus === 'CONNECTED';
	const pending = status === 'READY' && grantStatus === 'PENDING';
	let message;
	if (status === 'LOADING' || status === 'IDLE') {
		message = __('Checking…', 'moda-interact');
	} else if (status === 'ERROR') {
		message = __('Read access could not be checked. Your Moda connection is unchanged.', 'moda-interact');
	} else if (connected) {
		message = __('Read access approved', 'moda-interact');
	} else if (pending) {
		message = __('Awaiting WooCommerce approval', 'moda-interact');
	} else if (approvalNotCompleted) {
		message = __('Approval was not completed or has expired', 'moda-interact');
	} else if (grantStatus === 'REAUTHORIZATION_REQUIRED') {
		message = __('Read access needs approval again', 'moda-interact');
	} else {
		message = __('Read access not enabled', 'moda-interact');
	}
	const confirmRevoke = () => {
		if (globalThis.confirm?.(__('Stop Moda Interact from reading store data?', 'moda-interact'))) onRevoke();
	};

	return createElement(
		'section',
		{ className: 'moda-interact-read-access', 'aria-labelledby': 'moda-interact-read-access-title', 'aria-busy': busy },
		createElement('div', { className: 'moda-interact-read-access__header' },
			createElement('h2', { id: 'moda-interact-read-access-title' }, __('Store read access', 'moda-interact')),
			connected ? createElement('span', { className: 'moda-interact-status' }, __('Connected', 'moda-interact')) : null
		),
		createElement('p', null, __('Allow Moda Interact to read store data. WooCommerce will ask you to approve read-only access.', 'moda-interact')),
		createElement('p', { className: status === 'ERROR' ? 'moda-interact-message moda-interact-message--error' : 'moda-interact-message', role: status === 'ERROR' ? 'alert' : 'status', 'aria-live': 'polite' }, message),
		pending && authorizationUrl
			? createElement('p', null,
				createElement('a', { className: 'button button-primary', href: authorizationUrl, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' }, __('Open WooCommerce approval', 'moda-interact'))
			)
			: null,
		pending && authorizationUrl
			? createElement('p', { className: 'moda-interact-read-access__hint' }, __('Approval opens in a new tab. Return here to check the result.', 'moda-interact'))
			: null,
		providerRevocationRequired
			? createElement('p', { className: 'moda-interact-read-access__hint' }, __('To revoke the key at the store, open WooCommerce > Settings > Advanced > REST API.', 'moda-interact'))
			: null,
		createElement('div', { className: 'moda-interact-read-access__actions' },
			!connected && (!pending || !authorizationUrl) && status === 'READY'
				? createElement('button', { type: 'button', className: 'button button-primary', disabled: busy, onClick: onStart }, pendingAction === 'start' ? __('Checking…', 'moda-interact') : __('Allow read access', 'moda-interact'))
				: null,
			connected ? createElement('button', { type: 'button', className: 'button', disabled: busy, onClick: confirmRevoke }, __('Stop read access', 'moda-interact')) : null,
			status !== 'LOADING' && status !== 'IDLE'
				? createElement('button', { type: 'button', className: 'button', disabled: busy, onClick: onRefresh }, __('Check access', 'moda-interact'))
				: null
		)
	);
}
