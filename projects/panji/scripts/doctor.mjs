import fs from 'node:fs/promises';
import path from 'node:path';
const project = JSON.parse(await fs.readFile('project.config.json', 'utf8'));
let local = {}; try { local = JSON.parse(await fs.readFile('panji.local.json', 'utf8')); } catch {}
const candidates = [process.env.WECHAT_DEVTOOLS_CLI,
  ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean).map(base => path.join(base, 'Tencent', '微信web开发者工具', 'cli.bat')),
].filter(Boolean);
let cli = '';
for (const candidate of candidates) { try { await fs.access(candidate); cli = candidate; break; } catch {} }
console.log('项目：攀迹');
console.log('目录：' + process.cwd());
console.log('AppID：' + (project.appid === 'touristappid' ? '未配置，当前为游客工程，不能生成正式真机预览码' : '已配置'));
console.log('云环境：' + (local.cloudEnv ? '已配置；仍需核对部署与规则' : '未配置，本机记录可开发调试'));
console.log('开发者工具：' + (cli || '未发现；请安装微信开发者工具'));
try { await fs.access('miniprogram/app.json'); console.log('小程序代码：已构建'); } catch { console.log('小程序代码：请先运行 npm run build'); }
console.log('微信真机打开：需要真实 AppID、开发者权限、工具登录和扫码预览验证；当前不据文件存在判断完成。');
