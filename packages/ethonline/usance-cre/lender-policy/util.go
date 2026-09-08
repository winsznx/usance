package main

import (
	"math/big"
	"strings"
)

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if strings.EqualFold(x, v) {
			return true
		}
	}
	return false
}

// bigGt reports a > b for decimal-integer strings (18-dp fixed point, compared as integers).
func bigGt(a, b string) bool {
	ba, oka := new(big.Int).SetString(strings.TrimSpace(a), 10)
	bb, okb := new(big.Int).SetString(strings.TrimSpace(b), 10)
	if !oka || !okb {
		return false
	}
	return ba.Cmp(bb) > 0
}

// mulUnitsPrice returns units * priceUsd18 as an 18-dp string (units are whole, price is 1e18).
func mulUnitsPrice(units uint64, priceUsd18 string) string {
	bp, ok := new(big.Int).SetString(strings.TrimSpace(priceUsd18), 10)
	if !ok {
		return "0"
	}
	return new(big.Int).Mul(new(big.Int).SetUint64(units), bp).String()
}

func hexEncode(b []byte) string {
	const hextable = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = hextable[v>>4]
		out[i*2+1] = hextable[v&0x0f]
	}
	return string(out)
}

// asciiToBytes32 left-aligns an ASCII reason code into a 0x-prefixed 32-byte hex string, matching
// Solidity's `bytes32("ELIGIBLE")` layout.
func asciiToBytes32(s string) string {
	var buf [32]byte
	copy(buf[:], s)
	return "0x" + hexEncode(buf[:])
}
