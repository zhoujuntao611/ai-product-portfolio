import fs from 'node:fs/promises';
const [appid, cloudEnv = ''] = process.argv.slice(2);
if (!appid || !/^wx[a-f\d]{16}$/i.test(appid)) {
  console.error('用法：npm run configure -- wx开头的真实AppID [云环境ID]');
  process.exit(1);
}
if (cloudEnv && !/^[a-zA-Z0-9-]{1,100}$/.test(cloudEnv)) throw new Error('云环境 ID 格式无效');
const project = JSON.parse(await fs.readFile('project.config.json', 'utf8'));
project.appid = appid;
await fs.writeFile('project.config.json', JSON.stringify(project, null, 2) + '\n');
await fs.writeFile('panji.local.json', JSON.stringify({ appid, cloudEnv }, null, 2) + '\n');
console.log('账号配置已保存。请运行 npm run build，并在微信开发者工具中重新编译。');
