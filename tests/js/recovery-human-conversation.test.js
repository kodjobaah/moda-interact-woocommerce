import { afterEach, describe, it, expect, vi } from 'vitest';
import { createConversationCommandClient } from '../../src/recoveries/detail/human/conversation-command-client';
import {
	parseCommandResponse,
	parseFollowUpTemplates,
	commandInput,
	humanActionAvailability,
} from '../../src/recoveries/detail/human/conversation-command-contract';
import { HumanConversationController } from '../../src/recoveries/detail/human/human-conversation-controller';

const conversation = {
	id: 'conv_1',
	controlMode: 'HUMAN',
	controlRevision: 7,
	lastInboundAt: '2026-10-23T11:00:00.000Z',
	windowExpiresAt: '2026-10-24T11:00:00.000Z',
	followUp: { sequence2Used: false, initiatedBy: null },
};
const summary = {
	humanMessagingAllowed: true,
	humanMessagingStatus: 'ACTIVE',
	conversation,
};
const status = {
	schemaVersion: 1,
	commandId: 'cmd_1',
	conversationId: 'conv_1',
	kind: 'HUMAN_TEXT',
	state: 'SENT',
	createdAt: '2026-10-23T11:00:00.000Z',
	updatedAt: '2026-10-23T11:00:01.000Z',
	messageId: 'msg_1',
	failureCode: null,
	moderationStatus: 'moderation_allowed',
	moderationReasonCode: null,
};

afterEach(() => vi.useRealTimers());

