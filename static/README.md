# 大肥鱼前端

原生 HTML、CSS、JavaScript，无需 npm 安装或打包。`main.py` 已将此目录挂载到 `/`。

在项目所用的 Python 环境中安装并配置好后端依赖、模型及 OSS 凭证后，于 `D:\APP` 运行：

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

打开 http://127.0.0.1:8001/ 。请通过后端服务访问，不要双击 HTML 文件。

## 接口

| 功能 | 请求 |
| --- | --- |
| 会话列表 | `GET /api/v1/chat/threads`，从 checkpoint 数据库读取已有 thread |
| 流式回复 | `POST /api/v1/chat/stream`，JSON 为 `{message, image_url, thread_id, deep_thinking}` |
| 历史记录 | `GET /api/v1/chat/messages?thread_id=...` |
| 清空消息 | `DELETE /api/v1/chat/messages?thread_id=...` |
| 上传签名 | `GET /api/v1/oss/presign?filename=...`，随后 PUT 图片到 `uploadUrl` |

回复使用标准 SSE，每个 `data:` 帧为 JSON `{type, content}`。`type` 为 `reasoning`（思考增量）、`answer`（正文增量）、`done`（完成）或 `error`（生成失败）。前端支持跨网络分块的 UTF-8 和 SSE 解码。支持代码围栏显示，其他回复和思考过程按安全文本显示。旧的纯文本流客户端需要同步更新。

输入框下方的“深度思考”按钮默认关闭，点击后高亮并记住浏览器中的选择。每次发送通过 `deep_thinking` 控制模型的 `thinking.type`，开关只影响后续请求，生成时暂时禁用按钮。开启后显示实时思考过程，正文出现时自动折叠，可手动展开；刷新页面或重新选择会话后仍可查看已保存的思考过程。模型没有返回思考内容时只显示正文。

模型使用 [DeepSeek 思考模式接口](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。两个模式共享会话数据库，分别使用独立模型配置；工具调用后继续请求模型时保留 `reasoning_content`。

浏览器 localStorage 缓存会话 ID、标题、当前选择及深度思考开关；页面启动时从后端同步已有会话，也可点击“我的对话”旁的刷新按钮。尚未发送的新会话保留在本地，发送并存入后端后可被其他浏览器读取。消息从后端读取。数据库固定使用项目根目录的 `checkpoints.db`，不随启动目录变化。停止按钮仅中断前端接收，后端可能仍会生成并保存消息。

图片支持 JPG、PNG、GIF、WebP，前端限制 10 MB。OSS 需要允许页面来源跨域 PUT 和 Content-Type 请求头，且返回的 accessUrl 应能被模型和浏览器读取。图片理解能力取决于后端配置的模型。

## 验证范围

已检查 JavaScript 语法、静态资源加载、浏览器页面显示、建议卡片填入和接口不可用的错误提示。会话列表修复后，已使用 agent 环境验证数据库副本中的会话去重、历史读取和空库处理；实际后端接口及浏览器也已验证四个旧会话可列出、选择后可显示历史。尚未完成真实模型生成及 OSS 上传的端到端验证。

深度思考功能已通过模拟模型 HTTP 接口验证开关参数、SSE 思考/正文分离、工具调用后思考字段回传、同一会话模式切换、历史恢复和生成失败；前端解码测试覆盖中文 UTF-8 字节拆分、多个事件合并、CRLF 和截断响应。浏览器已验证按钮切换、思考折叠/展开和刷新恢复。未调用真实模型 API。

后端测试（需项目依赖及 `httpx`）：`python -m unittest discover -s tests -v`。前端解码测试（Node.js 18+）：`node tests/test_chat_stream.cjs`。

现有 requirements.txt 未列出后端导入的 `alibabacloud_oss_v2` 对应 SDK；启动后端时仍需在实际使用的环境中补齐该依赖。
