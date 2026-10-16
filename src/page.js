import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { ReadAccessPanel } from './read-access/read-access-panel';
import { ConnectedWorkspace } from './page/connected-workspace';
import { ConnectionPanel } from './page/connection-panel';
import { useModaPageState } from './page/use-moda-page-state';
import { isNativeMerchantPage } from './native-admin/page-surface';

/** Top-level composition only; each feature owns its controller and presentation. */
function ModaInteractPage() {
	const page = useModaPageState();
	const connectedRecoveries =
		page.activeSurface === 'RECOVERIES' &&
		page.connectionState.connection.status === 'CONNECTED';
	const connectedRecoverySettings =
		page.activeSurface === 'RECOVERY' &&
		page.connectionState.connection.status === 'CONNECTED';
	const connectedPromotions =
		page.activeSurface === 'PROMOTIONS' &&
		page.connectionState.connection.status === 'CONNECTED';
	const connectedSupport =
		page.activeSurface === 'SUPPORT' &&
		page.connectionState.connection.status === 'CONNECTED';
	const connectedBilling =
		page.activeSurface === 'BILLING' &&
		page.connectionState.connection.status === 'CONNECTED';

	let pageClassName = 'moda-interact-page';
	if (connectedSupport) {
		pageClassName += ' moda-interact-page--support';
	} else if (connectedBilling) {
		pageClassName += ' moda-interact-page--billing';
	} else if (connectedRecoverySettings) {
		pageClassName += ' moda-interact-page--recovery-settings';
	} else if (connectedPromotions) {
		pageClassName += ' moda-interact-page--promotions';
	} else if (connectedRecoveries) {
		pageClassName += ' moda-interact-page--recoveries';
	}

	return createElement(
		'main',
		{ className: pageClassName },
		connectedBilling ||
			connectedRecoveries ||
			connectedRecoverySettings ||
			connectedPromotions ||
			connectedSupport
			? null
			: createElement(
					'header',
					{ className: 'moda-interact-page__header' },
					createElement(
						'p',
						{ className: 'moda-interact-page__eyebrow' },
						__('WooCommerce', 'moda-interact')
					),
					createElement(
						'h1',
						null,
						__('Moda Interact', 'moda-interact')
					)
				),
		createElement(
			'div',
			{ className: 'moda-interact-page__content' },
			connectedBilling ||
				connectedRecoveries ||
				connectedRecoverySettings ||
				connectedPromotions ||
				connectedSupport
				? null
				: createElement(ConnectionPanel, {
						state: page.connectionState,
						onConnect: page.actions.connect,
						onRetry: page.actions.retryConnection,
					}),
			page.connectionState.connection.status === 'CONNECTED'
				? createElement(ConnectedWorkspace, {
						activeSurface: page.activeSurface,
						connectionIdentity: `${page.connectionState.connection.installationId ?? ''}:${page.connectionState.connection.credentialVersion ?? ''}`,
						merchantState: page.merchantState,
						billingState: page.billingState,
						syncState: page.syncState,
						categoryState: page.categoryState,
						recoverySummaryState: page.recoverySummaryState,
						recoveryPolicyState: page.recoveryPolicyState,
						actions: page.actions,
						showSurfaceNavigation: !isNativeMerchantPage(
							globalThis.location?.search ?? ''
						),
					})
				: null,
			page.connectionState.connection.status === 'CONNECTED' &&
				page.activeSurface === 'OVERVIEW'
				? createElement(ReadAccessPanel, {
						state: page.readAccessState,
						onStart: page.actions.startReadAccess,
						onRefresh: page.actions.refreshReadAccess,
						onRevoke: page.actions.revokeReadAccess,
					})
				: null
		)
	);
}

export { ConnectionPanel } from './page/connection-panel';
export default ModaInteractPage;
