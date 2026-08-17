import {
  auditReportSchema,
  type AuditFinding,
  type AuditReport,
  type ContractAuditProvider,
  type ContractBundle,
  type ProviderStatus,
  type Severity,
} from "@usance/schemas";
import { CHAINGPT_MODELS, ChainGptClient, ChainGptPayloadRejected } from "./client";

/**
 * ChainGPT Smart Contract Auditor.
 *
 * Verified working: given a contract with an external call before a balance decrement, it correctly
 * reported "Reentrancy Vulnerability" and explained the state-change-after-call ordering.
 *
 * This provider can return exactly two things: findings, or AUDIT_UNAVAILABLE. There is no success
 * path that means "secure". A CI gate that can print "secure" will eventually print it while
 * unconfigured, and a green build indistinguishable from an unrun one is worse than a red one.
 */
export class ChainGptContractAuditor implements ContractAuditProvider {
  readonly name = "chaingpt-auditor@2026-08";

  constructor(private readonly client: ChainGptClient = new ChainGptClient()) {}

  status(): ProviderStatus {
    return this.client.status();
  }

  async audit(bundle: ContractBundle, signal?: AbortSignal): Promise<AuditReport> {
    const producedAt = Math.floor(Date.now() / 1000);

    if (this.status() !== "available") {
      return unavailable(this.name, bundle, producedAt, "CHAINGPT_API_KEY is not configured");
    }

    const findings: AuditFinding[] = [];
    const skipped: string[] = [];

    // Audited per file rather than as one bundle. The model has an input ceiling, and a truncated
    // bundle would silently return an opinion about only the first few contracts while reading as
    // full coverage.
    for (const file of bundle.files) {
      try {
        const raw = await this.client.chat(
          CHAINGPT_MODELS.AUDITOR,
          auditPrompt(file.path, file.source),
          this.name,
          signal,
        );
        findings.push(...parseFindings(raw, file.path, this.name));
      } catch (e) {
        // One file failing must not discard the findings already gathered, but it also must not
        // vanish. It is recorded as skipped so the artifact states real coverage.
        skipped.push(`${file.path}: ${e instanceof ChainGptPayloadRejected ? "payload rejected" : (e as Error).message}`);
      }
    }

    // Every file failing is not a clean audit. It is an audit that did not happen.
    if (skipped.length === bundle.files.length && bundle.files.length > 0) {
      return unavailable(
        this.name,
        bundle,
        producedAt,
        `every file failed to audit (${skipped.length}/${bundle.files.length})`,
      );
    }

    return auditReportSchema.parse({
      provider: this.name,
      commit: bundle.commit,
      producedAt,
      status: "COMPLETED",
      findings,
      skipped,
      unavailableReason: null,
    });
  }
}

function unavailable(
  provider: string,
  bundle: ContractBundle,
  producedAt: number,
  reason: string,
): AuditReport {
  return auditReportSchema.parse({
    provider,
    commit: bundle.commit,
    producedAt,
    status: "AUDIT_UNAVAILABLE",
    findings: [],
    skipped: bundle.files.map((f) => f.path),
    unavailableReason: reason,
  });
}

function auditPrompt(path: string, source: string): string {
  return `Audit this Solidity file for security vulnerabilities.

For each issue, output one line in exactly this format and nothing else:
SEVERITY | TITLE | LINE_NUMBER_OR_NONE | EXPLANATION

SEVERITY must be one of: CRITICAL, HIGH, MEDIUM, LOW, INFO.
If you find no issues, output exactly: NO_FINDINGS

File: ${path}

${source}`;
}

const SEVERITIES: readonly Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

/**
 * Parse the auditor's free-text response into structured findings.
 *
 * Unparseable lines are ignored rather than guessed at. A finding invented by a lenient parser is
 * worse than a finding missed, because it costs reviewer attention that the real ones need.
 */
export function parseFindings(raw: string, contractPath: string, source: string): AuditFinding[] {
  if (/\bNO_FINDINGS\b/.test(raw)) return [];

  const out: AuditFinding[] = [];
  for (const line of raw.split("\n")) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 4) continue;

    const sev = (parts[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "");
    const severity = SEVERITIES.find((s) => sev.includes(s));
    if (!severity) continue;

    const title = parts[1] ?? "";
    if (title === "") continue;

    const lineRaw = parts[2] ?? "";
    const lineNum = /^\d+$/.test(lineRaw) ? Number(lineRaw) : null;

    out.push({
      // Deterministic id so the same finding across two runs is recognisably the same finding and
      // can be suppressed or tracked to resolution.
      findingId: `${contractPath}:${severity}:${slug(title)}`,
      severity,
      contract: contractPath,
      line: lineNum !== null && lineNum > 0 ? lineNum : null,
      title,
      detail: parts.slice(3).join(" | "),
      source,
    });
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
