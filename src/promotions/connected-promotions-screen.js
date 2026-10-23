import { createElement } from '@wordpress/element';
import { PromotionsScreen } from './promotions-screen';
import { usePromotions } from './use-promotions';

export function ConnectedPromotionsScreen({ onReconnect = null }) {
	const promotions = usePromotions();
	return createElement(PromotionsScreen, {
		model: promotions.state,
		onSelect: promotions.select,
		onOffersPage: promotions.offersPage,
		onHistoryPage: promotions.historyPage,
		onRefresh: promotions.refresh,
		onReconnect,
	});
}
