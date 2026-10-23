import { expect, it, vi } from 'vitest';
import { PromotionsScreen } from '../../src/promotions/promotions-screen';
import { PromotionHistory } from '../../src/promotions/history';
import { formatDate } from '../../src/billing/presentation-formatters';
import {
	PromotionCards,
	PromotionPager,
} from '../../src/promotions/presentation';

function nodes(tree, type) {
	if (Array.isArray(tree)) {
		return tree.flatMap((child) => nodes(child, type));
	}
	if (tree === null || tree === undefined || typeof tree !== 'object') {
		return [];
	}
	if (typeof tree.type === 'function') {
		return nodes(tree.type(tree.props), type);
	}
	return [
		...(tree.type === type ? [tree] : []),
		...nodes(tree.props?.children, type),
	];
}

function text(tree) {
	if (Array.isArray(tree)) {
		return tree.map(text).join(' ');
	}
	if (tree === null || tree === undefined) {
		return '';
	}
	if (typeof tree === 'string' || typeof tree === 'number') {
		return String(tree);
	}
	if (typeof tree.type === 'function') {
		return text(tree.type(tree.props));
	}
	return text(tree.props?.children);
}

const fixture = {
	id: 'campaign-a',
	merchantTitle: 'Autumn',
	merchantDescription: 'Five credits',
	quantity: 5,
	expiresAt: '2026-11-01T00:00:00.000Z',
	remainingQuantity: 5,
	previouslyClaimed: false,
	exhausted: false,
	eligible: true,
	selectable: true,
	currentlySelected: false,
};

it('renders honest unavailable, loading, error and denied states without fake offers or select actions', () => {
	for (const status of ['UNAVAILABLE', 'LOADING', 'ERROR', 'DENIED']) {
		const screen = PromotionsScreen({ model: { status } });
		expect(text(screen)).toContain('Promotions');
		expect(nodes(screen, 'article')).toHaveLength(0);
		expect(nodes(screen, 'button')).toHaveLength(0);
		expect(nodes(screen, 'details')).toHaveLength(1);
		expect(text(screen).includes('not yet available')).toBe(
			status === 'UNAVAILABLE'
		);
		expect(nodes(screen, 'p').some((p) => p.props.role === 'alert')).toBe(
			['ERROR', 'DENIED'].includes(status)
		);
	}
});

it('renders Shopify-like offer card content but disables unbacked selection', () => {
	const root = PromotionCards({ offers: [fixture] });
	const [button] = nodes(root, 'button');
	expect(text(root)).toContain('Autumn');
	expect(text(root)).toContain('5 credits');
	expect(text(root)).toContain(`Expires ${formatDate(fixture.expiresAt)}`);
	expect(button.props.disabled).toBe(true);
	expect(button.props.type).toBe('button');
});

it('only permits selection when an authorised adapter is provided and no lock/busy applies', () => {
	const select = vi.fn();
	for (const options of [
		{ locked: true },
		{ busy: true },
		{ selected: { campaignId: fixture.id } },
		{ offers: [{ ...fixture, exhausted: true }] },
	]) {
		const root = PromotionCards({
			offers: [fixture],
			onSelect: select,
			...options,
		});
		expect(nodes(root, 'button')[0].props.disabled).toBe(true);
	}
	const root = PromotionCards({ offers: [fixture], onSelect: select });
	const [button] = nodes(root, 'button');
	expect(button.props.disabled).toBe(false);
	button.props.onClick();
	button.props.onClick();
	expect(select).toHaveBeenCalledExactlyOnceWith(fixture.id);
});

it('renders selected/locked current campaign separately and hides it from offer grid', () => {
	const screen = PromotionsScreen({
		model: {
			status: 'READY',
			selection: {
				...fixture,
				campaignId: fixture.id,
				merchantTitle: fixture.merchantTitle,
				remainingQuantity: 2,
				locked: true,
			},
			offers: [
				fixture,
				{ ...fixture, id: 'campaign-b', merchantTitle: 'Winter' },
			],
			offersPagination: { page: 1, totalPages: 1 },
			history: { entries: [], totalEntries: 0 },
		},
	});
	expect(text(screen)).toContain('Current promotion');
	expect(text(screen)).toContain('Remaining 2');
	expect(nodes(screen, 'article')).toHaveLength(1);
	expect(text(screen)).toContain('Winter');
	expect(nodes(screen, 'button')[0].props.disabled).toBe(true);
});

it('paginates independently, supports empty state and keeps history disclosure semantic', () => {
	const onPage = vi.fn();
	const pager = PromotionPager({ page: 2, totalPages: 3, onPage });
	const buttons = nodes(pager, 'button');
	buttons[0].props.onClick();
	buttons[1].props.onClick();
	expect(onPage.mock.calls).toEqual([[1], [3]]);
	expect(PromotionPager({ page: 1, totalPages: 1 })).toBeNull();
	const disclosure = PromotionHistory({
		history: {
			entries: [
				{
					campaignId: 'a',
					campaignTitle: 'Autumn',
					status: 'USED',
					quantityGranted: 5,
					committedQuantity: 3,
					remainingQuantity: 2,
					lastSelectedAt: '2026-10-12T00:00:00.000Z',
					expiresAt: '2026-11-01T00:00:00.000Z',
				},
			],
			totalEntries: 1,
		},
		page: 1,
	});
	expect(nodes(disclosure, 'details')).toHaveLength(1);
	expect(nodes(disclosure, 'summary')).toHaveLength(1);
	expect(text(disclosure)).toContain('Autumn');
	const empty = PromotionsScreen({
		model: { status: 'READY', offers: [], history: { entries: [] } },
	});
	expect(text(empty)).toContain('No promotions available.');
});

