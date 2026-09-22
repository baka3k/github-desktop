# GitHub Desktop — top-level build targets
#
# This Makefile is a thin, well-documented wrapper over the underlying
# `yarn` scripts in package.json. It exists so that the common build,
# run, test, and lint commands have a single, discoverable entry point.
#
# Run `make help` to see every available target.
#
# Note: target names use hyphens (e.g. `build-dev`, `start-prod`) instead of
# colons because GNU Make treats `:` in target names as a rule separator and
# would refuse to parse them.

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

# Use bash so conditional / pipefail semantics are predictable on macOS.
SHELL := /bin/bash

# Keep tooling outputs out of make's automatic cleanup.
.PRECIOUS: out/

# Toggle echoing of recipe lines.
ifeq ($(VERBOSE),1)
  Q :=
  AT :=
else
  Q := @
  AT := @
endif

# Detect yarn / node and fail fast with a friendly hint if either is missing.
#
# GitHub Desktop requires Node 24 (see .nvmrc / .node-version). Node 26+ is
# installed by some Homebrew setups, but electron-packager 18.4.4 / extract-zip
# 2.0.1 hang silently under Node 26, so the build "succeeds" without producing
# a `.app`. Prefer a Node 24 binary (nvm or volta) when one is reachable on
# the host and force PATH so subprocesses inherit the matching toolchain.

# Detect Node 24+ under common version managers before consulting PATH.
NVM_NODE24 := $(shell ls -d /Users/*/.nvm/versions/node/v24*/bin/node 2>/dev/null | head -1)
VOLTA_NODE24 := $(shell command -v volta 2>/dev/null && volta which node 2>/dev/null | grep -E "v24" | head -1)
ifeq ($(NVM_NODE24),)
  ifneq ($(VOLTA_NODE24),)
    NODE := $(VOLTA_NODE24)
    NODE_BIN_DIR := $(dir $(VOLTA_NODE24))
  else
    NODE ?= node
    NODE_BIN_DIR :=
  endif
else
  NODE := $(NVM_NODE24)
  NODE_BIN_DIR := $(dir $(NVM_NODE24))
endif

# Prepend the Node 24 bin directory to PATH so every child process
# (including those spawned by `yarn`/`ts-node`/`electron-packager`)
# resolves the matching `node`, `corepack`, and `yarn` instead of any
# Homebrew/system Node 26 that happens to be earlier on PATH.
ifdef NODE_BIN_DIR
  PATH := $(NODE_BIN_DIR):$(PATH)
  export PATH
  SHELL := env PATH='$(PATH)' /bin/bash
endif

# Prefer `yarn` on PATH (now Node 24's); fall back to the vendored
# yarn-1.21.1.js that ships with this repository (see .yarnrc → yarn-path).
YARN_PATH := $(shell command -v yarn 2>/dev/null)
VENDORED_YARN := $(CURDIR)/vendor/yarn-1.21.1.js
ifeq ($(YARN_PATH),)
  ifneq ($(wildcard $(VENDORED_YARN)),)
    YARN := $(NODE) $(VENDORED_YARN)
  else
    YARN := $(error yarn is required: install via `npm install -g yarn` or enable corepack)
  endif
else
  YARN := $(YARN_PATH)
endif

# Default target when the user runs `make` with no arguments.
.DEFAULT_GOAL := help

# ----------------------------------------------------------------------------
# Targets
# ----------------------------------------------------------------------------

.PHONY: help
help: ## Show this help message
	@echo "GitHub Desktop — Make targets"
	@echo ""
	@echo "Usage:  make <target>"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Detected node: $(NODE) ($$($(NODE) --version 2>/dev/null))"
	@echo "Detected yarn:  $(YARN)"
	@echo "Set VERBOSE=1 to print every command as it runs."

.PHONY: install
install: ## Install JS dependencies (yarn install)
	$(Q)$(YARN) install

.PHONY: build
build: ## Build a production-ready app (compile + package)
	$(Q)$(YARN) build:prod

.PHONY: build-dev
build-dev: ## Build a development build of the app (faster, debug-friendly)
	$(Q)$(YARN) build:dev

.PHONY: build-prod
build-prod: build ## Alias of `make build` (explicit production target)

.PHONY: compile-dev
compile-dev: ## Webpack-compile only, dev mode
	$(Q)$(YARN) compile:dev

.PHONY: compile-prod
compile-prod: ## Webpack-compile only, prod mode
	$(Q)$(YARN) compile:prod

.PHONY: start
start: ## Launch the app from a fresh dev build, with hot reload
	$(Q)$(YARN) start

.PHONY: start-prod
start-prod: ## Launch the app from a production build (no dev tooling)
	$(Q)$(YARN) start:prod

.PHONY: package
package: ## Re-run the packaging step only (assumes a build has run)
	$(Q)$(YARN) package

.PHONY: test
test: ## Run all unit tests (alias for test-unit)
	$(Q)$(YARN) test

.PHONY: test-unit
test-unit: ## Run unit tests
	$(Q)$(YARN) test:unit

.PHONY: test-script
test-script: ## Run tests under script/
	$(Q)$(YARN) test:script

.PHONY: test-e2e
test-e2e: ## Run the end-to-end test suite (builds + runs Playwright)
	$(Q)$(YARN) test:e2e

.PHONY: test-e2e-unpackaged
test-e2e-unpackaged: ## Run e2e tests against an unpackaged dev build
	$(Q)$(YARN) test:e2e:unpackaged

.PHONY: lint
lint: ## Run prettier + eslint over the source tree
	$(Q)$(YARN) lint

.PHONY: lint-fix
lint-fix: ## Auto-fix lint and formatting issues
	$(Q)$(YARN) lint:fix

.PHONY: markdownlint
markdownlint: ## Lint Markdown files
	$(Q)$(YARN) markdownlint

.PHONY: validate
validate: lint markdownlint test-script ## CI-style aggregate check: lint + script tests
	$(Q)echo "✓ validate: lint, markdownlint, and script tests passed"

.PHONY: rebuild-hard-dev
rebuild-hard-dev: ## Nuke node_modules + out/ and rebuild a development build
	$(Q)$(YARN) rebuild-hard:dev

.PHONY: rebuild-hard-prod
rebuild-hard-prod: ## Nuke node_modules + out/ and rebuild a production build
	$(Q)$(YARN) rebuild-hard:prod

.PHONY: clean
clean: ## Remove the build output directory (out/) only
	$(Q)rm -rf out

.PHONY: clean-all
clean-all: ## Remove out/ + every node_modules directory (full reset)
	$(Q)rm -rf out node_modules app/node_modules

.PHONY: validate-changelog
validate-changelog: ## Validate changelog.json against the schema
	$(Q)$(YARN) validate-changelog

.PHONY: version-check
version-check: ## Validate Node/Yarn/Python tooling versions against .tool-versions
	$(Q)$(YARN) validate-electron-version
	$(Q)$(YARN) validate-macos-version

# Convenience composite target: build + smoke-test the same way CI does.
.PHONY: ci
ci: install lint test-script build ## Full CI-style sequence (install + lint + test + build)
	$(Q)echo "✓ ci: install, lint, test:script, build all succeeded"

# Catch-all safety net so typos surface a clear error instead of running
# whatever file happens to share the name.
.DEFAULT:
	$(AT)echo "error: no rule to build target '$@' (run '$(MAKE) help' for the list)" >&2
	$(AT)exit 2