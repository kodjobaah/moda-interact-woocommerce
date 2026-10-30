import test from 'node:test';
import assert from 'node:assert/strict';
import { assertInitialShopBrandWordPress } from './shop-brand-wordpress.mjs';

const parseJsonOutput = (value) => JSON.parse(value);

test('first connection drains pending capture before later credential rotation', async () => {
	const commands = [];
	const requests = [];
	const wpAsync = async (...args) => {
		commands.push(args);
		if (args[0] === 'action-scheduler') {
			requests.push({ httpStatus: 200 });
			return '';
		}
		if (args[1].includes('as_get_scheduled_actions')) return '[17]';
		return '"install_wp_fixture"';
	};
	await assertInitialShopBrandWordPress({
		wpAsync, parseJsonOutput,
		fixture: { getShopBrandRequests: () => requests },
	});
	assert.equal(commands.filter(([cmd]) => cmd === 'action-scheduler').length, 1);
	assert.equal(requests.length, 1);
});

test('an async capture that already posted is accepted without a second queue drain', async () => {
	const commands = [];
	const wpAsync = async (...args) => {
		commands.push(args);
		return args[1].includes('as_get_scheduled_actions') ? '[]' : '"install_wp_fixture"';
	};
	await assertInitialShopBrandWordPress({
		wpAsync, parseJsonOutput,
		fixture: { getShopBrandRequests: () => [{ httpStatus: 200 }] },
	});
	assert.equal(commands.some(([cmd]) => cmd === 'action-scheduler'), false);
});

test('missing initial capture reports sanitized scheduler and bootstrap diagnostics', async () => {
	const wpAsync = async (...args) => {
		if (args[1].includes('$statuses')) {
			return JSON.stringify({
				connectionInstallationId: 'install_wp_fixture', credentialVersion: 1,
				bootstrapMarker: 'install_wp_fixture', schedulerInitialized: true,
				captureActions: { pending: [], complete: [], failed: [17] },
			});
		}
		return '[]';
	};
	await assert.rejects(
		() => assertInitialShopBrandWordPress({
			wpAsync, parseJsonOutput,
			fixture: { getShopBrandRequests: () => [] },
		}),
		(error) => {
			assert.match(error.message, /first connection did not deliver a ShopBrand snapshot/);
			assert.match(error.message, /"failed":\[17\]/);
			assert.doesNotMatch(error.message, /credential\":\"/);
			return true;
		}
	);
});
