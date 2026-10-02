// Ingests local files into a new notebook for an existing user:
//   node scripts/createDatabase.js you@gmail.com path/to/a.pdf [path/to/b.docx ...]
// (sign in with Google once first so the user exists). Prints the notebook id
// to use with scripts/cliChat.js.
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../src/db/pool.js";
import { addNotebook, addSource, getSource, getUserByEmail } from "../src/db/store.js";
import { extractText } from "../src/services/ingestion.js";
import { processSource } from "../src/services/sourceProcessor.js";

async function main() {
  const [email, ...files] = process.argv.slice(2);
  if (!email || files.length === 0) {
    console.error("Usage: node scripts/createDatabase.js <user-email> <file-path> [more files...]");
    process.exit(1);
  }
  const user = await getUserByEmail(email);
  if (!user) throw new Error(`No user with email ${email}. Sign in with Google in the web app first.`);

  const notebook = await addNotebook({ userId: user.id, title: path.basename(files[0]), titleIsAuto: true });

  for (const filePath of files) {
    const id = uuidv4();
    const title = path.basename(filePath);
    await addSource({ id, notebookId: notebook.id, type: "file", title, fileName: title, fileType: path.extname(title).slice(1) });
    console.log(`Ingesting ${title}...`);
    await processSource(id, async () => ({ text: await extractText(filePath) }));
    const source = await getSource(id);
    console.log(source.status === "ready" ? `  ✅ ${source.chunkCount} chunks` : `  ❌ ${source.error}`);
  }

  console.log(`\nNotebook id = ${notebook.id}`);
  console.log(`Chat with it: npm run cli-chat -- ${notebook.id}`);
  // Give the background overview job a moment before closing the pool.
  setTimeout(() => pool.end(), 3000);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
