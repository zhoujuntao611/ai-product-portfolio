import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const app = JSON.parse(await fs.readFile('miniprogram/app.json', 'utf8'));
const project = JSON.parse(await fs.readFile('project.config.json', 'utf8'));
assert.equal(project.projectname, '攀迹'); assert.equal(project.miniprogramRoot, 'miniprogram/');
let checked = 0;
async function readMarkup(file, visited = new Set()) {
  const resolved = path.resolve(file);
  assert.ok(resolved.startsWith(path.resolve('miniprogram') + path.sep), 'WXML include outside mini program');
  if (visited.has(resolved)) return '';
  visited.add(resolved);
  const source = await fs.readFile(resolved, 'utf8');
  const includes = [...source.matchAll(/<(?:include|import)\s+src="([^"]+)"/g)];
  const nested = await Promise.all(includes.map(m => readMarkup(path.resolve(path.dirname(resolved), m[1]), visited)));
  return [source, ...nested].join('\n');
}
for (const page of app.pages) {
  const base = path.join('miniprogram', page);
  for (const ext of ['js', 'json', 'wxml', 'wxss']) await fs.access(`${base}.${ext}`);
  const source = await fs.readFile(base + '.js', 'utf8'); new vm.Script(source, { filename: base + '.js' });
  const markup = await readMarkup(base + '.wxml');
  assert.ok(!/\{\{[^}]*\.\w+\(/.test(markup), page + ' contains a method call unsupported by WXML');
  for (const condition of markup.matchAll(/wx:(?:if|elif)="([^"]*)"/g)) {
    assert.ok(condition[1].startsWith('{{') && condition[1].endsWith('}}'), page + ': conditional expression must use WXML bindings, not a constant string');
  }
  const bindings = [...markup.matchAll(/\b(?:bind|catch):?[a-zA-Z]+="([\w]+)"/g)].map(m => m[1]);
  let definition;
  const wx = { getStorageSync: () => '', getFileSystemManager: () => ({}) };
  const localRequire = createRequire(path.resolve(base + '.js'));
  vm.runInNewContext(source, { Page: p => { definition = p; }, wx, exports: {}, module: { exports: {} }, require: localRequire, setTimeout, clearTimeout });
  for (const binding of bindings) assert.equal(typeof definition?.[binding], 'function', `${page}: missing handler ${binding}`);
  JSON.parse(await fs.readFile(base + '.json', 'utf8')); checked++;
}
const componentFiles = (await fs.readdir('miniprogram/components',{recursive:true})).filter(file=>file.endsWith('.json'));
let componentCount = 0;
for (const file of componentFiles) {
  const base=path.join('miniprogram/components',file.slice(0,-5));
  const config=JSON.parse(await fs.readFile(base+'.json','utf8'));
  if(!config.component)continue;
  const markup=await readMarkup(base+'.wxml');
  await fs.access(base+'.wxss');
  const source=await fs.readFile(base+'.js','utf8');
  let definition;
  vm.runInNewContext(source,{Component:p=>{definition=p;},wx:{},exports:{},module:{exports:{}},require:createRequire(path.resolve(base+'.js'))});
  for(const match of markup.matchAll(/\b(?:bind|catch):?[a-zA-Z]+="([\w]+)"/g))assert.equal(typeof definition?.methods?.[match[1]],'function',`${file}: missing component handler ${match[1]}`);
  componentCount++;
}
for (const tab of app.tabBar.list) for (const key of ['iconPath', 'selectedIconPath']) await fs.access(path.join('miniprogram', tab[key]));
const files = await fs.readdir('miniprogram'); assert.ok(!files.includes('node_modules'));
const packageFiles = await fs.readdir('miniprogram', { recursive: true, withFileTypes: true });
let packageBytes=0;
for (const file of packageFiles.filter(f=>f.isFile())) packageBytes+=(await fs.stat(path.join(file.parentPath,file.name))).size;
assert.ok(packageBytes < 2*1024*1024, `小程序主包过大：${packageBytes} bytes`);
for (const page of app.pages) {
  const source=await fs.readFile(path.join('miniprogram',page+'.js'),'utf8');
  assert.ok(!source.includes('"banana-bj-xiaoyuehe"'), `${page}: public catalog duplicated in page bundle`);
}
console.log(`主包文件共 ${packageBytes} 字节，公开名录单独共享。`);
console.log(`已核对 ${checked} 个页面的文件、事件绑定、JS 语法、图标和项目配置。`);
console.log(`已核对 ${componentCount} 个自定义组件的文件和全部事件绑定。`);
console.log('注意：这些检查不能替代微信编译、扫码预览或真机验收。');