describe('ARCH-040 WooCommerce recovery human commands', () => {
	it('enforces strict bounded hosted response contracts', () => {
		expect(
			parseCommandResponse('status', status, 'conv_1', 'cmd_1')
		).toEqual(status);
		expect(() =>
			parseCommandResponse(
				'status',
				{ ...status, apiToken: 'secret' },
				'conv_1',
				'cmd_1'
			)
		).toThrow();
		expect(() =>
			parseCommandResponse('status', status, 'foreign_conv', 'cmd_1')
		).toThrow();
		expect(() =>
			commandInput('HUMAN_TEXT', 7, 'key_1', 'A reply')
		).not.toThrow();
		expect(() => commandInput('HUMAN_TEXT', 7, 'key_1', ' bad ')).toThrow();
	});

	it('calls only WP recovery-derived routes, never hosted/Meta endpoints', async () => {
		const request = vi.fn(async ({ path }) => {
			if (path.endsWith('/control')) {
				return {
					schemaVersion: 1,
					conversationId: 'conv_1',
					controlMode: 'HUMAN',
					controlRevision: 8,
					controlChangedAt: null,
				};
			}
			if (path.endsWith('/follow-up-templates')) {
				return {
					schemaVersion: 1,
					templates: [
						{ name: 'recovery_follow_up', language: 'en_GB' },
					],
				};
			}
			if (path.endsWith('/messages')) {
				return {
					schemaVersion: 1,
					commandId: 'cmd_1',
					conversationId: 'conv_1',
					kind: 'HUMAN_TEXT',
					state: 'ACCEPTED',
					controlRevision: 7,
				};
			}
			return status;
		});
		const client = createConversationCommandClient(request);
		await client.followUpTemplates('rec_1');
		await client.control('rec_1', conversation, 'HUMAN', 7);
		await client.send(
			'rec_1',
			conversation,
			'HUMAN_TEXT',
			'same-key',
			'Hello'
		);
		await client.status('rec_1', 'conv_1', 'cmd_1');
		expect(request.mock.calls.map(([args]) => args.path)).toEqual([
			'/moda-interact/v1/merchant/recoveries/rec_1/conversation/follow-up-templates',
			'/moda-interact/v1/merchant/recoveries/rec_1/conversation/control',
			'/moda-interact/v1/merchant/recoveries/rec_1/conversation/messages',
			'/moda-interact/v1/merchant/recoveries/rec_1/conversation/send-commands/cmd_1',
		]);
	});

	it('honours mode, real inbound window, suspension and already-used follow-up', () => {
		expect(
			humanActionAvailability(summary, Date.parse('2026-10-23T12:00:00Z'))
				.canText
		).toBe(true);
		expect(
			humanActionAvailability(summary, Date.parse('2026-10-24T12:00:00Z'))
				.canText
		).toBe(false);
		expect(
			humanActionAvailability({
				...summary,
				humanMessagingAllowed: false,
				humanMessagingStatus: 'SUSPENDED',
			}).canText
		).toBe(false);
		expect(
			humanActionAvailability({
				...summary,
				conversation: { ...conversation, controlMode: 'AI' },
			}).canTakeOver
		).toBe(true);
		expect(
			humanActionAvailability({
				...summary,
				conversation: {
					...conversation,
					followUp: { sequence2Used: true, initiatedBy: 'HUMAN' },
				},
			}).canTemplate
		).toBe(false);
	});

	it('only offers authenticated choices outside window and sends empty parameters', async () => {
		const templates = [{ name: 'recovery_follow_up', language: 'en_GB' }];
		expect(() =>
			commandInput('RECOVERY_FOLLOW_UP_TEMPLATE', 7, 'key_1', {
				templateName: 'recovery_follow_up',
				templateLanguage: 'en_GB',
				templateParameters: ['Injected'],
			})
		).toThrow();
		expect(
			humanActionAvailability(
				summary,
				Date.parse('2026-10-24T12:00:00Z'),
				templates
			).canTemplate
		).toBe(true);
		expect(
			humanActionAvailability(
				summary,
				Date.parse('2026-10-23T12:00:00Z'),
				templates
			).canTemplate
		).toBe(false);
		expect(() =>
			parseFollowUpTemplates({
				schemaVersion: 1,
				templates: [{ name: 'x', language: 'en', parameters: [] }],
			})
		).toThrow();
	});

	it('sends only the selected authorised template with no parameters', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
		const client = {
			followUpTemplates: vi
				.fn()
				.mockResolvedValue([
					{ name: 'recovery_follow_up', language: 'en_GB' },
				]),
			send: vi.fn().mockResolvedValue({
				schemaVersion: 1,
				commandId: 'cmd_1',
				conversationId: 'conv_1',
				kind: 'RECOVERY_FOLLOW_UP_TEMPLATE',
				state: 'ACCEPTED',
				controlRevision: 7,
			}),
			status: vi.fn(),
		};
		const c = new HumanConversationController(
			'rec_1',
			client,
			() => 'stable-template-key'
		);
		c.setActive(true);
		c.syncSummary(summary);
		c.syncSummary({
			...summary,
			conversation: {
				...conversation,
				windowExpiresAt: '2026-10-24T11:00:00.000Z',
			},
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(
			await c.sendTemplate({
				templateName: 'recovery_follow_up',
				templateLanguage: 'en_GB',
			})
		).toBe(true);
		expect(client.send).toHaveBeenCalledWith(
			'rec_1',
			expect.objectContaining({ id: 'conv_1' }),
			'RECOVERY_FOLLOW_UP_TEMPLATE',
			'stable-template-key',
			{
				templateName: 'recovery_follow_up',
				templateLanguage: 'en_GB',
				templateParameters: [],
			}
		);
		c.setActive(false);
	});

	it('never sends twice on pending click; ambiguous retry reuses the same key', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
		let accept;
		const call = vi.fn(
			() =>
				new Promise((resolve) => {
					accept = resolve;
				})
		);
		const client = {
			send: call,
			status: vi.fn().mockResolvedValue(status),
		};
		const c = new HumanConversationController(
			'rec_1',
			client,
			() => 'stable-key'
		);
		c.setActive(true);
		c.syncSummary(summary);
		const first = c.sendText('Hello');
		expect(await c.sendText('Hello')).toBe(false);
		expect(call).toHaveBeenCalledTimes(1);
		accept({
			schemaVersion: 1,
			commandId: 'cmd_1',
			conversationId: 'conv_1',
			kind: 'HUMAN_TEXT',
			state: 'ACCEPTED',
			controlRevision: 7,
		});
		expect(await first).toBe(true);
		expect(await c.sendText('Another')).toBe(false);
		await c.refreshCommand();
		expect(c.state.command.state).toBe('SENT');
		c.acknowledgeCommand();
		expect(c.state.command).toBeNull();
		c.setActive(false);
	});
});
