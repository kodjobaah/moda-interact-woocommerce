import { useEffect, useRef, useState } from '@wordpress/element';
import { PurchaseHistoryController } from './purchase-history-controller';

/**
 * Render only: all history I/O, caching and stale-response policy live in the controller.
 * @param {boolean} active - Whether history is visible and connected.
 */
export function usePurchaseHistory(active) {
	const controllerRef = useRef(null);
	if (!controllerRef.current) {
		controllerRef.current = new PurchaseHistoryController();
	}
	const [state, setState] = useState(controllerRef.current.state);
	useEffect(() => controllerRef.current.subscribe(setState), []);
	useEffect(() => {
		controllerRef.current?.setActive(active);
	}, [active]);
	useEffect(() => () => controllerRef.current?.dispose(), []);
	return {
		state,
		refresh: () => controllerRef.current?.refresh(),
		setFilter: (filter) => controllerRef.current?.changeFilter(filter),
		setPage: (page) => controllerRef.current?.changePage(page),
		setPageSize: (size) => controllerRef.current?.changePageSize(size),
	};
}
