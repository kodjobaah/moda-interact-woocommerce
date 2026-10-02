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
- The repository-owned WordPress environment uses WordPress `7.1.2`, WooCommerce
	`11.1.2` and PHP `8.5`.

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
