/**
 * Detect whether the current ESM module was invoked directly as a script
 * (rather than imported). Use to gate side-effecting `main()` calls so the
 * module stays importable from tests and other modules.
 *
 *     if (isMainModule(import.meta.url)) main();
 *
 * Equivalent of CommonJS's `require.main === module`. `fileURLToPath` strips
 * the `file://` prefix and URL-encoded segments so the comparison against
 * `process.argv[1]` (which is already an absolute resolved path) is
 * apples-to-apples on every platform.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The real path, or the path itself when it can't be resolved. */
const real = (path: string): string => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

export function isMainModule(importMetaUrl: string): boolean {
	const argv1 = process.argv[1];
	if (argv1 === undefined) return false;
	const modulePath = fileURLToPath(importMetaUrl);
	// Node gives the entry module its real path; argv[1] keeps the path as
	// typed, so a symlinked folder on the way (macOS's /var) still counts.
	return modulePath === argv1 || real(modulePath) === real(argv1);
}
