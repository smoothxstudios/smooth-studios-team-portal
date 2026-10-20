# Local security patch

Based on upstream braces 3.0.3 (MIT license retained). This is a local fork,
not an upstream patched release. GHSA-vfj7-8cjw-p6xm has no published upstream
fix as of October 20, 2026.

Parser stack depth is limited to 128 for both braces and parentheses. An
iterative guard bounds caller-supplied ASTs before compile, expand and stringify,
including cyclic child graphs. Existing character/range limits remain intact.
Tests in tests/dependency-security.test.mjs cover malicious nesting and normal
brace/fast-glob use. npm overrides routes all braces consumers to this directory.
Remove the fork when an upstream release fixes the issue and passes those tests.
