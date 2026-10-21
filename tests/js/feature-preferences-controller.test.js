import { describe, expect, it, vi } from 'vitest';
import {
	parseFeaturePreferences,
	createFeaturePreferencesClient,
} from '../../src/recovery-settings/feature-preferences-client';
import { FeaturePreferencesController } from '../../src/recovery-settings/feature-preferences-controller';

const snapshot = {
	schemaVersion: 1,
	revision: 'a'.repeat(64),
	features: [
		{
			id: 'required-1',
			key: 'fixture_core',
			name: 'Fixture core',
			description: 'Fixture description',
			enabled: false,
			effective: true,
			editable: false,
			required: true,
			planEligible: true,
		},
		{
			id: 'optional-1',
			key: 'fixture_optional',
			name: 'Fixture optional',
			description: null,
			enabled: false,
			effective: false,
			editable: true,
			required: false,
			planEligible: true,
		},
	],
};

const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((r, j) => {
		resolve = r;
		reject = j;
	});
	return { promise, resolve, reject };
};

async function flush() {
	for (let i = 0; i < 8; i++) {
		await Promise.resolve();
	}
}

function mount(client) {
	const controller = new FeaturePreferencesController(client);
	controller.setConnection({
		status: 'CONNECTED',
		installationId: 'a',
		credentialVersion: 1,
	});
	controller.setActive(true);
	return controller;
}

describe('ARCH-035-WOOCOMMERCE-003 feature controls', () => {
	it('defaults to unavailable without attempting an invented WordPress route', async () => {
		const controller = mount(
			createFeaturePreferencesClient(async () => {
				throw new Error('FEATURES_UNAVAILABLE');
			})
		);
		await flush();
		expect(controller.state).toEqual({ status: 'UNAVAILABLE', data: null });
		await controller.save('optional-1', true);
		expect(controller.state.status).toBe('UNAVAILABLE');
		controller.dispose();
	});

	it('rejects invalid, duplicate or client-defined entitlements', () => {
		expect(parseFeaturePreferences(snapshot)).toBe(snapshot);
		expect(() =>
			parseFeaturePreferences({
				...snapshot,
				features: [{ ...snapshot.features[0], editable: 'yes' }],
			})
		).toThrow('FEATURES_INVALID');
		expect(() =>
			parseFeaturePreferences({
				...snapshot,
				features: [snapshot.features[0], snapshot.features[0]],
			})
		).toThrow('FEATURES_INVALID');
		expect(() => parseFeaturePreferences({ features: [] })).toThrow(
			'FEATURES_INVALID'
		);
	});

	it('renders an authoritative empty state and distinguishes denied and transport errors', async () => {
		const client = {
			read: vi.fn(async () => ({
				schemaVersion: 1,
				revision: 'd'.repeat(64),
				features: [],
			})),
			save: vi.fn(),
		};
		const controller = mount(client);
		await flush();
		expect(controller.state).toEqual({
			status: 'READY',
			data: { schemaVersion: 1, revision: 'd'.repeat(64), features: [] },
		});
		client.read.mockRejectedValueOnce(new Error('DENIED'));
		await controller.refresh();
		expect(controller.state.status).toBe('DENIED');
		client.read.mockRejectedValueOnce(new Error('network'));
		await controller.refresh();
		expect(controller.state.status).toBe('ERROR');
		controller.dispose();
	});

	it('serializes revision-aware saves and disables required feature changes', async () => {
		const pending = deferred();
		const client = {
			read: vi.fn(async () => snapshot),
			save: vi.fn(() => pending.promise),
		};
		const controller = mount(client);
		await flush();
		await controller.save('required-1', false);
		expect(client.save).not.toHaveBeenCalled();
		const first = controller.save('optional-1', true);
		controller.save('optional-1', true);
		await flush();
		expect(client.save).toHaveBeenCalledTimes(1);
		expect(client.save).toHaveBeenCalledWith({
			expectedRevision: 'a'.repeat(64),
			changes: [{ featureId: 'optional-1', enabled: true }],
		});
		expect(controller.state.status).toBe('SAVING');
		expect(controller.state.data.features[1].enabled).toBe(false);
		pending.resolve({
			...snapshot,
			revision: 'b'.repeat(64),
			features: [
				snapshot.features[0],
				{ ...snapshot.features[1], enabled: true, effective: true },
			],
		});
		await first;
		expect(controller.state.status).toBe('SAVED');
		expect(controller.state.data.features[1].enabled).toBe(true);
		controller.dispose();
	});

	it('invalidates pending saves after credential rotation, disconnection or navigation', async () => {
		const pending = deferred();
		const client = {
			read: vi.fn(async () => snapshot),
			save: vi.fn(() => pending.promise),
		};
		const controller = mount(client);
		await flush();
		const saving = controller.save('optional-1', true);
		await flush();
		controller.setConnection({
			status: 'CONNECTED',
			installationId: 'a',
			credentialVersion: 2,
		});
		await flush();
		expect(controller.state.status).toBe('READY');
		pending.resolve({ ...snapshot, revision: 'c'.repeat(64) });
		await saving;
		expect(controller.state.data.revision).toBe('a'.repeat(64));
		controller.setConnection({ status: 'DISCONNECTED' });
		expect(controller.state).toEqual({ status: 'IDLE', data: null });
		controller.setConnection({ status: 'CONNECTED' });
		controller.setActive(false);
		await flush();
		expect(controller.state).toEqual({ status: 'IDLE', data: null });
		controller.dispose();
	});

	it('does not accept late reads after switching installations', async () => {
		const pending = deferred();
		const client = {
			read: vi
				.fn()
				.mockImplementationOnce(() => pending.promise)
				.mockResolvedValue(snapshot),
			save: vi.fn(),
		};
		const controller = mount(client);
		await flush();
		controller.setConnection({ status: 'CONNECTED', installationId: 'b' });
		await flush();
		pending.resolve({ ...snapshot, revision: 'c'.repeat(64) });
		await flush();
		expect(controller.state.data?.revision).toBe('a'.repeat(64));
		controller.dispose();
	});
});
