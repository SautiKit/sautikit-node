// Marks dist/cjs/ as CommonJS.
//
// The package is "type":"module", so Node would otherwise parse dist/cjs/*.js
// as ESM and a require() would fail with ERR_REQUIRE_ESM. A nested
// package.json scoping that directory to commonjs is the standard fix and
// keeps the dual build dependency-free (no bundler needed).
import { writeFileSync } from "node:fs";

const target = new URL("../dist/cjs/package.json", import.meta.url);
writeFileSync(target, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
console.log("finalize-cjs: wrote dist/cjs/package.json (type: commonjs)");
