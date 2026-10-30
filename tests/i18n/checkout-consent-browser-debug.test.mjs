import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const blocks = readFileSync(
	join(root, 'assets/js/checkout-consent-blocks-status.js'),
	'utf8'
);
const classic = readFileSync(
	join(root, 'assets/js/checkout-consent-classic.js'),
	'utf8'
);

function debugWindow(enabled, calls) {
	return {
		sessionStorage: {
			getItem: (key) =>
				enabled && key === 'modaWooConsentDebug' ? '1' : null,
		},
		console: { info: (...args) => calls.push(args) },
	};
}

function events(calls) {
	return calls.map((entry) => entry[1]);
}

test('Blocks diagnostics are off by default and report missing registration dependencies when enabled', () => {
	const silent = [];
	runInNewContext(blocks, {
		window: debugWindow(false, silent),
	});
	assert.equal(silent.length, 0);

	const recorded = [];
	runInNewContext(blocks, {
		window: debugWindow(true, recorded),
	});
	assert.deepEqual(events(recorded), [
		'blocks_script_loaded',
		'blocks_registration_blocked',
	]);
	assert.equal(recorded[0][2].wooRegistryPresent, false);
});

test('Blocks diagnostics distinguish mount and Store API status acknowledgement', async () => {
	const calls = [];
	const later = [];
	const effects = [];
	let registration;
	const cart = {
		billingAddress: { country: 'GB', phone: '+447400123456' },
		extensions: {},
	};
	const win = {
		...debugWindow(true, calls),
		setTimeout: (callback) => later.push(callback),
		document: { getElementsByClassName: () => [] },
		modaWooCheckoutConsentConfig: {
			nonce: 'secret-wp-nonce',
			storeNonce: 'secret-store-nonce',
		},
		wp: {
			element: {
				createElement: () => null,
				useState: (value) => [value, () => {}],
				useEffect: (effect) => effects.push(effect),
				useRef: (value) => ({ current: value }),
			},
			data: {
				useSelect: (callback) =>
					callback(() => ({ getCartData: () => cart })),
				select: () => ({ getCartData: () => cart }),
			},
		},
		wc: {
			blocksCheckout: {
				registerCheckoutBlock: (block) => (registration = block),
				extensionCartUpdate: async (args) => {
					cart.extensions['moda-interact-consent'] = {
						requestId: args.data.requestId,
						status: 'checked',
						confirmed: true,
						reason: '',
					};
				},
			},
		},
	};
	runInNewContext(blocks, { window: win });
	registration.component();
	effects[0]();
	for (const callback of later) {
		callback();
	}
	await new Promise((resolve) => setImmediate(resolve));
	for (const expected of [
		'blocks_script_loaded',
		'blocks_registration_started',
		'blocks_registered',
		'blocks_component_rendered',
		'blocks_contact_changed',
		'blocks_http_started',
		'blocks_http_response',
		'blocks_status_result',
	]) {
		assert.ok(events(calls).includes(expected), `Missing ${expected}`);
	}
	assert.equal(
		calls.find((entry) => entry[1] === 'blocks_status_result')[2].confirmed,
		true
	);
	const output = JSON.stringify(calls);
	assert.doesNotMatch(
		output,
		/447400123456|secret-wp-nonce|secret-store-nonce|Bearer /
	);
});

test('Classic diagnostics show script/config availability without exposing checkout fields', () => {
	const calls = [];
	const win = debugWindow(true, calls);
	runInNewContext(classic, {
		window: win,
		jQuery: null,
	});
	assert.deepEqual(events(calls), ['classic_script_loaded']);
	assert.equal(calls[0][2].jqueryPresent, false);
});

