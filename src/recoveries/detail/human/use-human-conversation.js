import { useEffect, useRef, useState } from '@wordpress/element';
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
	return {
		...state,
		control: state.control,
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
