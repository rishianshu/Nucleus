PNPM ?= corepack pnpm

.PHONY: ci-check smoke

ci-check: smoke

smoke:
	$(PNPM) check:metadata-lifecycle
