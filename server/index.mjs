// 帧间 Zhenjian 后端：托管前端页面 + 代理模型接口（密钥只放在服务器上）
// 运行：node server/index.mjs   （Node 18+，无第三方依赖）
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));

const CFG = {
  port: +(process.env.PORT || 8787),
  // 默认只监听本机：这是装在自己电脑上用的软件，局域网里的其他设备连不上，避免 Key 被别人用
  host: process.env.HOST || '127.0.0.1',
  arkBase: (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, ''),
  deepseekBase: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
  imageModel: process.env.ARK_IMAGE_MODEL || 'doubao-seedream-4-0-20260415',
  seedanceModel: process.env.ARK_VIDEO_MODEL || 'doubao-seedance-2-0-mini-260615',
  seedanceRes: process.env.ARK_VIDEO_RESOLUTION || '720p',
  klingBase: (process.env.KLING_BASE_URL || 'https://api-beijing.klingai.com').replace(/\/$/, ''),
  klingModel: process.env.KLING_MODEL || 'kling-v2-5-turbo',
  klingMode: process.env.KLING_MODE || 'pro', // pro = 1080p
  accessToken: process.env.ACCESS_TOKEN || '',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
};
const FILES = path.join(CFG.dataDir, 'files');
fs.mkdirSync(FILES, { recursive: true });

/* ---------------- 密钥：网页「设置」里保存的优先，其次是 .env / 环境变量 ---------------- */
const SETTINGS_FILE = path.join(CFG.dataDir, 'settings.json');
export const KEY_FIELDS = { ark: 'ARK_API_KEY', deepseek: 'DEEPSEEK_API_KEY', klingAk: 'KLING_ACCESS_KEY', klingSk: 'KLING_SECRET_KEY' };
let SAVED = {};
try { SAVED = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; } catch {}
// 设置里存了空字符串表示「清除」，此时也不再回落到 .env
const keyOf = k => String((k in SAVED ? SAVED[k] : process.env[KEY_FIELDS[k]]) || '').trim();
function applyKeys() {
  CFG.arkKey = keyOf('ark'); CFG.klingAk = keyOf('klingAk'); CFG.klingSk = keyOf('klingSk');
  // 分镜：填了 DeepSeek 的 Key 就走 DeepSeek 官方接口，否则走火山方舟
  const ds = keyOf('deepseek');
  CFG.llmKey = ds || CFG.arkKey;
  CFG.llmBase = ds ? CFG.deepseekBase : CFG.arkBase;
  CFG.llmModel = ds ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat') : (process.env.ARK_LLM_MODEL || 'deepseek-v4-1-flash-260910');
}
applyKeys();
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;

/* ---------------- 小工具 ---------------- */
function loadEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
// 页面上不显示具体用的哪家模型：缺配置时只告诉用户「暂未开通」，具体缺哪个密钥写到服务器日志里
const need = (ok, what, label) => {
  if (ok) return;
  console.warn(`${what} 未配置，可以在网页「设置」里填写`);
  throw new HttpError(503, `${label}还没有配置，请到「设置」里填写密钥`);
};
const newId = () => Date.now().toString(36) + crypto.randomBytes(5).toString('hex');

