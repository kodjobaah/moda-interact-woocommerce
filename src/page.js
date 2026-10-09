import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { BillingController, isBillingReturn } from './billing-controller';
import { BillingScreen } from './billing-screen';
import { ConnectionController } from './connection-controller';
import { MerchantBootstrapController } from './merchant-bootstrap-controller';
import { OverviewScreen } from './overview-screen';

function ConnectionPanel({ state, onConnect, onRetry }) {
	const { connection, pendingAction, actionError } = state;
	const pending = pendingAction !== null;
	let content;

	switch (connection.status) {
		case 'LOADING':
			content = createElement(
				'p',
				{
					className: 'moda-interact-message',
					role: 'status',
					'aria-live': 'polite',
				},
				__('Checking the connection to Moda Interact…', 'moda-interact')
			);
			break;
		case 'DISCONNECTED':
			content = createElement(
				'div',
				{ className: 'moda-interact-state' },
				createElement(
					'p',
					null,
					__(
						'This store is not connected to Moda Interact.',
						'moda-interact'
					)
				),
				createElement(
					'button',
					{
						type: 'button',
						className: 'button button-primary',
						disabled: pending,
						onClick: onConnect,
					},
					pendingAction === 'connect'
						? __('Connecting…', 'moda-interact')
						: __('Connect Moda Interact', 'moda-interact')
				)
			);
			break;
		case 'RECONNECT_REQUIRED':
			content = createElement(
				'div',
				{ className: 'moda-interact-state' },
				createElement(
					'p',
					null,
					__(
						'The local connection needs to be re-established. Your Moda account and store data have not been removed.',
						'moda-interact'
					)
				),
				createElement(
					'button',
					{
						type: 'button',
						className: 'button button-primary',
						disabled: pending,
						onClick: onConnect,
					},
					pendingAction === 'connect'
						? __('Reconnecting…', 'moda-interact')
						: __('Reconnect Moda Interact', 'moda-interact')
				)
			);
			break;
		case 'CONNECTED':
			content = createElement(
				'dl',
				{ className: 'moda-interact-details' },
				createElement('dt', null, __('Connection', 'moda-interact')),
				createElement('dd', null, __('Connected', 'moda-interact')),
				createElement(
					'dt',
					null,
					__('WordPress site', 'moda-interact')
				),
				createElement('dd', null, connection.canonicalSiteUrl)
			);
			break;
		case 'REMOTE_UNAVAILABLE':
			content = createElement(
				'div',
				{ className: 'moda-interact-state' },
				createElement(
					'p',
					null,
					__(
						'Moda Interact cannot be reached right now. The local connection has not been removed.',
						'moda-interact'
					)
				),
				createElement(
					'button',
					{
						type: 'button',
						className: 'button',
						disabled: pending,
						onClick: onRetry,
					},
					pendingAction === 'refresh'
						? __('Checking…', 'moda-interact')
						: __('Retry', 'moda-interact')
				)
			);
			break;
		case 'SITE_URL_CHANGED':
			content = createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				__(
					'This WordPress site address differs from the address used for the Moda Interact connection. Contact support before changing the connection.',
					'moda-interact'
				)
			);
			break;
		case 'API_NOT_CONFIGURED':
			content = createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				__(
					'Moda Interact service connectivity is not configured for this plugin installation. Contact your site administrator.',
					'moda-interact'
				)
			);
			break;
		case 'LOCAL_STATE_INVALID':
			content = createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				__(
					'The saved local connection could not be verified. Contact support for help restoring the connection.',
					'moda-interact'
				)
			);
			break;
		case 'LOAD_FAILED':
			content = createElement(
				'div',
				{ className: 'moda-interact-state' },
				createElement(
					'p',
					{ className: 'moda-interact-message', role: 'alert' },
					__(
						'The connection status could not be checked. Try again.',
						'moda-interact'
					)
				),
				createElement(
					'button',
					{
						type: 'button',
						className: 'button',
						disabled: pending,
						onClick: onRetry,
					},
					pendingAction === 'refresh'
						? __('Checking…', 'moda-interact')
						: __('Retry', 'moda-interact')
				)
			);
			break;
		default:
			content = createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				__(
					'The connection status is unavailable. Contact support for help.',
					'moda-interact'
				)
			);
	}

	return createElement(
		'section',
		{
			className: 'moda-interact-connection',
			'aria-labelledby': 'moda-interact-connection-heading',
			'aria-busy': pending,
		},
		createElement(
			'div',
			{ className: 'moda-interact-connection__heading' },
			createElement(
				'h2',
				{ id: 'moda-interact-connection-heading' },
				__('Connection', 'moda-interact')
			),
			connection.status === 'CONNECTED'
				? createElement(
						'span',
						{ className: 'moda-interact-status' },
						__('Connected', 'moda-interact')
					)
				: null
		),
		actionError
			? createElement(
					'p',
					{
						className:
							'moda-interact-message moda-interact-message--error',
						role: 'alert',
					},
					__(
						'The connection could not be completed. Check your connection and try again.',
						'moda-interact'
					)
				)
			: null,
		content
	);
}

