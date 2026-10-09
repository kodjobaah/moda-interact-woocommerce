import { isValidElement } from '@wordpress/element';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConnectionPanel } from '../../src/page/connection-panel';

function textContent(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(textContent).join(' ');
	}
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	return textContent(node.props?.children);
}

function findElement(node, type) {
	if (Array.isArray(node)) {
		return node.map((child) => findElement(child, type)).find(Boolean);
	}
	if (!node || typeof node !== 'object') {
		return undefined;
	}
	if (node.type === type) {
		return node;
	}
	return findElement(node.props?.children, type);
}

describe('Moda Interact connection presentation', () => {
	it.each([
		['LOADING', 'Checking the connection to Moda Interact'],
		['DISCONNECTED', 'This store is not connected'],
		['RECONNECT_REQUIRED', 'local connection needs to be re-established'],
		['CONNECTED', 'Connected'],
		['REMOTE_UNAVAILABLE', 'cannot be reached right now'],
		['SITE_URL_CHANGED', 'site address differs'],
		['API_NOT_CONFIGURED', 'not configured for this plugin installation'],
		['LOCAL_STATE_INVALID', 'saved local connection could not be verified'],
		['LOAD_FAILED', 'connection status could not be checked'],
	])('renders explicit %s status text', (status, expectedText) => {
		const element = ConnectionPanel({
			state: {
				connection:
					status === 'CONNECTED'
						? {
								status,
								installationId: 'install_safe',
								shopId: 'shop_safe',
								canonicalSiteUrl: 'https://merchant.example',
								credentialVersion: 1,
							}
						: { status },
				pendingAction: null,
				actionError: false,
			},
			onConnect: () => {},
			onRetry: () => {},
		});

		expect(isValidElement(element)).toBe(true);
		expect(textContent(element)).toContain(expectedText);
	});

	it('offers Connect and Reconnect as named, keyboard-operable buttons with pending feedback', () => {
		for (const [status, actionName, pendingName] of [
			['DISCONNECTED', 'Connect Moda Interact', 'Connecting'],
			['RECONNECT_REQUIRED', 'Reconnect Moda Interact', 'Reconnecting'],
		]) {
			const element = ConnectionPanel({
				state: {
					connection: { status },
					pendingAction: null,
					actionError: false,
				},
				onConnect: () => {},
				onRetry: () => {},
			});
			const button = findElement(element, 'button');
			expect(button.props.type).toBe('button');
			expect(textContent(button)).toBe(actionName);

			const pending = ConnectionPanel({
				state: {
					connection: { status },
					pendingAction: 'connect',
					actionError: false,
				},
				onConnect: () => {},
				onRetry: () => {},
			});
			expect(findElement(pending, 'button').props.disabled).toBe(true);
			expect(textContent(findElement(pending, 'button'))).toContain(
				pendingName
			);
			expect(pending.props['aria-busy']).toBe(true);
		}
	});

	it('offers status-only retry for remote and browser failures, never reconnect', () => {
		for (const status of ['REMOTE_UNAVAILABLE', 'LOAD_FAILED']) {
			const element = ConnectionPanel({
				state: {
					connection: { status },
					pendingAction: null,
					actionError: false,
				},
				onConnect: () => {},
				onRetry: () => {},
			});
			expect(textContent(findElement(element, 'button'))).toBe('Retry');
		}
	});

	it('shows only safe connection metadata and keeps merchant state in memory', () => {
		const element = ConnectionPanel({
			state: {
				connection: {
					status: 'CONNECTED',
					installationId: 'install_safe',
					shopId: 'shop_safe',
					canonicalSiteUrl: 'https://merchant.example',
					credentialVersion: 1,
				},
				pendingAction: null,
				actionError: false,
			},
			onConnect: () => {},
			onRetry: () => {},
		});
		const source = readFileSync(
			new URL('../../src/page.js', import.meta.url),
			'utf8'
		);
		const stateSource = readFileSync(
			new URL('../../src/page/use-moda-page-state.js', import.meta.url),
			'utf8'
		);
		const controllerSource = readFileSync(
			new URL('../../src/page/controller-factory.js', import.meta.url),
			'utf8'
		);

		expect(textContent(element)).toContain('https://merchant.example');
		expect(textContent(element)).not.toMatch(
			/install_safe|shop_safe|credentialVersion/
		);
		expect(source).not.toMatch(
			/localStorage|sessionStorage|currentLocale|localeAllowlist|Recoveries/
		);
		expect(source).toContain('createElement(ConnectionPanel');
		expect(source).toContain('createElement(ConnectedWorkspace');
		expect(source).not.toContain('new BillingController');
		expect(controllerSource).toContain('new BillingController');
		expect(stateSource).toContain(
			'initialMerchantSurface(globalThis.location?.search'
		);
		expect(source).toContain("status === 'CONNECTED'");
	});
});