async function readJson(req, limit = 40 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, '请求太大'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, '请求格式不是 JSON'); }
}
const SAFE_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
function send(res, status, body) {
  res.writeHead(status, { ...SAFE_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
// 口令比较用定长时间，避免按响应时间逐位猜口令
function tokenOk(got) {
  const a = Buffer.from(String(got || '')), b = Buffer.from(CFG.accessToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const UPSTREAM_TIMEOUT = +(process.env.UPSTREAM_TIMEOUT_MS || 180000);
// 超时从发请求一直算到读完响应体：图片结果有 1~2 MB，网速慢时主要耗在下载上
async function fetchBody(url, opt, label, as = 'text') {
  try {
    const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) });
    return { r, body: as === 'buffer' ? Buffer.from(await r.arrayBuffer()) : await r.text() };
  } catch (e) {
    if (e.name === 'TimeoutError') throw new HttpError(504, `${label} 超过 ${Math.round(UPSTREAM_TIMEOUT / 1000)} 秒没有完成，网络较慢时可以在 .env 里调大 UPSTREAM_TIMEOUT_MS`);
    throw new HttpError(502, `${label} 连接失败：${e.message}`);
  }
}
async function upstream(url, opt, label) {
  const { r, body: text } = await fetchBody(url, opt, label);
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 500) }; }
  if (!r.ok || (j && j.error)) {
    const msg = j?.error?.message || j?.message || j?.raw || r.statusText;
    throw new HttpError(r.status >= 400 && r.status < 500 ? 400 : 502, `${label} 返回错误：${msg}`);
  }
  return j;
}
async function saveFile(buf, ext) { const name = newId() + '.' + ext; await fsp.writeFile(path.join(FILES, name), buf); return '/files/' + name; }
function extOf(buf) { return buf[0] === 0x89 ? 'png' : buf[0] === 0xff ? 'jpg' : buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : 'png'; }
// 下载生成结果（图片 / 视频）。网络不稳时连接可能传到一半被断开，
// 这里会用 Range 从断开处接着下载，最多重试 DOWNLOAD_RETRIES 次
const DOWNLOAD_RETRIES = +(process.env.DOWNLOAD_RETRIES || 5);
export async function downloadBuffer(url) {
  const chunks = []; let got = 0, total = null, lastErr;
  for (let attempt = 0; attempt <= DOWNLOAD_RETRIES; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, Math.min(8000, 1000 * attempt)));
    try {
      const r = await fetch(url, { headers: got ? { range: `bytes=${got}-` } : {}, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) });
      if (r.status === 416 && total !== null && got >= total) break;
      if (!r.ok) {
        const err = new HttpError(502, '下载生成结果失败（' + r.status + '）');
        err.noRetry = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429; // 如链接过期
        throw err;
      }
      if (got && r.status !== 206) { chunks.length = 0; got = 0; } // 不支持断点续传，只能从头来
      if (total === null) {
        const cr = r.headers.get('content-range'), cl = r.headers.get('content-length');
        total = cr ? +cr.split('/')[1] || null : cl ? got + +cl : null;
      }
      for await (const c of r.body) { chunks.push(c); got += c.length; }
      if (total === null || got >= total) return Buffer.concat(chunks);
      lastErr = new Error('连接提前结束');
    } catch (e) {
      if (e.noRetry) throw e;
      lastErr = e;
    }
  }
  if (total !== null && got >= total) return Buffer.concat(chunks);
  throw new HttpError(502, `下载生成结果失败：重试 ${DOWNLOAD_RETRIES} 次后仍未完成（已下载 ${Math.round(got / 1024)} KB${total ? ' / ' + Math.round(total / 1024) + ' KB' : ''}）：${lastErr?.message || ''}`);
}
async function download(url, ext) {
  const buf = await downloadBuffer(url);
  return saveFile(buf, ext || extOf(buf));
}
// 前端传来的图片：data URI 原样转发；/files/xxx 读本地文件转成 data URI
async function toDataUri(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('/files/')) {
    const f = path.join(FILES, path.basename(src)); const buf = await fsp.readFile(f).catch(() => null);
    if (!buf) throw new HttpError(400, '参考图已不存在：' + src);
    const ext = extOf(buf); return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + buf.toString('base64');
  }
  if (/^https?:\/\//.test(src)) return src;
  throw new HttpError(400, '无法识别的图片地址');
}

/* ---------------- 生图：Seedream 4.0 ---------------- */
// Seedream 4.0 要求总像素在 1280×720 ~ 4096×4096 之间。先按目标比例生成高清图，前端再精确裁成目标尺寸。
export function seedreamSize(w, h) {
  const area = w * h, lo = 1280 * 720, hi = 2048 * 2048, target = Math.min(hi, Math.max(lo * 1.1, area));
  let k = Math.sqrt(target / area), W = Math.round(w * k), H = Math.round(h * k);
  const r = W / H; if (r > 16) H = Math.ceil(W / 16); if (r < 1 / 16) W = Math.ceil(H / 16);
  return `${W}x${H}`;
}
async function genImage({ prompt, images = [], width = 1024, height = 1024 }) {
  need(CFG.arkKey, '火山方舟 ARK_API_KEY', '生图服务');
  if (!prompt) throw new HttpError(400, '缺少提示词');
  const refs = (await Promise.all(images.slice(0, 6).map(toDataUri))).filter(Boolean);
  const body = { model: CFG.imageModel, prompt, size: seedreamSize(width, height), response_format: 'url', watermark: false };
  // 用 url 而不是 b64_json：接口在图片生成好后马上返回，图片本身再单独下载（可以断点续传）
  if (refs.length) body.image = refs.length === 1 ? refs[0] : refs;
  const j = await upstream(CFG.arkBase + '/images/generations', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CFG.arkKey }, body: JSON.stringify(body),
  }, '生图服务');
  const d = j.data?.[0]; if (!d) throw new HttpError(502, '生图服务没有返回图片，请重试');
  const url = d.b64_json ? await saveFile(Buffer.from(d.b64_json, 'base64'), 'jpg') : await download(d.url);
  return { url, model: CFG.imageModel };
}