test('Blocks choice diagnostics expose only fixed Store API rejection codes', async () => {
	async function choiceLog(reason) {
		const calls = [];
		const effects = [];
		const saved = [];
		const refs = [];
		let cursor = 0;
		let refIndex = 0;
		let registration;
		const cart = {
			billingAddress: { country: 'GB', phone: '+447400123456' },
			extensions: {},
		};
		const win = {
			...debugWindow(true, calls),
			modaWooCheckoutConsentConfig: {
				optIn: 'Consent',
				changeFailed: 'Try again',
			},
			wp: {
				element: {
					createElement: (type, props, ...children) => ({
						type,
						props,
						children,
					}),
					useState(initial) {
						const id = cursor++;
						if (!(id in saved)) {
							saved[id] = initial;
						}
						return [saved[id], (next) => (saved[id] = next)];
					},
					useEffect: (fn) => effects.push(fn),
					useRef(initial) {
						const id = refIndex++;
						if (!refs[id]) {
							refs[id] = { current: initial };
						}
						return refs[id];
					},
				},
				data: {
					useSelect: (selector) =>
						selector(() => ({ getCartData: () => cart })),
					select: () => ({ getCartData: () => cart }),
				},
			},
			wc: {
				blocksCheckout: {
					registerCheckoutBlock: (block) => (registration = block),
					extensionCartUpdate: async (args) => {
						cart.extensions['moda-interact-consent'] = {
							requestId: args.data.requestId,
							status:
								args.data.action === 'status'
									? 'checked'
									: 'unverified',
							confirmed: false,
							reason:
								args.data.action === 'status'
									? 'consent_proof_missing'
									: reason,
						};
					},
				},
			},
		};
		runInNewContext(blocks, { window: win });
		function render() {
			cursor = 0;
			refIndex = 0;
			effects.length = 0;
			return registration.component();
		}
		function findInput(node) {
			if (!node || typeof node !== 'object') {
				return null;
			}
			if (node.type === 'input') {
				return node;
			}
			for (const child of node.children || []) {
				const found = findInput(child);
				if (found) {
					return found;
				}
			}
			return null;
		}
		render();
		effects[0]();
		await new Promise((resolve) => setImmediate(resolve));
		const checkbox = findInput(render());
		assert.ok(checkbox);
		assert.equal(checkbox.props.disabled, false);
		checkbox.props.onChange({ target: { checked: true } });
		await new Promise((resolve) => setImmediate(resolve));
		return calls;
	}
	const safe = await choiceLog('checkout_cart_unavailable');
	const ack = safe.find((entry) => entry[1] === 'blocks_choice_ack');
	assert.deepEqual(JSON.parse(JSON.stringify(ack[2])), {
		recorded: false,
		reason: 'checkout_cart_unavailable',
	});
	assert.doesNotMatch(JSON.stringify(safe), /447400123456/);
	const stale = await choiceLog('capture_observe_grant_already_checked');
	assert.equal(
		stale.find((entry) => entry[1] === 'blocks_choice_ack')[2].reason,
		'capture_observe_grant_already_checked'
	);
	const empty = await choiceLog('capture_observe_cart_empty');
	assert.equal(
		empty.find((entry) => entry[1] === 'blocks_choice_ack')[2].reason,
		'capture_observe_cart_empty'
	);
	const unsafe = await choiceLog('private_447400123456');
	assert.equal(
		unsafe.find((entry) => entry[1] === 'blocks_choice_ack')[2].reason,
		null
	);
});

test('every PHP consent rejection code has a safe browser diagnostic mapping', () => {
	const phpFiles = [
		'includes/Checkout/CheckoutConsentCapture.php',
		'includes/Checkout/CheckoutConsentStoreApi.php',
	];
	const codes = phpFiles.flatMap((path) => {
		const content = readFileSync(join(root, path), 'utf8');
		const matches = content.matchAll(
			/'(capture_(?:observe|withdraw)_[a-z_]+|store_api_[a-z_]+)'/g
		);
		return Array.from(matches, (match) => match[1]);
	});
	for (const code of new Set(codes)) {
		assert.ok(
			blocks.includes(`'${code}'`),
			`Missing safe diagnostic: ${code}`
		);
	}
	assert.doesNotMatch(blocks, /'capture_not_recorded'/);
});
