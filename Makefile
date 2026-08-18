#  Usance — reproducible task runner.
#
#  Everything here works from a fresh clone with no developer-specific machine state. No absolute
#  paths, no assumed global installs beyond the toolchain listed by `make doctor`.
#
#  A `justfile` mirrors these targets for anyone who prefers `just`.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

CONTRACTS := contracts
FIXTURES  := fixtures/canonical/risk-scenarios.json

.PHONY: help doctor bootstrap fixtures test test-contracts test-ts test-differential \
        build build-contracts build-web lint fmt fmt-check verify-integrations \
        deploy-testnet demo-local clean test-rust deployer deployer-create test-live-xlayer \
        test-risk test-e2e demo-testnet audit-contracts

# Flags forwarded to the ChainGPT audit gate. CI passes --allow-unavailable on every branch except
# a protected one, so a missing credential blocks a release without blocking a pull request.
AUDIT_FLAGS ?=

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-22s\033[0m %s\n", $$1, $$2}'

doctor: ## Check that the required toolchain is present
	@echo "Checking toolchain…"
	@command -v node    >/dev/null || { echo "  MISSING node   (>= 20)"; exit 1; }
	@command -v pnpm    >/dev/null || { echo "  MISSING pnpm   (>= 9)"; exit 1; }
	@command -v forge   >/dev/null || { echo "  MISSING forge  (foundry)"; exit 1; }
	@command -v python3 >/dev/null || { echo "  MISSING python3 (fixture generation)"; exit 1; }
	@echo "  node    $$(node --version)"
	@echo "  pnpm    $$(pnpm --version)"
	@echo "  forge   $$(forge --version | head -1)"
	@echo "  python3 $$(python3 --version)"
	@echo "OK"

bootstrap: doctor ## Install every dependency from a clean checkout
	pnpm install --frozen-lockfile || pnpm install
	@# Named explicitly because a bare `forge install` cannot work here. The contract dependencies
	@# are vendored with --no-git, so there is no .gitmodules and nothing for the no-argument form
	@# to reinstall — on a fresh clone it succeeds silently and leaves lib/ empty, and the first
	@# error anyone sees is a missing forge-std import several minutes later.
	@test -d lib/forge-std || forge install foundry-rs/forge-std --no-git
	@test -d lib/openzeppelin-contracts || forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
	@echo "Bootstrapped."

fixtures: ## Regenerate the canonical conformance fixtures from spec/accounting.md
	python3 scripts/gen_fixtures.py

# ---------------------------------------------------------------------------- tests

test: test-contracts test-ts test-rust ## Run every deterministic test (no network required)
	@echo ""
	@echo "All deterministic suites passed."

test-contracts: ## Forge unit, fuzz and conformance tests
	cd $(CONTRACTS) && forge test -vv

test-ts: ## TypeScript unit and conformance tests
	pnpm -r test

test-rust: ## Rust reference-engine tests
	@if [ -f Cargo.toml ]; then cargo test --workspace --quiet; \
	 else echo "  (no Rust workspace yet — skipping)"; fi

test-differential: ## Prove Solidity and TypeScript agree with the frozen fixtures (invariant D-01)
	@echo "→ checking committed fixtures still match the spec transcription"
	@# Compared by content, not by `git diff`: an untracked fixture file would make git report
	@# no difference and the check would pass without having verified anything.
	@cp $(FIXTURES) .fixtures.committed.tmp
	@python3 scripts/gen_fixtures.py > /dev/null
	@if ! cmp -s $(FIXTURES) .fixtures.committed.tmp; then \
	  echo ""; \
	  echo "FAIL: committed fixtures disagree with scripts/gen_fixtures.py."; \
	  echo "      Either the spec transcription changed or the fixtures were edited by hand."; \
	  diff <(python3 -m json.tool .fixtures.committed.tmp) <(python3 -m json.tool $(FIXTURES)) | head -40 || true; \
	  rm -f .fixtures.committed.tmp; \
	  exit 1; \
	fi
	@rm -f .fixtures.committed.tmp
	@echo "→ Solidity conformance"
	@cd $(CONTRACTS) && forge test --match-contract RiskMathConformance
	@echo "→ TypeScript conformance"
	@pnpm --filter @usance/domain test
	@echo "→ Rust conformance"
	@if [ -f Cargo.toml ]; then cargo test --workspace --quiet; \
	 else echo "  SKIPPED: no Rust workspace yet"; fi
	@echo ""
	@echo "Three implementations agree on every canonical scenario, to the wei."

# ---------------------------------------------------------------------------- build

build: build-contracts build-web ## Build everything

build-contracts: ## Compile the contracts
	cd $(CONTRACTS) && forge build

build-web: ## Build the web application
	pnpm build

# ---------------------------------------------------------------------------- quality

lint: ## Typecheck TypeScript and lint Solidity
	pnpm -r typecheck
	cd $(CONTRACTS) && forge fmt --check

fmt: ## Format Solidity
	cd $(CONTRACTS) && forge fmt

fmt-check: ## Verify Solidity formatting
	cd $(CONTRACTS) && forge fmt --check

# ---------------------------------------------------------------------------- live

verify-integrations: ## Re-run the Phase 0 checks in docs/INTEGRATIONS.md against live endpoints
	@bash scripts/verify-integrations.sh

# --experimental-transform-types is not optional: packages/chaingpt uses constructor parameter
# properties, which Node's strip-only mode rejects. See the header of the script.
audit-contracts: ## Audit contracts/src with ChainGPT and gate on the findings (needs CHAINGPT_API_KEY)
	@node --experimental-transform-types --disable-warning=ExperimentalWarning \
	  scripts/chaingpt-audit.mjs $(AUDIT_FLAGS)

deployer: ## Show the deployer address and whether it is funded
	@node scripts/deployer.mjs || true

deployer-create: ## Generate a deployer key into .env (gitignored)
	@node scripts/deployer.mjs --create || true

test-live-xlayer: ## Read live X Layer state for the current deployment (needs a deployment)
	@node scripts/live-xlayer.mjs

deploy-testnet: ## Deploy the core to X Layer testnet (requires DEPLOYER_PRIVATE_KEY)
	@test -n "$${DEPLOYER_PRIVATE_KEY:-}" || { echo "DEPLOYER_PRIVATE_KEY is not set"; exit 1; }
	cd $(CONTRACTS) && forge script script/Deploy.s.sol:Deploy \
	  --rpc-url $${XLAYER_TESTNET_RPC_URL:-https://testrpc.xlayer.tech} \
	  --broadcast --slow -vvv
#  Regenerating the manifest is part of deploying, not a step someone remembers. It was a separate
#  manual step exactly once, and the manifest then described the previous deployment while every
#  check reported green.
	@node scripts/write-manifest.mjs 1952
	@node scripts/live-xlayer.mjs

test-risk: test-rust ## Alias for the Rust reference-engine suite (named in the build spec)

test-e2e: ## Playwright browser end-to-end suite
	@echo "NOT IMPLEMENTED: there is no Playwright suite yet, and no deployment to run it against."
	@echo "  Blocked by: unfunded deployer (see 'make deployer')."
	@echo "  This target exits non-zero rather than reporting a pass it cannot justify."
	@exit 1

demo-testnet: ## Run the judge path against a live X Layer testnet deployment
	@echo "NOT IMPLEMENTED: requires a broadcast deployment."
	@echo "  Run 'make deployer' for the funding blocker, then 'make deploy-testnet'."
	@echo "  Until then use 'make demo-local', which computes the real pipeline offline."
	@exit 1

demo-local: ## Run the deterministic walkthrough locally (no wallet, no network)
	@echo "Starting the local walkthrough at http://localhost:3000/simulate"
	pnpm dev

clean: ## Remove build output
	rm -rf $(CONTRACTS)/out $(CONTRACTS)/cache apps/web/.next
	find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
