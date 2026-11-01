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
| 流式回复 | `POST /api/v1/chat/stream`，JSON 为 `{message, image_url, thread_id}` |
| 历史记录 | `GET /api/v1/chat/messages?thread_id=...` |
| 清空消息 | `DELETE /api/v1/chat/messages?thread_id=...` |
| 上传签名 | `GET /api/v1/oss/presign?filename=...`，随后 PUT 图片到 `uploadUrl` |

后端虽然声明 `text/event-stream`，实际发送的是纯文本分块；前端使用流式 UTF-8 解码，不按标准 SSE `data:` 事件解析。支持代码围栏显示，其他回复按安全文本显示。

浏览器 localStorage 只缓存会话 ID、标题和当前选择；页面启动时从后端同步已有会话，也可点击“我的对话”旁的刷新按钮。尚未发送的新会话保留在本地，发送并存入后端后可被其他浏览器读取。消息从后端读取。数据库固定使用项目根目录的 `checkpoints.db`，不随启动目录变化。停止按钮仅中断前端接收，后端可能仍会生成并保存消息。

图片支持 JPG、PNG、GIF、WebP，前端限制 10 MB。OSS 需要允许页面来源跨域 PUT 和 Content-Type 请求头，且返回的 accessUrl 应能被模型和浏览器读取。图片理解能力取决于后端配置的模型。

## 验证范围

已检查 JavaScript 语法、静态资源加载、浏览器页面显示、建议卡片填入和接口不可用的错误提示。会话列表修复后，已使用 agent 环境验证数据库副本中的会话去重、历史读取和空库处理；实际后端接口及浏览器也已验证四个旧会话可列出、选择后可显示历史。尚未完成真实模型生成及 OSS 上传的端到端验证。

现有 requirements.txt 未列出后端导入的 `alibabacloud_oss_v2` 对应 SDK 和 `langgraph.checkpoint.postgres` 对应扩展；启动后端时需在实际使用的环境中补齐相关依赖，或移除未使用的 PostgresSaver 导入。
