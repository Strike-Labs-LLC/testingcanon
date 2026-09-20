import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const htmlPath = path.resolve(process.cwd(), "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

test("Criterion 1: Rocket and asteroid elements animate on intersecting trajectories", () => {
  // DOM elements existence
  assert.match(html, /<span\s+id="rocket"\s+class="rocket"\s+role="img"\s+aria-label="rocket ship">🚀<\/span>/);
  assert.match(html, /<span\s+id="asteroid"\s+class="asteroid"\s+role="img"\s+aria-label="asteroid">☄️<\/span>/);
  assert.match(html, /<button\s+id="launchButton"\s+type="button">Launch Rocket<\/button>/);

  // CSS animation bindings
  assert.match(html, /\.rocket\.launch\s*\{[^}]*animation:\s*blastoff\s+1\.5s\s+ease-in\s+forwards;/);
  assert.match(html, /\.asteroid\.launch\s*\{[^}]*animation:\s*asteroid-entry\s+1\.5s\s+ease-in\s+forwards;/);

  // Keyframe trajectory definitions
  assert.match(html, /@keyframes\s+blastoff\s*\{/);
  assert.match(html, /@keyframes\s+asteroid-entry\s*\{/);

  // Verify JS launch handler triggers rocket and asteroid animation
  assert.match(html, /const\s+animatedElements\s*=\s*\[rocket,\s*asteroid,\s*explosion\];/);
  assert.match(html, /animatedElements\.forEach\(\(el\)\s*=>\s*el\.classList\.add\("launch"\)\);/);
});

test("Criterion 2: Impact collision and visual explosion trigger at contact point", () => {
  // DOM element for explosion
  assert.match(html, /<span\s+id="explosion"\s+class="explosion"\s+role="img"\s+aria-label="explosion">💥<\/span>/);

  // CSS animation binding for explosion
  assert.match(html, /\.explosion\.launch\s*\{[^}]*animation:\s*explode\s+1\.5s\s+ease-out\s+forwards;/);

  // Explosion keyframe definition with collision timing (67%)
  assert.match(html, /@keyframes\s+explode\s*\{/);
  assert.match(html, /67%\s*\{[^}]*transform:\s*translateX\(-50%\)\s*scale\(1\.2\);\s*opacity:\s*1;/);

  // Timeline synchronization at collision point (66%/67%)
  assert.match(html, /66%\s*\{[^}]*transform:\s*translate\(-50%,\s*-70px\);\s*opacity:\s*1;/); // blastoff contact
  assert.match(html, /66%\s*\{[^}]*transform:\s*translate\(-55px,\s*65px\);\s*opacity:\s*1;/); // asteroid contact
});

test("Criterion 3: Rocket and asteroid visually hide post-collision with clean DOM and zero errors", () => {
  // Rocket and asteroid post-collision opacity (67%-100% opacity: 0)
  assert.match(html, /67%,\s*100%\s*\{[^}]*transform:\s*translate\(-50%,\s*-70px\);\s*opacity:\s*0;/);
  assert.match(html, /67%,\s*100%\s*\{[^}]*transform:\s*translate\(-55px,\s*65px\);\s*opacity:\s*0;/);

  // Explosion fade out at 100%
  assert.match(html, /100%\s*\{[^}]*transform:\s*translateX\(-50%\)\s*scale\(2\);\s*opacity:\s*0;/);

  // Run html-validate and linkinator to ensure zero console/syntax errors
  const htmlValidateOutput = execSync('npx --yes html-validate "**/*.html"').toString();
  assert.match(htmlValidateOutput, /0 errors/);

  // linkinator returns exit code 0 if all links are valid
  assert.doesNotThrow(() => {
    execSync('npx --yes linkinator . --recurse --silent --skip "^https?://" --skip "node_modules|[.]canon|[.]sdlc"');
  });
});

test("Criterion 4: Animation state cleanly resets for repeated launches", () => {
  // Verify click event removes launch class, triggers reflow, and re-adds launch class
  assert.match(html, /launchButton\.addEventListener\("click",\s*\(\)\s*=>\s*\{/);
  assert.match(html, /animatedElements\.forEach\(\(el\)\s*=>\s*el\.classList\.remove\("launch"\)\);/);
  assert.match(html, /void\s+rocket\.offsetWidth;/);
  assert.match(html, /animatedElements\.forEach\(\(el\)\s*=>\s*el\.classList\.add\("launch"\)\);/);
});

test("Criterion 5: Accessibility prefers-reduced-motion suppresses high motion", () => {
  // Verify prefers-reduced-motion media query
  assert.match(html, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{/);
  assert.match(html, /\.rocket\.launch,\s*[\r\n\s]*\.asteroid\.launch,\s*[\r\n\s]*\.explosion\.launch\s*\{[^}]*animation:\s*none;/);

  // Reduced motion opacity overrides
  assert.match(html, /\.rocket\.launch\s*\{[^}]*opacity:\s*0;/);
  assert.match(html, /\.asteroid\.launch\s*\{[^}]*opacity:\s*0;/);
  assert.match(html, /\.explosion\.launch\s*\{[^}]*opacity:\s*1;/);
});
