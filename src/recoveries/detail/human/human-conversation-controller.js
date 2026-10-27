import { createConversationCommandClient } from './conversation-command-client';
import { humanActionAvailability } from './conversation-command-contract';

const FINAL = new Set(['SENT', 'FAILED', 'CANCELLED']);
const DEFINITIVE_ERROR = new Set([
	'INVALID_REQUEST',
	'HUMAN_CONTENT_INVALID',
	'HUMAN_MESSAGING_SUSPENDED',
	'SERVICE_WINDOW_CLOSED',
	'STALE_CONTROL_REVISION',
	'NOT_HUMAN_CONTROLLED',
	'FOLLOW_UP_UNAVAILABLE',
	'TEMPLATE_NOT_ALLOWED',
	'SEND_ENTITLEMENT_UNAVAILABLE',
	'RECIPIENT_UNAVAILABLE',
	'IDEMPOTENCY_CONFLICT',
]);
const cleanError = (error) => error?.message || 'REMOTE_UNAVAILABLE';

/** A key represents one immutable send intent, even across network uncertainty. */
function newKey() {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID();
	}
	if (globalThis.crypto?.getRandomValues) {
		const bytes = new Uint8Array(16);
		globalThis.crypto.getRandomValues(bytes);
		return `woo-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
	}
	throw new Error('IDEMPOTENCY_UNAVAILABLE');
}

export class HumanConversationController {
	constructor(
		recoveryId,
		client = createConversationCommandClient(),
		keyFactory = newKey
	) {
		this.id = recoveryId;
		this.client = client;
		this.keyFactory = keyFactory;
		this.active = false;
		this.listeners = new Set();
		this.summary = null;
		this.intent = null;
		this.pending = null;
		this.state = {
			busy: false,
			error: null,
			command: null,
			control: null,
			polling: false,
			pollCount: 0,
			retryable: false,
			checking: false,
			checkedAt: null,
			templates: [],
			templatesStatus: 'IDLE',
			templatesError: null,
		};
		this.templateRequest = null;
	}

	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}
	publish(update) {
		this.state = { ...this.state, ...update };
		for (const listener of this.listeners) {
			listener(this.state);
		}
	}
	setActive(active) {
		this.active = active;
		if (!active) {
			this.pending?.abort();
			this.pending = null;
			this.templateRequest?.abort();
			this.templateRequest = null;
			this.intent = null;
			this.summary = null;
			this.publish({
				busy: false,
				error: null,
				command: null,
				control: null,
				polling: false,
				pollCount: 0,
				retryable: false,
				checking: false,
				checkedAt: null,
				templates: [],
				templatesStatus: 'IDLE',
				templatesError: null,
			});
		}
	}
	syncSummary(summary) {
		if (
			this.summary?.conversation?.id &&
			this.summary.conversation.id !== summary?.conversation?.id
		) {
			this.intent = null;
			this.publish({
				command: null,
				error: null,
				polling: false,
				pollCount: 0,
				checking: false,
				checkedAt: null,
			});
		}
		this.summary = summary;
		if (!this.templateEligible()) {
			this.templateRequest?.abort();
			this.templateRequest = null;
			if (
				this.state.templates.length ||
				this.state.templatesStatus !== 'IDLE'
			) {
				this.publish({
					templates: [],
					templatesStatus: 'IDLE',
					templatesError: null,
				});
			}
		} else if (
			this.state.templatesStatus === 'IDLE' &&
			!this.templateRequest
		) {
			void this.loadTemplates();
		}
	}

	templateEligible() {
		const availability = humanActionAvailability(
			this.summary,
			Date.now(),
			this.state.templates
		);
		return (
			availability.mode === 'HUMAN' &&
			availability.windowClosed &&
			!availability.suspended &&
			!availability.followUpUsed
		);
	}

	async loadTemplates() {
		if (!this.active || !this.templateEligible() || this.templateRequest) {
			return;
		}
		const abort = new AbortController();
		this.templateRequest = abort;
		this.publish({ templatesStatus: 'LOADING', templatesError: null });
		try {
			const templates = await this.client.followUpTemplates(
				this.id,
				abort.signal
			);
			if (this.active && this.templateRequest === abort) {
				this.publish({
					templates,
					templatesStatus: 'READY',
					templatesError: null,
				});
			}
		} catch (error) {
			if (
				this.active &&
				this.templateRequest === abort &&
				!abort.signal.aborted
			) {
				this.publish({
					templates: [],
					templatesStatus: 'ERROR',
					templatesError: cleanError(error),
				});
			}
		} finally {
			if (this.templateRequest === abort) {
				this.templateRequest = null;
			}
		}
	}

	async control(target) {
		if (!this.active || this.state.busy || this.intent) {
			return false;
		}
		const conversation = this.summary?.conversation;
		const availability = humanActionAvailability(
			this.summary,
			Date.now(),
			this.state.templates
		);
		if (
			!(target === 'HUMAN'
				? availability.canTakeOver
				: target === 'AI' && availability.canResumeAI)
		) {
			return false;
		}
		this.publish({ busy: true, error: null, retryable: false });
		try {
			const result = await this.client.control(
				this.id,
				conversation,
				target,
				conversation.controlRevision
			);
			if (!this.active) {
				return false;
			}
			this.publish({ busy: false, control: result, error: null });
			return true;
		} catch (error) {
			if (this.active) {
				this.publish({ busy: false, error: cleanError(error) });
			}
			return false;
		}
	}

	async sendText(value) {
		return this.sendIntent('HUMAN_TEXT', value.trim());
	}
	async sendTemplate(template) {
		if (
			!this.state.templates.some(
				(item) =>
					item.name === template?.templateName &&
					item.language === template?.templateLanguage
			)
		) {
			return false;
		}
		return this.sendIntent('RECOVERY_FOLLOW_UP_TEMPLATE', {
			templateName: template.templateName,
			templateLanguage: template.templateLanguage,
			templateParameters: [],
		});
	}
	async sendIntent(kind, content) {
		if (
			!this.active ||
			this.state.busy ||
			this.state.command ||
			this.intent
		) {
			return false;
		}
		const availability = humanActionAvailability(
			this.summary,
			Date.now(),
			this.state.templates
		);
		if (!(
			(kind === 'HUMAN_TEXT' && availability.canText) ||
			(kind === 'RECOVERY_FOLLOW_UP_TEMPLATE' && availability.canTemplate)
		)) {
			return false;
		}
		const conversation = this.summary?.conversation;
		this.intent = { kind, content, conversation, key: this.keyFactory() };
		return this.submitIntent();
	}

	async retryUncertain() {
		if (
			!this.active ||
			!this.intent ||
			this.state.busy ||
			this.state.command
		) {
			return false;
		}
		return this.submitIntent();
	}

	async submitIntent() {
		const intent = this.intent;
		this.publish({ busy: true, error: null, retryable: false });
		try {
			const command = await this.client.send(
				this.id,
				intent.conversation,
				intent.kind,
				intent.key,
				intent.content
			);
			if (!this.active || intent !== this.intent) {
				return false;
			}
			this.publish({
				busy: false,
				command,
				error: null,
				polling: !FINAL.has(command.state),
				pollCount: 0,
				retryable: false,
				checking: false,
				checkedAt: null,
			});
			return true;
		} catch (error) {
			if (this.active && intent === this.intent) {
				const code = cleanError(error);
				if (DEFINITIVE_ERROR.has(code)) {
					this.intent = null;
				}
				this.publish({
					busy: false,
					error: code,
					retryable: !DEFINITIVE_ERROR.has(code),
				});
			}
			return false;
		}
	}

	async refreshCommand() {
		const cmd = this.state.command;
		if (
			!this.active ||
			!cmd?.commandId ||
			this.state.busy ||
			this.pending
		) {
			return false;
		}
		const abort = new AbortController();
		this.pending = abort;
		this.publish({ checking: true });
		try {
			const outcome = await this.client.status(
				this.id,
				cmd.conversationId,
				cmd.commandId,
				abort.signal
			);
			if (
				!this.active ||
				abort.signal.aborted ||
				cmd.commandId !== this.state.command?.commandId
			) {
				return false;
			}
			const done = FINAL.has(outcome.state);
			this.publish({
				command: outcome,
				polling: !done && this.state.pollCount < 29,
				pollCount: this.state.pollCount + 1,
				error: null,
				checking: false,
				checkedAt: new Date().toISOString(),
			});
			if (done) {
				this.intent = null;
			}
			return true;
		} catch (error) {
			if (this.active && !abort.signal.aborted) {
				this.publish({
					polling: false,
					checking: false,
					error: cleanError(error),
				});
			}
			return false;
		} finally {
			if (this.pending === abort) {
				this.pending = null;
			}
		}
	}

	acknowledgeCommand() {
		if (
			!this.active ||
			!this.state.command ||
			!FINAL.has(this.state.command.state)
		) {
			return;
		}
		this.intent = null;
		this.publish({
			command: null,
			polling: false,
			pollCount: 0,
			error: null,
			retryable: false,
			checking: false,
			checkedAt: null,
		});
	}
}
