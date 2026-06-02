import asyncio

from iii import HttpRequest, HttpResponse, StreamingRequest


def test_http_request_buffered_has_body_no_reader():
    req = HttpRequest(path="/x", method="GET", body={"a": 1})
    assert req.body == {"a": 1}
    assert not hasattr(req, "request_body")


def test_http_response_buffered_shape():
    resp = HttpResponse(statusCode=201, body={"ok": True})
    assert resp.status_code == 201


def test_streaming_request_has_reader_field():
    import dataclasses
    fields = {f.name for f in dataclasses.fields(StreamingRequest)}
    assert "request_body" in fields
    assert "body" not in fields


class _FakeWriter:
    def __init__(self):
        self.sent = []

    async def send_message_async(self, m):
        self.sent.append(m)

    @property
    def stream(self):
        return None

    def close(self):
        pass


def test_http_wrapper_delivers_buffered_request():
    from iii.utils import http
    captured = {}

    async def handler(req, res):
        captured["body"] = req.body
        captured["has_reader"] = hasattr(req, "request_body")
        return None

    wrapped = http(handler)
    raw = {
        "path_params": {}, "query_params": {}, "headers": {}, "method": "POST",
        "path": "/x", "body": {"a": 1},
        "request_body": object(), "response": _FakeWriter(),
    }
    asyncio.run(wrapped(raw))
    assert captured["body"] == {"a": 1}
    assert captured["has_reader"] is False


def test_http_stream_wrapper_delivers_streaming_request():
    from iii.utils import http_stream
    captured = {}

    async def handler(req, res):
        captured["has_reader"] = hasattr(req, "request_body")
        captured["has_body"] = hasattr(req, "body")

    wrapped = http_stream(handler)
    raw = {
        "path_params": {}, "query_params": {}, "headers": {}, "method": "POST",
        "path": "/x", "body": {"a": 1},
        "request_body": object(), "response": _FakeWriter(),
    }
    asyncio.run(wrapped(raw))
    assert captured["has_reader"] is True
    assert captured["has_body"] is False
