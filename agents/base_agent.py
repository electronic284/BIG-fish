import os
import json
from pathlib import Path
from common.deepseek_model import ThinkingChatDeepSeek
from langchain.agents import create_agent
from langchain.tools import tool
from pydantic import BaseModel
# from langgraph.checkpoint.memory import InMemorySaver
# from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.checkpoint.sqlite import SqliteSaver
from common.logger import logger
from langchain.messages import HumanMessage, AIMessage, AIMessageChunk
import sqlite3

@tool
def get_weather(location:str)->str:
    """查询指定城市的实时天气。用户问天气时调用。

        Args:
            city: 城市名称（中文或英文均可）。
        """
    return f'{location} is sunny'

class system_info(BaseModel):
    name: str
    location:str



key = os.getenv("DEEPSEEK_API_KEY")
base_url = os.getenv('BASE_URL')
print(f"Key 是否存在: {key is not None}")

def make_model(deep_thinking: bool):
    return ThinkingChatDeepSeek(
        model="deepseek-flash",
        extra_body={"thinking": {"type": "enabled" if deep_thinking else "disabled"}},
    )


model = make_model(True)

system_prompt = """
#身份
- 你是一条大肥鱼

#指令
- 每次回答我时，都要加上主人

#示例
- user: ...
assistant: ...

"""

# config = {"configurable": {"thread_id": "thread_4"}}
DATABASE_PATH = Path(__file__).resolve().parents[1] / "checkpoints.db"
connection = sqlite3.connect(DATABASE_PATH, check_same_thread=False)
checkpointer = SqliteSaver(connection)
checkpointer.setup()
agent = create_agent(model=model, tools=[get_weather, ], system_prompt=system_prompt, checkpointer=checkpointer)
fast_agent = create_agent(model=make_model(False), tools=[get_weather], system_prompt=system_prompt, checkpointer=checkpointer)


def message_parts(message):
    """Separate provider reasoning from answer text, including standard content blocks."""
    reasoning = message.additional_kwargs.get("reasoning_content") or ""
    content = message.content
    if isinstance(content, str):
        return reasoning, content
    text, thoughts = [], []
    for block in content:
        if isinstance(block, str):
            text.append(block)
        elif isinstance(block, dict):
            if block.get("type") == "text":
                text.append(block.get("text", ""))
            elif block.get("type") == "reasoning":
                thoughts.append(block.get("reasoning", ""))
    return reasoning or "".join(thoughts), "".join(text)


def stream_event(kind, content=""):
    return "data: " + json.dumps({"type": kind, "content": content}, ensure_ascii=False) + "\n\n"

# 流式对话
def chat_stream(prompt: str, image: str, thread_id: str, deep_thinking: bool = False):
    """同步迭代器由 StreamingResponse 在线程池中运行，分别发送思考与正文。"""
    logger.info(f"[用户]: {prompt}, image: {image}, thread_id: {thread_id}")
    try:
        # 判断是否有图片，封装不同格式的消息
        if not image or image.strip() == "":
            message = HumanMessage(content=prompt)
        else:
            message = HumanMessage(content=[
                {"type": "image", "url": image},
                {"type": "text", "text": prompt}
            ])

        # 流式调用Agent
        selected_agent = agent if deep_thinking else fast_agent
        for chunk, metadata in selected_agent.stream(
            {"messages": [message]},
            {"configurable": {"thread_id": thread_id}},
            stream_mode="messages"
        ):
            if isinstance(chunk, AIMessageChunk):
                reasoning, text = message_parts(chunk)
                if deep_thinking and reasoning:
                    yield stream_event("reasoning", reasoning)
                if text:
                    yield stream_event("answer", text)
        yield stream_event("done")

    except Exception as e:
        logger.error(f"\n[错误]: {str(e)}")
        yield stream_event("error", "回复生成失败，请稍后重试。")

# 清空会话
def clear_messages(thread_id: str):
    """清空会话"""
    logger.info(f"清空历史消息，thread_id: {thread_id}")
    checkpointer.delete_thread(thread_id)

# 查询会话历史
def get_messages(thread_id: str) -> list[dict]:
    """获取会话历史"""
    logger.info(f"获取历史消息，thread_id: {thread_id}")

    # 根据 thread_id 查询 checkpoint
    checkpoint = checkpointer.get({"configurable": {"thread_id": thread_id}})

    # 如果不存在，返回空列表
    if not checkpoint:
        return []

    # 安全获取 messages
    channel_values = checkpoint.get("channel_values")
    if not channel_values:
        return []

    messages = channel_values.get("messages", [])
    if not messages:
        return []

    # 转换消息格式
    result = []
    for msg in messages:
        reasoning, text = message_parts(msg)
        if not msg.content and not reasoning:
            continue

        if isinstance(msg, HumanMessage):
            result.append({"role": "user", "content": msg.content})
        elif isinstance(msg, AIMessage):
            result.append({"role": "assistant", "content": text, "reasoning": reasoning})

    return result


def get_threads() -> list[dict[str, str]]:
    """列出根会话，每个 thread 只返回一条，按最近 checkpoint 排序。"""
    # 使用独立只读连接，不与流式写入共享游标，也不修改 checkpoint 数据。
    db = sqlite3.connect(DATABASE_PATH.as_uri() + "?mode=ro", uri=True)
    try:
        rows = db.execute(
            "SELECT thread_id, MAX(checkpoint_id) AS latest "
            "FROM checkpoints WHERE checkpoint_ns = '' "
            "GROUP BY thread_id ORDER BY latest DESC, thread_id"
        ).fetchall()
    finally:
        db.close()

    threads = []
    for thread_id, _ in rows:
        title = thread_id
        for message in get_messages(thread_id):
            if message["role"] != "user":
                continue
            content = message["content"]
            if isinstance(content, list):
                content = " ".join(
                    block if isinstance(block, str) else block.get("text", "")
                    for block in content
                    if isinstance(block, str) or (
                        isinstance(block, dict) and block.get("type") == "text"
                    )
                )
            if isinstance(content, str) and content.strip():
                title = " ".join(content.split())[:24]
                break
        threads.append({"id": thread_id, "title": title})
    return threads

# agent = create_agent(model=model, tools=[get_weather, ], system_prompt=system_prompt, checkpointer=InMemorySaver())
# response = agent.stream({
#     'messages': [{'role':'user', 'content': '给我写200字小作文，主题为我的主人'}]
# }, stream_mode='messages')


# response = agent.invoke({
#     'messages': [{'role': 'user', 'content': '我是谁'}]
# }, config)


# for message in response['messages']:
#     message.pretty_print()

# response2 = agent.invoke({
#     'messages': [{'role': 'user', 'content': ''}]
# }, config)
#
# for message in response2['messages']:
#     message.pretty_print()


# response = model.stream([
#     {
#         'role': 'system',
#         'content': '',
#     },
#     {
#         'role': 'user',
#         'content': ''
#     }
# ])
# for i in response:
#     print(i.content, end = '',flush = True)
