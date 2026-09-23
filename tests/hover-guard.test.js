const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("all :hover rules are inside @media (hover: hover)", async () => {
  const { transform } = await import("../tools/fix-hover.mjs");
  for (const f of fs.readdirSync("css").filter(f => f.endsWith(".css"))) {
    const src = fs.readFileSync(path.join("css", f), "utf8");
    assert.strictEqual(transform(src), src, `${f}: run node tools/fix-hover.mjs`);
  }
});

test("tap highlight disabled globally", () => {
  assert.match(fs.readFileSync("css/base.css", "utf8"), /html, body, \* \{ -webkit-tap-highlight-color: transparent; \}/);
});
