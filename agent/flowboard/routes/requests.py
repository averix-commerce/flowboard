from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowboard.db import get_session
from flowboard.db.models import Node, Request
from flowboard.worker.processor import get_worker

router = APIRouter(prefix="/api/requests", tags=["requests"])


class RequestCreate(BaseModel):
    node_id: Optional[int] = None
    type: str = Field(min_length=1, max_length=40)
    params: dict[str, Any] = Field(default_factory=dict)


@router.post("")
def create_request(body: RequestCreate):
    with get_session() as s:
        if body.node_id is not None and not s.get(Node, body.node_id):
            raise HTTPException(404, "node not found")
        req = Request(
            node_id=body.node_id,
            type=body.type,
            params=dict(body.params),
            status="queued",
        )
        s.add(req)
        s.commit()
        s.refresh(req)
        rid = req.id
        row = req

    assert rid is not None
    get_worker().enqueue(rid)
    return row


@router.get("/{request_id}")
def get_request(request_id: int):
    with get_session() as s:
        req = s.get(Request, request_id)
        if req is None:
            raise HTTPException(404, "request not found")
        return req


@router.post("/{request_id}/cancel")
def cancel_request(request_id: int):
    """Cancel a queued request before the worker picks it up.

    Only ``queued`` rows are cancelable. The worker pulls rids off an
    in-memory ``asyncio.Queue`` and we can't yank a value back out, so
    we mark the row as ``failed`` with ``error='canceled'`` and let
    ``_process_one`` skip rows whose DB status drifted away from
    ``queued``. Returns 409 for any other state — running jobs need
    different surgery (in-flight HTTP calls to Flow).
    """
    with get_session() as s:
        req = s.get(Request, request_id)
        if req is None:
            raise HTTPException(404, "request not found")
        if req.status != "queued":
            raise HTTPException(
                409, f"only queued requests can be canceled (status={req.status})"
            )
        req.status = "failed"
        req.error = "canceled"
        req.finished_at = datetime.now(timezone.utc)
        s.add(req)
        s.commit()
        s.refresh(req)
        return req
