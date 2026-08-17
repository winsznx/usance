import {
  observationSchema,
  SourceClass,
  isLowTrust,
  type Observation,
  type ObservationProvider,
  type ObservationQuery,
  type ProviderStatus,
} from "@usance/schemas";
import { ChainGptClient } from "./client";

/**
 * ChainGPT AI News as a low-trust observation source.
 *
 * Confirmed live: GET https://api.chaingpt.org/news returns
 * {"statusCode":200,"message":"Request Successful","data":[ ...30-field article records ]}.
 *
 * What this provider is for: noticing that something may have changed, so the pipeline can go and
 * re-read an authoritative source. What it is emphatically not for: changing a number. A news
 * article can trigger a Passport refresh or an alert. It can never raise a limit, and it can never
 * become a claim (invariant I-18).
 *
 * That guarantee is enforced twice — the return type narrows to the low-trust classes, and the
 * runtime asserts it as well. Belt and braces, because this is the single most likely place for a
 * future change to quietly promote a rumour into evidence.
 */
interface NewsItem {
  id: number;
  title?: string;
  description?: string;
  category?: string;
  pubDate?: string;
  createdAt?: string;
  token?: string;
  newsTags?: unknown;
}

interface NewsResponse {
  statusCode: number;
  message: string;
  data: NewsItem[];
}

export class ChainGptNewsObservations implements ObservationProvider {
  readonly name = "chaingpt-news@2026-08";

  constructor(private readonly client: ChainGptClient = new ChainGptClient()) {}

  status(): ProviderStatus {
    return this.client.status();
  }

  async poll(query: ObservationQuery, signal?: AbortSignal): Promise<readonly Observation[]> {
    const limit = Math.max(1, Math.min(query.limit || 25, 100));
    const res = await this.client.getJson<NewsResponse>(`/news?limit=${limit}`, this.name, signal);

    const out: Observation[] = [];
    for (const item of res.data ?? []) {
      const headline = (item.title ?? "").trim();
      if (headline === "") continue;

      const observedAt = toUnixSeconds(item.pubDate ?? item.createdAt);
      if (observedAt < query.since) continue;

      // Topic filtering is done here rather than trusted to the upstream query, because an
      // unfiltered feed silently becomes an alert firehose and alert fatigue is how a real
      // issuer-suspension headline gets scrolled past.
      if (query.topics.length > 0 && !matchesTopic(item, query.topics)) continue;

      const candidate = {
        observationId: `chaingpt-news:${item.id}`,
        sourceClass: SourceClass.NEWS,
        headline,
        uri: `https://api.chaingpt.org/news#${item.id}`,
        observedAt,
        // Deliberately empty. Mapping a headline to an assetId is an inference, and an inference
        // made here would be indistinguishable downstream from a verified association.
        assetIds: [],
      };

      const parsed = observationSchema.safeParse(candidate);
      if (!parsed.success) continue;

      // Structural guarantee, asserted rather than assumed.
      if (!isLowTrust(parsed.data.sourceClass)) {
        throw new Error("an observation provider emitted a non-low-trust source class");
      }
      out.push(parsed.data);
    }
    return out;
  }
}

function toUnixSeconds(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

function matchesTopic(item: NewsItem, topics: readonly string[]): boolean {
  const hay = [item.title, item.description, item.category, item.token, JSON.stringify(item.newsTags ?? "")]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  return topics.some((t) => hay.includes(t.toLowerCase()));
}
