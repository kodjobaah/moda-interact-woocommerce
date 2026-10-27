import { describe, expect, it, vi } from 'vitest';
import {
	createRecoveryPolicyClient,
	makeRecoveryPolicyUpdate,
	parseMerchantRecoveryPolicy,
	RECOVERY_POLICY_PATH,
} from '../../src/recovery-policy-client';
import { RecoveryPolicyController } from '../../src/recovery-policy-controller';
import {
	recoveryBehaviourChanged,
	recoveryBehaviourPreview,
} from '../../src/recovery-settings/recovery-behaviour-validation';

const initial = {
	schemaVersion: 2,
	revision: '2026-10-12T10:00:00.000Z',
	merchant: {
		recoveryDelayMinutes: 30,
		recoveryOfferMode: 'NONE',
		followUpEnabled: false,
		followUpDelayMinutes: null,
	},
	effective: {
		recoveryDelayMinutes: 60,
		recoveryOfferMode: 'NONE',
		followUpEnabled: true,
		followUpDelayMinutes: 120,
	},
	source: 'ADMIN_OVERRIDE',
	overrideActive: true,
	offerSelectionAvailable: false,
	notifyOnInitialRecoveryOutreach: false,
};

const updated = {
	...initial,
	revision: '2026-10-12T10:01:00.000Z',
	notifyOnInitialRecoveryOutreach: true,
	merchant: {
		...initial.merchant,
		recoveryDelayMinutes: 45,
		followUpEnabled: true,
		followUpDelayMinutes: 100,
	},
};

async function settle() {
	for (let index = 0; index < 12; index++) {
		await Promise.resolve();
	}
}

