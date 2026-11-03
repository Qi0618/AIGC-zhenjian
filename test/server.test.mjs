// 后端测试：用本地假上游模拟火山方舟，不会消耗任何真实额度。运行：npm test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MP4 = Buffer.from('0123456789abcdef');
const calls = [];
let mock, mockUrl, app, base, dataDir;

const ENUMS = { scales: ['远景', '全景', '中景', '近景', '特写'], moods: ['night', 'warm'], cams: ['固定', '推'] };
const STORY = { genre: '悬疑', title: '测试', syn: '一个故事', len: 10, nShots: 2, ratio: '9:16', chars: [{ name: '甲' }, { name: '乙' }] };

function startMock() {
  return new Promise(ok => {
    mock = http.createServer(async (req, res) => {
      let body = ''; for await (const c of req) body += c;
      const j = body ? JSON.parse(body) : null; calls.push({ method: req.method, url: req.url, body: j, auth: req.headers.authorization });
      const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/images/generations') return json({ data: [{ b64_json: PNG.toString('base64') }] });
      if (req.url === '/chat/completions') {
        const ask = j.messages[1].content;
        // 故意包一层 Markdown 代码块、塞进不合法的取值，检查后端的容错
        const content = ask.includes('只重写第')
          ? '{"shot":{"scale":"特写","mood":"warm","cam":"推","desc":"新的画面","line":"台词","dur":4,"cast":[1]}}'
          : '```json\n{"shots":[{"scale":"大远景","mood":"sunny","cam":"甩","desc":"雨夜","line":"","dur":99,"cast":[0,5,0]},{"scale":"近景","mood":"night","cam":"推","desc":"特写门缝","dur":3,"cast":[1]}]}\n```';
        return json({ choices: [{ message: { content } }], usage: { total_tokens: 10 } });
      }
      if (req.method === 'POST' && req.url === '/contents/generations/tasks') return json({ id: 'up-1' });
      if (req.url === '/contents/generations/tasks/up-1') return json({ status: 'succeeded', content: { video_url: mockUrl + '/v.mp4' } });
      if (req.url === '/v.mp4') { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(MP4); }
      res.writeHead(404); res.end();
    }).listen(0, () => { mockUrl = `http://127.0.0.1:${mock.address().port}`; ok(); });
  });
}

