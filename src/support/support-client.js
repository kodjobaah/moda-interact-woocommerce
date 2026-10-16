/**
 * No merchant-support read/send/mark-read contract is approved on the Woo
 * privileged REST facade. Do not route these requests to Shopify sessions or
 * construct hypothetical hosted URLs. An API-owner task must establish the
 * authenticated WordPress proxy before any capability becomes enabled.
 */
export function createSupportClient() {
  return Object.freeze({
    capabilities: Object.freeze({ read: false, send: false, markRead: false }),
  });
}
