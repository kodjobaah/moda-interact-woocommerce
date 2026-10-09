import { describe, expect, it, vi } from 'vitest';
import { createPageActions } from '../../src/page/page-actions';
import { createControllerSession } from '../../src/page/controller-session';

function fakeController(initialState = { status: 'IDLE' }) {
	const subscribers = new Set();
	return {
		state: initialState,
		refresh: vi.fn(),
		connect: vi.fn(),
		setConnectionStatus: vi.fn(),
		setActive: vi.fn(),
		chooseCategory: vi.fn(),
		toggleMapping: vi.fn(),
		save: vi.fn(),
		loadPlans: vi.fn(),
		createOrSwitch: vi.fn(),
		cancel: vi.fn(),
		setView: vi.fn(),
		sync: vi.fn(),
		dispose: vi.fn(),
		subscribe(listener) {
			subscribers.add(listener);
			listener(this.state);
			return () => subscribers.delete(listener);
		},
		publish(nextState) {
			this.state = nextState;
			for (const listener of subscribers) {
				listener(nextState);
			}
		},
		listenerCount() {
			return subscribers.size;
		},
	};
}

function controllers() {
	return {
		connection: fakeController({ connection: { status: 'LOADING' } }),
		merchant: fakeController(),
		billing: fakeController(),
		sync: fakeController(),
		category: fakeController(),
		recoverySummary: fakeController(),
	};
}

describe('page controller session', () => {
	it('propagates connection state to every feature', () => {
		const items = controllers();
		const onConnection = vi.fn();
		const onConnectionLost = vi.fn();
		const session = createControllerSession(items, {
			onConnection,
			onMerchant: vi.fn(),
			onBilling: vi.fn(),
			onSync: vi.fn(),
			onCategory: vi.fn(),
			onRecoverySummary: vi.fn(),
			onConnectionLost,
		});
		session.start();
		expect(items.connection.refresh).toHaveBeenCalledTimes(1);
		items.connection.publish({ connection: { status: 'CONNECTED' } });
		for (const name of [
			'merchant',
			'billing',
			'sync',
			'category',
			'recoverySummary',
		]) {
			expect(items[name].setConnectionStatus).toHaveBeenLastCalledWith(
				'CONNECTED'
			);
		}
		expect(onConnection).toHaveBeenCalledTimes(2);
		expect(onConnectionLost).not.toHaveBeenCalled();
		session.dispose();
	});

	it('resets after a connected installation disconnects', () => {
		const items = controllers();
		const onConnectionLost = vi.fn();
		const session = createControllerSession(items, {
			onConnection: vi.fn(),
			onMerchant: vi.fn(),
			onBilling: vi.fn(),
			onSync: vi.fn(),
			onCategory: vi.fn(),
			onRecoverySummary: vi.fn(),
			onConnectionLost,
		});
		items.connection.publish({
			connection: { status: 'REMOTE_UNAVAILABLE' },
		});
		expect(onConnectionLost).not.toHaveBeenCalled();
		items.connection.publish({ connection: { status: 'CONNECTED' } });
		items.connection.publish({ connection: { status: 'LOAD_FAILED' } });
		expect(onConnectionLost).toHaveBeenCalledTimes(1);
		session.dispose();
	});

	it('disposes once and unsubscribes all callbacks', () => {
		const items = controllers();
		const onConnection = vi.fn();
		const session = createControllerSession(items, {
			onConnection,
			onMerchant: vi.fn(),
			onBilling: vi.fn(),
			onSync: vi.fn(),
			onCategory: vi.fn(),
			onRecoverySummary: vi.fn(),
			onConnectionLost: vi.fn(),
		});
		session.dispose();
		session.dispose();
		for (const item of Object.values(items)) {
			expect(item.listenerCount()).toBe(0);
			expect(item.dispose).toHaveBeenCalledTimes(1);
		}
		items.connection.publish({ connection: { status: 'CONNECTED' } });
		expect(onConnection).toHaveBeenCalledTimes(1);
	});
});

describe('page actions', () => {
	it('refreshes categories only when Recovery Settings is selected', () => {
		const items = controllers();
		const setActiveSurface = vi.fn();
		const actions = createPageActions(
			{ current: { controllers: items } },
			setActiveSurface
		);
		actions.selectSurface('BILLING');
		expect(items.billing.setActive).toHaveBeenLastCalledWith(true);
		expect(items.category.refresh).not.toHaveBeenCalled();
		actions.selectSurface('RECOVERY');
		expect(items.billing.setActive).toHaveBeenLastCalledWith(false);
		expect(items.category.refresh).toHaveBeenCalledTimes(1);
		expect(items.recoverySummary.setActive).toHaveBeenLastCalledWith(true);
		expect(setActiveSurface).toHaveBeenLastCalledWith('RECOVERY');
	});

	it('routes commands only to their owning controllers', () => {
		const items = controllers();
		const actions = createPageActions(
			{ current: { controllers: items } },
			vi.fn()
		);
		actions.connect();
		actions.syncStoreContext();
		actions.selectPlan('paid-plan');
		actions.chooseCategory('retail');
		actions.toggleMapping('apparel');
		actions.saveCategory();
		expect(items.connection.connect).toHaveBeenCalledTimes(1);
		expect(items.sync.sync).toHaveBeenCalledTimes(1);
		expect(items.billing.createOrSwitch).toHaveBeenCalledWith('paid-plan');
		expect(items.category.chooseCategory).toHaveBeenCalledWith('retail');
		expect(items.category.toggleMapping).toHaveBeenCalledWith('apparel');
		expect(items.category.save).toHaveBeenCalledTimes(1);
	});
});
