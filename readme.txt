=== Moda Interact ===
Contributors: modainteract
Tags: woocommerce, store-management
Requires at least: 7.0
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Moda Interact provides a WooCommerce Admin application for connecting a WooCommerce store to Moda Interact and viewing the authenticated merchant overview available to the connected installation.

== Description ==

The plugin adds a Moda Interact page to WooCommerce Admin. Administrators can connect or reconnect the installation and, while connected, view the merchant overview returned by Moda Interact. The overview is read-only. The plugin does not complete onboarding, change store categories, or provide billing, recovery, product, coupon, or messaging features.

The browser application calls the local WordPress REST API. The PHP runtime stores the installation credential server-side and makes authenticated HTTPS requests to the Moda Interact service; the credential is not exposed to browser JavaScript.

== External services ==

This plugin connects to the Moda Interact hosted service at https://api.modainteract.com. It sends the canonical WordPress site URL and installation identity for connection, and sends authenticated merchant bootstrap requests when an administrator opens the connected overview. Those requests retrieve the shop identity, onboarding status, store-category projection, and store locale, language, time-zone, and country context. The installation credential is sent only by the PHP runtime in an HTTPS Authorization header and is not included in browser responses.

The plugin does not initiate a Moda service request merely because it is installed or activated. A connection request is initiated by an administrator, and the merchant bootstrap request is made when the connected overview is loaded.

== Installation ==

1. Upload the `moda-interact.zip` file through the WordPress Plugins screen or install it using your normal WordPress plugin deployment process.
2. Activate Moda Interact and WooCommerce.
3. Open Moda Interact from the WooCommerce Admin navigation and connect the store as an administrator.

The installed plugin directory and main file are `moda-interact/moda-interact.php`.

== Frequently Asked Questions ==

= Does the plugin send the installation credential to the browser? =

No. The credential remains in server-side WordPress storage and is used by PHP for authenticated HTTPS requests.

= Does installing or activating the plugin connect the store automatically? =

No. An administrator must initiate connection from the Moda Interact page.

= Does deactivating the plugin erase the connection? =

No. Deactivation preserves the locally stored connection record.

== Changelog ==

= 0.1.0 =
* Initial Moda Interact WooCommerce distribution candidate.