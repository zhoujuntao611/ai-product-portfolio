import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const root = process.cwd();
const {version}=JSON.parse(await fs.readFile('package.json','utf8'));
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = await Promise.all(entries.map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name)));
  return results.flat();
}
const files = await walk('src/miniprogram');
const hash = createHash('sha256');
for (const file of [...files, ...(await walk('src/shared')), 'src/config.ts'].sort()) {
  hash.update(file.replaceAll('\\','/')); hash.update(await fs.readFile(file));
}
const buildId = hash.digest('hex').slice(0, 8);
await fs.mkdir('miniprogram', { recursive: true });
for (const file of files.filter(f => !f.endsWith('.ts'))) {
  const target = path.join('miniprogram', path.relative('src/miniprogram', file));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(file, target);
}
let local = {};
try { local = JSON.parse(await fs.readFile('panji.local.json', 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const entries = files.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
// Native mini programs do not support esbuild code splitting. Keep growing public
// datasets in shared CommonJS modules, rather than copying them into every page.
const sharedData = new Map([
  [path.resolve('src/shared/gym-catalog-data.json'), 'shared/gym-catalog-data.js'],
  [path.resolve('infrastructure/gym-catalog-osm.json'), 'shared/gym-catalog-osm.js'],
]);
for (const [source, target] of sharedData) {
  const value = JSON.parse(await fs.readFile(source, 'utf8'));
  await fs.mkdir(path.dirname(path.join('miniprogram', target)), { recursive: true });
  await fs.writeFile(path.join('miniprogram', target), 'module.exports=' + JSON.stringify(value) + ';\n');
}
await Promise.all(entries.map(entry => {
  const output = path.join('miniprogram', path.relative('src/miniprogram', entry)).replace(/\.ts$/, '.js');
  return build({ entryPoints: [entry], outfile: output, bundle: true,
    platform: 'neutral', format: 'cjs', target: 'es2017', charset: 'utf8',
    define: { PANJI_CLOUD_ENV: JSON.stringify(local.cloudEnv || ''), PANJI_BUILD_ID: JSON.stringify(buildId) },
    plugins: [{ name: 'shared-public-data', setup(builder) {
      builder.onResolve({ filter: /gym-catalog-(data|osm)\.json$/ }, args => {
        const target = sharedData.get(path.resolve(args.resolveDir, args.path));
        if (!target) return;
        let relative = path.relative(path.dirname(output), path.join('miniprogram', target)).replaceAll('\\', '/');
        if (!relative.startsWith('.')) relative = './' + relative;
        return { path: relative, external: true };
      });
    } }],
  });
}));
await build({ entryPoints: ['cloudfunctions/panji/main.ts'], outfile: 'cloudfunctions/panji/index.js',
  bundle: true, platform: 'node', target: 'node18', format: 'cjs', charset: 'utf8', external: ['wx-server-sdk', '@cloudbase/node-sdk', '@cloudbase/manager-node'] });
await build({ entryPoints: ['cloudfunctions/panji/main.ts'], outfile: 'cloudfunctions/panjiV2/index.js',
  bundle: true, platform: 'node', target: 'node20', format: 'cjs', charset: 'utf8', external: ['wx-server-sdk', '@cloudbase/node-sdk', '@cloudbase/manager-node'] });
console.log('攀迹构建完成。导入目录：' + root);
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/build-release.json', JSON.stringify({version,build:buildId},null,2)+'\n');
console.log('预览版本：'+version+' · '+buildId);
console.log(local.cloudEnv ? '已配置云环境；首次进入由用户主动选择开通云端记录。' : '未配置云环境；可使用本机记录，不会发送训练数据。');