/* ---------------- 分镜脚本：DeepSeek V4.1 Flash ---------------- */
const SB_SYS = '你是短剧分镜编剧。只输出 JSON，不要任何解释或 Markdown。';
function storyBrief(s) {
  const chars = (s.chars || []).map((c, i) => `${i}. ${c.name}（${[c.role, c.look].filter(Boolean).join('，')}）`).join('\n') || '（无）';
  return `类型：${s.genre || ''}\n片名：${s.title || ''}\n梗概：${s.syn || ''}\n角色（序号. 名字）：\n${chars}`;
}
function shotRules(E) {
  const moodList = (E.moods || []).map(k => (E.moodNames && E.moodNames[k] ? `${k}（${E.moodNames[k]}）` : k)).join('/');
  return `取值限制：scale 只能是 ${(E.scales || []).join('/')}；mood 只能是 ${moodList}（填括号前的英文）；cam 只能是 ${(E.cams || []).join('/')}；dur 为 2~8 的整数；cast 为上面角色序号组成的数组，最多 3 个。`;
}
const SHOT_FMT = '{"scale":"景别","mood":"光线","cam":"运镜","desc":"画面描述，一两句，写清人物动作和环境","line":"台词或旁白，没有就空字符串","dur":秒数,"cast":[出镜角色序号]}';
// 模型输出不一定守规矩：取值不在枚举里就用默认值，长度和时长都截断到合理范围
export function normalizeShot(x, E = {}, nChars = 0) {
  x = x || {};
  const pick = (v, list, d) => (list && list.includes(v) ? v : d);
  return {
    scale: pick(x.scale, E.scales, (E.scales || [])[2] || '中景'),
    mood: pick(x.mood, E.moods, (E.moods || [])[0] || 'night'),
    cam: pick(x.cam, E.cams, (E.cams || [])[0] || '固定'),
    desc: String(x.desc || '').slice(0, 200), line: String(x.line || '').slice(0, 60),
    dur: Math.max(2, Math.min(8, Math.round(+x.dur || 3))),
    cast: [...new Set((Array.isArray(x.cast) ? x.cast : []).map(Number))].filter(i => Number.isInteger(i) && i >= 0 && i < nChars).slice(0, 3),
  };
}
export function parseJsonReply(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : text); } catch { throw new HttpError(502, '分镜结果格式不对，请重试'); }
}
async function chat(user, temperature = 0.8) {
  need(CFG.llmKey, '分镜模型密钥（ARK_API_KEY 或 DEEPSEEK_API_KEY）', '分镜服务');
  const j = await upstream(CFG.llmBase + '/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CFG.llmKey },
    body: JSON.stringify({ model: CFG.llmModel, temperature, messages: [{ role: 'system', content: SB_SYS }, { role: 'user', content: user }] }),
  }, '分镜服务');
  return { out: parseJsonReply(j.choices?.[0]?.message?.content), usage: j.usage };
}
async function genStoryboard({ story, enums }) {
  const s = story || {}, E = enums || {};
  const user = `为一部${s.len || 30}秒的${s.ratio === '16:9' ? '横屏' : '竖屏'}短剧写分镜脚本，正好 ${s.nShots || 8} 个镜头，镜头时长之和约等于总时长。
${storyBrief(s)}

输出格式：{"shots":[${SHOT_FMT}]}
${shotRules(E)}
要求：开头 3 秒内要有钩子，结尾留悬念；台词口语化，每句不超过 20 字。`;
  const { out, usage } = await chat(user);
  const shots = (out.shots || []).slice(0, 30).map(x => normalizeShot(x, E, (s.chars || []).length));
  if (!shots.length) throw new HttpError(502, '分镜服务没有返回镜头，请重试');
  return { shots, usage, model: CFG.llmModel };
}
// 重写单个镜头：带上前后镜头作为上下文，保证剧情连贯
async function rewriteShot({ story, enums, shots, index, note }) {
  const s = story || {}, E = enums || {}, list = (Array.isArray(shots) ? shots.slice(0, 30) : []).map(x => (x && typeof x === 'object' ? x : {}));
  const i = Math.round(+index);
  if (!(i >= 0 && i < list.length)) throw new HttpError(400, '镜头序号不正确');
  const ctx = list.map((x, k) => `${k + 1}. [${x.scale || ''}/${x.cam || ''}/${x.dur || 3}秒] ${String(x.desc || '').slice(0, 120)}${x.line ? ' 台词：' + String(x.line).slice(0, 40) : ''}${k === i ? '  ← 需要重写' : ''}`).join('\n');
  const user = `下面是一部${s.ratio === '16:9' ? '横屏' : '竖屏'}短剧的分镜脚本，请只重写第 ${i + 1} 个镜头：换一种更有张力的拍法（景别、运镜、光线可以变），剧情要和前后镜头衔接，时长保持在 ${list[i].dur || 3} 秒左右。${note ? '\n额外要求：' + String(note).slice(0, 200) : ''}
${storyBrief(s)}

当前分镜：
${ctx}

输出格式：{"shot":${SHOT_FMT}}
${shotRules(E)}`;
  const { out, usage } = await chat(user, 0.9);
  if (!out.shot || !out.shot.desc) throw new HttpError(502, '分镜服务没有返回镜头，请重试');
  return { shot: normalizeShot(out.shot, E, (s.chars || []).length), usage, model: CFG.llmModel };
}

