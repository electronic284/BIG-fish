from langchain_deepseek import ChatDeepSeek
from langchain_core.messages import AIMessage


class ThinkingChatDeepSeek(ChatDeepSeek):
    """Keep reasoning on assistant turns when replaying tool calls to DeepSeek."""

    def _get_request_payload(self, input_, *, stop=None, **kwargs):
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        messages = self._convert_input(input_).to_messages()
        for source, target in zip(messages, payload["messages"]):
            if isinstance(source, AIMessage):
                target["reasoning_content"] = source.additional_kwargs.get("reasoning_content") or ""
        return payload
