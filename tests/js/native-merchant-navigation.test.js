import { describe, expect, it, vi } from 'vitest';
import { ConnectedWorkspace } from '../../src/page/connected-workspace';
import { mountNativeAdmin } from '../../src/native-admin/mount';
import {
	initialMerchantSurface,
	isNativeMerchantPage,
} from '../../src/native-admin/page-surface';
import { OverviewScreen } from '../../src/overview-screen';
import { BillingScreen } from '../../src/billing-screen';
import { RecoverySettingsScreen } from '../../src/recovery-settings/recovery-settings-screen';

const actions = {
	selectSurface: vi.fn(),
	refreshMerchant: vi.fn(),
	syncStoreContext: vi.fn(),
	refreshBilling: vi.fn(),
	loadPlans: vi.fn(),
	selectPlan: vi.fn(),
	cancelPlan: vi.fn(),
	setBillingView: vi.fn(),
	refreshCategory: vi.fn(),
	chooseCategory: vi.fn(),
	toggleMapping: vi.fn(),
	saveCategory: vi.fn(),
};

describe('native merchant navigation', () => {
	it.each([
		['?page=moda-interact', 'OVERVIEW'],
		['?page=moda-interact-billing', 'BILLING'],
		['?page=moda-interact-recovery-settings', 'RECOVERY'],
	])(
		'resolves %s to %s without another navigation bar',
		(search, surface) => {
			expect(isNativeMerchantPage(search)).toBe(true);
			expect(initialMerchantSurface(search)).toBe(surface);
		}
	);

	it('keeps the legacy WooCommerce route and billing return behavior', () => {
		expect(isNativeMerchantPage('?page=wc-admin&path=/moda-interact')).toBe(
			false
		);
		expect(
			initialMerchantSurface('?page=wc-admin&path=/moda-interact')
		).toBe('OVERVIEW');
		expect(
			initialMerchantSurface('?page=wc-admin&moda_billing_return=1')
		).toBe('BILLING');
		expect(isNativeMerchantPage('?page=moda-interact-support')).toBe(false);
	});

	it.each([
		['OVERVIEW', OverviewScreen],
		['BILLING', BillingScreen],
		['RECOVERY', RecoverySettingsScreen],
	])(
		'renders only the %s screen when the native menu owns navigation',
		(surface, Screen) => {
			const workspace = ConnectedWorkspace({
				activeSurface: surface,
				merchantState: { status: 'IDLE' },
				billingState: { status: 'IDLE' },
				syncState: { status: 'IDLE' },
				categoryState: { status: 'IDLE' },
				actions,
				showSurfaceNavigation: false,
			});
			const [navigation, content] = workspace.props.children;
			expect(navigation).toBeNull();
			expect(content.type).toBe(Screen);
		}
	);

	it('mounts in the native root only, with no mount on unrelated screens', () => {
		const target = {};
		const render = vi.fn();
		const rootFactory = vi.fn(() => ({ render }));
		const doc = {
			getElementById: vi.fn((id) =>
				id === 'moda-interact-native-root' ? target : null
			),
		};
		expect(mountNativeAdmin(doc, rootFactory)).toBe(true);
		expect(rootFactory).toHaveBeenCalledWith(target);
		expect(render).toHaveBeenCalledOnce();
		expect(
			mountNativeAdmin({ getElementById: () => null }, rootFactory)
		).toBe(false);
		expect(rootFactory).toHaveBeenCalledTimes(1);
	});
});
