import { createElement } from '@wordpress/element';
import { BillingScreen } from '../billing-screen';
import { usePurchaseHistory } from './use-purchase-history';

/**
 * React-only binding; BillingScreen stays hook-free and independently testable.
 * @param {Object} props Billing props and current state.
 */
export function ConnectedBillingScreen(props) {
	const { state } = props;
	const showHistory =
		state.status === 'READY' &&
		state.view === 'PURCHASE_HISTORY' &&
		state.data?.surfaces.purchaseHistoryAllowed;
	const history = usePurchaseHistory(Boolean(showHistory));
	return createElement(BillingScreen, { ...props, history });
}
