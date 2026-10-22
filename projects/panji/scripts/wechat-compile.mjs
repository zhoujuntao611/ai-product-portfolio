import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const suffix = process.platform === 'win32' ? '.exe' : '';
const candidates = process.env.WECHAT_COMPILER_DIR ? [process.env.WECHAT_COMPILER_DIR] : [];
let base = '';
for (const candidate of candidates) {
  try {
    await Promise.all(['wcc', 'wcsc'].map(name => fs.access(path.join(candidate, name + suffix))));
    base = candidate; break;
  } catch {}
}
if (!base) throw new Error('找不到微信原生编译器。设置 WECHAT_COMPILER_DIR 指向开发者工具的 wcc-exec 目录。');
const app = JSON.parse(await fs.readFile('miniprogram/app.json', 'utf8'));
await fs.mkdir('artifacts/compiler', { recursive: true });
const records = [];
const shared = (await fs.readdir('miniprogram/components',{recursive:true})).filter(name => /\.(wxml|wxss)$/.test(name)).map(name=>name.replaceAll('\\','/'));
for (const [compiler, extension, extra] of [['wcc', 'wxml', []], ['wcsc', 'wxss', ['app.wxss']]]) {
  const binary = path.join(base, compiler + (process.platform === 'win32' ? '.exe' : ''));
  try { await fs.access(binary); } catch { throw new Error('找不到微信原生编译器。设置 WECHAT_COMPILER_DIR 指向开发者工具的 wcc-exec 目录。'); }
  const output = path.resolve('artifacts/compiler/' + compiler + '.js');
  const args = ['-o', output, ...extra, ...shared.filter(name => name.endsWith('.' + extension)).map(name => 'components/' + name), ...app.pages.map(p => p + '.' + extension)];
  const result = spawnSync(binary, args, { cwd: 'miniprogram', encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.status !== 0) { console.error(result.stderr || result.stdout || result.error); process.exit(1); }
  const generated = await fs.stat(output);
  records.push({ compiler, pages: app.pages.length, bytes: generated.size, success: true });
}
await fs.writeFile('artifacts/wechat-compile.json', JSON.stringify({ checkedAt: new Date().toISOString(), compilerDirectory: base, records,
  scope: '微信原生 WXML/WXSS 编译；不等同于 IDE 登录、扫码预览或真机验收' }, null, 2) + '\n');
console.log(`${app.pages.length} 个页面通过微信原生 WXML 与 WXSS 编译。`);
console.log('仍需开发者工具内运行与手机微信扫码验收。');
