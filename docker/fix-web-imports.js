/**
 * Fix relative imports in nested pages that were restored with wrong ../ depth.
 * Only touches known nested folders under src/pages and src/components issues listed.
 */
const fs = require("fs");
const path = require("path");

const root = "C:/develop/My_Lab_System/health_web_app/src";
const nestedPrefixes = [
  "pages/dashboard/",
  "pages/b2b/",
  "pages/sales/",
  "pages/wellness/",
];

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx?)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const replacements = [
  [/from ['"]\.\.\/api['"]/g, "from '../../api'"],
  [/from ['"]\.\.\/auth\//g, "from '../../auth/"],
  [/from ['"]\.\.\/config['"]/g, "from '../../config'"],
  [/from ['"]\.\.\/hooks\//g, "from '../../hooks/"],
  [/from ['"]\.\.\/payments\//g, "from '../../payments/"],
  [/from ['"]\.\.\/components\//g, "from '../../components/"],
  [/from ['"]\.\.\/types\//g, "from '../../types/"],
  [/from ['"]\.\.\/cart\//g, "from '../../cart/"],
];

let fixed = 0;
for (const f of walk(root)) {
  const rel = path.relative(root, f).replace(/\\/g, "/");
  if (!nestedPrefixes.some((p) => rel.startsWith(p))) continue;
  let c = fs.readFileSync(f, "utf8");
  const orig = c;
  for (const [re, to] of replacements) c = c.replace(re, to);
  if (c !== orig) {
    fs.writeFileSync(f, c);
    fixed++;
    console.log("fixed", rel);
  }
}

// ComplaintPage incorrectly used ../../api from pages/
const complaint = path.join(root, "pages/ComplaintPage.tsx");
if (fs.existsSync(complaint)) {
  let c = fs.readFileSync(complaint, "utf8");
  const n = c.replace(/from ['"]\.\.\/\.\.\/api['"]/g, "from '../api'");
  if (n !== c) {
    fs.writeFileSync(complaint, n);
    console.log("fixed pages/ComplaintPage.tsx");
    fixed++;
  }
}

console.log("files_fixed", fixed);
