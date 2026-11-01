from fastapi import APIRouter
from models.schemas import ChatRequest
from fastapi.responses import StreamingResponse
from agents.base_agent import chat_stream, clear_messages, get_messages, get_threads

router = APIRouter()


@router.get("/chat/threads")
def get_chat_threads():
    """获取数据库中已有的会话列表。"""
    return {"threads": get_threads()}


@router.post("/chat/stream")
async def chat_endpoint(request: ChatRequest):
    """流式对话"""
    return StreamingResponse(
        chat_stream(request.message, request.image_url, request.thread_id, request.deep_thinking),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/chat/messages")
async def get_chat_messages(thread_id: str):
    """获取历史消息"""
    messages = get_messages(thread_id)
    return {"messages": messages}


@router.delete("/chat/messages")
async def clear_chat_messages(thread_id: str):
    """清空历史消息"""
    clear_messages(thread_id)
    return {"success": True}
