import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
	recoveriesListHref,
	recoveryDetailHref,
	readRecoveryDetailRoute,
	readRecoveryListQuery,
} from '../../src/recoveries/detail/detail-navigation';
import { RecoveryDetailScreen } from '../../src/recoveries/detail/recovery-detail-screen';
import { ConversationPanel } from '../../src/recoveries/detail/conversation/conversation-panel';
import {
	ConversationMessage,
	SafeMessageText,
} from '../../src/recoveries/detail/conversation/conversation-message';
import { CheckoutContextPanel } from '../../src/recoveries/detail/context/checkout-context-panel';
import { RelatedRecoveries } from '../../src/recoveries/detail/context/related-recoveries';
import { RecoveryList } from '../../src/recoveries/list/recovery-list';
import { RecoveryRow } from '../../src/recoveries/list/recovery-row';
import { RecoveriesController } from '../../src/recoveries/recoveries-controller';

function descendants(node, type) {
	if (Array.isArray(node)) {
		return node.flatMap((item) => descendants(item, type));
	}
	if (!node || typeof node !== 'object') {
		return [];
	}
	if (typeof node.type === 'function') {
		return descendants(node.type(node.props), type);
	}
	return [
		...(node.type === type ? [node] : []),
		...descendants(node.props?.children, type),
	];
}

function words(node) {
	if (Array.isArray(node)) {
		return node.map(words).join(' ');
	}
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	if (!node) {
		return '';
	}
	if (typeof node.type === 'function') {
		return words(node.type(node.props));
	}
	return words(node.props?.children);
}

const query = {
	from: '2026-09-12',
	to: '2026-10-11',
	q: 'ada@example.invalid',
	status: 'COMPLETED',
	page: 2,
	pageSize: 10,
};
const fixture = {
	customerName: 'Ada Lovelace',
	customerEmail: 'ada@example.invalid',
	status: 'COMPLETED',
	checkoutValue: '£89.99',
	startedAt: 'Oct 9, 2026',
	milestones: { started: 'Oct 9, 2026', sent: 'Oct 9, 2026' },
};

const message = {
	id: 'sample-message',
	direction: 'outbound',
	sender: 'assistant',
	contentType: 'TEXT',
	text: 'Visit https://example.test/help or javascript:alert(1) <b>bold</b>',
	createdAt: 'Oct 9, 2026',
	deliveryStatus: 'Delivered',
};

