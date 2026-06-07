import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

function computeHash(data: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonicalJson(data)).digest("hex")}`;
}

function verifyChain(chain: any[]) {
  return chain.map((record: any) => {
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
      valid: computed === record.content_hash,
    };
  });
}

function makeRecord(overrides = {}): any {
  const record: any = {
    record_id: "rec_test_001",
    mandate_id: "mnd_test_001",
    action_type: "test_action",
    timestamp: "2025-01-01T00:00:00.000Z",
    agent_id: "ag_test_001",
    input_hash: "sha256:abc",
    output_hash: "sha256:def",
    within_mandate: true,
    chain_position: 1,
    prev_record_hash: null,
    ...overrides,
  };
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
  record.content_hash = computeHash(data);
  return record;
}

describe("MCP Verification", () => {
  it("verifies an intact chain", () => {
    const records = [makeRecord(), makeRecord({ chain_position: 2, prev_record_hash: "rec_test_001" })];
    const results = verifyChain(records);
    expect(results.every((r) => r.valid)).toBe(true);
  });

  it("detects a tampered record", () => {
    const record = makeRecord();
    record.content_hash = "sha256:tampered";
    const results = verifyChain([record]);
    expect(results[0].valid).toBe(false);
  });

  it("verifies empty chain returns empty", () => {
    const results = verifyChain([]);
    expect(results).toEqual([]);
  });
});
