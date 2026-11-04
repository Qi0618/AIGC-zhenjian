// 把本机的两个样例项目整理成内置样例（samples/ 文件夹），打包后不填密钥也能看到真实效果。
// 用法：FFMPEG_PATH=/path/to/ffmpeg node scripts/build-samples.mjs [--film /files/xxx.mp4]
//   - 从 data/store 里找名为「样例 · 美妆三件套」和「样例 · 重回发布会」的项目
//   - 把它们用到的图片、视频压缩后复制到 samples/，改写成 samples/ 下的相对地址
//   - --film 指定已经合成好的成片，一起放进去，演示模式下可以直接观看
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const OUT = path.join(ROOT, 'samples');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const NAMES = { shop: '样例 · 美妆三件套', drama: '样例 · 重回发布会' };
const filmArg = process.argv.indexOf('--film');
const FILM = filmArg > 0 ? process.argv[filmArg + 1] : null;

const projects = fs.readdirSync(path.join(DATA, 'store', 'projects')).map(f => JSON.parse(fs.readFileSync(path.join(DATA, 'store', 'projects', f), 'utf8')));
const pick = name => { const p = projects.find(x => x.name === name); if (!p) throw new Error('找不到项目：' + name); return p; };

await fsp.rm(OUT, { recursive: true, force: true });
await fsp.mkdir(OUT, { recursive: true });
const done = new Map();
let bytes = 0;
// 图片：最长边 1080，JPEG；视频：720p，CRF 28，AAC 96k（样例够看，体积小很多）
function convert(url) {
  if (done.has(url)) return done.get(url);
  const src = path.join(DATA, 'files', path.basename(url)), isVideo = url.endsWith('.mp4');
  if (!fs.existsSync(src)) throw new Error('文件不存在：' + url);
  const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12) + (isVideo ? '.mp4' : '.jpg'), dest = path.join(OUT, name);
  const args = isVideo
    ? ['-i', src, '-vf', "scale='min(720,iw)':-2", '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', dest]
    : ['-i', src, '-vf', "scale='if(gt(iw,ih),min(1080,iw),-2)':'if(gt(iw,ih),-2,min(1080,ih))'", '-q:v', '4', dest];
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  bytes += fs.statSync(dest).size;
  const rel = 'samples/' + name; done.set(url, rel); return rel;
}
// 把对象里所有 /files/ 地址换成样例地址，并去掉只在生成过程中用的字段
const DROP = new Set(['sel', 'dirty', 'busy', 'vTask', 'vPaid', 'vRun', 'vAt', 'kfPaid', 'kfPrev', 'kfJob', 'p', 'kp', 'src', 'pendingCost']);
function rewrite(v) {
  if (Array.isArray(v)) return v.map(rewrite);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!DROP.has(k)) o[k] = rewrite(x);
    return o;
  }
  if (typeof v === 'string' && /^\/files\/[a-z0-9]+\.(jpg|png|webp|mp4)$/.test(v)) return convert(v);
  return v;
}

const shop = pick(NAMES.shop), drama = pick(NAMES.drama);
const shopState = rewrite(shop.state);
shopState.results = (shopState.results || []).filter(r => r.url); // 只要真实生成的图
const dramaState = rewrite(drama.state);
dramaState.step = 4; dramaState.maxStep = 4; dramaState.time = 0;
const manifest = {
  version: 1,
  shop: { name: NAMES.shop, state: shopState },
  drama: { name: NAMES.drama, state: dramaState, film: FILM ? convert(FILM) : null },
};
await fsp.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
console.log(`样例已生成：${done.size} 个文件，共 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  电商：${shopState.skus.length} 个商品、${shopState.results.length} 张图；短剧：${dramaState.shots.length} 个镜头、${dramaState.shots.filter(s => s.videoUrl).length} 段视频${FILM ? '、1 部成片' : ''}`);