describe('ARCH-035 Recovery Detail UI Stage 1', () => {
	it('keeps the WordPress Recoveries menu and filter/page context for full reload and back', () => {
		const detail = recoveryDetailHref('recovery_42', query);
		expect(detail).toContain('page=moda-interact-recoveries');
		expect(detail).toContain('recoveryId=recovery_42');
		const route = readRecoveryDetailRoute(detail.split('?')[1]);
		expect(route.recoveryId).toBe('recovery_42');
		expect(readRecoveryListQuery(route.listHref.split('?')[1])).toEqual(
			query
		);
		expect(route.listHref).toBe(recoveriesListHref(query));
		const controller = new RecoveriesController(
			{ list: vi.fn() },
			readRecoveryListQuery(route.listHref.split('?')[1])
		);
		expect(controller.query).toEqual(query);
	});

	it('does not allow arbitrary WP route fields, unsafe IDs or injected query arguments', () => {
		expect(recoveryDetailHref('invalid?/id', query)).toBeNull();
		expect(
			readRecoveryListQuery('?from=2026-02-30&to=2026-10-11')
		).not.toHaveProperty('from');
		expect(recoveryDetailHref('', query)).toBeNull();
		expect(recoveryDetailHref('x'.repeat(192), query)).toBeNull();
		expect(
			readRecoveryDetailRoute('?page=moda-interact-recoveries')
		).toBeNull();
		const bad = readRecoveryDetailRoute(
			'?page=moda-interact-recoveries&recoveryId=%3Cbad%3E&token=private'
		);
		expect(bad.recoveryId).toBeNull();
		expect(bad.listHref).not.toContain('token');
		expect(
			recoveriesListHref({ ...query, q: 'a&apiToken=secret' })
		).toContain('q=a%26apiToken%3Dsecret');
	});

	it('uses links for real list rows but never invents production detail data', () => {
		const item = { ...fixture, id: 'recovery_42' };
		const href = recoveryDetailHref(item.id, query);
		const row = RecoveryRow({ item, detailHref: href });
		const anchor = descendants(row, 'a')[0];
		expect(anchor.props.href).toBe(href);
		expect(words(row)).toContain('Ada Lovelace');
		const list = RecoveryList({
			state: 'READY',
			items: [item],
			getDetailHref: () => href,
		});
		expect(descendants(list, 'a')).toHaveLength(1);
		const detail = RecoveryDetailScreen({
			route: readRecoveryDetailRoute(href.split('?')[1]),
		});
		expect(words(detail)).toContain(
			'This section is not yet available for WooCommerce.'
		);
		expect(words(detail)).not.toContain('Ada Lovelace');
		expect(words(detail)).not.toContain('£89.99');
		expect(descendants(detail, 'a')[0].props.href).toBe(
			recoveriesListHref(query)
		);
	});

	it('renders a Shopify-shaped header, conversation and independently paged related section from test-only props', () => {
		const prev = vi.fn();
		const next = vi.fn();
		const refresh = vi.fn();
		const detail = RecoveryDetailScreen({
			route: {
				recoveryId: 'recovery_42',
				listHref: recoveriesListHref(query),
			},
			detail: fixture,
			conversation: {
				state: 'READY',
				messages: [message],
				timeZone: 'America/New_York',
				hasPrevious: true,
				hasNext: true,
				onPrevious: prev,
				onNext: next,
				onJumpLatest: refresh,
				onRefresh: refresh,
			},
			related: {
				state: 'READY',
				items: [
					{ id: 'r2', label: 'Sep 28, 2026', status: 'COMPLETED' },
				],
				onNext: next,
				hasNext: true,
				getHref: (id) => recoveryDetailHref(id, query),
			},
		});
		expect(words(detail)).toContain('Ada Lovelace');
		expect(words(detail)).toContain('Read-only conversation history.');
		expect(words(detail)).toContain('Milestones');
		expect(words(detail)).toContain('Related recoveries');
		expect(descendants(detail, 'details')[0].props.open).toBe(true);
		expect(descendants(detail, 'time')).toHaveLength(1);
		expect(
			descendants(detail, 'a').some((a) =>
				a.props.href.includes('recoveryId=r2')
			)
		).toBe(true);
	});

	it('renders only safe HTTP(S) links and escapes unsupported link schemes as text', () => {
		const text = SafeMessageText({ text: message.text });
		const links = descendants(text, 'a');
		expect(links).toHaveLength(1);
		expect(links[0].props.href).toBe('https://example.test/help');
		expect(links[0].props.rel).toBe('noopener noreferrer');
		expect(words(text)).toContain('javascript:alert(1) <b>bold</b>');
		expect(
			descendants(
				SafeMessageText({
					text: 'https://user:pass@example.test/private',
				}),
				'a'
			)
		).toHaveLength(0);
		expect(
			words(
				ConversationMessage({
					message: { ...message, contentType: 'AUDIO', text: null },
				})
			)
		).toContain('Transcription unavailable');
	});

	it('separates unavailable/loading/empty/error without enabling unsupported actions', () => {
		for (const [state, marker] of [
			['UNAVAILABLE', 'not yet available'],
			['LOADING', 'Loading recoveries'],
			['EMPTY', 'No conversation recorded.'],
			['ERROR', 'This section could not be loaded.'],
		]) {
			const conversation = ConversationPanel({ state });
			expect(words(conversation)).toContain(marker);
			expect(
				descendants(conversation, 'button').every(
					(btn) => btn.props.disabled
				)
			).toBe(true);
		}
		expect(words(RelatedRecoveries({ state: 'EMPTY' }))).toContain(
			'No related recoveries.'
		);
		expect(words(CheckoutContextPanel({}))).toContain('not yet available');
		expect(
			words(
				RecoveryDetailScreen({
					route: { recoveryId: null, listHref: recoveriesListHref() },
				})
			)
		).toContain('Recovery unavailable.');
	});

	it('uses responsive two-column desktop and single-column mobile panels', () => {
		const scss = readFileSync(
			new URL(
				'../../src/recoveries/detail/styles/_recovery-detail.scss',
				import.meta.url
			),
			'utf8'
		);
		expect(scss).toContain(
			'grid-template-columns: minmax(0, 1.75fr) minmax(250px, 0.9fr)'
		);
		expect(scss).toContain('@media (max-width: 960px)');
		expect(scss).toContain('@media (max-width: 600px)');
		const chatScss = readFileSync(
			new URL(
				'../../src/recoveries/detail/styles/_recovery-conversation.scss',
				import.meta.url
			),
			'utf8'
		);
		expect(chatScss).toContain('@media (max-width: 600px)');
	});
});
