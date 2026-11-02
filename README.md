# 绘影 Huiying

**绘**图，成**影**。面向电商和短剧团队的 AI 视觉创作工作台 Demo，包含两个模块：

- **电商图片**：批量导入 SKU，按套图方案为每个商品一次生成白底图、主图、场景图，支持按平台批量改尺寸、批量换风格。
- **短剧生成**：故事设定 + 角色卡 → 分镜脚本 → 关键帧确认 → 逐镜生成视频并预览成片。

当前版本不接任何模型。图片和视频都用浏览器 Canvas 模拟生成，用来验证交互流程和信息结构。

## 功能一览

### 电商图片
- 批量上传商品图，每张图自动成为一个 SKU，可补充名称、卖点、到手价
- 套图方案：图片类型多选 × 尺寸多选 × 每组张数，生成前显示总张数和预计积分
- 风格选择带示例图，示例用当前选中的商品实时渲染
- 7 个平台尺寸预设（淘宝/天猫、京东、详情页、小红书、抖音、亚马逊、店铺横幅）+ 自定义尺寸
- 结果按 SKU 分组，可筛选、全选本组；批量改尺寸 / 改风格 / 删除

### 短剧生成
- 题材示例（都市逆袭、甜宠、悬疑），单集时长与镜头数可调
- 画面比例 9:16 / 16:9，画风（写实 / 电影感 / 动漫）选择带示例图
- 角色卡：姓名、身份、外形、主色、参考图，分镜中按角色选择出镜，保证前后一致
- 分镜可逐镜编辑景别、运镜、光线、时长、画面描述、台词，并显示总时长与目标时长是否匹配
- 关键帧确认：确认 / 重画 / 改提示词重画 / 框选区域局部重绘；只有确认过的镜头会进入视频生成
- 视频生成队列（并发 2）、时间轴、带运镜和字幕的成片预览

### 界面
- 浅色（宣纸暖白 + 朱砂）与深色（墨色 + 暖朱）两套主题，默认跟随系统，侧栏可手动切换
- 手机宽度下自动改为顶部导航

### 管理
- 项目：两个模块各自的项目列表，状态自动保存
- 历史记录：每次生成任务的内容和积分消耗，可跳回对应项目
- 积分：演示额度 3000，生成前显示预估，余额不足时拦截

## 本地运行

不需要构建，任意静态服务器即可：

```bash
# 任选其一
npx serve .
python3 -m http.server 8080
```

然后打开 `http://localhost:8080`（或命令输出的地址）。也可以直接双击 `index.html` 打开，但部分浏览器在 `file://` 下会限制本地存储。

## 部署到 GitHub Pages

1. 把本目录推到 GitHub 仓库的默认分支
2. 仓库 **Settings → Pages**，Source 选 **Deploy from a branch**，分支选 `main`、目录选 `/ (root)`
3. 保存后稍等片刻，页面会出现在 `https://<用户名>.github.io/<仓库名>/`

## 数据存储

| 运行环境 | 项目 / 历史 / 积分 | 上传的图片 |
| --- | --- | --- |
| 普通浏览器（本地或 GitHub Pages） | `localStorage` | IndexedDB |
| Claude Artifact 内 | Claude 提供的云端数据库 | Claude 提供的文件存储 |
| 以上都不可用 | 仅保存在本次会话 | 仅保存在本次会话 |

存储逻辑集中在 `app.js` 的 `Store` 对象里。换成自己的后端时，实现同名方法即可：
`init`、`saveProject`、`deleteProject`、`addHistory`、`saveWallet`、`putImage`。

## 接入模型

所有生成调用都集中在 `app.js` 顶部的 `API` 对象。把 4 个函数换成真实接口，页面其余部分不用改。每个函数返回 Promise，`onProgress` 接收 0~1 的进度。

| 函数 | 入参 | 当前返回 | 接入后建议返回 |
| --- | --- | --- | --- |
| `generateImages(jobs, onProgress)` | `[{skuId, type, style, size, seed}]` | 同一批 job（带 seed） | 每个 job 附加图片 `url` |
| `generateStoryboard(story)` | `{genre, title, syn, chars, nShots, len}` | 镜头数组 | 由大模型生成的镜头数组，字段同 `toShot()` |
| `generateKeyframe(req, onProgress)` | `{shot, prompt, region, note}`，`region` 为空表示整张重画 | `{seed}` | `{url}`；`region` 为 0~1 的归一化坐标，可直接用于 inpainting mask |
| `generateVideo(shot, onProgress)` | 已确认关键帧的镜头 | `{ok}` | `{url}`，图生视频，首帧用关键帧 |

接入真实图片后，需要把 `renderImage()` / `drawFrame()` 的 Canvas 绘制换成展示返回的 `url`。

## 积分配置

价格在 `app.js` 的 `PRICING` 里，均为示意值：

```js
const PRICING = {
  imageBase: 2,      // 单张电商图
  imageLarge: 3,     // 长边超过 largeSide 的电商图
  largeSide: 1500,
  storyboard: 5,     // 生成一次分镜脚本
  keyframe: 4,       // 生成或整张重画一张关键帧
  inpaint: 2,        // 局部重绘一次
  videoPerSec: 10,   // 视频每秒
};
const DEFAULT_CREDITS = 3000; // 演示额度
```

## 目录结构

```
.
├── index.html   页面结构
├── styles.css   样式（明暗两套主题，颜色均为 :root 上的 CSS 变量）
├── app.js       全部逻辑：API 接入点、Store 存储、电商模块、短剧模块、项目与历史
└── README.md
```
