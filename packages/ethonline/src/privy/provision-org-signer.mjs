/**
 * Provision the organisation's Privy-controlled approval signer for the institutional facility.
 *
 *   node --env-file=../../.env src/privy/provision-org-signer.mjs
 *
 * Creates, once and reused thereafter:
 *   - a Privy key quorum of two P-256 authorization keys, threshold 2 (dual approval)
 *   - an Ethereum server wallet owned by that quorum
 *
 * The wallet's address is the `orgApprover` configured into EthOnlineAuthorityVerifier. A raw
 * secp256k1 signature from that wallet is only produced after both quorum keys authorize the
 * request, so signing a FacilityDecision is a genuine two-party organisational control, not a
 * lone key.
 *
 * Secrets (the two P-256 private keys) are written to packages/ethonline/.privy-org.json, which is
 * gitignored. Only public identifiers go into the committed proof.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrivyClient, generateP256KeyPair } from "@privy-io/node";

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRETS = path.resolve(here, "../../.privy-org.json");
const PROOF = path.resolve(here, "../../../../docs/ethonline-2026/proof/privy-org-signer.json");

const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
if (!appId || !appSecret) throw new Error("PRIVY_APP_ID / PRIVY_APP_SECRET missing");

const privy = new PrivyClient({ appId, appSecret });

async function main() {
  if (fs.existsSync(SECRETS)) {
    const s = JSON.parse(fs.readFileSync(SECRETS, "utf8"));
    console.log(`already provisioned: wallet ${s.walletAddress} (id ${s.walletId}), quorum ${s.keyQuorumId}`);
    return;
  }

  console.log("generating two P-256 organisational approver keys ...");
  const k1 = await generateP256KeyPair();
  const k2 = await generateP256KeyPair();

  console.log("creating the key quorum (threshold 2) ...");
  const quorum = await privy.keyQuorums().create({
    authorization_threshold: 2,
    display_name: "Usance institutional org approvers",
    public_keys: [k1.publicKey, k2.publicKey],
  });

  console.log("creating the Ethereum server wallet owned by the quorum ...");
  const wallet = await privy.wallets().create({
    chain_type: "ethereum",
    owner_id: quorum.id,
    display_name: "Usance facility org approver",
  });

  fs.writeFileSync(SECRETS, JSON.stringify({
    $warning: "SECRET — gitignored. The two P-256 private keys that satisfy the org approval quorum.",
    appId,
    keyQuorumId: quorum.id,
    walletId: wallet.id,
    walletAddress: wallet.address,
    approverPrivateKeys: [k1.privateKey, k2.privateKey],
    approverPublicKeys: [k1.publicKey, k2.publicKey],
  }, null, 2) + "\n");
  fs.chmodSync(SECRETS, 0o600);

  fs.writeFileSync(PROOF, JSON.stringify({
    $generatedAt: new Date().toISOString(),
    what: "the organisation's Privy-controlled FacilityDecision approval signer",
    provider: "Privy server wallets (@privy-io/node)",
    appId,
    keyQuorumId: quorum.id,
    authorizationThreshold: 2,
    approverPublicKeys: [k1.publicKey, k2.publicKey],
    walletId: wallet.id,
    walletAddress: wallet.address,
    chainType: "ethereum",
    control: "a raw secp256k1 signature from walletAddress is produced only when both quorum keys authorize the raw_sign request; this address is the EthOnlineAuthorityVerifier orgApprover",
    secretsFile: "packages/ethonline/.privy-org.json (gitignored)",
  }, null, 2) + "\n");

  console.log(`\n✓ wallet ${wallet.address} (id ${wallet.id})`);
  console.log(`✓ quorum ${quorum.id} (threshold 2)`);
  console.log(`✓ secrets -> ${SECRETS}`);
  console.log(`✓ proof   -> ${PROOF}`);
}

main().catch((e) => { console.error("\n✗", e?.message || e); process.exit(1); });
