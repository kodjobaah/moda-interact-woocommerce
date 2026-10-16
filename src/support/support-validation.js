/** Unicode grapheme count matching Shopify's 500 user-perceived characters. */
export function countSupportGraphemes(value) {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
  }
  // Conservative for combining clusters on older browsers; never under-count.
  return Array.from(value).length;
}

export function validSupportBody(body) {
  const count = countSupportGraphemes(body);
  return count >= 1 && count <= 500;
}
