import { describe, expect, it, vi } from 'vitest';
import { ConversationPanel } from '../../src/recoveries/detail/conversation/conversation-panel';
import { HumanModeControls } from '../../src/recoveries/detail/human/human-mode-controls';
import { HumanReplyComposer } from '../../src/recoveries/detail/human/human-reply-composer';
import { HumanCommandStatus } from '../../src/recoveries/detail/human/human-command-status';
import { HumanConversationController } from '../../src/recoveries/detail/human/human-conversation-controller';
import { RecoveryDetailController } from '../../src/recoveries/detail/recovery-detail-controller';

const conversation = {
	id: 'conv_1',
	controlMode: 'HUMAN',
	controlRevision: 3,
	windowExpiresAt: '2099-01-01T12:00:00.000Z',
	followUp: { sequence2Used: false, initiatedBy: null },
};
const summary = {
	conversation,
	humanMessagingAllowed: true,
	humanMessagingStatus: 'ACTIVE',
	timeZone: 'Europe/London',
};
const accepted = {
	schemaVersion: 1,
	commandId: 'cmd_1',
	conversationId: 'conv_1',
	kind: 'HUMAN_TEXT',
	state: 'ACCEPTED',
	controlRevision: 3,
};
const failed = {
	schemaVersion: 1,
	commandId: 'cmd_1',
	conversationId: 'conv_1',
	kind: 'HUMAN_TEXT',
	state: 'FAILED',
	createdAt: '2026-10-23T14:00:00.000Z',
	updatedAt: '2026-10-23T14:01:00.000Z',
	messageId: null,
	failureCode: null,
	moderationStatus: 'moderation_allowed',
	moderationReasonCode: null,
};

function textContent(node) {
	if (Array.isArray(node)) {
		return node.map(textContent).join(' ');
	}
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	if (!node?.props) {
		return '';
	}
	return textContent(node.props.children);
}

describe('ARCH-040 WooCommerce Shopify-aligned conversation behaviour', () => {
	it('shows conversation controls, the dated transcript, paging and the composer in that order', () => {
		const view = ConversationPanel({
			state: 'READY',
			summary,
			human: { busy: false },
			timeZone: 'Europe/London',
			messages: [
				{
					id: 'one',
					sender: 'assistant',
					direction: 'outbound',
					contentType: 'TEXT',
					text: 'Hello',
					day: '23 Oct 2026',
					time: '14:30',
				},
				{
					id: 'two',
					sender: 'customer',
					direction: 'inbound',
					contentType: 'TEXT',
					text: 'Thanks',
					day: '23 Oct 2026',
					time: '14:35',
				},
			],
		});
		const children = view.props.children;
		const mode = children.findIndex(
			(child) => child?.type === HumanModeControls
		);
		const transcript = children.findIndex((child) => child?.type === 'ol');
		const paging = children.findIndex((child) => child?.type === 'nav');
		const composer = children.findIndex(
			(child) => child?.type === HumanReplyComposer
		);
		const status = children.findIndex(
			(child) => child?.type === HumanCommandStatus
		);
		expect(mode).toBeGreaterThan(0);
		expect(transcript).toBeGreaterThan(mode);
		expect(paging).toBeGreaterThan(transcript);
		expect(composer).toBeGreaterThan(paging);
		expect(status).toBeGreaterThan(composer);
		const lines = children[transcript].props.children;
		expect(
			lines.filter(
				(line) => line.props.className === 'moda-recovery-detail__day'
			)
		).toHaveLength(1);
	});

	it('provides an observable result of a status check even when FAILED remains FAILED', async () => {
		const client = {
			send: vi.fn().mockResolvedValue(accepted),
			status: vi.fn().mockResolvedValue(failed),
		};
		const controller = new HumanConversationController(
			'rec_1',
			client,
			() => 'key_1'
		);
		controller.setActive(true);
		controller.syncSummary(summary);
		expect(await controller.sendText('A message')).toBe(true);
		expect(await controller.refreshCommand()).toBe(true);
		expect(controller.state.command).toMatchObject({
			state: 'FAILED',
			commandId: 'cmd_1',
		});
		expect(controller.state.checkedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
		expect(controller.state.checking).toBe(false);
		expect(await controller.refreshCommand()).toBe(true);
		expect(client.status).toHaveBeenCalledTimes(2);
		expect(client.send).toHaveBeenCalledTimes(1);
		const shown = HumanCommandStatus({
			human: {
				...controller.state,
				onCheckStatus: vi.fn(),
				onAcknowledge: vi.fn(),
			},
		});
		expect(textContent(shown)).toContain('Message failed.');
		expect(
			shown.props.children.some(
				(child) =>
					child?.props?.className === 'moda-recovery-detail__checked'
			)
		).toBe(true);
		controller.acknowledgeCommand();
		controller.setActive(false);
	});

	it('supersedes an in-flight transcript read when a command reaches terminal state', async () => {
		let resolveInitial;
		const pending = new Promise((resolve) => {
			resolveInitial = resolve;
		});
		const client = {
			messages: vi
				.fn()
				.mockImplementationOnce(() => pending)
				.mockResolvedValue({
					items: [],
					previousCursor: null,
					nextCursor: null,
				}),
		};
		const controller = new RecoveryDetailController('rec_1', client);
		controller.active = true;
		controller.state.summary = { status: 'READY', data: {}, error: null };
		const first = controller.loadMessages();
		expect(controller.state.messages.status).toBe('LOADING');
		await controller.jumpLatest();
		expect(client.messages).toHaveBeenLastCalledWith(
			'rec_1',
			{ window: 'latest' },
			expect.anything()
		);
		resolveInitial({
			items: [{ id: 'stale' }],
			previousCursor: null,
			nextCursor: null,
		});
		await first;
		expect(controller.state.messages.data.items).toEqual([]);
		controller.setActive(false);
	});

	it('disables repeated status clicks while the same status request is in flight', async () => {
		let finish;
		const client = {
			send: vi.fn().mockResolvedValue(accepted),
			status: vi.fn(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					})
			),
		};
		const controller = new HumanConversationController(
			'rec_1',
			client,
			() => 'key_2'
		);
		controller.setActive(true);
		controller.syncSummary(summary);
		await controller.sendText('Another message');
		const first = controller.refreshCommand();
		expect(controller.state.checking).toBe(true);
		expect(await controller.refreshCommand()).toBe(false);
		expect(client.status).toHaveBeenCalledTimes(1);
		finish(failed);
		expect(await first).toBe(true);
		expect(controller.state.checking).toBe(false);
		controller.setActive(false);
	});
});
