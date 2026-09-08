package main

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func policy() *LenderPolicy {
	return &LenderPolicy{
		Version:                1,
		MaxIssuerExposureUsd18: "500000000000000000000000",
		MaxSubstitutionUsd18:   "250000000000000000000000",
		MinRatingNotch:         12,
		AllowedIssuers:         []string{"USANCE-ISSUER-A", "USANCE-ISSUER-B"},
	}
}

func TestDecideAllow(t *testing.T) {
	in := &DecisionInput{
		IssuerID: "USANCE-ISSUER-B", RatingNotch: 15, RequestedUnits: 150000,
		MarkPriceUsd18: "1000000000000000000", IssuerExposureUsd18: "100000000000000000000000",
	}
	allow, reason := decide(in, policy())
	require.True(t, allow)
	require.Equal(t, "ELIGIBLE", reason)
}

func TestDecideDenials(t *testing.T) {
	base := &DecisionInput{
		IssuerID: "USANCE-ISSUER-B", RatingNotch: 15, RequestedUnits: 150000,
		MarkPriceUsd18: "1000000000000000000", IssuerExposureUsd18: "100000000000000000000000",
	}
	cases := map[string]func(*DecisionInput){
		"ISSUER_BLOCKED":       func(d *DecisionInput) { d.IssuerID = "OTHER" },
		"RATING_BELOW_MIN":     func(d *DecisionInput) { d.RatingNotch = 3 },
		"ISSUER_CONCENTRATION": func(d *DecisionInput) { d.IssuerExposureUsd18 = "999000000000000000000000" },
		"SIZE_OVER_LIMIT":      func(d *DecisionInput) { d.RequestedUnits = 999999 },
	}
	for want, mut := range cases {
		d := *base
		mut(&d)
		allow, reason := decide(&d, policy())
		require.False(t, allow, want)
		require.Equal(t, want, reason)
	}
}

func TestCommitStable(t *testing.T) {
	p := policy()
	c1 := commit(p)
	p.AllowedIssuers = []string{"USANCE-ISSUER-B", "USANCE-ISSUER-A"}
	require.Equal(t, c1, commit(p), "commitment must be order-independent")
	require.Len(t, c1, 66)
}

func TestConfigParses(t *testing.T) {
	var c Config
	require.NoError(t, json.Unmarshal([]byte(`{"workflowVersion":1,"secretId":"LENDER_POLICY"}`), &c))
	require.Equal(t, uint32(1), c.WorkflowVersion)
}
