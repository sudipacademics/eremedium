/**
 * Restore health_web_app source files from the agent transcript (latest Write per path).
 */
const fs = require("fs");
const path = require("path");

const transcript =
  process.argv[2] ||
  "C:/Users/91801/.cursor/projects/c-Users-91801-OneDrive-Desktop-My-Lab-System/agent-transcripts/ada874e7-c91a-4024-9cc9-60168beb5035/ada874e7-c91a-4024-9cc9-60168beb5035.jsonl";
const outRoot = process.argv[3] || "C:/develop/My_Lab_System";

const latest = new Map(); // relPath -> {contents, line}

const rl = require("readline").createInterface({
  input: fs.createReadStream(transcript, { encoding: "utf8" }),
});

let lineNo = 0;
rl.on("line", (line) => {
  lineNo++;
  if (!line.includes("health_web_app") || !line.includes("Write")) return;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }
  const content = obj?.message?.content;
  if (!Array.isArray(content)) return;
  for (const c of content) {
    if (c?.type !== "tool_use" || c?.name !== "Write") continue;
    const p = (c.input?.path || "").replace(/\\/g, "/");
    const contents = c.input?.contents;
    if (!contents || !p.includes("health_web_app/")) continue;
    const idx = p.indexOf("health_web_app/");
    const rel = p.slice(idx);
    latest.set(rel, { contents, line: lineNo });
  }
});

rl.on("close", () => {
  let written = 0;
  for (const [rel, { contents, line }] of latest) {
    const full = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    // Don't overwrite App.tsx / api.ts if local is newer/larger unless missing
    if (fs.existsSync(full)) {
      const cur = fs.readFileSync(full, "utf8");
      if (cur.length >= contents.length && !rel.includes("HrSelfService") && !rel.includes("StaffLayout") && !rel.includes("roles.ts")) {
        continue;
      }
    }
    fs.writeFileSync(full, contents);
    written++;
    console.log("WROTE", rel, "from line", line, "len", contents.length);
  }
  console.log("TOTAL_CANDIDATES", latest.size, "WRITTEN", written);
});
