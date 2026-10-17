// Verifies the API key(s), the chat and embedding models, and each model tier
// (Nano / Super / Ultra), through LangChain:
//   npm run check-api
import { TIERS, config } from "../src/config/index.js";
import { complete, completeJson } from "../src/services/llm.js";
import { getEmbeddings } from "../src/services/embeddings.js";
import { flushAiLog } from "../src/db/aiCalls.js";
import { pool } from "../src/db/pool.js";

async function main() {
  const { chat, embedding, chatModel, embeddingModel, tiers } = config.ai;
  console.log(`Chat:       ${chat.baseUrl}`);
  console.log(`Embeddings: ${embedding.provider}${embedding.baseUrl ? ` (${embedding.baseUrl})` : ""}`);

  process.stdout.write(`Embeddings (${embeddingModel})... `);
  const vector = await getEmbeddings().embedQuery("warm up");
  console.log(`OK — ${vector.length} dimensions`);

  process.stdout.write(`Chat (${chatModel})... `);
  const reply = await complete("You are a terse assistant.", "Reply with the single word: ready", { task: "check_api" });
  console.log(`OK — "${reply}"`);

  // Every tier must answer plain text and JSON (structured output is what the agent relies on).
  let failed = 0;
  for (const tier of TIERS) {
    const s = tiers[tier];
    const label = `${tier[0].toUpperCase()}${tier.slice(1)}`.padEnd(5);
    process.stdout.write(`${label} (${s.model} at ${new URL(s.baseUrl).host}${s.inherited ? ", same as chat" : ""}${s.systemPrefix ? `, prefix "${s.systemPrefix}"` : ""})... `);
    try {
      const text = await complete("You are a terse assistant.", "Reply with the single word: ready", { tier, task: "check_api" });
      const json = await completeJson("You are a terse assistant.", 'Return JSON: {"sum": number} with the sum of 17 and 25.', { tier, task: "check_api" });
      const sum = Number(json?.sum);
      console.log(`OK — "${text.slice(0, 40)}", JSON ${sum === 42 ? "OK" : `returned ${JSON.stringify(json).slice(0, 60)} (expected 42)`}`);
    } catch (err) {
      failed += 1;
      console.log(`FAILED\n   ${err.message}`);
    }
  }
  if (failed) throw new Error(`${failed} model tier(s) failed — see above.`);
}

main()
  .catch((err) => {
    console.error(`\n❌ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushAiLog();
    await pool.end();
  });
