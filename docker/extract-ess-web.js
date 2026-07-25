const fs = require("fs");
const path = require("path");

const transcript =
  "C:/Users/91801/.cursor/projects/c-Users-91801-OneDrive-Desktop-My-Lab-System/agent-transcripts/ada874e7-c91a-4024-9cc9-60168beb5035/ada874e7-c91a-4024-9cc9-60168beb5035.jsonl";
const base = "C:/develop/My_Lab_System/health_web_app/src";

const targets = {
  "roles.ts": null,
  "StaffLayout.tsx": null,
};

const rl = require("readline").createInterface({
  input: fs.createReadStream(transcript, { encoding: "utf8" }),
});

rl.on("line", (line) => {
  if (!line.includes("Write")) return;
  if (!line.includes("roles.ts") && !line.includes("StaffLayout")) return;
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
    const p = c.input?.path || "";
    const contents = c.input?.contents;
    if (!contents) continue;
    if (p.endsWith("roles.ts")) targets["roles.ts"] = { p, contents };
    if (p.endsWith("StaffLayout.tsx")) targets["StaffLayout.tsx"] = { p, contents };
  }
});

rl.on("close", () => {
  if (targets["roles.ts"]) {
    fs.mkdirSync(path.join(base, "auth"), { recursive: true });
    let c = targets["roles.ts"].contents;
    if (!c.includes("isHrStaff")) {
      c +=
        "\nexport function isHrStaff(roles: string[] = []) {\n" +
        "  const set = new Set(roles || []);\n" +
        "  return [\n" +
        "    'Phlebotomist',\n" +
        "    'Franchisee Operator',\n" +
        "    'Lab Technician',\n" +
        "    'Health System Admin',\n" +
        "    'System Manager',\n" +
        "    'Pathologist',\n" +
        "    'Sales Representative',\n" +
        "    'Sales Manager',\n" +
        "  ].some((r) => set.has(r));\n" +
        "}\n";
    }
    fs.writeFileSync(path.join(base, "auth", "roles.ts"), c);
    console.log("roles", c.length, "isHrStaff", c.includes("isHrStaff"));
  } else {
    console.log("roles missing");
  }

  if (targets["StaffLayout.tsx"]) {
    fs.mkdirSync(path.join(base, "components"), { recursive: true });
    let c = targets["StaffLayout.tsx"].contents;
    if (!c.includes("isHrStaff")) {
      c = c.replace(
        /import \{([^}]+)\} from ['\"]\.\.\/auth\/roles['\"]/,
        (m, g) => {
          if (g.includes("isHrStaff")) return m;
          return `import {${g.trim().replace(/,$/, "")}, isHrStaff } from '../auth/roles'`;
        }
      );
    }
    if (!c.includes("/dashboard/hr")) {
      const needle = '{isStaff(roles) && <NavLink to="/dashboard/staff">Operations</NavLink>}';
      const insert =
        needle +
        '\n            {isHrStaff(roles) && <NavLink to="/dashboard/hr">HR self-service</NavLink>}';
      if (c.includes(needle)) {
        c = c.replace(needle, insert);
      } else {
        // broader: after franchisee link
        c = c.replace(
          /\{isFranchisee\(roles\) && <NavLink to="\/dashboard\/franchisee">[^<]+<\/NavLink>\}/,
          (m) =>
            m +
            '\n            {isHrStaff(roles) && <NavLink to="/dashboard/hr">HR self-service</NavLink>}'
        );
      }
    }
    fs.writeFileSync(path.join(base, "components", "StaffLayout.tsx"), c);
    console.log(
      "StaffLayout",
      c.length,
      "hr",
      c.includes("/dashboard/hr"),
      "isHrStaff",
      c.includes("isHrStaff")
    );
  } else {
    console.log("StaffLayout missing");
  }
});
