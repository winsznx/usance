# Mirrors the Makefile for anyone who prefers `just`. The Makefile is canonical.

default:
    @just --list

doctor:              ; make doctor
bootstrap:           ; make bootstrap
test:                ; make test
test-contracts:      ; make test-contracts
test-risk:           ; make test-risk
test-e2e:            ; make test-e2e
test-ts:             ; make test-ts
test-differential:   ; make test-differential
build:               ; make build
lint:                ; make lint
fmt:                 ; make fmt
fixtures:            ; make fixtures
verify-integrations: ; make verify-integrations
# `just audit-contracts --allow-unavailable` reaches the gate as AUDIT_FLAGS does under make.
audit-contracts *FLAGS: ; make audit-contracts AUDIT_FLAGS="{{FLAGS}}"
demo-local:          ; make demo-local
demo-testnet:        ; make demo-testnet
test-live-xlayer:    ; make test-live-xlayer
deploy-testnet:      ; make deploy-testnet
clean:               ; make clean