/* ---------------- 视频：Seedance 2.0 mini / 可灵 2.5 Turbo ---------------- */
function klingJwt(ak = CFG.klingAk, sk = CFG.klingSk) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64({ iss: ak, exp: now + 1800, nbf: now - 5 });
  const sig = crypto.createHmac('sha256', sk).update(head + '.' + body).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const TASKS = new Map(); // 本地任务 id → {provider, upstreamId, url?}
const tasksFile = path.join(CFG.dataDir, 'tasks.json');
// 只保留 7 天内的任务记录：上游的任务结果本来也只保存几天
const TASK_TTL = 7 * 24 * 3600 * 1000;
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(tasksFile, 'utf8')))) if (Date.now() - (v.at || 0) < TASK_TTL) TASKS.set(k, v); } catch {}
const saveTasks = () => fsp.writeFile(tasksFile, JSON.stringify(Object.fromEntries(TASKS))).catch(() => {});

async function createVideo({ provider = 'seedance', image, prompt = '', duration = 5, ratio = '9:16' }) {
  const img = await toDataUri(image); if (!img) throw new HttpError(400, '缺少首帧图（已确认的关键帧）');
  let upstreamId;
  if (provider === 'kling') {
    need(CFG.klingAk && CFG.klingSk, '可灵 KLING_ACCESS_KEY / KLING_SECRET_KEY', '视频服务');
    const dur = duration > 5 ? '10' : '5'; // 可灵只支持 5 / 10 秒
    const j = await upstream(CFG.klingBase + '/v1/videos/image2video', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + klingJwt() },
      body: JSON.stringify({ model_name: CFG.klingModel, mode: CFG.klingMode, image: img.replace(/^data:[^,]+,/, ''), prompt: prompt.slice(0, 2400), duration: dur }),
    }, '视频服务');
    if (j.code && j.code !== 0) throw new HttpError(400, '可灵返回错误：' + (j.message || j.code));
    upstreamId = j.data?.task_id;
  } else {
    need(CFG.arkKey, '火山方舟 ARK_API_KEY', '视频服务');
    // Seedance 2.0 mini 支持 4~15 秒；镜头更短时生成 4 秒，合成成片时再裁到分镜时长
    const dur = Math.max(4, Math.min(15, Math.round(duration)));
    const j = await upstream(CFG.arkBase + '/contents/generations/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CFG.arkKey },
      // 首帧图已经是目标比例，ratio 用 adaptive 跟随首帧
      body: JSON.stringify({ model: CFG.seedanceModel, content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: img }, role: 'first_frame' }], resolution: CFG.seedanceRes, ratio: 'adaptive', duration: dur, watermark: false, generate_audio: false }),
    }, '视频服务');
    upstreamId = j.id;
  }
  if (!upstreamId) throw new HttpError(502, '视频接口没有返回任务 id');
  const id = newId(); TASKS.set(id, { provider, upstreamId, at: Date.now() }); saveTasks();
  return { id };
}
async function queryVideo(id) {
  const t = TASKS.get(id); if (!t) throw new HttpError(404, '任务不存在');
  if (t.url) return { status: 'succeeded', url: t.url };
  if (t.error) return { status: 'failed', error: t.error };
  let status, remote, error;
  if (t.provider === 'kling') {
    const j = await upstream(`${CFG.klingBase}/v1/videos/image2video/${t.upstreamId}`, { headers: { authorization: 'Bearer ' + klingJwt() } }, '视频服务');
    const s = j.data?.task_status; status = s === 'succeed' ? 'succeeded' : s === 'failed' ? 'failed' : 'running';
    remote = j.data?.task_result?.videos?.[0]?.url; error = j.data?.task_status_msg;
  } else {
    const j = await upstream(`${CFG.arkBase}/contents/generations/tasks/${t.upstreamId}`, { headers: { authorization: 'Bearer ' + CFG.arkKey } }, '视频服务');
    const s = String(j.status || '').toLowerCase(); status = s === 'succeeded' ? 'succeeded' : ['failed', 'cancelled', 'expired'].includes(s) ? 'failed' : 'running';
    remote = j.content?.video_url; error = j.error?.message;
  }
  if (status === 'succeeded') {
    if (!remote) throw new HttpError(502, '任务完成但没有视频地址');
    t.url = await download(remote, 'mp4'); saveTasks(); return { status, url: t.url };
  }
  if (status === 'failed') { t.error = error || '生成失败'; saveTasks(); return { status, error: t.error }; }
  return { status: 'running', elapsed: Math.round((Date.now() - t.at) / 1000) };
}

