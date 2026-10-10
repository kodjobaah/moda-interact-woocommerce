# Moda Interact WordPress translations

ARCH-026-WOOCOMMERCE-009 installs the native gettext compilation pipeline.
The plugin ships **English source messages only** until the reviewed translation
batches WOO-010 through WOO-013 are provided. Locale detection is not the same
as translation coverage.

## Authoring a language pack

1. Generate and review the **source-only** template with a running wp-env:
   `npm run i18n:makepot` (scans `moda-interact.php`, `includes/`, `src/`,
   **not** the generated `build/` bundle). Commit the updated `.pot`.
2. Create `moda-interact-<WordPress locale>.po`, e.g.
   `moda-interact-fr_FR.po`. Keep msgctxt/msgid, plural counts, `#:` source
   locations, and PHP/JavaScript printf placeholders. For a new translation
   batch, generate/update the PO from the current POT using WordPress tooling.
3. Run `npm run i18n:compile`. Every *present* non-English PO must translate all
   current message keys; missing or mismatched placeholders fail compilation.
   Missing language packs are permitted **only until WOO-014**.
4. The compiler creates `moda-interact-<locale>.mo` for PHP and
   `moda-interact-<locale>-moda-interact.json` for JavaScript. These files are
   ignored by Git because production packaging generates them from reviewed PO
   sources, and packages them in `languages/` in the installable plugin ZIP.
5. WOO-014 must run `npm run i18n:verify:20`, review all twenty language UIs
   and verify the released ZIP has all compiled files; this gate is intentionally
   not enabled for the infrastructure-only WOO-009 task.

English source language has no pseudo-translation pack. The canonical 20-tag
coverage list and WordPress locale map are in `scripts/i18n/locales.mjs`.
Additional WordPress locale variants must be consciously reviewed before being
added to an existing translation pack; do not assume dialects are interchangeable.

## Runtime boundary

WordPress selects the signed-in administrator's interface locale (site language
if no user override). `load_plugin_textdomain` runs at `init` and
`wp_set_script_translations('moda-interact', 'moda-interact', .../languages)`
loads the translated React strings. An absent/unsupported WordPress locale
naturally displays the English source strings. No extra language selector or
per-shop API write exists.

`Shop.storeLocale`, the CommerceAgent conversation language and WhatsApp
language are **separate** from this administrator UI translation mechanism.
Shopify ICU catalogues are translation references, not WordPress gettext assets.

## ARCH-026-WOOCOMMERCE-010 — initial translation batch

The English gettext source plus complete French (`fr_FR`), German (`de_DE`),
Italian (`it_IT`), and Spanish (`es_ES`) reviewed PO sources cover the current
169-message template. WordPress PHP `.mo` files and script-handle-specific JSON
are built from these PO sources by `npm run i18n:compile` and included in the
production plugin ZIP. A future message added to the POT requires an explicit
translation update in **all present** PO files; the compiler fails otherwise.

Terminology guidelines for this batch:

| Source | French | German | Italian | Spanish |
| --- | --- | --- | --- | --- |
| Billing | Facturation | Abrechnung | Fatturazione | Facturación |
| Recovery settings | Paramètres de récupération | Wiederherstellungseinstellungen | Impostazioni di recupero | Configuración de recuperación |
| Store category | Catégorie de la boutique | Shop-Kategorie | Categoria del negozio | Categoría de la tienda |
| Save category | Enregistrer la catégorie | Kategorie speichern | Salva categoria | Guardar categoría |
| Free (named plan) | Free | Free | Free | Free |

The product names **Moda Interact**, **WooCommerce**, **CommerceAgent**, and
the named plan **Free** are intentionally not translated. For the rest, localized
phrasing is required even when some Shopify reference catalogues still contain
English fallbacks. `en_US` and `en_GB` use the original English source and do not
need pseudo-translation PO files.

Batch tests: `npm run test:i18n`; actual WordPress locale checks are included in
`npm run test:integration:wordpress` and verify four administrator locales while
the site's locale remains `en_GB`. Other language batches and WOO-014's global
20-language gate remain separate tasks.
