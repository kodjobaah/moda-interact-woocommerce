import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = readFileSync(
	join(root, 'assets/js/checkout-consent-blocks-status.js'),
	'utf8'
);

const blockMetadata = JSON.parse(
	readFileSync(
		join(root, 'assets/blocks/checkout-consent/block.json'),
		'utf8'
	)
);

test('Blocks consent is forced into Checkout Fields, never the order summary', () => {
	assert.equal(blockMetadata.name, 'moda-interact/checkout-consent');
	assert.deepEqual(blockMetadata.parent, [
		'woocommerce/checkout-fields-block',
	]);
	assert.deepEqual(blockMetadata.attributes.lock.default, {
		remove: true,
		move: true,
	});
	const captured = [];
	const win = {
		modaWooCheckoutConsentConfig: {
			endpoint: '/wp-json/moda-interact/v1/checkout-consent/',
		},
		wp: {
			element: {
				createElement: () => null,
				useState: () => [],
				useEffect: () => {},
				useRef: () => ({}),
			},
			data: { useSelect: () => '' },
		},
		wc: {
			blocksCheckout: {
				registerCheckoutBlock: (value) => captured.push(value),
			},
		},
	};
	runInNewContext(script, { window: win });
	assert.equal(captured.length, 1);
	assert.equal(captured[0].metadata.name, blockMetadata.name);
	assert.equal(
		Array.from(captured[0].metadata.parent).join(','),
		'woocommerce/checkout-fields-block'
	);
	assert.equal(typeof captured[0].component, 'function');
	assert.doesNotMatch(script, /blocks\.ExperimentalOrderMeta\s*[,)]/);
	assert.doesNotMatch(script, /plugins\.registerPlugin/);
	assert.match(script, /request\('status'/);
	assert.match(script, /change\('choice'/);
	assert.match(script, /change\(\s*'withdraw'/);
	assert.doesNotMatch(script, /createRoot|MutationObserver|querySelector/);
	assert.doesNotMatch(
		script,
		/grantEventId|installationId|canonicalPhone|Bearer /
	);
});

test('Blocks consent observes the billing phone from the live Woo cart store', () => {
	let registered = null;
	let selectedStore = null;
	const win = {
		modaWooCheckoutConsentConfig: { endpoint: '/test', nonce: 'nonce' },
		wp: {
			element: {
				createElement: (_type, _props, ...children) => children,
				useState: (initial) => [initial, () => {}],
				useEffect: () => {},
				useRef: (initial) => ({ current: initial }),
			},
			data: {
				useSelect: (callback) =>
					callback((storeName) => {
						selectedStore = storeName;
						return {
							getCartData: () => ({
								billingAddress: {
									country: 'GB',
									phone: '+447400123456',
								},
							}),
						};
					}),
			},
		},
		wc: {
			blocksCheckout: {
				registerCheckoutBlock: (block) => (registered = block),
			},
		},
	};
	runInNewContext(script, { window: win });
	assert.doesNotThrow(() => registered.component());
	assert.equal(selectedStore, 'wc/store/cart');
	// Missing Woo APIs must not break the rest of checkout.
	assert.doesNotThrow(() =>
		runInNewContext(script, { window: { wp: {}, wc: {} } })
	);
});

test('Blocks uses native Store API cart/extensions, not custom WordPress REST', async () => {
	const effects = [];
	const updates = [];
	let block = null;
	const cart = {
		billingAddress: {
			country: 'GB',
			phone: '+447400123456',
		},
		extensions: {},
	};
	const win = {
		modaWooCheckoutConsentConfig: { changeFailed: 'Try again' },
		wp: {
			element: {
				createElement: () => null,
				useState: (initial) => [initial, () => {}],
				useEffect: (callback) => effects.push(callback),
				useRef: (initial) => ({ current: initial }),
			},
			data: {
				useSelect: (callback) =>
					callback(() => ({ getCartData: () => cart })),
				select: () => ({ getCartData: () => cart }),
			},
		},
		wc: {
			blocksCheckout: {
				registerCheckoutBlock: (value) => (block = value),
				extensionCartUpdate: async (options) => {
					updates.push(options);
					cart.extensions['moda-interact-consent'] = {
						requestId: options.data.requestId,
						status: 'checked',
						confirmed: true,
						reason: '',
					};
					// Some Woo versions return undefined, even on success.
					return undefined;
				},
			},
		},
	};
	runInNewContext(script, {
		window: win,
		fetch: () => {
			throw new Error('Blocks must not call custom WP REST');
		},
	});
	block.component();
	effects[0]();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(updates.length, 1);
	assert.equal(updates[0].namespace, 'moda-interact-consent');
	assert.equal(updates[0].overwriteDirtyCustomerData, false);
	assert.equal(updates[0].data.action, 'status');
	assert.equal(updates[0].data.expectedPhone, '+447400123456');
	assert.equal(updates[0].data.expectedCountry, 'GB');
	assert.ok(!JSON.stringify(updates).includes('grantEventId'));
	assert.doesNotMatch(
		script,
		/fetch\s*\(/,
		'Blocks must not use custom REST fetch'
	);
});

test('Blocks uses only Woo checkout registration even with old placeholder markup', () => {
	const registrations = [];
	const legacy = {
		getAttribute: () => '1',
		closest: () => ({}),
	};
	const win = {
		document: {
			readyState: 'complete',
			getElementsByClassName: () => [legacy],
		},
		modaWooCheckoutConsentConfig: { endpoint: '/consent/' },
		wp: {
			element: {
				createElement: () => null,
				createRoot: () => {
					throw new Error(
						'A second React root must never be created'
					);
				},
				useState: () => [],
				useEffect: () => {},
				useRef: () => ({}),
			},
			data: { useSelect: () => '' },
		},
		wc: {
			blocksCheckout: {
				registerCheckoutBlock: (block) => registrations.push(block),
			},
		},
	};
	assert.doesNotThrow(() => runInNewContext(script, { window: win }));
	assert.equal(registrations.length, 1);
	assert.equal(registrations[0].metadata.name, blockMetadata.name);
	assert.doesNotMatch(script, /data-moda-woo-runtime-mount/);
});

test('Blocks Store API failures expose no private error message or credentials', async () => {
	const effects = [];
	const events = [];
	let registered;
	const win = {
		sessionStorage: { getItem: () => '1' },
		console: {
			info: (_prefix, event, details) => events.push({ event, details }),
		},
		modaWooCheckoutConsentConfig: {
			endpoint: '/wp-json/moda-interact/v1/checkout-consent/',
			nonce: 'private-wp-nonce',
			storeNonce: 'private-store-nonce',
		},
		wp: {
			element: {
				createElement: () => null,
				useState: (initial) => [initial, () => {}],
				useEffect: (effect) => effects.push(effect),
				useRef: (initial) => ({ current: initial }),
			},
			data: {
				useSelect: (callback) =>
					callback(() => ({
						getCartData: () => ({
							billingAddress: {
								country: 'GB',
								phone: '+447400123456',
							},
						}),
					})),
			},
		},
		wc: {
			blocksCheckout: {
				registerCheckoutBlock: (block) => (registered = block),
				extensionCartUpdate: async () => {
					throw new Error(
						'secret phone, customer and credentials must not appear'
					);
				},
			},
		},
	};
	runInNewContext(script, { window: win });
	registered.component();
	effects[0]();
	await new Promise((resolve) => setImmediate(resolve));
	const rejection = events.find(
		(item) => item.event === 'blocks_http_rejected'
	);
	assert.ok(rejection);
	assert.equal(rejection.details.action, 'status');
	assert.equal(rejection.details.errorCode, 'store_api_request_failed');
	const logged = JSON.stringify(events);
	assert.ok(!logged.includes('+447400123456'));
	assert.ok(!logged.includes('private-wp-nonce'));
	assert.ok(!logged.includes('private-store-nonce'));
	assert.ok(!logged.includes('secret phone'));
});
