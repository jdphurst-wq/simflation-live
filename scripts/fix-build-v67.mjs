import fs from 'node:fs';

const path = 'scripts/build-v67.mjs';
const lines = fs.readFileSync(path, 'utf8').split('\n');
const matches = lines.map((line,index)=>line.includes('const scripts = [...html.matchAll')?index:-1).filter(index=>index>=0);
if(matches.length!==1)throw new Error(`Expected one parser line, found ${matches.length}`);
lines[matches[0]] = "const scripts = [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)].map(m => m[1]);";
fs.writeFileSync(path, lines.join('\n'));
console.log('Repaired v67 inline-script parser.');
