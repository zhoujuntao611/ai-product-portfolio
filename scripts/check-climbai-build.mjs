import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(root, 'projects/climbai/dist');
const published = path.join(root, 'docs/climbai');

async function manifest(dir, base = dir) {
  const result = {};
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, await manifest(file, base));
    else result[path.relative(base, file).replaceAll('\\', '/')] =
      createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
  return result;
}

try {
  const [a, b] = await Promise.all([manifest(built), manifest(published)]);
  const differences = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(name => a[name] !== b[name]);
  if (differences.length) {
    console.error('ClimbAI build differs from the committed Pages copy:');
    for (const name of differences) console.error('  ' + name);
    console.error('Rebuild projects/climbai, review the output, then sync dist/ to docs/climbai/ (including obsolete hashed assets).');
    process.exitCode = 1;
  } else console.log(`ClimbAI: ${Object.keys(a).length} built files match docs/climbai byte for byte.`);
} catch (error) {
  console.error('Build ClimbAI first: npm ci && npm run build in projects/climbai.');
  console.error(error.message);
  process.exitCode = 1;
}
