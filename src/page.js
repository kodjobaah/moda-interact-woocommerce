import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { ConnectedWorkspace } from './page/connected-workspace';
import { ConnectionPanel } from './page/connection-panel';
import { useModaPageState } from './page/use-moda-page-state';
import { isNativeMerchantPage } from './native-admin/page-surface';

/** Top-level composition only; each feature owns its controller and presentation. */
function ModaInteractPage() {
	const page = useModaPageState();

	return createElement(
		'main',
		{ className: 'moda-interact-page' },
		createElement(
			'header',
			{ className: 'moda-interact-page__header' },
			createElement(
				'p',
				{ className: 'moda-interact-page__eyebrow' },
				__('WooCommerce', 'moda-interact')
			),
			createElement('h1', null, __('Moda Interact', 'moda-interact'))
		),
		createElement(
			'div',
			{ className: 'moda-interact-page__content' },
			createElement(ConnectionPanel, {
				state: page.connectionState,
				onConnect: page.actions.connect,
				onRetry: page.actions.retryConnection,
			}),
			page.connectionState.connection.status === 'CONNECTED'
				? createElement(ConnectedWorkspace, {
						activeSurface: page.activeSurface,
						merchantState: page.merchantState,
						billingState: page.billingState,
						syncState: page.syncState,
						categoryState: page.categoryState,
						recoverySummaryState: page.recoverySummaryState,
						actions: page.actions,
						showSurfaceNavigation: !isNativeMerchantPage(
							globalThis.location?.search ?? ''
						),
					})
				: null
		)
	);
}

export { ConnectionPanel } from './page/connection-panel';
export default ModaInteractPage;
