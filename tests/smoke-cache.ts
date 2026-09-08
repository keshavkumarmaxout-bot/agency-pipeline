/**
 * Prompt-cache smoke test. Needs an Anthropic credential; needs no database.
 *
 * This is the guard on the single biggest silent cost bug in the system: if
 * anything volatile leaks into the cached prefix, every request pays full price
 * and nothing visibly breaks. Run it after any change to playbooks.ts or
 * runner.ts's buildSystem().
 *
 *   npm run smoke:cache
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadPlaybooks, untrusted } from "../src/agents/playbooks.ts";
import { MODELS, costUsd } from "../src/agents/models.ts";

const MIN_CACHEABLE_TOKENS = 1024;
const client = new Anthropic();

const { text: playbookText, hash } = loadPlaybooks([
  "icp",
  "services",
  "tone",
  "pricing",
  "objections",
]);

const system: Anthropic.TextBlockParam[] = [
  {
    type: "text",
    text: `${playbookText}\n\n<instructions agent="smoke">\nReply with a single word: OK.\n</instructions>`,
    cache_control: { type: "ephemeral", ttl: "1h" },
  },
];

async function call(leadBlurb: string): Promise<Anthropic.Message> {
  return client.messages.create({
    model: MODELS.cheap,
    max_tokens: 16,
    system,
    messages: [
      { role: "user", content: untrusted("website", leadBlurb) + "\n\nReply with OK." },
    ],
  });
}

function fail(message: string): never {
  console.error(`\nFAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`playbook hash: ${hash}`);

  const { input_tokens: prefixTokens } = await client.messages.countTokens({
    model: MODELS.cheap,
    system,
    messages: [{ role: "user", content: "x" }],
  });
  console.log(`cached prefix: ~${prefixTokens} tokens`);
  if (prefixTokens < MIN_CACHEABLE_TOKENS) {
    fail(
      `prefix is ${prefixTokens} tokens, below the ~${MIN_CACHEABLE_TOKENS} minimum — ` +
        `caching will silently never happen. Add real content to the playbooks.`,
    );
  }

  // Two calls with the SAME prefix and DIFFERENT user content. The second must
  // read from cache; if it does not, something volatile is in the prefix.
  const first = await call("Acme Ltd, 40-person logistics firm, rebranding this year.");
  const second = await call("Beta Co, 12-person dental group, no website to speak of.");

  const written = first.usage.cache_creation_input_tokens ?? 0;
  const read = second.usage.cache_read_input_tokens ?? 0;

  console.log(`call 1: wrote ${written} tokens to cache`);
  console.log(`call 2: read  ${read} tokens from cache, ${second.usage.input_tokens} uncached`);
  console.log(
    `cost: $${(costUsd(MODELS.cheap, first.usage) + costUsd(MODELS.cheap, second.usage)).toFixed(6)}`,
  );

  if (read === 0) {
    fail(
      "call 2 read 0 tokens from cache. A volatile value (timestamp, uuid, per-lead " +
        "field) is in the cached prefix, or the prefix changed between calls.",
    );
  }
  if (read < prefixTokens * 0.8) {
    fail(`only ${read} of ~${prefixTokens} prefix tokens were cached — prefix is unstable`);
  }

  console.log("\nPASS: prompt caching is working.");
}

const NO_CREDENTIAL = /Could not resolve authentication method/i;

main().catch((error: unknown) => {
  // A missing credential surfaces two ways: a client-side resolution failure
  // before any request, or a 401 from the API. Both mean the same thing here.
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Anthropic.AuthenticationError || NO_CREDENTIAL.test(message)) {
    console.error(
      "\nNo Anthropic credential found. Run `ant auth login`, or set ANTHROPIC_API_KEY in .env.",
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});