it('uses compact promotions and history headings in the unavailable state', () => {
	const screen = PromotionsScreen({ model: { status: 'UNAVAILABLE' } });
	const sections = nodes(screen, 'section');
	expect(
		sections.some(
			(section) => section.props.className === 'moda-promotions__panel'
		)
	).toBe(true);
	expect(nodes(screen, 'header')).toHaveLength(1);
	expect(nodes(screen, 'h1')).toHaveLength(1);
	expect(nodes(screen, 'details')).toHaveLength(1);
	expect(text(screen)).toContain(
		'Promotion offers are not yet available for WooCommerce.'
	);
	expect(nodes(screen, 'article')).toHaveLength(0);
});

it.each([
	['SELECTED', 'Selected'],
	['USED', 'Used'],
	['EXHAUSTED', 'Exhausted'],
	['EXPIRED', 'Expired'],
	['CLOSED', 'Closed'],
	['NO_LONGER_ELIGIBLE', 'No longer eligible'],
	['REOPENED', 'Reopened'],
])('renders API-021 history status %s as %s', (status, label) => {
	const root = PromotionHistory({
		history: {
			entries: [
				{
					campaignId: 'campaign-a',
					campaignTitle: 'Autumn',
					status,
					quantityGranted: 5,
					committedQuantity: 2,
					remainingQuantity: 3,
					lastSelectedAt: '2026-10-20T00:00:00.000Z',
					expiresAt: '2026-11-01T00:00:00.000Z',
				},
			],
			totalEntries: 1,
			totalPages: 1,
		},
	});
	expect(text(root)).toContain(label);
	expect(text(root)).toContain('Granted 5');
	expect(text(root)).not.toContain('Unavailable');
});

it('supports explicit refresh, reconnect, and post-revision-conflict messaging', () => {
	const onRefresh = vi.fn();
	const onReconnect = vi.fn();
	const expired = PromotionsScreen({
		model: { status: 'RECONNECT_REQUIRED' },
		onRefresh,
		onReconnect,
	});
	expect(text(expired)).toContain('Reconnect Moda Interact');
	nodes(expired, 'button')[0].props.onClick();
	expect(onReconnect).toHaveBeenCalledOnce();
	expect(onRefresh).not.toHaveBeenCalled();
	const conflict = PromotionsScreen({
		model: { status: 'CONFLICT' },
		onRefresh,
	});
	expect(nodes(conflict, 'p').some((p) => p.props.role === 'alert')).toBe(
		true
	);
	nodes(conflict, 'button')[0].props.onClick();
	expect(onRefresh).toHaveBeenCalledOnce();
	const reloaded = PromotionsScreen({
		model: {
			status: 'READY',
			selection: null,
			offers: [],
			offersPagination: { page: 1, totalPages: 1 },
			history: { page: 1, entries: [], totalPages: 1 },
			error: 'CONFLICT',
		},
	});
	expect(nodes(reloaded, 'p').some((p) => p.props.role === 'alert')).toBe(
		true
	);
	expect(text(reloaded)).toContain('latest offers have been loaded');
});

it('explains a locked selection without advertising offers as available', () => {
	const onSelect = vi.fn();
	const current = {
		campaignId: 'selected-campaign',
		merchantTitle: 'Current bonus',
		remainingQuantity: 4,
		locked: true,
		expiresAt: '2026-10-31T00:00:00.000Z',
	};
	const model = {
		status: 'READY',
		selection: current,
		offers: [fixture],
		offersPagination: { page: 1, totalPages: 1 },
		history: { entries: [], page: 1, totalPages: 1 },
	};
	const lockedScreen = PromotionsScreen({ model, onSelect });
	expect(text(lockedScreen)).toContain(
		`You cannot select another promotion until your current promotion expires (${formatDate(current.expiresAt)}).`
	);
	expect(text(lockedScreen)).toContain('Selection locked');
	expect(text(lockedScreen)).not.toContain('Available now');
	const [lockedButton] = nodes(lockedScreen, 'button');
	expect(lockedButton.props.disabled).toBe(true);
	lockedButton.props.onClick();
	expect(onSelect).not.toHaveBeenCalled();

	const unlockedScreen = PromotionsScreen({
		model: { ...model, selection: null },
		onSelect,
	});
	expect(text(unlockedScreen)).toContain('Available now');
	expect(text(unlockedScreen)).not.toContain('Selection locked');
	expect(text(unlockedScreen)).not.toContain(
		'You cannot select another promotion'
	);
	const [unlockedButton] = nodes(unlockedScreen, 'button');
	expect(unlockedButton.props.disabled).toBe(false);
	unlockedButton.props.onClick();
	expect(onSelect).toHaveBeenCalledExactlyOnceWith(fixture.id);
});

it('distinguishes exhaustion, prior claim and ineligibility', () => {
	for (const [changes, label] of [
		[{ exhausted: true }, 'Exhausted'],
		[{ previouslyClaimed: true }, 'Previously claimed'],
		[{ eligible: false }, 'Not available'],
		[{ selectable: false }, 'Not available'],
	]) {
		const root = PromotionCards({
			offers: [{ ...fixture, ...changes }],
			onSelect: vi.fn(),
		});
		expect(text(root)).toContain(label);
		expect(text(root)).not.toContain('Available now');
		expect(nodes(root, 'button')[0].props.disabled).toBe(true);
	}
});