/* ---------------- 合成成片：把各镜头 mp4 拼成一条 ---------------- */
async function concatVideos({ urls, durs }) {
  if (!HAS_FFMPEG) throw new HttpError(501, '服务器没有安装 ffmpeg，无法合成，请逐个下载镜头');
  const files = (urls || []).map(u => path.join(FILES, path.basename(String(u))));
  if (!files.length || files.some(f => !fs.existsSync(f))) throw new HttpError(400, '有镜头视频已不存在');
  const out = path.join(FILES, newId() + '.mp4');
  // 不同模型的分辨率可能不同，统一缩放后重新编码，保证能拼接
  const inputs = files.flatMap(f => ['-i', f]);
  const filt = files.map((_, i) => `[${i}:v]${+durs?.[i] > 0 ? `trim=duration=${+durs[i]},setpts=PTS-STARTPTS,` : ''}scale=720:-2:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1,fps=24[v${i}]`).join(';')
    + ';' + files.map((_, i) => `[v${i}]`).join('') + `concat=n=${files.length}:v=1:a=0[v]`;
  await new Promise((ok, bad) => {
    const p = spawn('ffmpeg', ['-y', ...inputs, '-filter_complex', filt, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'ignore' });
    p.on('exit', c => (c === 0 ? ok() : bad(new HttpError(500, '合成失败（ffmpeg 退出码 ' + c + '）')))); p.on('error', bad);
  });
  return { url: '/files/' + path.basename(out) };
}

