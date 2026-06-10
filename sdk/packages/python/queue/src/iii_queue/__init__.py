"""iii queue types."""

from typing import Literal

from pydantic import BaseModel, Field


class EnqueueResult(BaseModel):
    """Result returned when a function is invoked with ``TriggerAction.Enqueue``.

    Attributes:
        messageReceiptId: UUID assigned by the engine to the enqueued job.
    """

    messageReceiptId: str = Field(description="UUID assigned by the engine to the enqueued job.")


class TriggerActionEnqueue(BaseModel):
    """Routes the invocation through a named queue for async processing.

    Attributes:
        type: Always ``'enqueue'``.
        queue: Name of the target queue.
    """

    type: Literal["enqueue"] = "enqueue"
    queue: str


__all__ = ["EnqueueResult", "TriggerActionEnqueue"]
