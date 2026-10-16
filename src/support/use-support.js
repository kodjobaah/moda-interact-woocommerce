import { useEffect, useRef, useState } from '@wordpress/element';
import { SupportController } from './support-controller';

/** Screen lifecycle is bounded by the connected-only parent render. */
export function useSupport() {
	const controllerRef = useRef(null);
	if (!controllerRef.current) {
		controllerRef.current = new SupportController();
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
		capabilities: controllerRef.current.capabilities,
		refresh: () => controllerRef.current.refresh(),
		page: (number) => controllerRef.current.goToPage(number),
		send: (body) => controllerRef.current.send(body),
	};
}