/* ---------------- 设置：在网页里填写 / 测试密钥 ---------------- */
const modelsStatus = () => ({ image: !!CFG.arkKey, llm: !!CFG.llmKey, seedance: !!CFG.arkKey, kling: !!(CFG.klingAk && CFG.klingSk) });
// 只返回末尾 4 位，页面上用来确认填的是哪一个
function settingsView() {
  const keys = {};
  for (const k of Object.keys(KEY_FIELDS)) {
    const v = keyOf(k);
    keys[k] = { set: !!v, tail: v ? v.slice(-4) : '', source: k in SAVED ? 'settings' : v ? 'env' : 'none' };
  }
  return { keys, models: modelsStatus() };
}
// 常见的粘贴错误在保存前就拦下来，比如前后带空格、两个 Key 粘在一起
export function checkKey(k, v) {
  if (v === '') return null;
  if (v.length > 200 || /[\s"'，。]/.test(v)) return '里面有空格、引号或中文标点，请只粘贴 Key 本身';
  if (k === 'deepseek' && !/^sk-[A-Za-z0-9]{16,64}$/.test(v)) return 'DeepSeek 的 Key 应该是 sk- 开头的一串字母数字，请检查是不是多粘了内容';
  if (v.length < 16) return '长度太短，请检查是否粘贴完整';
  return null;
}
async function saveSettings(body) {
  const next = { ...SAVED };
  for (const k of Object.keys(KEY_FIELDS)) {
    if (typeof body[k] !== 'string') continue; // 没传的项保持不变
    const v = body[k].trim(), bad = checkKey(k, v);
    if (bad) throw new HttpError(400, `${SETTING_NAMES[k]}：${bad}`);
    next[k] = v;
  }
  const tmp = SETTINGS_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, SETTINGS_FILE);
  SAVED = next; applyKeys();
  return settingsView();
}
const SETTING_NAMES = { ark: '火山方舟 API Key', deepseek: 'DeepSeek API Key', klingAk: '可灵 AccessKey', klingSk: '可灵 SecretKey' };
// 用「列出模型 / 任务」这类免费接口验证 Key，不会产生费用。没传新值就测已保存的
async function testKey({ which, key, ak, sk }) {
  const pick = (v, k) => (typeof v === 'string' && v.trim() ? v.trim() : keyOf(k));
  const call = async (url, headers) => {
    let r;
    try { r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) }); }
    catch (e) { return { ok: false, message: e.name === 'TimeoutError' ? '连接超时，请检查网络' : '连不上服务器：' + e.message }; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403 || (j.code && [1000, 1001, 1002, 1003, 1004].includes(+j.code))) return { ok: false, message: 'Key 无效或已过期，请重新复制' };
    if (!r.ok) return { ok: false, message: `服务返回 ${r.status}：${j.error?.message || j.message || '未知错误'}` };
    return { ok: true, message: '连接成功' };
  };
  if (which === 'ark') {
    const k = pick(key, 'ark'); if (!k) return { ok: false, message: '还没有填写' };
    return call(CFG.arkBase + '/models', { authorization: 'Bearer ' + k });
  }
  if (which === 'deepseek') {
    const k = pick(key, 'deepseek'); if (!k) return { ok: false, message: '还没有填写' };
    const bad = checkKey('deepseek', k); if (bad) return { ok: false, message: bad };
    return call(CFG.deepseekBase + '/models', { authorization: 'Bearer ' + k });
  }
  if (which === 'kling') {
    const a = pick(ak, 'klingAk'), b = pick(sk, 'klingSk'); if (!a || !b) return { ok: false, message: 'AccessKey 和 SecretKey 都要填写' };
    return call(CFG.klingBase + '/v1/videos/image2video?pageNum=1&pageSize=1', { authorization: 'Bearer ' + klingJwt(a, b) });
  }
  throw new HttpError(400, '不认识的测试项');
}

/* ---------------- 请求来源检查 ---------------- */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLoopback = req => LOOPBACK.has(req.socket.remoteAddress);
// 防止你正在浏览的其他网页偷偷调用本机接口（消耗额度、改密钥）：
// 1) 写操作必须是 JSON 请求，跨站发送时浏览器会先发预检请求，而这里不响应预检，于是被拦下
// 2) 只监听本机时，Host 必须是本机地址，挡住 DNS 重绑定
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
export function checkRequest({ method, contentType, host }, { token = CFG.accessToken, bindHost = CFG.host } = {}) {
  if (method !== 'GET' && method !== 'HEAD' && !/^application\/json\b/i.test(contentType || '')) return [415, '请求格式不正确'];
  if (!token && LOOPBACK.has(bindHost) && !LOCAL_HOSTS.test(host || '')) return [403, '只允许从本机访问'];
  return null;
}
function guard(req) {
  const bad = checkRequest({ method: req.method, contentType: req.headers['content-type'], host: req.headers.host });
  if (bad) throw new HttpError(...bad);
}

