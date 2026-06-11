"""StreamRequest / StreamResponse streaming types and the D7 Http* / Api* split."""

import iii_http

from iii import (
    ApiRequest,
    ApiResponse,
    HttpRequest,
    HttpResponse,
    StreamRequest,
    StreamResponse,
)


def test_stream_types_exported() -> None:
    assert StreamRequest is not None
    assert StreamResponse is not None


def test_http_names_are_buffered_lib_types() -> None:
    assert HttpRequest is iii_http.HttpRequest
    assert HttpResponse is iii_http.HttpResponse


def test_http_names_are_distinct_from_stream_types() -> None:
    assert HttpRequest is not StreamRequest
    assert HttpResponse is not StreamResponse


def test_api_names_are_deprecated_aliases_of_http() -> None:
    assert ApiRequest is HttpRequest
    assert ApiResponse is HttpResponse
