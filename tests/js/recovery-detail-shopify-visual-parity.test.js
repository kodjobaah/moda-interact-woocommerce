import { describe, expect, it } from 'vitest';
import {
	detailSummaryDisplay,
	formatDetailMoney,
	recoveryCustomerHeading,
} from '../../src/recoveries/detail/recovery-detail-presentation';
import { RecoveryDetailHeader } from '../../src/recoveries/detail/recovery-detail-header';
import { CheckoutContextPanel } from '../../src/recoveries/detail/context/checkout-context-panel';
import { HumanModeControls } from '../../src/recoveries/detail/human/human-mode-controls';

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

const money = (amount) => ({ amount, currency: 'USD' });
const summary = {
	customer: {
		firstName:
			'Grace--https://simulations-mrs-anime-ceiling.trycloudflare.com',
		lastName: 'Hopper',
		email: 'grace@example.invalid',
	},
	value: { ...money('124.50'), incomplete: false },
	status: 'ENGAGED',
	timeZone: 'Europe/London',
	basket: {
		items: [
			{
				title: 'Fixture checkout product',
				variantTitle: 'Standard',
				quantity: 1,
				unitPrice: money('124.50'),
				lineTotal: null,
				imageUrl: null,
			},
		],
		recoveryTotal: money('124.50'),
		unavailableReason: null,
	},
	conversation: { followUp: { sequence2Used: false } },
	milestones: {
		detectedAt: '2026-10-20T15:36:00.000Z',
		messageSentAt: '2026-10-20T19:36:00.000Z',
		engagedAt: '2026-10-20T20:06:00.000Z',
		completedAt: null,
		expiredAt: null,
	},
};

describe('ARCH-040 Woo Recovery Detail visual parity with Shopify', () => {
	it('separates an explicitly marked fixture store URL from the customer heading', () => {
		const display = detailSummaryDisplay(summary, 'en-GB');
		expect(display.customerName).toBe('Grace Hopper');
		expect(display.customerSite).toBe(
			'https://simulations-mrs-anime-ceiling.trycloudflare.com'
		);
		expect(display.checkoutValue).toMatch(/124\.50/);
		const header = RecoveryDetailHeader({ detail: display });
		expect(words(header)).toContain('Grace Hopper');
		expect(words(header)).toContain('grace@example.invalid');
		expect(words(header)).toContain(display.customerSite);
		expect(
			recoveryCustomerHeading(
				{ firstName: 'Anne--Marie', lastName: 'Smith' },
				'Guest'
			).name
		).toBe('Anne--Marie Smith');
	});

	it('displays exact saved amounts and never invents unavailable prices', () => {
		expect(formatDetailMoney(money('124.50'), 'en-GB')).toMatch(/124\.50/);
		expect(
			formatDetailMoney({ amount: null, currency: 'USD' }, 'en-GB')
		).toBeNull();
		expect(
			formatDetailMoney({ amount: '124.50', currency: null }, 'en-GB')
		).toBeNull();
	});

	it('renders independent basket, recovery activity and related cards', () => {
		const display = detailSummaryDisplay(summary, 'en-GB');
		const panel = CheckoutContextPanel({
			basket: display.basket,
			milestones: display.milestones,
			followUpUsed: display.followUpUsed,
			related: { state: 'READY', items: [] },
		});
		const cards = panel.props.children;
		expect(cards.map((card) => card.type)).toEqual([
			'details',
			'section',
			'details',
		]);
		expect(cards[0].props.open).toBe(true);
		expect(cards[2].props.open).toBe(false);
		expect(
			CheckoutContextPanel({
				related: { state: 'READY', items: [{ id: 'related_1' }] },
			}).props.children[2].props.open
		).toBe(true);
		expect(words(cards[0])).toContain('Checkout basket');
		expect(words(cards[0])).toContain('Saved recovery total');
		expect(words(cards[0])).toContain('Unit price');
		expect(words(cards[0])).toContain('Prices are not live.');
		expect(words(cards[1])).toContain('Recovery activity');
		expect(words(cards[1])).toContain('Initial outreach');
		expect(words(cards[1])).toContain('Follow-up');
		expect(words(cards[2])).toContain('Related recoveries');
	});

	it('groups mode status at the left and keeps the action separate', () => {
		const onResumeAI = () => {};
		const controlSummary = {
			conversation: {
				id: 'conv_1',
				controlMode: 'HUMAN',
				controlRevision: 3,
				windowExpiresAt: '2099-01-01T12:00:00.000Z',
				followUp: { sequence2Used: false, initiatedBy: null },
			},
			timeZone: 'Europe/London',
			humanMessagingAllowed: true,
			humanMessagingStatus: 'ACTIVE',
		};
		const control = HumanModeControls({
			summary: controlSummary,
			human: { busy: false, onResumeAI },
		});
		const [modeRow] = control.props.children;
		const [status, resume] = modeRow.props.children.filter(Boolean);
		expect(modeRow.props.className).toBe(
			'moda-recovery-detail__human-mode'
		);
		expect(status.props.className).toBe(
			'moda-recovery-detail__human-mode-status'
		);
		expect(status.props.children[0].props['aria-hidden']).toBe(true);
		expect(words(status)).toContain('Merchant in control');
		expect(resume.props.children).toBe('Resume AI');
		expect(resume.props.onClick).toBe(onResumeAI);
		const busyRow = HumanModeControls({
			summary: controlSummary,
			human: { busy: true, onResumeAI },
		}).props.children[0];
		expect(busyRow.props.children.filter(Boolean)[1].props.disabled).toBe(
			true
		);

		const onTakeOver = () => {};
		const aiControl = HumanModeControls({
			summary: {
				...controlSummary,
				conversation: {
					...controlSummary.conversation,
					controlMode: 'AI',
				},
			},
			human: { busy: false, onTakeOver },
		});
		const [aiStatus, takeOver] =
			aiControl.props.children[0].props.children.filter(Boolean);
		expect(words(aiStatus)).toContain('Moda assistant');
		expect(takeOver.props.children).toBe('Take Over');
		expect(takeOver.props.onClick).toBe(onTakeOver);
	});
});
