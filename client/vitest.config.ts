import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./vitest.setup.ts"],
		// Playwright E2E specs live under ``e2e/`` and use ``@playwright/test``;
		// keep them off the vitest run or @playwright/test's ``test.describe`` will
		// refuse to initialize outside the Playwright runner.
		exclude: ["node_modules/**", "dist/**", ".next/**", "e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html", "lcov"],
			// Scope coverage to modules that ship tests in this PR (P2-13 / #198 /
			// P2-17 / P2-19). As new modules are added, extend this include list
			// rather than loosening the global gate.
			include: [
				"src/lib/api/**/*.ts",
				"src/lib/api/**/*.tsx",
				"src/components/timeline/**/*.tsx",
				"src/lib/timeline/**/*.ts",
				"src/lib/sanitize/**/*.ts",
				"src/components/sidebar/**/*.tsx",
				"src/components/explore/**/*.tsx",
				"src/components/search/**/*.tsx",
			],
			exclude: [
				"src/lib/api/**/__tests__/**",
				"src/components/**/__tests__/**",
				"src/lib/timeline/**/__tests__/**",
				"src/lib/sanitize/**/__tests__/**",
				"**/*.d.ts",
			],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	esbuild: {
		// Use the React automatic JSX runtime so test files do not need to
		// manually import React. This mirrors what Next.js configures for
		// production builds.
		jsx: "automatic",
	},
});
