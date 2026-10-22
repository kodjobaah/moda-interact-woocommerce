import { useEffect, useRef, useState } from '@wordpress/element';
import { PromotionsController } from './promotions-controller';

/** Installation-keyed mount; unmount fences every outstanding GET/PUT. */
export function usePromotions() {
	const ref = useRef(null);
	if (!ref.current) ref.current = new PromotionsController();
	const [state, setState] = useState(ref.current.state);
	useEffect(() => {
		const controller = ref.current;
		const unsubscribe = controller.subscribe(setState);
		controller.setActive(true);
		return () => {
			unsubscribe();
			controller.dispose();
		};
	}, []);
	return {
		state,
		refresh: () => ref.current.refresh(),
		select: (campaignId) => ref.current.select(campaignId),
		offersPage: (page) => ref.current.goToOffersPage(page),
		historyPage: (page) => ref.current.goToHistoryPage(page),
	};
}
