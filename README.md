# Moda Interact for WooCommerce

Moda Interact is an installable WordPress plugin with a minimal React page inside
WooCommerce Admin. It does not run a separate Node server or connect to Moda
services.

The plugin uses the official WooCommerce `create-woo-extension` template and the
WordPress Scripts build system. Production assets are generated into `build/` before
packaging; source code remains in `src/`.

## Requirements

- Node.js and npm selected by the workspace `.nvmrc`.
- PHP, Composer, Docker and a running Docker daemon on the host.
- Supported runtime: WordPress `7.0` and `7.1`, PHP `8.1+`, and WooCommerce
	`11.0` and `11.1`.
- The current validation environment pins WordPress `7.1.2`, WooCommerce `11.1.2`
	and container PHP `8.1`.

## Runtime Compatibility

WordPress plugin headers declare the native requirements: WordPress `7.0`, PHP
`8.1`, and the `woocommerce` plugin. The runtime remains inert unless active
WooCommerce is version `11.0` or later. Unsupported or missing WooCommerce is
reported only to administrators who can activate plugins. WooCommerce-dependent
Admin setup waits for the public `woocommerce_init` hook and runs once per request.

The deterministic `wp-env` matrix is:

| Matrix | WordPress | WooCommerce | Container PHP |
| --- | --- | --- | --- |
| Minimum | 7.0.6 | 11.0.1 | 8.1 |
| Current | 7.1.2 | 11.1.2 | 8.1 |

Run the minimum matrix on a separate port so it can coexist with the current
environment:

```sh
WP_ENV_PORT=8892 npm run env:start:minimum
WP_ENV_PORT=8892 npm run env:stop:minimum
```

The default `npm run env:start` / `npm run env:stop` commands use the current
matrix from `.wp-env.json`.

Before Node, PHP, Composer, Docker or wp-env commands, source the workspace bootstrap
from this repository:

```sh
export MODA_WORKSPACE_ROOT="/path/to/moda-interact-workspace"
source "$MODA_WORKSPACE_ROOT/scripts/bootstrap-woocommerce.sh"
```

## Setup And Development

```sh
npm ci
npm run install:php
npm run start
```

`npm run start` watches and rebuilds assets. For one production build, use
`npm run build`.

## Checks And Tests

```sh
npm run lint:js
npm run lint:css
npm run lint:php
npm run test:js
npm run test:php
```

## Local WordPress And WooCommerce

```sh
npm run env:start
```

Open `http://localhost:8888/wp-admin/` and sign in with the wp-env development
account (`admin` / `password`). The Moda Interact page is available from the
WooCommerce Admin navigation at `/moda-interact`.

Stop and remove the local environment with:

```sh
npm run env:stop
```

## Plugin Package

Create `moda-interact.zip` with:

```sh
npm run plugin-zip
```

The command rebuilds production assets, installs only production Composer
dependencies, and runs the official WordPress Scripts plugin packager. The ZIP
contains the `moda-interact/` plugin root and excludes development sources, tests,
local environment state, Node dependencies and Composer development dependencies.
Run `npm run install:php` again to restore PHPUnit before further PHP tests.
