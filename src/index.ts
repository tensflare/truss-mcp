import Fastify from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";

interface JoinRequest {
  evidence_ids: string[];
  mandate_ids?: string[];
}

interface EvidenceRecord {
  record_id: string;
  mandate_id: string;
  action_type: string;
  timestamp: string;
  agent_id: string;
  input_hash: string;
  output_hash: string;
  within_mandate: boolean;
  chain_position: number;
  prev_record_hash: string | null;
  content_hash?: string;
}

interface EvidencePackage {
  package_id?: string;
  generated_at?: string;
  action_log?: EvidenceRecord[];
  [key: string]: unknown;
}

function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

function computeHash(data: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonicalJson(data)).digest("hex")}`;
}

function verifyChain(chain: EvidenceRecord[]) {
  return chain.map((record) => {
    const data = {
      record_id: record.record_id,
      mandate_id: record.mandate_id,
      action_type: record.action_type,
      timestamp: record.timestamp,
      agent_id: record.agent_id,
      input_hash: record.input_hash,
      output_hash: record.output_hash,
      within_mandate: record.within_mandate,
      chain_position: record.chain_position,
      prev_record_hash: record.prev_record_hash,
    };
    const computed = computeHash(data);
    return {
      record_id: record.record_id,
      chain_position: record.chain_position,
      content_hash_stored: record.content_hash ?? null,
      content_hash_computed: computed,
      valid: computed === record.content_hash,
    };
  });
}

const app = Fastify({ logger: true, bodyLimit: 1_048_576, requestTimeout: 30_000 });

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  const key = request.headers["x-api-key"];
  const apiKey = Array.isArray(key) ? key[0] : key;
  if (!apiKey || !process.env.MCP_API_KEY) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  const expected = Buffer.from(process.env.MCP_API_KEY);
  const actual = Buffer.from(apiKey);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

app.post("/tools/join", async (request, reply) => {
  const body = request.body as JoinRequest;
  if (!body?.evidence_ids?.length) {
    return reply.status(400).send({ error: "At least one evidence_id is required" });
  }
  return {
    joined: true,
    evidence_count: body.evidence_ids.length,
    mandate_count: body.mandate_ids?.length ?? 0,
    assembled_at: new Date().toISOString(),
  };
});

app.get("/tools/list", async (request, reply) => {
  return {
    evidence_packages: [],
    count: 0,
  };
});

app.post("/tools/verify", async (request, reply) => {
  const body = request.body as { evidence: EvidencePackage };
  if (!body?.evidence) {
    return reply.status(400).send({ error: "evidence is required" });
  }
  const chain = body.evidence.action_log ?? [];
  if (chain.length === 0) {
    return reply.status(400).send({ error: "evidence.action_log is empty or missing" });
  }
  const results = verifyChain(chain);
  const allValid = results.every((r) => r.valid);
  return {
    package_id: body.evidence.package_id ?? null,
    chain_integrity: allValid ? "intact" : "tampered",
    total_records: results.length,
    valid_records: results.filter((r) => r.valid).length,
    tampered_records: results.filter((r) => !r.valid).length,
    results,
    verified_at: new Date().toISOString(),
  };
});

app.get("/health", async () => ({ status: "ok", service: "truss-mcp" }));

const port = parseInt(process.env.PORT ?? "4001", 10);
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";

try {
  await app.listen({ port, host });
  console.log(`Truss MCP Server running on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
