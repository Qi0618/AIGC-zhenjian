// 打包成「解压即用」的压缩包：自带 Node 运行环境，双击启动脚本就能用。
// 用法：npm run package                 打 Mac（Apple 芯片 / Intel）和 Windows 三个包
//       npm run package -- mac-arm64     只打指定的包
// 需要在 Mac 或 Linux 上运行（解压 Node 安装包用到系统自带的 tar、unzip）。
// 环境变量：NODE_DIST_VERSION 指定打包用的 Node 版本；NODE_MIRROR 指定下载源。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const NODE_VER = process.env.NODE_DIST_VERSION || 'v20.18.0';
// 国内访问 nodejs.org 经常不稳定，先试 npmmirror（Node 官方二进制的国内镜像），再试官网。都会用官方 SHASUMS256 校验
const MIRRORS = process.env.NODE_MIRROR ? [process.env.NODE_MIRROR] : ['https://cdn.npmmirror.com/binaries/node', 'https://nodejs.org/dist'];
const CACHE = path.join(ROOT, '.cache', 'node'), DIST = path.join(ROOT, 'dist');
const APP_FILES = ['index.html', 'styles.css', 'app.js', 'package.json', 'README.md', 'server/index.mjs'];

const TARGETS = {
  'mac-arm64': { archive: `node-${NODE_VER}-darwin-arm64.tar.gz`, os: 'mac' },
  'mac-x64': { archive: `node-${NODE_VER}-darwin-x64.tar.gz`, os: 'mac' },
  'win-x64': { archive: `node-${NODE_VER}-win-x64.zip`, os: 'win' },
};

/* ---- 生成 zip：文件名标记为 UTF-8（Windows 解压中文不乱码），并保留可执行权限 ---- */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
async function writeZip(baseDir, rootName, outFile) {
  const entries = [];
  const walk = async rel => {
    const abs = path.join(baseDir, rel), st = await fsp.stat(abs);
    if (st.isDirectory()) { entries.push({ name: rel + '/', dir: true, mode: 0o755, mtime: st.mtime }); for (const n of (await fsp.readdir(abs)).sort()) await walk(rel + '/' + n); }
    else entries.push({ name: rel, abs, mode: st.mode & 0o777, mtime: st.mtime });
  };
  await walk(rootName);
  const out = fs.openSync(outFile, 'w'); let offset = 0; const central = [];
  const write = buf => { fs.writeSync(out, buf); offset += buf.length; };
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), data = e.dir ? Buffer.alloc(0) : fs.readFileSync(e.abs);
    const comp = e.dir ? data : zlib.deflateRawSync(data, { level: 9 }), method = e.dir ? 0 : 8;
    const crc = crc32(data), { time, date } = dosTime(e.mtime), flags = 0x0800; // bit 11 = 文件名是 UTF-8
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const at = offset; write(local); write(name); write(comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE((3 << 8) | 20, 4); /* 3 = Unix，才能带上权限 */ cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(flags, 8); cen.writeUInt16LE(method, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE((((e.dir ? 0o040000 : 0o100000) | e.mode) << 16 | (e.dir ? 0x10 : 0)) >>> 0, 38); cen.writeUInt32LE(at, 42);
    central.push(Buffer.concat([cen, name]));
  }
  const cdStart = offset; for (const c of central) write(c);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16); write(end);
  fs.closeSync(out);
}

const sh = (cmd, args, opt = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opt });
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function download(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const tmp = dest + '.part';
  await fsp.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
  await fsp.rename(tmp, dest);
}
// 下载 Node 并用官方校验和核对；已经下载过且校验通过的直接用缓存
async function fetchNode(archive) {
  await fsp.mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, archive), sums = path.join(CACHE, `SHASUMS256-${NODE_VER}.txt`);
  let lastErr;
  for (const base of MIRRORS) {
    try {
      if (!fs.existsSync(sums)) await download(`${base}/${NODE_VER}/SHASUMS256.txt`, sums);
      const want = fs.readFileSync(sums, 'utf8').split('\n').find(l => l.endsWith('  ' + archive))?.split(' ')[0];
      if (!want) throw new Error('校验文件里没有 ' + archive);
      if (fs.existsSync(file) && sha256(file) === want) return file;
      console.log(`  下载 ${archive}（${base}）…`);
      await download(`${base}/${NODE_VER}/${archive}`, file);
      if (sha256(file) !== want) { fs.rmSync(file); throw new Error(archive + ' 校验失败'); }
      return file;
    } catch (e) { lastErr = e; console.log(`  ${base} 不可用：${e.message}`); fs.rmSync(sums, { force: true }); }
  }
  throw lastErr;
}

const MAC_LAUNCHER = `#!/bin/bash
# 帧间 Zhenjian 启动脚本：双击运行。使用期间不要关闭这个窗口，关闭窗口即退出帧间。
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"
export DATA_DIR="$DIR/data"
export OPEN_BROWSER="\${OPEN_BROWSER:-1}"
export UPSTREAM_TIMEOUT_MS="\${UPSTREAM_TIMEOUT_MS:-600000}"
echo "帧间 Zhenjian ${VERSION}"
echo
exec "$DIR/runtime/node" "$DIR/app/server/index.mjs"
`;
// .bat 用 CRLF 换行；先切到 UTF-8 代码页，后面的中文才能正常显示
const WIN_LAUNCHER = [
  '@echo off',
  'chcp 65001 >nul',
  'cd /d "%~dp0"',
  'title 帧间 Zhenjian',
  'set "DATA_DIR=%~dp0data"',
  'if not defined OPEN_BROWSER set OPEN_BROWSER=1',
  'if not defined UPSTREAM_TIMEOUT_MS set UPSTREAM_TIMEOUT_MS=600000',
  `echo 帧间 Zhenjian ${VERSION}`,
  'echo 使用期间不要关闭这个窗口，关闭窗口即退出帧间。',
  'echo.',
  '"%~dp0runtime\\node.exe" "%~dp0app\\server\\index.mjs"',
  'echo.',
  'echo 帧间已退出。如果上面有报错，可以截图发给提供软件的人。',
  'pause',
  '',
].join('\r\n');

