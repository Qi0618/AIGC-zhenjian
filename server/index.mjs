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
// 打包版可以把 ffmpeg 放在自带目录里，用 FFMPEG_PATH 指定
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const HAS_FFMPEG = spawnSync(FFMPEG, ['-version']).status === 0;
// 用数据目录区分不同的帧间：双击启动时，如果同一份数据的帧间已经在跑，就直接打开它
const INSTANCE = crypto.createHash('sha1').update(CFG.dataDir).digest('hex').slice(0, 10);

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
// 把模型平台的原始报错（多为英文，还带着模型 ID 和账号）翻成用户看得懂、知道怎么办的话；原文保留在 raw 里写日志
export function friendlyError(label, status, msg) {
  const m = String(msg || '');
  if (/not activated|ModelNotOpen|has not been activated/i.test(m)) return `${label}还没有在火山方舟开通，请到火山方舟控制台「开通管理」里开通后再试`;
  if (status === 401 || /invalid api key|api key.*invalid|authenticat|unauthorized/i.test(m)) return `${label}的密钥无效或已过期，请到「设置」里重新填写`;
  if (/overdue|insufficient|balance|arrear|欠费|余额/i.test(m)) return `${label}的账户余额不足或已欠费，请先到对应平台充值`;
  if (status === 429 || /rate.?limit|too many requests|RequestBurstTooFast|quota/i.test(m)) return `${label}请求太频繁或超出额度，请稍等一会儿再试`;
  // 视频模型不允许用「像真人照片」的图做首帧（防伪造真人），写实画风的关键帧常被误判
  if (/real person|real human|真人/i.test(m)) return `${label}认为画面里的人物太像真人照片，不允许用来生成视频。可以把短剧画风换成「动漫」后重画关键帧再试`;
  if (/sensitive|risk|审核|违规/i.test(m)) return `${label}判定内容可能不合规，请修改描述或图片后再试`;
  return `${label}返回错误：${m}`;
}
function upstreamError(label, status, msg) {
  const e = new HttpError(status >= 400 && status < 500 ? 400 : 502, friendlyError(label, status, msg));
  e.raw = `${label} ${status}：${msg}`; return e;
}
async function upstream(url, opt, label) {
  const { r, body: text } = await fetchBody(url, opt, label);
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 500) }; }
  if (!r.ok || (j && j.error)) {
    const msg = j?.error?.message || j?.message || j?.raw || r.statusText;
    throw upstreamError(label, r.status, msg);
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
// 上传给模型前先压缩：原图常有 1 MB 左右，网速慢时是「连接失败」的主要原因。
// 有 ffmpeg 时缩到最长边 maxSide 以内：JPEG 重新压缩；PNG / WebP 只缩小尺寸、保持 PNG（避免透明背景变黑）
export function shrinkImage(buf, maxSide = 1280) {
  if (!HAS_FFMPEG || buf.length < 250 * 1024) return Promise.resolve(buf);
  const jpeg = extOf(buf) === 'jpg';
  const args = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vf', `scale='min(iw,${maxSide})':'min(ih,${maxSide})':force_original_aspect_ratio=decrease`,
    '-frames:v', '1', '-f', 'image2pipe', ...(jpeg ? ['-c:v', 'mjpeg', '-q:v', '3'] : ['-c:v', 'png']), 'pipe:1'];
  return new Promise(ok => {
    const p = spawn(FFMPEG, args), out = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), 20000);
    p.stdout.on('data', d => out.push(d)); p.stderr.resume();
    p.on('error', () => { clearTimeout(timer); ok(buf); });
    p.on('close', code => { clearTimeout(timer); const r = Buffer.concat(out); ok(code === 0 && r.length && r.length < buf.length ? r : buf); });
    p.stdin.on('error', () => {}); p.stdin.end(buf);
  });
}
const asDataUri = buf => { const ext = extOf(buf); return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + buf.toString('base64'); };
async function toDataUri(src, maxSide = 1280) {
  if (!src) return null;
  if (/^https?:\/\//.test(src)) return src;
  let buf;
  if (src.startsWith('data:')) {
    const m = /^data:image\/[a-z+]+;base64,(.*)$/s.exec(src); if (!m) return src;
    buf = Buffer.from(m[1], 'base64');
  } else if (src.startsWith('/files/')) {
    buf = await fsp.readFile(path.join(FILES, path.basename(src))).catch(() => null);
    if (!buf) throw new HttpError(400, '参考图已不存在：' + src);
  } else if (/^\/?samples\//.test(src)) {
    // 内置样例（samples/ 下的图）：样例项目也能作为参考图重新生成
    buf = await fsp.readFile(path.join(ROOT, 'samples', path.basename(src))).catch(() => null);
    if (!buf) throw new HttpError(400, '样例图片不存在：' + src);
  } else throw new HttpError(400, '无法识别的图片地址');
  return asDataUri(await shrinkImage(buf, maxSide));
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
const SHOT_FMT = '{"scale":"景别","mood":"光线","cam":"运镜","desc":"画面描述，一两句，写清人物动作和环境","line":"台词或旁白，写成「说话人：内容」，如「林夏：你好」「旁白：三年后」，没有就空字符串","dur":秒数,"cast":[出镜角色序号]}';
// 模型输出不一定守规矩：取值不在枚举里就用默认值，长度和时长都截断到合理范围
export function normalizeShot(x, E = {}, nChars = 0) {
  x = x || {};
  const pick = (v, list, d) => (list && list.includes(v) ? v : d);
  return {
    scale: pick(x.scale, E.scales, (E.scales || [])[2] || '中景'),
    mood: pick(x.mood, E.moods, (E.moods || [])[0] || 'night'),
    cam: pick(x.cam, E.cams, (E.cams || [])[0] || '固定'),
    desc: String(x.desc || '').slice(0, 200), line: String(x.line || '').slice(0, 70),
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
要求：开头 3 秒内要有钩子，结尾留悬念；台词口语化，每句不超过 20 字；说话人必须是上面的角色名或「旁白」，并且是本镜头出镜的角色。`;
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

// audio=true 时让视频模型同时生成声音（台词配音、口型、环境音），不需要另外接语音合成
// fallback：首帧被判「像真人」时，改为纯文字生成要补充的描述（角色外形、画风）；不传就不自动改
async function createVideo({ provider = 'seedance', image, prompt = '', duration = 5, ratio = '9:16', audio = false, fallback = '' }) {
  const img = await toDataUri(image); if (!img) throw new HttpError(400, '缺少首帧图（已确认的关键帧）');
  let upstreamId, textOnly = false;
  if (provider === 'kling') {
    need(CFG.klingAk && CFG.klingSk, '可灵 KLING_ACCESS_KEY / KLING_SECRET_KEY', '视频服务');
    const dur = duration > 5 ? '10' : '5'; // 可灵只支持 5 / 10 秒
    const j = await upstream(CFG.klingBase + '/v1/videos/image2video', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + klingJwt() },
      body: JSON.stringify({ model_name: CFG.klingModel, mode: CFG.klingMode, image: img.replace(/^data:[^,]+,/, ''), prompt: prompt.slice(0, 2400), duration: dur }),
    }, '视频服务');
    if (j.code && j.code !== 0) throw upstreamError('视频服务', 400, j.message || String(j.code));
    upstreamId = j.data?.task_id;
  } else {
    need(CFG.arkKey, '火山方舟 ARK_API_KEY', '视频服务');
    // Seedance 2.0 mini 支持 4~15 秒；镜头更短时生成 4 秒，合成成片时再裁到分镜时长
    const dur = Math.max(4, Math.min(15, Math.round(duration)));
    const submit = (content, r) => upstream(CFG.arkBase + '/contents/generations/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CFG.arkKey },
      body: JSON.stringify({ model: CFG.seedanceModel, content, resolution: CFG.seedanceRes, ratio: r, duration: dur, watermark: false, generate_audio: !!audio }),
    }, '视频服务');
    let j;
    try {
      // 首帧图已经是目标比例，ratio 用 adaptive 跟随首帧
      j = await submit([{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: img }, role: 'first_frame' }], 'adaptive');
    } catch (e) {
      // 视频模型不接受「像真人照片」的首帧：改为只按文字生成，画面会和关键帧有差异
      if (!fallback || !/real person|real human/i.test(e.raw || '')) throw e;
      console.warn('首帧被判定像真人，改为按文字生成视频');
      j = await submit([{ type: 'text', text: `${prompt}\n${String(fallback).slice(0, 600)}` }], ratio === '16:9' ? '16:9' : '9:16');
      textOnly = true;
    }
    upstreamId = j.id;
  }
  if (!upstreamId) throw new HttpError(502, '视频接口没有返回任务 id');
  const id = newId(); TASKS.set(id, { provider, upstreamId, at: Date.now(), audio: !!audio && provider !== 'kling', textOnly }); saveTasks();
  return { id, textOnly };
}
// 视频生成好以后在后台下载到本机：网速慢时一段视频要下好几分钟，查询进度不必一直挂着等；同一个任务只下载一次
const DOWNLOADS = new Map();
async function queryVideo(id) {
  const t = TASKS.get(id); if (!t) throw new HttpError(404, '任务不存在');
  if (t.url) return { status: 'succeeded', url: t.url };
  if (t.error) return { status: 'failed', error: t.error };
  if (!t.remote) {
    const r = await queryUpstreamVideo(t);
    if (r.status === 'failed') { t.error = r.error || '生成失败'; saveTasks(); return { status: 'failed', error: t.error }; }
    if (r.status !== 'succeeded') return { status: 'running', elapsed: Math.round((Date.now() - t.at) / 1000) };
    if (!r.remote) throw new HttpError(502, '任务完成但没有视频地址');
    t.remote = r.remote; t.doneAt = Date.now(); saveTasks(); // 记下地址，服务重启后也能接着下载
  }
  if (!DOWNLOADS.has(id)) {
    if ((t.dlFails || 0) >= 3) { t.error = '视频已经生成，但下载到本机失败了：' + (t.dlError || ''); saveTasks(); return { status: 'failed', error: t.error }; }
    DOWNLOADS.set(id, download(t.remote, 'mp4')
      .then(url => { t.url = url; delete t.remote; saveTasks(); })
      .catch(e => { t.dlFails = (t.dlFails || 0) + 1; t.dlError = e.message; saveTasks(); console.error('下载视频失败', id, e.message); })
      .finally(() => DOWNLOADS.delete(id)));
  }
  return { status: 'downloading', elapsed: Math.round((Date.now() - t.at) / 1000) };
}
async function queryUpstreamVideo(t) {
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
  return { status, remote, error };
}

/* ---------------- 合成成片：镜头 + 声音拼成一条，烧录字幕 ---------------- */
// 不用 ffprobe 也能判断 mp4 有没有音轨：找 hdlr 盒子里的 soun 类型
export function hasAudioTrack(buf) {
  for (let i = buf.indexOf('hdlr'); i !== -1; i = buf.indexOf('hdlr', i + 4)) if (buf.toString('latin1', i + 12, i + 16) === 'soun') return true;
  return false;
}
// 读 mp4 的实际时长（秒）：mvhd 盒子里的 timescale 和 duration
export function mp4Duration(buf) {
  const i = buf.indexOf('mvhd'); if (i < 0) return 0;
  const v = buf[i + 4];
  const [scale, dur] = v === 1 ? [buf.readUInt32BE(i + 24), Number(buf.readBigUInt64BE(i + 28))] : [buf.readUInt32BE(i + 16), buf.readUInt32BE(i + 20)];
  return scale ? dur / scale : 0;
}
// 字幕用系统自带的中文字体；可以用 SUBTITLE_FONT 指定
const FONT_CANDIDATES = {
  darwin: ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc', '/Library/Fonts/Arial Unicode.ttf'],
  win32: ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyh.ttf', 'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsun.ttc'],
  linux: ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', '/usr/share/fonts/wqy-microhei/wqy-microhei.ttc'],
};
export function findSubtitleFont() {
  const list = [process.env.SUBTITLE_FONT, ...(FONT_CANDIDATES[process.platform] || FONT_CANDIDATES.linux)].filter(Boolean);
  return list.find(f => fs.existsSync(f)) || null;
}
// 按每行最多 max 个字分行，各行字数尽量平均（避免最后一行只剩一个字），最多 3 行
export function wrapLine(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim(); if (!t) return [];
  const n = Math.min(3, Math.ceil(t.length / max)), per = Math.ceil(t.length / n), out = [];
  for (let i = 0; i < t.length && out.length < 3; i += per) out.push(t.slice(i, i + per));
  return out;
}
// filter 参数里的路径：统一用 / ，冒号和单引号要转义（Windows 的 C: 也要）
const ffPath = f => String(f).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
/**
 * 生成 ffmpeg 的 filter_complex。
 * clips: [{ dur, audio, subFiles: [每行一个文本文件] }]，size: [W, H]，font: 字体文件或 null
 */
export function buildConcatFilter(clips, [W, H], font) {
  const parts = [], labels = [];
  let t = 0;
  clips.forEach((c, i) => {
    const d = Math.max(0.5, +c.dur || 3);
    // 视频：比设定时长短就停在最后一帧补齐，再裁到设定时长；统一尺寸和帧率
    parts.push(`[${i}:v]tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v${i}]`);
    // 声音：有就裁到同样长度，不够补静音；没有音轨就生成一段静音，保证音画对齐
    parts.push(c.audio
      ? `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d}[a${i}]`
      : `anullsrc=r=44100:cl=stereo,atrim=duration=${d}[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
    c.start = t; c.end = t + d; t += d;
  });
  parts.push(`${labels.join('')}concat=n=${clips.length}:v=1:a=1[vc][ac]`);
  const subs = font ? clips.filter(c => c.subFiles && c.subFiles.length) : [];
  if (subs.length) {
    // 每行单独画一次，各自水平居中；最后一行离底部 9%
    const fs_ = Math.round(Math.min(W, H) * 0.052), lh = Math.round(fs_ * 1.35), bottom = Math.round(H * 0.09);
    const draw = subs.flatMap(c => c.subFiles.map((f, j) => {
      const y = H - bottom - (c.subFiles.length - j) * lh;
      return `drawtext=fontfile='${ffPath(font)}':textfile='${ffPath(f)}':fontsize=${fs_}:fontcolor=white:borderw=${Math.max(2, Math.round(fs_ / 12))}:bordercolor=black@0.85:x=(w-text_w)/2:y=${y}:enable='between(t,${c.start.toFixed(2)},${(c.end - 0.05).toFixed(2)})'`;
    }));
    parts.push(`[vc]${draw.join(',')}[v]`);
  } else parts.push('[vc]null[v]');
  return { filter: parts.join(';'), total: t };
}
async function concatVideos({ urls, durs, lines, ratio = '9:16', subtitles = true }) {
  if (!HAS_FFMPEG) throw new HttpError(501, '没有找到 ffmpeg，无法合成成片，改为逐个下载镜头');
  // 镜头可以是生成的（/files/）或内置样例（samples/）
  const files = (urls || []).map(u => /^\/?samples\//.test(String(u)) ? path.join(ROOT, 'samples', path.basename(String(u))) : path.join(FILES, path.basename(String(u))));
  if (!files.length || files.length > 60 || files.some(f => !fs.existsSync(f))) throw new HttpError(400, '有镜头视频已不存在');
  const size = ratio === '16:9' ? [1280, 720] : [720, 1280];
  const tmp = await fsp.mkdtemp(path.join(CFG.dataDir, 'tmp-'));
  try {
    const font = subtitles ? findSubtitleFont() : null;
    if (subtitles && !font) console.warn('没有找到中文字体，成片不带字幕；可以用 SUBTITLE_FONT 指定字体文件');
    const clips = [];
    for (let i = 0; i < files.length; i++) {
      const head = await fsp.readFile(files[i]), audio = hasAudioTrack(head), real = mp4Duration(head);
      // 有配音的镜头保留完整长度：视频模型最短出 4 秒，台词可能说到最后，按分镜时长裁会把话切掉
      const want = +durs?.[i] || 3, c = { dur: audio && real > want ? Math.min(real, want + 8) : want, audio };
      const rows = font ? wrapLine(lines?.[i], size[0] < size[1] ? 14 : 22) : [];
      c.subFiles = [];
      for (let j = 0; j < rows.length; j++) { const f = path.join(tmp, `sub${i}-${j}.txt`); await fsp.writeFile(f, rows[j]); c.subFiles.push(f); }
      clips.push(c);
    }
    const { filter } = buildConcatFilter(clips, size, font);
    const out = path.join(FILES, newId() + '.mp4');
    const args = ['-y', '-hide_banner', '-loglevel', 'error', ...files.flatMap(f => ['-i', f]), '-filter_complex', filter, '-map', '[v]', '-map', '[ac]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out];
    let err = '';
    await new Promise((ok, bad) => {
      const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      p.stderr.on('data', d => { err = (err + d).slice(-2000); });
      p.on('exit', c => (c === 0 ? ok() : bad(new HttpError(500, '合成失败（ffmpeg 退出码 ' + c + '）'))));
      p.on('error', bad);
    }).catch(e => { console.error('ffmpeg 出错：', err); throw e; });
    return { url: '/files/' + path.basename(out), subtitles: !!(font && clips.some(c => c.subFiles.length)), duration: clips.reduce((a, c) => a + c.dur, 0) };
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
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

/* ---------------- 本机数据：项目 / 历史 / 积分 / 上传的图片 ---------------- */
// 全部存在 data/ 下，备份或换电脑只要复制整个 data 文件夹
const STORE = path.join(CFG.dataDir, 'store'), PROJ_DIR = path.join(STORE, 'projects');
fs.mkdirSync(PROJ_DIR, { recursive: true });
const HISTORY_FILE = path.join(STORE, 'history.json'), WALLET_FILE = path.join(STORE, 'wallet.json');
const HISTORY_MAX = 500;
const readJsonFile = async (f, d) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return d; } };
// 先写临时文件再改名，写到一半断电也不会留下损坏的文件；同一个文件的写入排队进行
const writeQueue = new Map();
function writeJsonFile(f, data) {
  const run = (writeQueue.get(f) || Promise.resolve()).catch(() => {}).then(async () => {
    const tmp = `${f}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data)); await fsp.rename(tmp, f);
  });
  writeQueue.set(f, run); return run;
}
const projFile = id => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, '项目 id 不正确');
  return path.join(PROJ_DIR, id + '.json');
};
async function loadStore() {
  const names = (await fsp.readdir(PROJ_DIR)).filter(n => n.endsWith('.json'));
  const projects = (await Promise.all(names.map(n => readJsonFile(path.join(PROJ_DIR, n), null).then(d => d && { ...d, id: n.slice(0, -5) })))).filter(Boolean);
  const wallet = await readJsonFile(WALLET_FILE, {});
  return { projects, history: await readJsonFile(HISTORY_FILE, []), credits: typeof wallet.credits === 'number' ? wallet.credits : null };
}
async function addHistory(h) {
  if (!h || typeof h !== 'object') throw new HttpError(400, '记录格式不正确');
  const list = await readJsonFile(HISTORY_FILE, []);
  list.unshift({ ...h, id: h.id || newId() });
  await writeJsonFile(HISTORY_FILE, list.slice(0, HISTORY_MAX));
  return { ok: true };
}
// 上传图片（商品图、角色参考图）：前端发 data URL，存成文件后返回 /files/ 地址
async function uploadImage({ dataUrl }) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, '只能上传 PNG、JPG、WebP 或 GIF 图片');
  const buf = Buffer.from(m[2], 'base64'); if (!buf.length) throw new HttpError(400, '图片是空的');
  return { url: await saveFile(buf, m[1] === 'jpeg' ? 'jpg' : m[1]) };
}

/* ---------------- 存储空间：统计和清理没被使用的文件 ---------------- */
const TRASH = path.join(CFG.dataDir, 'trash');
const GRACE_MS = 24 * 3600 * 1000; // 一天内生成的文件不算没用：可能刚生成、还没来得及存进项目
async function dirStats(dir) {
  let count = 0, bytes = 0;
  const walk = async d => { for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else { count++; bytes += (await fsp.stat(f)).size; } } };
  await walk(dir); return { count, bytes };
}
// 项目、历史、视频任务里提到的 /files/ 文件都算在用
async function referencedFiles() {
  const used = new Set(), texts = [];
  for (const n of await fsp.readdir(PROJ_DIR).catch(() => [])) texts.push(await fsp.readFile(path.join(PROJ_DIR, n), 'utf8').catch(() => ''));
  for (const f of [HISTORY_FILE, tasksFile]) texts.push(await fsp.readFile(f, 'utf8').catch(() => ''));
  for (const t of texts) for (const m of t.matchAll(/\/files\/([A-Za-z0-9]+\.[a-z0-9]+)/g)) used.add(m[1]);
  return used;
}
async function unusedFiles() {
  const used = await referencedFiles(), now = Date.now(), out = [];
  for (const n of await fsp.readdir(FILES)) {
    if (used.has(n)) continue;
    const st = await fsp.stat(path.join(FILES, n)).catch(() => null);
    if (st && st.isFile() && now - st.mtimeMs > GRACE_MS) out.push({ name: n, size: st.size });
  }
  return out;
}
async function storageInfo() {
  const [all, trash, unused] = await Promise.all([dirStats(FILES), dirStats(TRASH), unusedFiles()]);
  return { dataDir: CFG.dataDir, files: all, unused: { count: unused.length, bytes: unused.reduce((a, f) => a + f.size, 0) }, trash };
}
// 不直接删除：移到 data/trash/日期时间/，确认不需要后再手动删
async function cleanupStorage() {
  const list = await unusedFiles(); if (!list.length) return { moved: 0, bytes: 0, ...(await storageInfo()) };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15), dest = path.join(TRASH, stamp);
  await fsp.mkdir(dest, { recursive: true });
  let moved = 0, bytes = 0;
  for (const f of list) { try { await fsp.rename(path.join(FILES, f.name), path.join(dest, f.name)); moved++; bytes += f.size; } catch {} }
  return { moved, bytes, trashDir: dest, ...(await storageInfo()) };
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
        ok: true, app: 'zhenjian', instance: INSTANCE, auth: !!CFG.accessToken, ffmpeg: HAS_FFMPEG,
        // 只告诉页面各项能不能用，不暴露具体模型
        models: modelsStatus(), settings: isLoopback(req) || !!CFG.accessToken,
      });
      if (p.startsWith('/api/settings')) {
        // 密钥只能在本机改；开放给其他电脑访问时必须设置访问口令
        if (!isLoopback(req) && !CFG.accessToken) throw new HttpError(403, '只能在运行帧间的这台电脑上修改设置');
        if (req.method === 'GET' && p === '/api/settings') return send(res, 200, settingsView());
        if (req.method === 'POST' && p === '/api/settings') return send(res, 200, await saveSettings(await readJson(req)));
        if (req.method === 'POST' && p === '/api/settings/test') return send(res, 200, await testKey(await readJson(req)));
        if (req.method === 'GET' && p === '/api/settings/storage') return send(res, 200, await storageInfo());
        if (req.method === 'POST' && p === '/api/settings/storage/cleanup') return send(res, 200, await cleanupStorage());
      }
      if (p === '/api/store' && req.method === 'GET') return send(res, 200, await loadStore());
      if (p.startsWith('/api/store/projects/')) {
        const f = projFile(decodeURIComponent(p.slice(20)));
        if (req.method === 'PUT') { const d = await readJson(req); if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, '项目格式不正确'); delete d.id; await writeJsonFile(f, d); return send(res, 200, { ok: true }); }
        if (req.method === 'DELETE') { await fsp.rm(f, { force: true }); return send(res, 200, { ok: true }); }
      }
      if (p === '/api/store/history' && req.method === 'POST') return send(res, 200, await addHistory(await readJson(req)));
      if (p === '/api/store/wallet' && req.method === 'PUT') {
        const { credits } = await readJson(req); if (typeof credits !== 'number' || !isFinite(credits)) throw new HttpError(400, '积分格式不正确');
        await writeJsonFile(WALLET_FILE, { credits }); return send(res, 200, { ok: true });
      }
      if (p === '/api/upload' && req.method === 'POST') return send(res, 200, await uploadImage(await readJson(req)));
      if (req.method === 'POST' && p === '/api/image') return send(res, 200, await genImage(await readJson(req)));
      if (req.method === 'POST' && p === '/api/storyboard') return send(res, 200, await genStoryboard(await readJson(req)));
      if (req.method === 'POST' && p === '/api/shot') return send(res, 200, await rewriteShot(await readJson(req)));
      if (req.method === 'POST' && p === '/api/video') return send(res, 200, await createVideo(await readJson(req)));
      if (req.method === 'GET' && p.startsWith('/api/video/')) return send(res, 200, await queryVideo(p.slice(11)));
      if (req.method === 'POST' && p === '/api/concat') return send(res, 200, await concatVideos(await readJson(req)));
      throw new HttpError(404, '接口不存在');
    }
    if (p.startsWith('/files/')) return serveStatic(req, res, path.join(FILES, path.basename(p)));
    // 内置样例：只允许 samples 目录下这几种文件
    if (p.startsWith('/samples/') && /\.(jpg|png|webp|mp4|json)$/.test(p)) return serveStatic(req, res, path.join(ROOT, 'samples', path.basename(p)));
    // 带扩展名或以点开头、但不在白名单里的（如 /favicon.ico、/.env）一律 404，其余路径回落到首页
    if (!STATIC.has(p) && (path.extname(p) || path.basename(p).startsWith('.'))) { res.writeHead(404, SAFE_HEADERS); res.end('Not found'); return; }
    return serveStatic(req, res, path.join(ROOT, STATIC.has(p) ? p : '/index.html'));
  } catch (e) {
    // 5xx 和模型服务返回的错误都记到日志里（后者常是 4xx，比如模型没开通、参数不对），方便排查
    const status = e.status || 500;
    if (status >= 500 || e.raw) console.error(new Date().toLocaleTimeString('zh-CN'), req.method, p, status, e.raw || e.message);
    send(res, status, { error: e.message || '服务器错误' });
  }
});
// 直接运行时才监听端口；测试里 import 这个文件时不自动启动
const realpath = f => { try { return fs.realpathSync(f); } catch { return path.resolve(f); } };
const isMain = !!process.argv[1] && realpath(process.argv[1]) === realpath(fileURLToPath(import.meta.url));
function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}
// 端口被占用时：如果占着的就是这一份帧间，直接打开浏览器后退出；否则换下一个端口
function start(port, tries = 0) {
  const onError = async e => {
    server.off('listening', onListening);
    if (e.code !== 'EADDRINUSE' || tries >= 10) { console.error('启动失败：' + e.message); process.exit(1); }
    const same = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
      .then(r => r.json()).then(j => j.app === 'zhenjian' && j.instance === INSTANCE).catch(() => false);
    if (same) {
      console.log(`帧间已经在运行：http://localhost:${port}${process.env.OPEN_BROWSER === '1' ? '，已为你打开浏览器' : ''}`);
      if (process.env.OPEN_BROWSER === '1') openBrowser(`http://localhost:${port}`);
      setTimeout(() => process.exit(0), 300); return;
    }
    console.log(`端口 ${port} 被其他程序占用，改用 ${port + 1}`);
    start(port + 1, tries + 1);
  };
  const onListening = () => {
    server.off('error', onError);
    const url = `http://localhost:${server.address().port}`;
    console.log(`帧间已启动：${url}${LOOPBACK.has(CFG.host) ? '' : `（监听 ${CFG.host}，其他设备也能访问${CFG.accessToken ? '' : '，建议设置 ACCESS_TOKEN'}）`}`);
    console.log(`  数据保存在：${CFG.dataDir}`);
    console.log(`  火山方舟（Seedream / DeepSeek / Seedance）：${CFG.arkKey ? '已配置' : '未配置，请在网页「设置」里填写'}`);
    console.log(`  分镜模型：${CFG.llmKey ? CFG.llmModel + ' @ ' + CFG.llmBase : '未配置'}`);
    console.log(`  可灵 2.5 Turbo：${CFG.klingAk && CFG.klingSk ? '已配置' : '未配置（精品档不可用）'}`);
    console.log(`  ffmpeg 合成成片：${HAS_FFMPEG ? '可用' : '未安装（导出时改为逐个下载镜头）'}`);
    if (process.env.OPEN_BROWSER === '1') { console.log('  正在打开浏览器… 使用期间请不要关闭这个窗口'); openBrowser(url); }
  };
  server.once('error', onError); server.once('listening', onListening);
  server.listen(port, CFG.host);
}
if (isMain) start(CFG.port);
