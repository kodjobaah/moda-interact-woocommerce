import { useEffect, useRef, useState } from '@wordpress/element';
import { UsageHistoryController } from './usage-history-controller';

/** Connected-only lifecycle; unmount/disconnect invalidates all pending responses. */
export function useUsageHistory() {
	const controllerRef = useRef(null);
	if (!controllerRef.current) controllerRef.current = new UsageHistoryController();
	const [state, setState] = useState(controllerRef.current.state);
	useEffect(() => {
		const controller = controllerRef.current;
		const unsubscribe = controller.subscribe(setState);
		controller.setActive(true);
		return () => {
			unsubscribe();
			controller.dispose();
		};
	}, []);
	const controller = controllerRef.current;
	return {
		state,
		refresh: () => controller.refresh(),
		setView: (value) => controller.setView(value),
		setPeriod: (value) => controller.setPeriod(value),
		setKind: (value) => controller.setKind(value),
		setPageSize: (value) => controller.setPageSize(value),
		setPage: (value) => controller.setPage(value),
		setPeriodCursor: (value) => controller.setPeriodCursor(value),
		clearCursor: () => controller.clearCursor(),
	};
}
