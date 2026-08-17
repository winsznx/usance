import { z } from "zod";
import { unixSecondsSchema } from "./primitives";

/**
 * Contract audit reporting.
 *
 * There is deliberately no "SECURE" status. An audit provider reports findings, or reports that it
 * could not run. A CI gate that can print "secure" is a gate that will eventually print it while
 * unconfigured, and a green build nobody can distinguish from an unrun one is worse than a red
 * build.
 */

export const severitySchema = z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type Severity = z.infer<typeof severitySchema>;

export const SEVERITY_ORDER: readonly Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function severityAtLeast(a: Severity, floor: Severity): boolean {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(floor);
}

export const auditFindingSchema = z
  .object({
    findingId: z.string().min(1),
    severity: severitySchema,
    contract: z.string().min(1),
    line: z.number().int().positive().nullable(),
    title: z.string().min(1),
    detail: z.string(),
    source: z.string().min(1),
  })
  .strict();

export type AuditFinding = z.infer<typeof auditFindingSchema>;

export const auditReportSchema = z
  .object({
    provider: z.string().min(1),
    commit: z.string().min(1),
    producedAt: unixSecondsSchema,
    status: z.enum(["COMPLETED", "AUDIT_UNAVAILABLE"]),
    findings: z.array(auditFindingSchema),
    /** Contracts the provider was asked about but did not return an opinion on. */
    skipped: z.array(z.string()),
    /** Why, when status is AUDIT_UNAVAILABLE. Never empty in that case. */
    unavailableReason: z.string().nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.status === "AUDIT_UNAVAILABLE" && !r.unavailableReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unavailableReason"],
        message: "an unavailable audit must say why, or it is indistinguishable from a clean one",
      });
    }
    if (r.status === "AUDIT_UNAVAILABLE" && r.findings.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["findings"],
        message: "an audit that did not run cannot have findings",
      });
    }
  });

export type AuditReport = z.infer<typeof auditReportSchema>;

export interface ContractBundle {
  readonly commit: string;
  readonly solcVersion: string;
  readonly files: readonly { readonly path: string; readonly source: string }[];
}

export interface ContractAuditProvider {
  audit(bundle: ContractBundle, signal?: AbortSignal): Promise<AuditReport>;
}
