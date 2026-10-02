// Terminal chat against a notebook's sources, run as:
//   node scripts/cliChat.js <notebookId>
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getNotebook, listSources } from "../src/db/store.js";
import { pool } from "../src/db/pool.js";
import { answerQuestionText } from "../src/services/ragService.js";

async function main() {
  const notebookId = process.argv[2];
  if (!notebookId) {
    console.error("Usage: node scripts/cliChat.js <notebookId>");
    console.error("(notebookId comes from scripts/createDatabase.js or GET /api/notebooks)");
    process.exit(1);
  }

  const notebook = await getNotebook(notebookId);
  if (!notebook) throw new Error(`Notebook ${notebookId} not found.`);
  const sources = (await listSources(notebookId)).filter((s) => s.status === "ready");
  if (sources.length === 0) throw new Error("This notebook has no ready sources.");

  console.log(`Chatting with "${notebook.title}" (${sources.length} sources). Press 0 to exit.`);

  const rl = readline.createInterface({ input, output });
  const history = [];

  while (true) {
    const question = await rl.question("You : ");
    if (question === "0") break;

    const { content, citations } = await answerQuestionText({ sources, question, history });
    console.log(`\n AI: ${content}\n`);
    for (const c of citations) console.log(`   [${c.number}] ${c.sourceTitle}, chunk ${c.chunk}`);
    console.log();

    history.push({ role: "user", content: question }, { role: "assistant", content });
  }

  rl.close();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
