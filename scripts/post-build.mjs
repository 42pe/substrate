#!/usr/bin/env node
// Post-build step: prepend the Node shebang to the CLI entry and chmod +x.
// tsc does not preserve shebangs, so without this step `npx substrate <cmd>`
// will fail (the bin file would start with `import` statements, not `#!`).

import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CLI_PATH = resolve('./dist/server/cli/index.js');
const SHEBANG = '#!/usr/bin/env node\n';

if (!existsSync(CLI_PATH)) {
  console.error(`post-build: ${CLI_PATH} does not exist. Did tsc -p tsconfig.build.json run?`);
  process.exit(1);
}

const content = readFileSync(CLI_PATH, 'utf-8');
if (!content.startsWith('#!')) {
  writeFileSync(CLI_PATH, SHEBANG + content, 'utf-8');
  console.log(`post-build: prepended shebang to ${CLI_PATH}`);
} else {
  console.log(`post-build: ${CLI_PATH} already has a shebang`);
}

chmodSync(CLI_PATH, 0o755);
console.log(`post-build: chmod +x ${CLI_PATH}`);