before(async () => {
  await startMock();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenjian-test-'));
  Object.assign(process.env, {
    DATA_DIR: dataDir, ARK_API_KEY: 'ark-test', ARK_BASE_URL: mockUrl, ACCESS_TOKEN: 'secret',
    // 显式置空，避免读到本地 .env 里的真实密钥
    DEEPSEEK_API_KEY: '', KLING_ACCESS_KEY: '', KLING_SECRET_KEY: '',
  });
  app = await import('../server/index.mjs');
  await new Promise(ok => app.server.listen(0, ok));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => {
  app.server.closeAllConnections?.(); app.server.close(); mock.closeAllConnections?.(); mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const H = { 'content-type': 'application/json', 'x-access-token': 'secret' };
const post = (p, body, headers = H) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });

test('seedreamSize 保持比例且总像素在 Seedream 允许范围内', () => {
  for (const [w, h] of [[800, 800], [1080, 1920], [1920, 600], [2000, 2000], [100, 4096]]) {
    const [W, H2] = app.seedreamSize(w, h).split('x').map(Number);
    assert.ok(W * H2 >= 1280 * 720 && W * H2 <= 4096 * 4096, `${w}x${h} → ${W}x${H2}`);
    if (w / h <= 16 && h / w <= 16) assert.ok(Math.abs(W / H2 - w / h) / (w / h) < 0.02);
  }
});

test('parseRange 处理常见写法和越界', () => {
  assert.deepEqual(app.parseRange('bytes=0-3', 10), { start: 0, end: 3 });
  assert.deepEqual(app.parseRange('bytes=4-', 10), { start: 4, end: 9 });
  assert.deepEqual(app.parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(app.parseRange('bytes=5-100', 10), { start: 5, end: 9 });
  assert.equal(app.parseRange('bytes=10-', 10), null);
  assert.equal(app.parseRange('bytes=5-2', 10), null);
  assert.equal(app.parseRange('bytes=-', 10), null);
  assert.equal(app.parseRange('items=0-1', 10), null);
});

test('normalizeShot 修正不合法的取值', () => {
  const s = app.normalizeShot({ scale: 'x', mood: 'y', cam: 'z', dur: 0.2, cast: [1, 1, 9, -1, 'a'] }, ENUMS, 2);
  assert.deepEqual(s, { scale: '中景', mood: 'night', cam: '固定', desc: '', line: '', dur: 2, cast: [1] });
});

test('health 不需要口令，并报告模型配置', async () => {
  const j = await (await fetch(base + '/api/health')).json();
  assert.equal(j.ok, true); assert.equal(j.auth, true);
  assert.ok(j.models.image && j.models.llm && j.models.seedance); assert.equal(j.models.kling, false);
});

test('设置了 ACCESS_TOKEN 时，没有或错误的口令返回 401', async () => {
  assert.equal((await post('/api/image', { prompt: 'x' }, { 'content-type': 'application/json' })).status, 401);
  assert.equal((await post('/api/image', { prompt: 'x' }, { ...H, 'x-access-token': 'secreT' })).status, 401);
  assert.equal((await post('/api/image', { prompt: 'x' }, { ...H, 'x-access-token': 's' })).status, 401);
});

test('生图：结果保存到本地，可以按 Range 读取', async () => {
  const r = await post('/api/image', { prompt: '一瓶精华', width: 800, height: 800 });
  assert.equal(r.status, 200); const { url } = await r.json();
  assert.match(url, /^\/files\/[a-z0-9]+\.jpg$/);
  const call = calls.find(c => c.url === '/images/generations');
  assert.equal(call.auth, 'Bearer ark-test'); assert.equal(call.body.size, app.seedreamSize(800, 800));
  const full = Buffer.from(await (await fetch(base + url)).arrayBuffer());
  assert.deepEqual(full, PNG);
  const part = await fetch(base + url, { headers: { range: 'bytes=-4' } });
  assert.equal(part.status, 206); assert.deepEqual(Buffer.from(await part.arrayBuffer()), PNG.subarray(-4));
  assert.equal((await fetch(base + url, { headers: { range: 'bytes=99999-' } })).status, 416);
});

test('生图：缺少提示词返回 400', async () => {
  const r = await post('/api/image', {});
  assert.equal(r.status, 400); assert.match((await r.json()).error, /提示词/);
});

test('分镜：能解析带代码块的回复，并修正取值', async () => {
  const r = await post('/api/storyboard', { story: STORY, enums: ENUMS });
  assert.equal(r.status, 200); const { shots } = await r.json();
  assert.equal(shots.length, 2);
  assert.deepEqual(shots[0], { scale: '中景', mood: 'night', cam: '固定', desc: '雨夜', line: '', dur: 8, cast: [0] });
  assert.deepEqual(shots[1].cast, [1]);
});

test('重写单个镜头', async () => {
  const shots = [{ desc: 'A', dur: 3 }, { desc: 'B', dur: 4 }];
  const r = await post('/api/shot', { story: STORY, enums: ENUMS, shots, index: 1 });
  assert.equal(r.status, 200); const { shot } = await r.json();
  assert.deepEqual(shot, { scale: '特写', mood: 'warm', cam: '推', desc: '新的画面', line: '台词', dur: 4, cast: [1] });
  const ask = calls.filter(c => c.url === '/chat/completions').pop().body.messages[1].content;
  assert.match(ask, /只重写第 2 个镜头/); assert.match(ask, /2\. .*B.*← 需要重写/);
  assert.equal((await post('/api/shot', { story: STORY, enums: ENUMS, shots, index: 5 })).status, 400);
});

test('视频：创建任务 → 查询完成 → 下载到本地；任务记录写入磁盘', async () => {
  const img = 'data:image/png;base64,' + PNG.toString('base64');
  const { id } = await (await post('/api/video', { provider: 'seedance', image: img, prompt: '走路', duration: 2 })).json();
  const create = calls.find(c => c.url === '/contents/generations/tasks');
  assert.equal(create.body.duration, 4, '短于 4 秒按 4 秒生成');
  const q = await (await fetch(base + '/api/video/' + id, { headers: H })).json();
  assert.equal(q.status, 'succeeded'); assert.match(q.url, /\.mp4$/);
  assert.deepEqual(Buffer.from(await (await fetch(base + q.url)).arrayBuffer()), MP4);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8'))[id]);
  assert.equal((await fetch(base + '/api/video/nope', { headers: H })).status, 404);
});

test('可灵未配置时返回 503 和提示', async () => {
  const r = await post('/api/video', { provider: 'kling', image: 'data:image/png;base64,AA==' });
  assert.equal(r.status, 503); assert.match((await r.json()).error, /可灵/);
});

test('静态文件：白名单之外带扩展名的路径 404，其余回落首页', async () => {
  assert.equal((await fetch(base + '/favicon.ico')).status, 404);
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await fetch(base + '/server/index.mjs')).status, 404);
  const home = await fetch(base + '/projects');
  assert.equal(home.status, 200); assert.match(await home.text(), /<title>帧间/);
  const js = await fetch(base + '/app.js');
  assert.match(js.headers.get('content-type'), /javascript/); assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
});
