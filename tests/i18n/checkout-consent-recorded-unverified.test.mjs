import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(
	join(root, 'assets/js/checkout-consent-blocks-status.js'),
	'utf8'
);

function simulate({
	remoteConfirmed = false,
	remoteUnavailable = false,
	failure = false,
} = {}) {
	let registered;
	let cursor = 0;
	let refIndex = 0;
	const state = [];
	const refs = [];
	const effects = [];
	const actions = [];
	const logs = [];
	const ids = [];
	let grantCount = 0;
	const cart = {
		billingAddress: { country: 'GB', phone: '+447400123456' },
		extensions: {},
	};
	const h = (type, props, ...children) => ({
		type,
		props: props || {},
		children,
	});
	const win = {
		modaWooCheckoutConsentConfig: {
			optIn: 'WhatsApp checkbox',
			recordedUnverified: 'Grant saved, status unavailable',
			checkStatus: 'Retry',
			changeFailed: 'Try again',
			waitForPhone: 'Enter phone first',
		},
		sessionStorage: { getItem: () => '1' },
		console: { info: (...args) => logs.push(args) },
		wp: {
			element: {
				createElement: h,
				useState(initial) {
					const index = cursor++;
					if (!(index in state)) {
						state[index] = initial;
					}
					return [state[index], (next) => (state[index] = next)];
				},
				useRef(initial) {
					const index = refIndex++;
					if (!refs[index]) {
						refs[index] = { current: initial };
					}
					return refs[index];
				},
				useEffect(effect) {
					effects.push(effect);
				},
			},
			data: {
				useSelect: (fn) => fn(() => ({ getCartData: () => cart })),
				select: () => ({ getCartData: () => cart }),
			},
		},
		wc: {
			blocksCheckout: {
				registerCheckoutBlock: (block) => (registered = block),
				extensionCartUpdate: async ({ data }) => {
					const { action, checked, requestId } = data;
					actions.push({ action, checked, requestId });
					if (action === 'status') {
						if (remoteUnavailable) {
							cart.extensions['moda-interact-consent'] = {
								requestId,
								status: 'checked',
								confirmed: false,
								reason: 'consent_status_remote_unavailable',
							};
							return;
						}
						cart.extensions['moda-interact-consent'] = {
							requestId,
							status: 'checked',
							confirmed: remoteConfirmed,
							reason: remoteConfirmed
								? ''
								: 'consent_proof_missing',
						};
					} else {
						ids.push(requestId);
						if (checked) {
							grantCount++;
						}
						cart.extensions['moda-interact-consent'] = {
							requestId,
							status: failure ? 'unverified' : 'recorded',
							confirmed: false,
							reason: failure
								? 'capture_observe_cart_unavailable'
								: '',
						};
					}
				},
			},
		},
	};
	runInNewContext(source, { window: win });
	function render() {
		cursor = 0;
		refIndex = 0;
		effects.length = 0;
		return registered.component();
	}
	function visit(node, result = []) {
		if (!node || typeof node !== 'object') {
			return result;
		}
		if (Array.isArray(node)) {
			for (const part of node) {
				visit(part, result);
			}
			return result;
		}
		if (node.type) {
			result.push(node);
		}
		for (const child of node.children || []) {
			visit(child, result);
		}
		return result;
	}
	async function settle() {
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
	}
	async function load() {
		render();
		effects[0]();
		await settle();
		return visit(render());
	}
	return {
		load,
		render,
		visit,
		settle,
		actions,
		logs,
		ids,
		setRemoteConfirmed(value) {
			remoteConfirmed = value;
			remoteUnavailable = false;
		},
		setFailure(value) {
			failure = value;
		},
		getGrants: () => grantCount,
	};
}

function checkbox(nodes) {
	const inputs = nodes.filter((node) => node.type === 'input');
	assert.equal(
		inputs.length,
		1,
		'The shopper must see exactly one consent checkbox'
	);
	return inputs[0];
}

test('current API-006 GRANTED appears checked and one uncheck records REVOKE', async () => {
	const app = simulate({ remoteConfirmed: true });
	const loaded = checkbox(await app.load());
	assert.equal(loaded.props.checked, true);
	assert.equal(loaded.props.disabled, false);
	loaded.props.onChange({ target: { checked: false } });
	await app.settle();
	const updated = checkbox(app.visit(app.render()));
	assert.equal(updated.props.checked, false);
	assert.ok(
		app.actions.some(
			(action) => action.action === 'choice' && action.checked === false
		)
	);
	assert.equal(
		app.actions.some((action) => action.action === 'withdraw'),
		false
	);
});

test('no proof yields unchecked; acknowledged GRANT leaves only a checked control', async () => {
	const app = simulate();
	const first = checkbox(await app.load());
	assert.equal(first.props.checked, false);
	assert.equal(first.props.disabled, false);
	first.props.onChange({ target: { checked: true } });
	await app.settle();
	const nodes = app.visit(app.render());
	const selected = checkbox(nodes);
	assert.equal(selected.props.checked, true);
	assert.equal(
		nodes.some((node) => node.type === 'button'),
		false
	);
	assert.equal(
		nodes.some((node) => node.props.role === 'status' || node.props.role === 'alert'),
		false,
		'Checkout must never show an operational status or error panel'
	);
	assert.equal(
		app.actions.filter((action) => action.action === 'status').length,
		1,
		'A successful grant ACK must not cause a redundant API-006 read'
	);
	assert.equal(app.getGrants(), 1);
	// Same-checkout opt-out never needs an extra withdrawal button.
	selected.props.onChange({ target: { checked: false } });
	await app.settle();
	assert.equal(checkbox(app.visit(app.render())).props.checked, false);
	assert.equal(
		app.actions.some((a) => a.action === 'choice' && a.checked === false),
		true
	);
	assert.doesNotMatch(
		JSON.stringify(app.logs),
		/447400123456|Bearer |grantEventId/
	);
});

test('unavailable remote status quietly hides optional Moda UI', async () => {
	const app = simulate({ remoteUnavailable: true });
	const nodes = await app.load();
	assert.equal(nodes.length, 0, 'No checkbox, retry button or error panel');
	assert.equal(app.getGrants(), 0);
	assert.deepEqual(app.actions.map((action) => action.action), ['status']);
});

test('a failed consent write quietly restores the previous checkbox and can retry', async () => {
	const app = simulate({ failure: true });
	const input = checkbox(await app.load());
	input.props.onChange({ target: { checked: true } });
	await app.settle();
	const nodes = app.visit(app.render());
	assert.equal(checkbox(nodes).props.checked, false);
	assert.equal(
		nodes.some((node) => node.props.role === 'alert' || node.type === 'button'),
		false,
		'No large error or retry panel may block merchant checkout'
	);
	assert.equal(app.ids.length, 1);
	app.setFailure(false);
	checkbox(nodes).props.onChange({ target: { checked: true } });
	await app.settle();
	assert.equal(
		app.ids[1],
		app.ids[0],
		'A lost ACK must reuse the same request ID'
	);
	assert.equal(checkbox(app.visit(app.render())).props.checked, true);
});
