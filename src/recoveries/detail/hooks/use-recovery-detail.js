import { useEffect, useRef, useState } from '@wordpress/element';
import { RecoveryDetailController } from '../recovery-detail-controller';

/**
 * Bind the detail controller only once per WordPress page mount.
 * @param {string|null} recoveryId
 */
export function useRecoveryDetail(recoveryId) {
	const controller = useRef(null);
	if (!controller.current) {
		controller.current = new RecoveryDetailController(recoveryId);
	}
	const [state, setState] = useState(controller.current.state);
	useEffect(() => {
		const current = controller.current;
		const stop = current.subscribe(setState);
		current.setActive(true);
		return () => {
			stop();
			current.setActive(false);
		};
	}, []);
	return {
		state,
		refreshSummary: () => controller.current.loadSummary(),
		refreshMessages: () => controller.current.loadMessages(),
		refreshRelated: () => controller.current.loadRelated(),
		previousMessages: () => controller.current.goMessages('previous'),
		nextMessages: () => controller.current.goMessages('next'),
		latestMessages: () => controller.current.jumpLatest(),
		previousRelated: () => controller.current.goRelated('previous'),
		nextRelated: () => controller.current.goRelated('next'),
	};
}