/* ---------------- 路由 ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.json': 'application/json' };
async function serveStatic(req, res, file) {
  const st = await fsp.stat(file).catch(() => null); if (!st || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
  const type = MIME[path.extname(file)] || 'application/octet-stream', range = req.headers.range;
  const head = { ...SAFE_HEADERS, 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': file.startsWith(FILES) ? 'public, max-age=31536000, immutable' : 'no-cache' };
  if (range) { // 视频拖动进度需要 Range
    const r = parseRange(range, st.size);
    if (!r) { res.writeHead(416, { ...head, 'content-range': `bytes */${st.size}` }); res.end(); return; }
    res.writeHead(206, { ...head, 'content-range': `bytes ${r.start}-${r.end}/${st.size}`, 'content-length': r.end - r.start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start: r.start, end: r.end }).pipe(res); return;
  }
  res.writeHead(200, { ...head, 'content-length': st.size });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}
// 支持 bytes=a-b、bytes=a-、bytes=-n（最后 n 字节）；越界返回 null（416）
export function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h).trim()); if (!m || (!m[1] && !m[2]) || size <= 0) return null;
  let start, end;
  if (!m[1]) { start = Math.max(0, size - +m[2]); end = size - 1; }
  else { start = +m[1]; end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
  return start <= end && start < size ? { start, end } : null;
}
const STATIC = new Set(['/index.html', '/styles.css', '/app.js']);

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      guard(req);
      if (CFG.accessToken && p !== '/api/health' && !tokenOk(req.headers['x-access-token'])) throw new HttpError(401, '需要访问口令');
      if (p === '/api/health') return send(res, 200, {
        ok: true, auth: !!CFG.accessToken, ffmpeg: HAS_FFMPEG,
        // 只告诉页面各项能不能用，不暴露具体模型
        models: modelsStatus(), settings: isLoopback(req) || !!CFG.accessToken,
      });
      if (p.startsWith('/api/settings')) {
        // 密钥只能在本机改；开放给其他电脑访问时必须设置访问口令
        if (!isLoopback(req) && !CFG.accessToken) throw new HttpError(403, '只能在运行帧间的这台电脑上修改设置');
        if (req.method === 'GET' && p === '/api/settings') return send(res, 200, settingsView());
        if (req.method === 'POST' && p === '/api/settings') return send(res, 200, await saveSettings(await readJson(req)));
        if (req.method === 'POST' && p === '/api/settings/test') return send(res, 200, await testKey(await readJson(req)));
      }
      if (req.method === 'POST' && p === '/api/image') return send(res, 200, await genImage(await readJson(req)));
      if (req.method === 'POST' && p === '/api/storyboard') return send(res, 200, await genStoryboard(await readJson(req)));
      if (req.method === 'POST' && p === '/api/shot') return send(res, 200, await rewriteShot(await readJson(req)));
      if (req.method === 'POST' && p === '/api/video') return send(res, 200, await createVideo(await readJson(req)));
      if (req.method === 'GET' && p.startsWith('/api/video/')) return send(res, 200, await queryVideo(p.slice(11)));
      if (req.method === 'POST' && p === '/api/concat') return send(res, 200, await concatVideos(await readJson(req)));
      throw new HttpError(404, '接口不存在');
    }
    if (p.startsWith('/files/')) return serveStatic(req, res, path.join(FILES, path.basename(p)));
    // 带扩展名或以点开头、但不在白名单里的（如 /favicon.ico、/.env）一律 404，其余路径回落到首页
    if (!STATIC.has(p) && (path.extname(p) || path.basename(p).startsWith('.'))) { res.writeHead(404, SAFE_HEADERS); res.end('Not found'); return; }
    return serveStatic(req, res, path.join(ROOT, STATIC.has(p) ? p : '/index.html'));
  } catch (e) {
    const status = e.status || 500; if (status >= 500) console.error(p, e.message);
    send(res, status, { error: e.message || '服务器错误' });
  }
});
// 直接运行时才监听端口；测试里 import 这个文件时不自动启动
const realpath = f => { try { return fs.realpathSync(f); } catch { return path.resolve(f); } };
const isMain = !!process.argv[1] && realpath(process.argv[1]) === realpath(fileURLToPath(import.meta.url));
if (isMain) server.listen(CFG.port, CFG.host, () => {
  console.log(`帧间已启动：http://localhost:${CFG.port}${LOOPBACK.has(CFG.host) ? '' : `（监听 ${CFG.host}，其他设备也能访问${CFG.accessToken ? '' : '，建议设置 ACCESS_TOKEN'}）`}`);
  console.log(`  火山方舟（Seedream / DeepSeek / Seedance）：${CFG.arkKey ? '已配置' : '未配置，请在网页「设置」里填写'}`);
  console.log(`  分镜模型：${CFG.llmKey ? CFG.llmModel + ' @ ' + CFG.llmBase : '未配置'}`);
  console.log(`  可灵 2.5 Turbo：${CFG.klingAk && CFG.klingSk ? '已配置' : '未配置（精品档不可用）'}`);
  console.log(`  ffmpeg 合成成片：${HAS_FFMPEG ? '可用' : '未安装'}`);
});
