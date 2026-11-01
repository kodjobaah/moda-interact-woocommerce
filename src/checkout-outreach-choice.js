const setting = window.wc?.wcSettings?.getSetting?.(
	'moda-interact-outreach-choice_data',
	{}
);

if (
	setting?.available === true &&
	typeof setting.nonce === 'string' &&
	typeof setting.action === 'string' &&
	typeof setting.checkoutUrl === 'string' &&
	window.wp?.plugins?.registerPlugin &&
	window.wc?.blocksCheckout?.ExperimentalOrderMeta
) {
	const { createElement } = window.wp.element;
	const { ExperimentalOrderMeta } = window.wc.blocksCheckout;

	const Choice = ({ context }) => {
		if (context !== 'woocommerce/checkout') {
			return null;
		}
		return createElement(
			'form',
			{
				className: 'moda-interact-outreach-choice',
				method: 'post',
				action: setting.checkoutUrl,
			},
			createElement('input', {
				type: 'hidden',
				name: setting.action,
				value: 'try_offered',
			}),
			createElement('input', {
				type: 'hidden',
				name: '_wpnonce',
				value: setting.nonce,
			}),
			createElement(
				'button',
				{ type: 'submit', className: 'wc-block-components-button' },
				setting.buttonText
			)
		);
	};

	window.wp.plugins.registerPlugin('moda-interact-outreach-choice', {
		render: () =>
			createElement(ExperimentalOrderMeta, null, createElement(Choice)),
		scope: 'woocommerce-checkout',
	});
}
