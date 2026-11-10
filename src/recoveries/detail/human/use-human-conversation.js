import { useEffect, useRef, useState } from '@wordpress/element';
import { humanActionAvailability } from './conversation-command-contract';
import { HumanConversationController } from './human-conversation-controller';

/** Poll only the selected visible detail, with a bounded automatic budget. */
export function useHumanConversation(recoveryId, summary, onRefresh) {
	const ref = useRef(null);
	if (!ref.current || ref.current.id !== recoveryId) {
		ref.current = new HumanConversationController(recoveryId);
	}
	const [state, setState] = useState(ref.current.state);
	const controller = ref.current;
	const refreshRef = useRef(onRefresh);
	const lastTerminalSync = useRef(null);
	refreshRef.current = onRefresh;
	useEffect(() => {
		const unsubscribe = controller.subscribe(setState);
		controller.setActive(true);
		return () => {
			controller.setActive(false);
			unsubscribe();
		};
	}, [controller]);
	useEffect(() => {
		controller.syncSummary(summary);
	}, [controller, summary]);
	useEffect(() => {
		const command = state.command;
		if (
			!command?.commandId ||
			!['SENT', 'FAILED', 'CANCELLED'].includes(command.state)
		) {
			return;
		}
		const outcome = `${recoveryId}:${command.commandId}:${command.state}`;
		if (lastTerminalSync.current === outcome) {
			return;
		}
		lastTerminalSync.current = outcome;
		// Refresh the transcript once when a command reaches a terminal state.
		void refreshRef.current();
	}, [recoveryId, state.command]);
	useEffect(() => {
		if (!state.polling || !state.command?.commandId || !controller.active) {
			return undefined;
		}
		const timer = setTimeout(() => controller.refreshCommand(), 4000);
		return () => clearTimeout(timer);
	}, [controller, state.polling, state.pollCount, state.command?.commandId]);
	const [catalogue, setCatalogue] = useState(null);
	const canRequest = humanActionAvailability(summary).canRequestTemplates;
	useEffect(() => {
		setCatalogue(null);
		if (!canRequest || !summary?.conversation || state.command) return;
		const abort = new AbortController();
		const load = () => controller.client.templates(recoveryId, abort.signal).then(
			(templates) => {
				if (!abort.signal.aborted) setCatalogue({ summary, templates });
			},
			() => {
				if (!abort.signal.aborted) setCatalogue({ summary, templates: [], failed: true });
			}
		);
		void load();
		const opensAt = Date.parse(summary.milestones?.messageSentAt) + 24 * 60 * 60 * 1000;
		const remaining = opensAt - Date.now();
		const timer = remaining > 0 && remaining <= 24 * 60 * 60 * 1000
			? setTimeout(load, remaining + 1) : null;
		return () => {
			clearTimeout(timer);
			abort.abort();
		};
	}, [canRequest, recoveryId, controller, summary, state.command]);
	const choices = canRequest && catalogue?.summary === summary ? catalogue.templates : [];
	return {
		...state,
		control: state.control,
		templates: choices,
		templateLookupFailed: canRequest && catalogue?.summary === summary && catalogue.failed,
		onSendTemplate: async (choice) => {
			if (!choices.includes(choice)) return false;
			const accepted = await controller.sendIntent('RECOVERY_FOLLOW_UP_TEMPLATE', {
				templateName: choice.name, templateLanguage: choice.language, templateParameters: [],
			});
			if (accepted) void refreshRef.current();
			return accepted;
		},
		onTakeOver: async () => {
			if (await controller.control('HUMAN')) {
				onRefresh();
			}
		},
		onResumeAI: async () => {
			if (await controller.control('AI')) {
				onRefresh();
			}
		},
		onSendText: async (text) => {
			const accepted = await controller.sendText(text);
			if (accepted) {
				void refreshRef.current();
			}
			return accepted;
		},
		onRetry: () => controller.retryUncertain(),
		onCheckStatus: async () => {
			const checked = await controller.refreshCommand();
			if (checked) {
				void refreshRef.current();
			}
			return checked;
		},
		onAcknowledge: () => {
			controller.acknowledgeCommand();
			onRefresh();
		},
	};
}
