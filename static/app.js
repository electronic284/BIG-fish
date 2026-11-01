(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE = 'big-fish.sessions.v1';
  const ACTIVE = 'big-fish.active.v1';
  const uuid = () => globalThis.crypto?.randomUUID?.() || `fish-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let sessions = [], activeId, busy = false, loading = false, syncing = false, controller, historyController;
  let selectedImage = null, previewUrl = null, loadVersion = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    if (Array.isArray(saved)) sessions = saved.filter(s => s && typeof s.id === 'string' && typeof s.title === 'string');
    activeId = localStorage.getItem(ACTIVE);
  } catch { /* Storage may be unavailable in private browsing. */ }
  if (!sessions.length) sessions.push({ id: uuid(), title: '新的对话' });
  if (!sessions.some(s => s.id === activeId)) activeId = sessions[0].id;

  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify(sessions)); localStorage.setItem(ACTIVE, activeId); }
    catch { notice('浏览器无法保存会话列表，刷新后可能无法找回当前会话。'); }
  }
  function notice(text, retry = false) {
    $('notice-text').textContent = text;
    $('retry-history').hidden = !retry;
    $('notice').hidden = !text;
  }
  function menu(open) {
    $('sidebar').classList.toggle('open', open);
    $('backdrop').hidden = !open;
    $('menu-toggle').setAttribute('aria-expanded', String(open));
  }
  function renderSessions() {
    $('sessions').replaceChildren();
    sessions.forEach(session => {
      const button = document.createElement('button');
      button.className = `session-button${session.id === activeId ? ' active' : ''}`;
      button.disabled = busy || syncing;
      button.setAttribute('aria-current', session.id === activeId ? 'true' : 'false');
      const icon = document.createElement('span'); icon.className = 'session-icon'; icon.textContent = '◷';
      const title = document.createElement('span'); title.textContent = session.title;
      button.append(icon, title); button.title = session.title;
      button.addEventListener('click', () => { if (!busy) { activeId = session.id; resetImage(); persist(); renderSessions(); loadHistory(); menu(false); } });
      $('sessions').append(button);
    });
    $('session-count').textContent = sessions.length;
    $('page-title').textContent = sessions.find(s => s.id === activeId)?.title || '新的对话';
  }
  function updateControls() {
    $('send-button').disabled = syncing || loading || (!busy && !$('message-input').value.trim() && !selectedImage);
    $('send-button').textContent = busy ? '■' : '↑';
    $('send-button').classList.toggle('busy', busy);
    $('send-button').setAttribute('aria-label', busy ? '停止接收回复' : '发送消息');
    $('send-button').title = busy ? '停止接收（后端可能仍在生成）' : '发送消息';
    $('upload-image').disabled = busy || loading || syncing;
    $('remove-image').disabled = busy;
    $('message-input').disabled = busy;
    $('new-chat').disabled = busy || syncing;
    $('refresh-sessions').disabled = busy || loading || syncing;
    $('clear-chat').disabled = busy || loading || syncing;
    $('messages').setAttribute('aria-busy', String(busy || loading));
  }
  function showMessages() { $('welcome').hidden = true; $('messages').hidden = false; }
  function scrollBottom(force = false) {
    const pane = $('conversation');
    if (force || pane.scrollHeight - pane.scrollTop - pane.clientHeight < 160) pane.scrollTop = pane.scrollHeight;
  }
  function safeImage(url) {
    try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; }
  }
  // Render as text nodes: model output and history must never become executable HTML.
  function renderText(target, text) {
    target.replaceChildren();
    const blocks = String(text).split(/```(?:[^\n`]*\n)?/);
    blocks.forEach((block, index) => {
      if (index % 2) { const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = block; pre.append(code); target.append(pre); }
      else target.append(document.createTextNode(block));
    });
  }
  function contentParts(content) {
    if (typeof content === 'string') return { text: content, images: [] };
    const parts = { text: '', images: [] };
    if (Array.isArray(content)) for (const block of content) {
      if (typeof block === 'string') parts.text += block;
      else if (block?.type === 'text') parts.text += block.text || '';
      else if (block?.type === 'image' || block?.type === 'image_url') {
        const url = block.url || block.image_url?.url || block.image_url;
        if (typeof url === 'string' && safeImage(url)) parts.images.push(url);
      }
    }
    return parts;
  }
  function addMessage(role, content, pending = false) {
    showMessages();
    const parts = contentParts(content);
    const row = document.createElement('article'); row.className = `message ${role}`;
    const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = role === 'user' ? '我' : '鱼';
    const main = document.createElement('div'); main.className = 'message-main';
    const meta = document.createElement('div'); meta.className = 'message-meta'; meta.textContent = role === 'user' ? '你' : '大肥鱼';
    const body = document.createElement('div'); body.className = 'message-content';
    const text = document.createElement('div'); text.classList.toggle('pending', pending); renderText(text, parts.text);
    for (const url of parts.images) { const img = document.createElement('img'); img.src = url; img.alt = '消息中的图片'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; body.append(img); }
    body.append(text);
    if (role === 'assistant') {
      const copy = document.createElement('button'); copy.className = 'copy-button'; copy.textContent = '复制';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text.textContent); copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制'; }, 1500); }
        catch { notice('复制失败，请手动选中回复文字进行复制。'); }
      }); meta.append(copy);
    }
    const status = document.createElement('div'); status.className = 'message-status';
    main.append(meta, body, status); row.append(avatar, main); $('messages').append(row);
    return { text, status, row };
  }
  async function checkedFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    return response;
  }
  async function syncSessions() {
    if (busy || syncing) return;
    syncing = true; updateControls(); renderSessions();
    let failure = '';
    try {
      const response = await checkedFetch('/api/v1/chat/threads');
      const data = await response.json();
      if (!Array.isArray(data.threads) || data.threads.some(s => !s || typeof s.id !== 'string' || typeof s.title !== 'string')) {
        throw new Error('会话列表格式不正确');
      }
      const serverIds = new Set(data.threads.map(s => s.id));
      // 未发送的新会话尚未写入数据库，合并时保留本地会话。
      sessions = [...data.threads, ...sessions.filter(s => !serverIds.has(s.id))];
      persist(); renderSessions();
    } catch (error) {
      failure = `无法同步会话列表：${error.message}。当前显示本地缓存，可点击刷新重试。`;
    }
    try {
      await loadHistory();
      if (failure) notice(failure, true);
    } finally {
      syncing = false; updateControls(); renderSessions();
    }
  }
  async function loadHistory() {
    historyController?.abort(); historyController = new AbortController();
    const version = ++loadVersion; loading = true; updateControls(); notice('');
    $('messages').replaceChildren(); $('messages').hidden = true; $('welcome').hidden = true;
    notice('正在读取会话…');
    try {
      const response = await checkedFetch(`/api/v1/chat/messages?thread_id=${encodeURIComponent(activeId)}`, { signal: historyController.signal });
      const data = await response.json();
      if (version !== loadVersion) return;
      if (!Array.isArray(data.messages)) throw new Error('历史消息格式不正确');
      for (const message of data.messages) if (['user', 'assistant'].includes(message.role)) addMessage(message.role, message.content);
      $('welcome').hidden = $('messages').childElementCount > 0;
      notice(''); scrollBottom(true);
    } catch (error) {
      if (version !== loadVersion) return;
      $('welcome').hidden = false;
      notice(`无法读取历史消息：${error.message}。请确认后端服务已启动。`, true);
    } finally { if (version === loadVersion) { loading = false; updateControls(); } }
  }
  function resetImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    selectedImage = null; previewUrl = null; $('attachment').hidden = true;
    $('attachment-preview').removeAttribute('src'); $('image-input').value = ''; updateControls();
  }
  async function uploadImage(file, signal) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[file.type];
    const filename = `chat-${uuid()}.${ext}`;
    const response = await checkedFetch(`/api/v1/oss/presign?filename=${encodeURIComponent(filename)}`, { signal });
    const data = await response.json();
    if (!safeImage(data.uploadUrl) || !safeImage(data.accessUrl)) throw new Error('图片上传地址无效');
    await checkedFetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': data.contentType || file.type }, body: file, signal });
    return data.accessUrl;
  }
  $('chat-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) { controller?.abort(); return; }
    const prompt = $('message-input').value.trim();
    if (loading || syncing || (!prompt && !selectedImage)) return;
    const message = prompt || '请帮我看看这张图片。';
    const file = selectedImage;
    busy = true; controller = new AbortController(); updateControls(); renderSessions(); notice('');
    let reply, submitted = false, output = '';
    try {
      let imageUrl = null;
      if (file) { notice('正在上传图片…'); imageUrl = await uploadImage(file, controller.signal); notice(''); }
      addMessage('user', imageUrl ? [{ type: 'image', url: imageUrl }, { type: 'text', text: message }] : message);
      reply = addMessage('assistant', '', true); scrollBottom(true);
      const session = sessions.find(s => s.id === activeId);
      if (session.title === '新的对话') { session.title = message.slice(0, 24); persist(); renderSessions(); }
      submitted = true;
      $('message-input').value = ''; $('message-input').style.height = ''; resetImage();
      const response = await checkedFetch('/api/v1/chat/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, image_url: imageUrl, thread_id: activeId }), signal: controller.signal
      });
      if (!response.body) throw new Error('浏览器不支持流式响应');
      const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8');
      // Backend declares text/event-stream but yields raw text, without SSE data: frames.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        renderText(reply.text, output); scrollBottom();
      }
      output += decoder.decode(); renderText(reply.text, output);
      if (!output.trim()) reply.status.textContent = '没有收到回复，请稍后重新尝试。';
    } catch (error) {
      const stopped = error.name === 'AbortError';
      if (reply) reply.status.textContent = stopped ? '已停止接收。后端可能仍在生成，稍后可切换会话刷新历史。' : `回复未完成：${error.message}。可切换会话查看后端是否已保存消息。`;
      else notice(stopped ? '已取消图片上传。' : `图片上传失败：${error.message}。请检查上传服务和 OSS 跨域配置。`);
      if (submitted && !stopped) notice('发送失败或连接中断，输入框已恢复原消息；重新发送前可先检查历史，避免重复。');
      if (submitted && !stopped) $('message-input').value = prompt;
    } finally {
      reply?.text.classList.remove('pending'); busy = false; controller = null; updateControls(); renderSessions(); $('message-input').focus();
    }
  });
  $('message-input').addEventListener('input', () => {
    const input = $('message-input'); input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; updateControls();
  });
  $('message-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!busy) $('chat-form').requestSubmit(); }
  });
  $('upload-image').addEventListener('click', () => $('image-input').click());
  $('image-input').addEventListener('change', () => {
    const file = $('image-input').files[0]; if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) { notice('请选择 JPG、PNG、GIF 或 WebP 图片。'); $('image-input').value = ''; return; }
    if (file.size > 10 * 1024 * 1024) { notice('图片不能超过 10 MB，请压缩后再上传。'); $('image-input').value = ''; return; }
    resetImage(); selectedImage = file; previewUrl = URL.createObjectURL(file);
    $('attachment-preview').src = previewUrl; $('attachment-name').textContent = file.name;
    $('attachment').hidden = false; notice(''); updateControls();
  });
  $('remove-image').addEventListener('click', resetImage);
  $('new-chat').addEventListener('click', () => {
    if (busy) return;
    const session = { id: uuid(), title: '新的对话' }; sessions.unshift(session); activeId = session.id;
    $('message-input').value = ''; resetImage(); persist(); renderSessions(); loadHistory(); menu(false); $('message-input').focus();
  });
  $('clear-chat').addEventListener('click', () => {
    if (!busy && !loading) { $('clear-dialog').returnValue = ''; $('clear-dialog').showModal(); }
  });
  $('clear-dialog').addEventListener('close', async () => {
    if ($('clear-dialog').returnValue !== 'confirm' || busy || loading) return;
    busy = true; updateControls(); renderSessions();
    try {
      await checkedFetch(`/api/v1/chat/messages?thread_id=${encodeURIComponent(activeId)}`, { method: 'DELETE' });
      sessions.find(s => s.id === activeId).title = '新的对话'; persist(); await loadHistory();
    } catch (error) { notice(`清空失败：${error.message}`); }
    finally { busy = false; updateControls(); renderSessions(); }
  });
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    $('message-input').value = button.dataset.prompt; $('message-input').dispatchEvent(new Event('input')); $('message-input').focus();
  }));
  $('menu-toggle').addEventListener('click', () => menu(!$('sidebar').classList.contains('open')));
  $('backdrop').addEventListener('click', () => menu(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') menu(false); });
  $('dismiss-notice').addEventListener('click', () => notice(''));
  $('retry-history').addEventListener('click', syncSessions);
  $('refresh-sessions').addEventListener('click', syncSessions);
  persist(); renderSessions(); syncSessions();
})();
