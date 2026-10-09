import { describe, expect, it, vi } from 'vitest';
import { OverviewContent, OverviewScreen } from '../../src/overview-screen';

function textContent(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(textContent).join(' ');
	}
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	return textContent(node.props?.children);
}

function bootstrap(overrides = {}) {
	return {
		shop: {
			id: 'shop_1',
			platform: 'WOOCOMMERCE',
			domain: 'https://merchant.example',
			onboardingCompleted: false,
			installedAt: '2026-10-03T12:00:00.000Z',
		},
		internationalContext: {
			storeLocale: 'pt_BR',
			languageTag: null,
			timeZone: null,
			countryCode: 'PT',
		},
		storeProfile: {
			activeCategory: null,
			pendingCategory: null,
			pendingSelectionGeneration: 0,
			pendingSelectedAt: null,
		},
		...overrides,
	};
}

describe('Overview screen', () => {
	it.each([
		[false, 'Setup not completed'],
		[true, 'Setup completed'],
	])(
		'presents the shared onboarding milestone %s as %s',
		(completed, label) => {
			const data = bootstrap({
				shop: { ...bootstrap().shop, onboardingCompleted: completed },
			});
			expect(textContent(OverviewContent({ data }))).toContain(label);
		}
	);

	it('shows active and pending categories distinctly and retains generation/date context', () => {
		const data = bootstrap({
			storeProfile: {
				activeCategory: {
					id: 'cat_active',
					slug: 'home',
					displayName: 'Home',
				},
				pendingCategory: {
					id: 'cat_pending',
					slug: 'apparel',
					displayName: 'Apparel',
				},
				pendingSelectionGeneration: 4,
				pendingSelectedAt: '2026-10-02T12:30:00Z',
			},
		});
		const content = textContent(OverviewContent({ data }));

		expect(content).toContain('Active category');
		expect(content).toContain('Home');
		expect(content).toContain('Pending category');
		expect(content).toContain('Apparel');
		expect(content).toContain('4');
		expect(content).toContain('Oct');
	});

	it('presents empty category and nullable store context without substituting a locale', () => {
		const data = bootstrap({
			internationalContext: {
				storeLocale: 'pt_BR',
				languageTag: null,
				timeZone: null,
				countryCode: null,
			},
		});
		const content = textContent(OverviewContent({ data }));

		expect(content).toContain('Not selected');
		expect(content).toContain('pt_BR');
		expect(content).toContain('Language tag Not available');
		expect(content).toContain('Time zone Not available');
		expect(content).toContain('Country code Not available');
		expect(content).not.toContain('English');
	});

	it('keeps retry an explicit read-only action for a bounded failure', () => {
		const onRefresh = vi.fn();
		const element = OverviewScreen({
			state: { status: 'REMOTE_UNAVAILABLE' },
			onRefresh,
		});
		expect(textContent(element)).toContain('temporarily unavailable');
		expect(textContent(element)).toContain('Refresh overview');
		element.props.children[0].props.children[1].props.children[1].props.onClick();
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it('offers a real Sync store settings action and retryable errors without changing connection', () => {
		const sync = vi.fn();
		const element = OverviewScreen({
			state: { status: 'READY', data: bootstrap() },
			onRefresh: vi.fn(),
			onSync: sync,
			syncState: { status: 'ERROR' },
		});
		expect(textContent(element)).toContain('Sync store settings');
		expect(textContent(element)).toContain('Your connection is unchanged');
		const buttons = [];
		function walk(node) {
			if (Array.isArray(node)) {
				return node.forEach(walk);
			}
			if (!node || typeof node !== 'object') {
				return;
			}
			if (node.type === 'button') {
				buttons.push(node);
			}
			walk(node.props?.children);
		}
		walk(element);
		const syncButton = buttons.find(
			(button) => textContent(button) === 'Sync store settings'
		);
		expect(syncButton).toBeDefined();
		syncButton.props.onClick();
		expect(sync).toHaveBeenCalledTimes(1);
		const pending = OverviewScreen({
			state: { status: 'READY', data: bootstrap() },
			onRefresh: vi.fn(),
			onSync: sync,
			syncState: { status: 'SYNCING' },
		});
		expect(textContent(pending)).toContain('Syncing');
	});
});
