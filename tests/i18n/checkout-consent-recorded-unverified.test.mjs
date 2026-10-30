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
	let confirmWithdrawal = false;
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
			granted: 'Already granted',
			withdraw: 'Withdraw permission',
			confirm: 'Really withdraw?',
		},
		sessionStorage: { getItem: () => '1' },
		confirm: () => confirmWithdrawal,
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
		setConfirmation(value) {
			confirmWithdrawal = value;
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

function button(nodes) {
	const buttons = nodes.filter((node) => node.type === 'button');
	assert.equal(
		buttons.length,
		1,
		'Verified GRANT requires one distinct withdrawal button'
	);
	return buttons[0];
}

test('verified GRANTED shows status and separate confirmed withdrawal, never a checked box', async () => {
	const app = simulate({ remoteConfirmed: true });
	let nodes = await app.load();
	assert.equal(nodes.filter((node) => node.type === 'input').length, 0);
	assert.ok(nodes.some((node) => node.props.role === 'status'));
	button(nodes).props.onClick();
	await app.settle();
	assert.deepEqual(
		app.actions.map((a) => a.action),
		['status']
	);
	app.setConfirmation(true);
	button(nodes).props.onClick();
	await app.settle();
	nodes = app.visit(app.render());
	assert.equal(checkbox(nodes).props.checked, false);
	assert.deepEqual(
		app.actions.map((a) => a.action),
		['status', 'withdraw']
	);
	assert.equal(
		app.actions.some((a) => a.action === 'choice' && a.checked === false),
		false
	);
});

test('no proof gives unchecked consent; GRANT ACK switches to withdrawal button', async () => {
	const app = simulate();
	const first = checkbox(await app.load());
	assert.equal(first.props.checked, false);
	assert.equal(first.props.disabled, false);
	first.props.onChange({ target: { checked: true } });
	await app.settle();
	const nodes = app.visit(app.render());
	assert.equal(nodes.filter((node) => node.type === 'input').length, 0);
	assert.ok(button(nodes));
	assert.equal(app.actions.filter((a) => a.action === 'status').length, 1);
	assert.equal(app.getGrants(), 1);
	assert.doesNotMatch(
		JSON.stringify(app.logs),
		/447400123456|Bearer |grantEventId/
	);
});

test('remote outage gives a visible neutral unchecked opt-in, never an inferred GRANT', async () => {
	const app = simulate({ remoteUnavailable: true });
	const nodes = await app.load();
	const input = checkbox(nodes);
	assert.equal(input.props.checked, false);
	assert.equal(input.props.disabled, false);
	assert.equal(
		nodes.some((node) => node.type === 'button'),
		false
	);
	assert.equal(app.getGrants(), 0);
	assert.deepEqual(
		app.actions.map((a) => a.action),
		['status']
	);
});

test('failed consent write preserves neutral state and retries with one stable request ID', async () => {
	const app = simulate({ failure: true });
	const input = checkbox(await app.load());
	input.props.onChange({ target: { checked: true } });
	await app.settle();
	const nodes = app.visit(app.render());
	assert.equal(checkbox(nodes).props.checked, false);
	assert.ok(nodes.some((node) => node.props.role === 'alert'));
	assert.equal(app.ids.length, 1);
	app.setFailure(false);
	checkbox(nodes).props.onChange({ target: { checked: true } });
	await app.settle();
	assert.equal(app.ids[1], app.ids[0], 'Lost ACK retries same request ID');
	assert.ok(button(app.visit(app.render())));
});

test('failed withdrawal keeps verified status and retries with same event request ID', async () => {
	const app = simulate({ remoteConfirmed: true, failure: true });
	app.setConfirmation(true);
	let nodes = await app.load();
	button(nodes).props.onClick();
	await app.settle();
	nodes = app.visit(app.render());
	assert.ok(
		button(nodes),
		'A failed hosted write must not clear the GRANT presentation'
	);
	assert.ok(nodes.some((node) => node.props.role === 'alert'));
	app.setFailure(false);
	button(nodes).props.onClick();
	await app.settle();
	assert.equal(app.ids[1], app.ids[0]);
	assert.equal(checkbox(app.visit(app.render())).props.checked, false);
});