describe('ARCH-035 Recovery Behaviour manual-save integration', () => {
	it('uses strictly validated merchant and effective policy projections', () => {
		expect(
			parseMerchantRecoveryPolicy(initial).merchant.recoveryDelayMinutes
		).toBe(30);
		expect(recoveryBehaviourPreview(initial)).toEqual({
			recoveryDelayMinutes: '30',
			followUpEnabled: false,
			followUpDelayMinutes: '',
			notifyOnInitialRecoveryOutreach: false,
		});
		expect(
			recoveryBehaviourChanged(initial, recoveryBehaviourPreview(initial))
		).toBe(false);
		for (const invalid of [
			{ ...initial, credential: 'leak' },
			{
				...initial,
				merchant: {
					...initial.merchant,
					fixedShopifyDiscountId: 'secret',
				},
			},
			{ ...initial, overrideActive: false },
			{ ...initial, notifyOnInitialRecoveryOutreach: 'yes' },
			{ ...initial, schemaVersion: 1 },
			{
				...initial,
				merchant: { ...initial.merchant, followUpDelayMinutes: 100 },
			},
		]) {
			expect(() => parseMerchantRecoveryPolicy(invalid)).toThrow();
		}
	});

	it('builds the exact five-field PUT body with no provider or shop identity', () => {
		const update = makeRecoveryPolicyUpdate(initial, {
			recoveryDelayMinutes: '45',
			followUpEnabled: true,
			followUpDelayMinutes: '100',
			notifyOnInitialRecoveryOutreach: false,
		});
		expect(update).toEqual({
			expectedRevision: initial.revision,
			recoveryDelayMinutes: 45,
			followUpEnabled: true,
			followUpDelayMinutes: 100,
			notifyOnInitialRecoveryOutreach: false,
		});
		for (const value of ['-1', '1.5', '10081', '']) {
			expect(() =>
				makeRecoveryPolicyUpdate(initial, {
					recoveryDelayMinutes: value,
					followUpEnabled: false,
					followUpDelayMinutes: '',
					notifyOnInitialRecoveryOutreach: true,
				})
			).toThrow('INVALID_REQUEST');
		}
		expect(() =>
			makeRecoveryPolicyUpdate(initial, {
				recoveryDelayMinutes: '45',
				followUpEnabled: true,
				followUpDelayMinutes: '50',
				notifyOnInitialRecoveryOutreach: true,
			})
		).toThrow('INVALID_REQUEST');
		expect(
			makeRecoveryPolicyUpdate(initial, {
				recoveryDelayMinutes: '45',
				followUpEnabled: false,
				followUpDelayMinutes: '100',
				notifyOnInitialRecoveryOutreach: true,
			}).followUpDelayMinutes
		).toBe(null);
		expect(() =>
			makeRecoveryPolicyUpdate(initial, {
				recoveryDelayMinutes: '45',
				followUpEnabled: false,
				followUpDelayMinutes: '',
				notifyOnInitialRecoveryOutreach: 'true',
			})
		).toThrow('INVALID_REQUEST');
	});

	it('tracks notification-only edits as dirty', () => {
		const draft = recoveryBehaviourPreview(initial);
		expect(
			recoveryBehaviourChanged(initial, {
				...draft,
				notifyOnInitialRecoveryOutreach: true,
			})
		).toBe(true);
	});

	it('uses the privileged WordPress route and never transmits installation credentials', async () => {
		const request = vi.fn(async ({ method }) =>
			method === 'GET' ? initial : updated
		);
		const client = createRecoveryPolicyClient(request);
		expect(await client.read()).toEqual(initial);
		const update = makeRecoveryPolicyUpdate(initial, {
			recoveryDelayMinutes: '45',
			followUpEnabled: true,
			followUpDelayMinutes: '100',
			notifyOnInitialRecoveryOutreach: true,
		});
		expect(await client.save(update)).toEqual(updated);
		expect(request).toHaveBeenCalledWith({
			path: RECOVERY_POLICY_PATH,
			method: 'GET',
		});
		expect(request).toHaveBeenCalledWith({
			path: RECOVERY_POLICY_PATH,
			method: 'PUT',
			data: update,
		});
	});

	it('rejects a save response that does not persist the requested notification value', async () => {
		const client = createRecoveryPolicyClient(async () => ({
			...updated,
			notifyOnInitialRecoveryOutreach: false,
		}));
		const update = makeRecoveryPolicyUpdate(initial, {
			recoveryDelayMinutes: '45',
			followUpEnabled: true,
			followUpDelayMinutes: '100',
			notifyOnInitialRecoveryOutreach: true,
		});
		await expect(client.save(update)).rejects.toThrow(
			'REMOTE_RESPONSE_INVALID'
		);
	});

	it('keeps the last policy visible and reports failed saves without success state', async () => {
		const client = {
			read: vi.fn(async () => initial),
			save: vi.fn(async () => {
				throw new Error('REMOTE_RESPONSE_INVALID');
			}),
		};
		const controller = new RecoveryPolicyController(client);
		controller.setConnectionStatus('CONNECTED');
		controller.setActive(true);
		await settle();
		const draft = {
			recoveryDelayMinutes: '30',
			followUpEnabled: false,
			followUpDelayMinutes: '',
			notifyOnInitialRecoveryOutreach: true,
		};
		await controller.save(draft);
		expect(controller.state.status).toBe('SAVE_FAILED');
		expect(controller.state.data).toBe(initial);
		expect(controller.state.status).not.toBe('SAVED');
		controller.dispose();
	});

	it('does not persist changes before Save, and refreshes the summary after success', async () => {
		const client = {
			read: vi.fn(async () => initial),
			save: vi.fn(async () => updated),
		};
		const onSaved = vi.fn();
		const controller = new RecoveryPolicyController(client, onSaved);
		controller.setConnectionStatus('CONNECTED');
		controller.setActive(true);
		await settle();
		expect(controller.state.status).toBe('READY');
		expect(client.save).not.toHaveBeenCalled();
		const draft = {
			recoveryDelayMinutes: '45',
			followUpEnabled: true,
			followUpDelayMinutes: '100',
			notifyOnInitialRecoveryOutreach: true,
		};
		await controller.save(draft);
		expect(controller.state.status).toBe('SAVED');
		expect(controller.state.data.merchant.recoveryDelayMinutes).toBe(45);
		expect(controller.state.data.effective.recoveryDelayMinutes).toBe(60);
		expect(onSaved).toHaveBeenCalledTimes(1);
		expect(client.save.mock.calls[0][0].expectedRevision).toBe(
			initial.revision
		);
		controller.dispose();
	});

	it('serialises double-clicks, preserves edits on conflict and requires explicit refresh', async () => {
		let resolveSave;
		const deferred = new Promise((resolve) => {
			resolveSave = resolve;
		});
		const client = {
			read: vi.fn(async () => initial),
			save: vi.fn(() => deferred),
		};
		const controller = new RecoveryPolicyController(client);
		controller.setConnectionStatus('CONNECTED');
		controller.setActive(true);
		await settle();
		const draft = {
			recoveryDelayMinutes: '45',
			followUpEnabled: true,
			followUpDelayMinutes: '100',
			notifyOnInitialRecoveryOutreach: false,
		};
		const one = controller.save(draft);
		const two = controller.save(draft);
		expect(one).toBe(two);
		await settle();
		expect(client.save).toHaveBeenCalledTimes(1);
		resolveSave(Promise.reject(new Error('POLICY_CONFLICT')));
		await one;
		expect(controller.state.status).toBe('CONFLICT');
		expect(controller.state.data).toBe(initial);
		await controller.save(draft);
		expect(client.save).toHaveBeenCalledTimes(1);
		await controller.refresh();
		expect(client.read).toHaveBeenCalledTimes(2);
		controller.dispose();
	});

	it('drops late responses after disconnect and rejects unknown proxy responses', async () => {
		let resolveRead;
		const pending = new Promise((resolve) => {
			resolveRead = resolve;
		});
		const controller = new RecoveryPolicyController({
			read: () => pending,
		});
		controller.setConnectionStatus('CONNECTED');
		controller.setActive(true);
		await settle();
		controller.setConnectionStatus('DISCONNECTED');
		resolveRead(initial);
		await settle();
		expect(controller.state.data).toBeNull();
		await expect(
			createRecoveryPolicyClient(async () => ({
				...initial,
				shopId: 'foreign',
			})).read()
		).rejects.toThrow('REMOTE_RESPONSE_INVALID');
	});
});
