"""Exercise the real API, agents and SQLite history against a fake model transport."""
import importlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from common.deepseek_model import ThinkingChatDeepSeek


class DeepThinkingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.db = sqlite3.connect(Path(cls.temp.name) / "history.db", check_same_thread=False)
        cls.requests = []
        cls.fail = False

        def respond(request):
            payload = json.loads(request.content)
            cls.requests.append(payload)
            if cls.fail:
                return httpx.Response(400, json={"error": {"message": "test failure"}})
            deltas = [{"role": "assistant"}]
            if payload["thinking"]["type"] == "enabled":
                deltas.append({"reasoning_content": "先分析问题。\n再核对条件。"})
            tool_turn = payload["messages"][-1]["content"] == "test-tool"
            if tool_turn:
                deltas.append({"tool_calls": [{"index": 0, "id": "weather-1", "type": "function",
                                               "function": {"name": "get_weather", "arguments": '{"location":"北京"}'}}]})
            else:
                deltas.append({"content": "主人，答案是 42。"})
            events = []
            for delta in deltas:
                events.append("data: " + json.dumps({
                    "id": "test-response", "object": "chat.completion.chunk",
                    "created": 1, "model": "deepseek-flash",
                    "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
                }) + "\n\n")
            events.append("data: " + json.dumps({"id": "test-response", "object": "chat.completion.chunk",
                "created": 1, "model": "deepseek-flash", "choices": [{"index": 0, "delta": {},
                "finish_reason": "tool_calls" if tool_turn else "stop"}]}) + "\n\ndata: [DONE]\n\n")
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, text="".join(events))

        cls.http = httpx.Client(transport=httpx.MockTransport(respond))

        def make_model(**kwargs):
            return ThinkingChatDeepSeek(**kwargs, api_key="test-only", http_client=cls.http, max_retries=0)

        # Import without touching the user's database or reading their credentials.
        with patch("sqlite3.connect", return_value=cls.db), patch("common.deepseek_model.ThinkingChatDeepSeek", side_effect=make_model):
            cls.backend = importlib.import_module("agents.base_agent")
        from api.v1.chat import router
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.http.close()
        cls.db.close()
        cls.temp.cleanup()

    def send(self, thread, **options):
        response = self.client.post("/api/v1/chat/stream", json={
            "message": "求答案", "thread_id": thread, **options,
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        return [json.loads(frame[6:]) for frame in response.text.strip().split("\n\n")]

    def test_toggle_and_reload_same_thread(self):
        events = self.send("toggle", deep_thinking=True)
        self.assertEqual(self.requests[-1]["thinking"], {"type": "enabled"})
        self.assertIn("reasoning", [event["type"] for event in events])
        self.assertEqual(events[-1]["type"], "done")
        history = self.client.get("/api/v1/chat/messages", params={"thread_id": "toggle"}).json()["messages"]
        self.assertEqual(history[-1]["reasoning"], "先分析问题。\n再核对条件。")
        self.assertEqual(history[-1]["content"], "主人，答案是 42。")
        events = self.send("toggle", deep_thinking=False)
        self.assertEqual(self.requests[-1]["thinking"], {"type": "disabled"})
        self.assertNotIn("reasoning", [event["type"] for event in events])
        self.assertGreaterEqual(len(self.requests[-1]["messages"]), 4)

    def test_default_is_fast(self):
        events = self.send("default")
        self.assertEqual(self.requests[-1]["thinking"]["type"], "disabled")
        self.assertEqual("".join(e["content"] for e in events if e["type"] == "answer"), "主人，答案是 42。")

    def test_thinking_survives_tool_call(self):
        events = self.send("tools", message="test-tool", deep_thinking=True)
        self.assertEqual(events[-1]["type"], "done")
        replayed = [m for m in self.requests[-1]["messages"] if m.get("tool_calls")]
        self.assertEqual(len(replayed), 1)
        self.assertEqual(replayed[0]["reasoning_content"], "先分析问题。\n再核对条件。")

    def test_provider_error_is_not_an_answer(self):
        type(self).fail = True
        try:
            events = self.send("failed", deep_thinking=True)
            self.assertEqual([e["type"] for e in events], ["error"])
        finally:
            type(self).fail = False


if __name__ == "__main__":
    unittest.main()
