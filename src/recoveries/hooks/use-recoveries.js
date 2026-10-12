import { useEffect, useRef, useState } from '@wordpress/element';
import { RecoveriesController } from '../recoveries-controller';
import { readRecoveryListQuery } from '../detail/detail-navigation';

/** One controller per mounted Recoveries page; no transport in React components. */
export function useRecoveries() {
	const controllerRef = useRef(null);
	if (!controllerRef.current) {
		controllerRef.current = new RecoveriesController(
			undefined,
			readRecoveryListQuery(globalThis.location?.search ?? '')
		);
	}
	const [state, setState] = useState(controllerRef.current.state);

	useEffect(() => {
		const controller = controllerRef.current;
		const unsubscribe = controller.subscribe(setState);
		controller.setActive(true);
		return () => {
			unsubscribe();
			controller.setActive(false);
		};
	}, []);

	return {
		state,
		refresh: () => controllerRef.current.refresh(),
		applyFilters: (filters) => controllerRef.current.applyFilters(filters),
		clearFilters: () => controllerRef.current.clearFilters(),
		goToPage: (page) => controllerRef.current.goToPage(page),
	};
}
