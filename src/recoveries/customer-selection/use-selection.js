import { useEffect, useRef, useState } from '@wordpress/element';
import { SelectionController } from './selection-controller';

export function useSelection() {
	const controller = useRef(null);
	if (!controller.current) {
		controller.current = new SelectionController();
	}
	const [state, setState] = useState(controller.current.state);
	useEffect(() => {
		const instance = controller.current;
		const unsubscribe = instance.subscribe(setState);
		instance.setActive(true);
		return () => {
			unsubscribe();
			instance.setActive(false);
		};
	}, []);
	return {
		state,
		lookup: (phone) => controller.current.lookup(phone),
		command: (action, reference) =>
			controller.current.command(action, reference),
	};
}
