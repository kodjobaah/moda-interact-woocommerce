import { describe, expect, it, vi } from 'vitest';
import { BillingScreen } from '../../src/billing-screen';
import { OverviewScreen } from '../../src/overview-screen';
import { ConnectedWorkspace } from '../../src/page/connected-workspace';
import { SurfaceNavigation } from '../../src/page/surface-navigation';
import { RecoverySettingsScreen } from '../../src/recovery-settings/recovery-settings-screen';

function renderWorkspace(activeSurface) {
	return ConnectedWorkspace({
		activeSurface,
		merchantState: { status: 'IDLE' },
		billingState: { status: 'IDLE' },
		syncState: { status: 'IDLE' },
		categoryState: { status: 'IDLE' },
		actions: {
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
		},
	});
}

describe('connected workspace composition', () => {
	it.each([
		['OVERVIEW', OverviewScreen],
		['BILLING', BillingScreen],
		['RECOVERY', RecoverySettingsScreen],
	])('mounts only the %s screen next to the tablist', (surface, Screen) => {
		const workspace = renderWorkspace(surface);
		const [navigation, content] = workspace.props.children;
		expect(navigation.type).toBe(SurfaceNavigation);
		expect(content.type).toBe(Screen);
		expect(navigation.props.activeSurface).toBe(surface);
		expect(workspace.props.className).toBe('moda-interact-surfaces');
	});
});
