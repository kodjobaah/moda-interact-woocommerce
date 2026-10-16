import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import { MerchantOffersController } from './offer-controller';
import { MerchantOffersView } from './merchant-offers-view';

/**
 * Owns only the lifecycle. Mode-specific presentation lives in MerchantOffersView.
 * @param {Object} root0
 * @param {Object} root0.controller
 */
export function MerchantOffersPanel({ controller: injected }) {
	const holder = useRef(null);
	if (!holder.current) {
		holder.current = injected ?? new MerchantOffersController();
	}
	const controller = holder.current;
	const [state, setState] = useState(controller.state);
	const [term, setTerm] = useState('');
	useEffect(() => {
		const stop = controller.subscribe(setState);
		void controller.refresh();
		return () => {
			stop();
			if (!injected) {
				controller.dispose();
			}
		};
	}, [controller, injected]);
	return createElement(MerchantOffersView, {
		state,
		controller,
		term,
		onTermChange: setTerm,
	});
}