const applicationSections = [{ id: 'connection', component: ConnectionPanel }];

function ModaInteractPage() {
	const controllerRef = useRef(null);
	const merchantControllerRef = useRef(null);
	const billingControllerRef = useRef(null);
	const previousConnectionStatus = useRef('LOADING');
	const [activeSurface, setActiveSurface] = useState(() =>
		isBillingReturn(globalThis.location?.search ?? '')
			? 'BILLING'
			: 'OVERVIEW'
	);
	const [state, setState] = useState({
		connection: { status: 'LOADING' },
		pendingAction: null,
		actionError: false,
	});
	const [merchantState, setMerchantState] = useState({ status: 'IDLE' });
	const [billingState, setBillingState] = useState({ status: 'IDLE' });

	useEffect(() => {
		const controller = new ConnectionController();
		const merchantController = new MerchantBootstrapController(
			undefined,
			() => controller.refresh()
		);
		const billingController = new BillingController(undefined, () =>
			controller.refresh()
		);
		controllerRef.current = controller;
		merchantControllerRef.current = merchantController;
		billingControllerRef.current = billingController;
		const unsubscribeMerchant =
			merchantController.subscribe(setMerchantState);
		const unsubscribeBilling = billingController.subscribe(setBillingState);
		const unsubscribe = controller.subscribe((nextState) => {
			setState(nextState);
			merchantController.setConnectionStatus(nextState.connection.status);
			billingController.setConnectionStatus(nextState.connection.status);
			if (
				previousConnectionStatus.current === 'CONNECTED' &&
				nextState.connection.status !== 'CONNECTED'
			) {
				setActiveSurface('OVERVIEW');
			}
			previousConnectionStatus.current = nextState.connection.status;
		});
		controller.refresh();
		return () => {
			controllerRef.current = null;
			merchantControllerRef.current = null;
			billingControllerRef.current = null;
			unsubscribe();
			unsubscribeMerchant();
			unsubscribeBilling();
			controller.dispose();
			merchantController.dispose();
			billingController.dispose();
		};
	}, []);

	useEffect(() => {
		billingControllerRef.current?.setActive(
			state.connection.status === 'CONNECTED' &&
				activeSurface === 'BILLING'
		);
	}, [activeSurface, state.connection.status]);

	const sections = applicationSections.map(({ id, component: Section }) =>
		createElement(Section, {
			key: id,
			state,
			onConnect: () => controllerRef.current?.connect(),
			onRetry: () => controllerRef.current?.refresh(),
		})
	);
	if (state.connection.status === 'CONNECTED') {
		sections.push(
			createElement(
				'div',
				{
					key: 'surface-navigation',
					className: 'moda-interact-surfaces',
				},
				createElement(
					'div',
					{
						className: 'moda-interact-surfaces__tabs',
						role: 'tablist',
					},
					...[
						['OVERVIEW', __('Overview', 'moda-interact')],
						['BILLING', __('Billing', 'moda-interact')],
					].map(([surface, label]) =>
						createElement(
							'button',
							{
								key: surface,
								type: 'button',
								role: 'tab',
								'aria-selected': activeSurface === surface,
								className:
									activeSurface === surface
										? 'button moda-interact-surfaces__tab is-active'
										: 'button moda-interact-surfaces__tab',
								onClick: () => {
									setActiveSurface(surface);
									billingControllerRef.current?.setActive(
										surface === 'BILLING'
									);
								},
							},
							label
						)
					),
					activeSurface === 'BILLING'
						? createElement(BillingScreen, {
								key: 'billing',
								state: billingState,
								onRefresh: () =>
									billingControllerRef.current?.refresh(),
								onLoadPlans: () =>
									billingControllerRef.current?.loadPlans(),
								onSelectPlan: (plan) =>
									billingControllerRef.current?.createOrSwitch(
										plan
									),
								onCancel: () =>
									billingControllerRef.current?.cancel(),
								onSetView: (view) =>
									billingControllerRef.current?.setView(view),
							})
						: createElement(OverviewScreen, {
								key: 'overview',
								state: merchantState,
								onRefresh: () =>
									merchantControllerRef.current?.refresh(),
							})
				)
			)
		);
	}

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
			sections
		)
	);
}

export { ConnectionPanel };
export default ModaInteractPage;
