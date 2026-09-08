import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, costUsd } from "../src/agents/models.ts";

test("opus-5 list pricing: $5/MTok in, $25/MTok out", () => {
  const cost = costUsd(MODELS.deep, { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(cost, 5);
  const out = costUsd(MODELS.deep, { input_tokens: 0, output_tokens: 1_000_000 });
  assert.equal(out, 25);
});

test("haiku is the cheap tier and sonnet sits between", () => {
  const usage = { input_tokens: 100_000, output_tokens: 10_000 };
  const cheap = costUsd(MODELS.cheap, usage);
  const standard = costUsd(MODELS.standard, usage);
  const deep = costUsd(MODELS.deep, usage);
  assert.ok(cheap < standard && standard < deep, `${cheap} < ${standard} < ${deep}`);
});

test("cache reads cost a tenth of uncached input", () => {
  const uncached = costUsd(MODELS.deep, { input_tokens: 500_000, output_tokens: 0 });
  const cached = costUsd(MODELS.deep, {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 500_000,
  });
  assert.ok(Math.abs(cached * 10 - uncached) < 1e-9, `${cached} * 10 should equal ${uncached}`);
});

test("cache writes cost 1.25x uncached input", () => {
  const uncached = costUsd(MODELS.deep, { input_tokens: 400_000, output_tokens: 0 });
  const written = costUsd(MODELS.deep, {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 400_000,
  });
  assert.ok(Math.abs(written - uncached * 1.25) < 1e-9);
});

test("a cached agent run is far cheaper than an uncached one", () => {
  // Representative scoring call: ~8k playbook prefix, ~1k lead data, ~600 out.
  const cold = costUsd(MODELS.deep, {
    input_tokens: 9_000,
    output_tokens: 600,
    cache_creation_input_tokens: 0,
  });
  const warm = costUsd(MODELS.deep, {
    input_tokens: 1_000,
    output_tokens: 600,
    cache_read_input_tokens: 8_000,
  });
  assert.ok(warm < cold, `warm ${warm} should beat cold ${cold}`);
});

test("unknown model reports zero rather than throwing", () => {
  assert.equal(costUsd("some-future-model", { input_tokens: 1000, output_tokens: 1000 }), 0);
});