function readme(os) {
  const start = os === 'mac'
    ? `1. 双击「启动帧间.command」。
   第一次打开时，macOS 可能提示「无法打开，因为无法验证开发者」：
   请在文件上点右键 → 打开 → 再点「打开」。以后直接双击即可。`
    : `1. 双击「启动帧间.bat」。
   如果 Windows 弹出「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。
   如果杀毒软件拦截，请选择允许。`;
  const text = `帧间 Zhenjian ${VERSION} 使用说明
==============================

帧间是一个 AI 视觉创作工具：批量生成电商商品图，或者从故事梗概一步步生成短剧。
它运行在你自己的电脑上，用你自己的模型账号生成内容，费用由各平台直接从你的账户扣除。

【开始使用】
${start}
2. 浏览器会自动打开帧间。如果没有自动打开，手动访问启动窗口里显示的地址（通常是 http://localhost:8787）。
3. 第一次使用会进入「设置」页：按页面提示获取并粘贴火山方舟的 API Key，点「测试连接」，再点「保存设置」。
4. 回到「电商图片」或「短剧生成」就可以开始了。

使用期间不要关闭启动窗口；关闭窗口就会退出帧间。下次使用再双击启动即可。
不填密钥也能打开，此时为演示模式：可以体验全部流程，但图片和视频是模拟生成的。

【数据保存在哪里】
所有项目、历史记录、上传和生成的图片视频、密钥，都保存在这个文件夹下的 data 文件夹里。
· 备份或换电脑：复制整个 data 文件夹。
· 升级到新版本：解压新版本后，把旧版本的 data 文件夹复制过去。
· 密钥只保存在本机，不会上传到其他地方。

【常见问题】
· 生成很慢或超时：生图通常 20 秒到 1 分钟，视频要几分钟。网络较慢时请耐心等待。
· 提示「还没有配置」：到左侧「设置」里填写对应的密钥。
· 导出短剧成片：需要电脑上安装了 ffmpeg；没有安装时会改为逐个下载每个镜头的视频。
· 安全：帧间只允许本机访问，同一网络里的其他设备打不开。

本软件附带 Node.js 运行环境（runtime 文件夹），其许可证见 runtime/NODE_LICENSE。
`;
  return os === 'win' ? text.replace(/\n/g, '\r\n') : text;
}

async function build(id) {
  const t = TARGETS[id]; if (!t) throw new Error('不认识的目标：' + id + '，可选 ' + Object.keys(TARGETS).join(' / '));
  console.log(`\n打包 ${id}`);
  const archive = await fetchNode(t.archive);
  const name = `帧间-${VERSION}-${id}`, out = path.join(DIST, 'build', name);
  await fsp.rm(out, { recursive: true, force: true });
  await fsp.mkdir(path.join(out, 'runtime'), { recursive: true });
  for (const f of APP_FILES) {
    const dest = path.join(out, 'app', f);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(path.join(ROOT, f), dest);
  }
  // 只取出 node 可执行文件和许可证
  const inner = t.archive.replace(/\.(tar\.gz|zip)$/, '');
  const tmp = path.join(DIST, 'build', '.extract-' + id);
  await fsp.rm(tmp, { recursive: true, force: true }); await fsp.mkdir(tmp, { recursive: true });
  if (t.os === 'mac') {
    sh('tar', ['-xzf', archive, '-C', tmp, `${inner}/bin/node`, `${inner}/LICENSE`]);
    await fsp.rename(path.join(tmp, inner, 'bin', 'node'), path.join(out, 'runtime', 'node'));
    await fsp.chmod(path.join(out, 'runtime', 'node'), 0o755);
    await fsp.writeFile(path.join(out, '启动帧间.command'), MAC_LAUNCHER, { mode: 0o755 });
  } else {
    sh('unzip', ['-q', '-o', archive, `${inner}/node.exe`, `${inner}/LICENSE`, '-d', tmp]);
    await fsp.rename(path.join(tmp, inner, 'node.exe'), path.join(out, 'runtime', 'node.exe'));
    await fsp.writeFile(path.join(out, '启动帧间.bat'), WIN_LAUNCHER);
  }
  await fsp.rename(path.join(tmp, inner, 'LICENSE'), path.join(out, 'runtime', 'NODE_LICENSE'));
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.writeFile(path.join(out, '使用说明.txt'), readme(t.os));

  const zip = path.join(DIST, name + '.zip');
  await fsp.rm(zip, { force: true });
  await writeZip(path.join(DIST, 'build'), name, zip);
  const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
  console.log(`  完成：dist/${name}.zip（${mb} MB）`);
  return zip;
}

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
for (const id of want) await build(id);
console.log('\n全部完成，压缩包在 dist/ 文件夹里。');
