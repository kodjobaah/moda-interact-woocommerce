# ARCH-048-WOOCOMMERCE-002 — WooCommerce 11.1.2 hook verification

This audit compares upstream **WooCommerce tags `11.0.1` and `11.1.2`**,
which are pinned respectively by `.wp-env.minimum.json` and `.wp-env.json`. Source inspection establishes the
hook API and ordering, **not** execution in a live site. Runtime evidence must
come from `assertClassicClearRefill` and `assertStoreApiClearRefill` in the
`--checkout-only` WordPress integration run on a separately confirmed
**disposable** wp-env site. No WordPress read endpoint is added.

| Hook | Upstream arguments | Invocation order relevant to this task | Consumer |
| --- | --- | --- | --- |
| `woocommerce_cart_item_removed` | `(string $cart_item_key, WC_Cart $cart)` | `WC_Cart::remove_cart_item` first unsets the line, then fires the hook; Woo's own `calculate_totals` callback is priority 20. Moda observes emptiness at priority 10. Empty `calculate_totals()` returns without `woocommerce_after_calculate_totals`. | `afterCartRemoval` (0 arguments) |
| `woocommerce_cart_emptied` | `(bool $clear_persistent_cart)` | `WC_Cart::empty_cart` empties cart contents and resets totals before firing the hook. | `afterCartRemoval` (0 arguments) |
| `woocommerce_store_api_checkout_update_order_from_request` | `(WC_Order $order, WP_REST_Request $request)` | `CheckoutTrait::update_order_from_request` fires before the order is saved. Under deferred-draft checkout since WooCommerce 10.8, first-time `PATCH /checkout` uses `woocommerce_store_api_checkout_update_draft` instead; the order hook applies at real order creation / retry. | `capture` (0 arguments) |
| `woocommerce_store_api_cart_update_customer_from_request` | `(WC_Customer $customer, WP_REST_Request $request)` | `CartUpdateCustomer::get_route_post_response` sets customer properties, fires the hook, then saves the customer and recalculates cart totals. | `captureExisting` (0 arguments) |
| `woocommerce_store_api_checkout_update_draft` | `(WP_REST_Request $request)` | Checkout `PATCH` after live customer/session update but before response. | `capture` (0 arguments) |

The callbacks intentionally accept **zero** arguments despite upstream hooks
supplying one or two: Moda reads the live `WC()->cart`, `WC()->customer` and
`WC()->session` rather than using external order or request identity, and
WordPress `add_action(..., accepted_args=0)` is a valid registration.

Sources (exact upstream release tags, not floating trunk):

- [WC_Cart cart removal, empty and totals](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart.php)
- [Store API cart customer update](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/CartUpdateCustomer.php)
- [Checkout order request hook](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CheckoutTrait.php)
- [Store API checkout PATCH/draft hook](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php)
- [Classic `wc-ajax=remove_from_cart` and `update_order_review`](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php)
- [Minimum-supported WC_Cart hooks (11.0.1)](https://github.com/woocommerce/woocommerce/blob/11.0.1/plugins/woocommerce/includes/class-wc-cart.php)
- [Minimum-supported Store API customer hook (11.0.1)](https://github.com/woocommerce/woocommerce/blob/11.0.1/plugins/woocommerce/src/StoreApi/Routes/V1/CartUpdateCustomer.php)
- [Minimum-supported checkout order hook (11.0.1)](https://github.com/woocommerce/woocommerce/blob/11.0.1/plugins/woocommerce/src/StoreApi/Utilities/CheckoutTrait.php)
- [Minimum-supported checkout draft hook (11.0.1)](https://github.com/woocommerce/woocommerce/blob/11.0.1/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php)

## Runtime acceptance gate

The integration harness already gates `--checkout-only` on
`MODA_CHECKOUT_TEST_DISPOSABLE=1` and checks the fixture installation/credential.
Only set this after confirming the active wp-env really is throwaway; the test
creates/deletes users, products, orders, changes options and injects fixture API
configuration. `npm run test:integration:wordpress -- --checkout-only` must finish
with an unambiguous final PASS and exit code 0 to satisfy Attempt 2. Unit tests
and upstream source inspection do **not** substitute for that evidence.

Expected evidence lines include:

- `ARCH-048 never-active empty Store API/Classic requests PASS`
- `ARCH-048 guest Classic: clear once, repeat no-op, refill with same key PASS`
- `ARCH-048 guest Store API: clear once, repeat no-op, refill with same key PASS`
- Corresponding `customer` lines and `ARCH-035 checkout-only integration PASS`.
