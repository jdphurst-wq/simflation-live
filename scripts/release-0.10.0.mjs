import fs from 'node:fs';

const path = 'scripts/build-v67.mjs';
let text = fs.readFileSync(path, 'utf8');

function replaceIfPresent(before, after, label) {
  if (text.includes(after)) return;
  if (!text.includes(before)) throw new Error(`Missing release patch target: ${label}`);
  text = text.replace(before, after);
}

replaceIfPresent(
  "window.__simflationV67={...window.__simflationV66,modelVersion:'v67'};",
  "window.__simflationV67={...window.__simflationV66,version:'0.10.0',releaseVersion:'0.10.0',modelVersion:'v67'};",
  'v67 release metadata'
);
replaceIfPresent(
  "fs.writeFileSync('SimFlation-0.9.0.html', html);",
  "fs.writeFileSync('SimFlation-0.10.0.html', html);",
  'standalone output filename'
);
replaceIfPresent("  version: '0.9.0',", "  version: '0.10.0',", 'version.json version');
replaceIfPresent("  label: '0.9.0',", "  label: '0.10.0',", 'version.json label');
replaceIfPresent("  standalone: 'SimFlation-0.9.0.html',", "  standalone: 'SimFlation-0.10.0.html',", 'version.json standalone');

const identityMarker = "// 10a. Public release identity for SimFlation 0.10.0.";
if (!text.includes(identityMarker)) {
  const anchor = "// Static parse check every inline script before publishing the generated build.";
  if (!text.includes(anchor)) throw new Error('Missing static-parse anchor for release identity patch');
  const block = `${identityMarker}\nhtml = html.replace('<title>SimFlation 0.9.0</title>', '<title>SimFlation 0.10.0</title>');\nhtml = html.replace('<h1>SimFlation</h1><span class=\"edition-badge\">0.9.0</span>', '<h1>SimFlation</h1><span class=\"edition-badge\">0.10.0</span>');\nhtml = html.replace(\"current.releaseVersion || '0.9.0'\", \"current.releaseVersion || '0.10.0'\");\n\n`;
  text = text.replace(anchor, block + anchor);
}

fs.writeFileSync(path, text);
console.log('SimFlation v67 build now publishes release 0.10.0.');
