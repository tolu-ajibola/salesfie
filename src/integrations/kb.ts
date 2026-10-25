import { config } from "../config.js";

/**
 * The knowledge base is a RAG service — a Chroma DB wrapper. We POST a natural-language
 * query and get back the most semantically-relevant document chunks, which we then
 * feed to Claude as extra context (product knowledge, T&Cs, internal docs, etc.).
 *
 * Query contract (provided):
 *   POST {baseUrl}/v2/retrieve
 *   { text, n_results, tenant, database, collection_name }
 */

export interface KbSnippet {
  id?: string; // chunk id, e.g. "doc_123_0" (used to dedup)
  text: string;
  metadata?: Record<string, unknown>;
  score?: number; // lower = closer, if a distance is returned
}

/** Raw retrieve — returns the unparsed JSON. Useful for the probe script. */
export async function rawRetrieve(text: string, nResults = 5): Promise<unknown> {
  const res = await fetch(`${config.kb.baseUrl}/v2/retrieve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      n_results: nResults,
      tenant: config.kb.tenant,
      database: config.kb.database,
      collection_name: config.kb.collection,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Knowledge base retrieve failed: ${res.status} ${res.statusText} ${body}`);
  }
  return res.json();
}

/**
 * Retrieve relevant document chunks for a query.
 *
 * Confirmed live response shape (2026-05-30):
 *   { ids: string[], documents: string[], metadatas: object[], ... }
 * where each metadata has { document_id, document_title, link, source_id,
 * parent_title, created_at, ... }. `parseSnippets` handles this plus a few
 * defensive fallbacks. No distance/score is returned by this endpoint.
 */
export async function retrieve(text: string, nResults = 5): Promise<KbSnippet[]> {
  const json = await rawRetrieve(text, nResults);
  return parseSnippets(json);
}

/**
 * Run several queries against the knowledge base in parallel, then merge and dedupe the
 * results. Vector search is sensitive to phrasing, so issuing a few varied
 * queries and unioning their hits substantially improves recall. Dedupe is by
 * chunk id (falling back to a text prefix). Returns up to `finalLimit` snippets.
 */
export async function retrieveMulti(
  queries: string[],
  perQuery = 6,
  finalLimit = 10,
): Promise<KbSnippet[]> {
  const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const lists = await Promise.all(
    unique.map((q) => retrieve(q, perQuery).catch(() => [] as KbSnippet[])),
  );

  const merged: KbSnippet[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const s of list) {
      const key = s.id ?? s.text.slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(s);
    }
  }
  return merged.slice(0, finalLimit);
}

/** Best-effort extraction of text snippets from several plausible response shapes. */
export function parseSnippets(json: unknown): KbSnippet[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, any>;

  // Shape A: a flat array of result objects.
  if (Array.isArray(json)) return json.map(toSnippet).filter(hasText);

  // Shape B: { results: [...] } or { documents: [...] } as a flat array of objects.
  for (const key of ["results", "documents", "data", "matches", "items"]) {
    const v = obj[key];
    if (Array.isArray(v) && (v.length === 0 || typeof v[0] === "object")) {
      return v.map(toSnippet).filter(hasText);
    }
  }

  // Shape C: native Chroma — parallel arrays, often nested one level:
  //   { documents: [[...]], metadatas: [[...]], distances: [[...]] }
  const docs = unwrap(obj.documents);
  if (Array.isArray(docs) && typeof docs[0] === "string") {
    const metas = unwrap(obj.metadatas) ?? [];
    const dists = unwrap(obj.distances) ?? [];
    const ids = unwrap(obj.ids) ?? [];
    return docs.map((text: string, i: number) => ({
      id: ids[i],
      text,
      metadata: metas[i],
      score: dists[i],
    }));
  }

  return [];
}

function unwrap(v: any): any[] | undefined {
  if (!Array.isArray(v)) return undefined;
  // Chroma nests results in a per-query outer array; take the first query's results.
  return Array.isArray(v[0]) ? v[0] : v;
}

function toSnippet(item: any): KbSnippet {
  if (typeof item === "string") return { text: item };
  const text =
    item.text ?? item.document ?? item.content ?? item.page_content ?? item.chunk ?? "";
  return {
    text: String(text),
    metadata: item.metadata ?? item.meta ?? undefined,
    score: item.distance ?? item.score ?? undefined,
  };
}

function hasText(s: KbSnippet): boolean {
  return Boolean(s.text && s.text.trim());
}

/** Flatten snippets into a single context string for an LLM prompt. */
export function snippetsToContext(snippets: KbSnippet[]): string {
  if (snippets.length === 0) return "(no relevant internal documents found)";
  return snippets
    .map((s, i) => {
      const meta = (s.metadata ?? {}) as Record<string, any>;
      // Confirmed knowledge-base metadata fields: document_title + link.
      const title =
        meta.document_title ?? meta.title ?? meta.source ?? meta.document_id ?? "";
      const link = meta.link ?? "";
      const cite = title ? `${title}${link ? ` <${link}>` : ""}` : link;
      const header = cite ? `[${i + 1}] Source: ${cite}` : `[${i + 1}]`;
      return `${header}\n${cleanWikiText(s.text)}`;
    })
    .join("\n\n");
}

/**
 * The knowledge base returns raw wiki markup (tables full of pipes, wiki links). Trim the
 * worst of the noise so the LLM context is cleaner and cheaper, without dropping
 * the actual content (e.g. Google Sheet / Drive URLs we may need to surface).
 */
function cleanWikiText(text: string): string {
  return text
    .replace(/^[\s|*-]*\|[\s|*-]*$/gm, "") // table separator rows like "---|---"
    .replace(/\n{3,}/g, "\n\n") // collapse excess blank lines
    .trim();
}
