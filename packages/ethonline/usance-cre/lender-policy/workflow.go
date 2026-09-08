package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/smartcontractkit/chainlink-protos/cre/go/sdk"
	httpcap "github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/cre"
	"golang.org/x/crypto/sha3"
)

// Config is the public, on-chain-safe part of the workflow settings. The lender's actual
// thresholds are NOT here — they arrive as a CRE secret and never leave the enclave.
type Config struct {
	WorkflowVersion uint32 `json:"workflowVersion"`
	SecretID        string `json:"secretId"`
}

// DecisionInput is the HTTP trigger body: the exact substitution decision plus the candidate
// attributes the lender's private policy is evaluated against.
type DecisionInput struct {
	DecisionHash        string `json:"decisionHash"`
	FacilityID          string `json:"facilityId"`
	CandidateAssetID    string `json:"candidateAssetId"`
	IssuerID            string `json:"issuerId"`
	RequestedUnits      uint64 `json:"requestedUnits"`
	MarkPriceUsd18      string `json:"markPriceUsd18"`
	IssuerExposureUsd18 string `json:"issuerExposureUsd18"`
	RatingNotch         int    `json:"ratingNotch"`
}

// LenderPolicy is the confidential document. Only its keccak256 commitment is ever public.
type LenderPolicy struct {
	Version                uint32   `json:"version"`
	MaxIssuerExposureUsd18 string   `json:"maxIssuerExposureUsd18"`
	MaxSubstitutionUsd18   string   `json:"maxSubstitutionUsd18"`
	MinRatingNotch         int      `json:"minRatingNotch"`
	AllowedIssuers         []string `json:"allowedIssuers"`
}

// Verdict is what the workflow returns. The relayer signs (decisionHash, allow, policyCommitment,
// workflowVersion, reasonCode, expiry) for EthOnlinePolicyVerifier.submitVerdict.
type Verdict struct {
	DecisionHash     string `json:"decisionHash"`
	Allow            bool   `json:"allow"`
	ReasonCode       string `json:"reasonCode"`       // bytes32, left-aligned ASCII, 0x-prefixed
	PolicyCommitment string `json:"policyCommitment"` // keccak256 of the canonical private policy
	WorkflowVersion  uint32 `json:"workflowVersion"`
}

var teeRequirements = cre.OneOfTees{cre.Nitro{Regions: []cre.NitroRegion{cre.NitroUsWest2}}}

func InitWorkflow(config *Config, logger *slog.Logger, _ cre.SecretsProvider) (cre.Workflow[*Config], error) {
	if config.WorkflowVersion == 0 {
		return nil, fmt.Errorf("config.workflowVersion must be set")
	}
	if config.SecretID == "" {
		config.SecretID = "LENDER_POLICY"
	}
	// Confidential Workflow: the handler runs inside an AWS Nitro enclave, so the lender policy
	// fetched via runtime.GetSecret is never exposed to the DON or to chain.
	return cre.Workflow[*Config]{
		cre.HandlerInTee(httpcap.Trigger(&httpcap.Config{}), evaluatePolicy, teeRequirements),
	}, nil
}

func evaluatePolicy(config *Config, runtime cre.TeeRuntime, payload *httpcap.Payload) (*Verdict, error) {
	logger := runtime.Logger()

	var in DecisionInput
	if err := json.Unmarshal(payload.Input, &in); err != nil {
		return nil, fmt.Errorf("bad decision input: %w", err)
	}
	if !strings.HasPrefix(in.DecisionHash, "0x") || len(in.DecisionHash) != 66 {
		return nil, fmt.Errorf("decisionHash must be a 32-byte hex string")
	}

	secret, err := runtime.GetSecret(&sdk.SecretRequest{Id: config.SecretID}).Await()
	if err != nil {
		return nil, fmt.Errorf("lender policy secret unavailable: %w", err)
	}
	var policy LenderPolicy
	if err := json.Unmarshal([]byte(secret.Value), &policy); err != nil {
		return nil, fmt.Errorf("malformed lender policy: %w", err)
	}

	commitment := commit(&policy)

	allow, reason := decide(&in, &policy)
	logger.Info("confidential lender-policy verdict",
		"decisionHash", in.DecisionHash, "allow", allow, "reason", reason,
		"policyVersion", policy.Version)

	return &Verdict{
		DecisionHash:     in.DecisionHash,
		Allow:            allow,
		ReasonCode:       asciiToBytes32(reason),
		PolicyCommitment: commitment,
		WorkflowVersion:  config.WorkflowVersion,
	}, nil
}

func decide(in *DecisionInput, p *LenderPolicy) (bool, string) {
	if !contains(p.AllowedIssuers, in.IssuerID) {
		return false, "ISSUER_BLOCKED"
	}
	if in.RatingNotch < p.MinRatingNotch {
		return false, "RATING_BELOW_MIN"
	}
	if bigGt(in.IssuerExposureUsd18, p.MaxIssuerExposureUsd18) {
		return false, "ISSUER_CONCENTRATION"
	}
	substitutionUsd := mulUnitsPrice(in.RequestedUnits, in.MarkPriceUsd18)
	if bigGt(substitutionUsd, p.MaxSubstitutionUsd18) {
		return false, "SIZE_OVER_LIMIT"
	}
	return true, "ELIGIBLE"
}

// commit is the in-enclave keccak256 of the canonical private policy. Only this value is public.
func commit(p *LenderPolicy) string {
	issuers := append([]string(nil), p.AllowedIssuers...)
	sort.Strings(issuers)
	canonical := struct {
		Version                uint32   `json:"version"`
		MaxIssuerExposureUsd18 string   `json:"maxIssuerExposureUsd18"`
		MaxSubstitutionUsd18   string   `json:"maxSubstitutionUsd18"`
		MinRatingNotch         int      `json:"minRatingNotch"`
		AllowedIssuers         []string `json:"allowedIssuers"`
	}{p.Version, p.MaxIssuerExposureUsd18, p.MaxSubstitutionUsd18, p.MinRatingNotch, issuers}
	b, _ := json.Marshal(canonical)
	h := sha3.NewLegacyKeccak256()
	h.Write([]byte("USANCE_CRE_LENDER_POLICY_V1"))
	h.Write(b)
	return "0x" + hexEncode(h.Sum(nil))
}
