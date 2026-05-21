"""Remote Google Flow project list + sync status.

Pulls the user's project list from labs.google via the
``project.searchUserProjects`` TRPC endpoint (proxied through the
Chrome extension's authenticated session) and cross-references with
``BoardFlowProject`` rows so the frontend can:

  - render the user's actual Flow project list,
  - flag any Flowboard board whose bound flow_project_id no longer
    exists on Flow's side (deleted, or the bind never landed properly),
  - offer re-bind / re-create on those orphans.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from flowboard.db import get_session
from flowboard.db.models import Board, BoardFlowProject
from flowboard.services.flow_sdk import get_flow_sdk

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flow/projects", tags=["flow-projects"])


@router.get("")
async def list_flow_projects(tool: str = "PINHOLE"):
    """Return Flow's remote project list + per-board sync status.

    Response shape:
        {
          "remote_projects": [
            {project_id, project_title, thumbnail_media_key?, creation_time?},
            ...
          ],
          "truncated": bool,      # true when we hit the page cap
          "board_status": [
            {board_id, board_name, flow_project_id, exists_on_flow},
            ...
          ]
        }

    `exists_on_flow` is true when the board's bound flow_project_id
    appears in the remote list. False means orphan — the project was
    deleted on Flow's side (or was never properly created), so any
    dispatch using it would 404. The frontend renders this as a
    warning + re-bind affordance.
    """
    result = await get_flow_sdk().list_user_projects_all(tool=tool)
    if result.get("error"):
        raise HTTPException(
            status_code=502,
            detail={"message": result["error"]},
        )
    remote_projects: list[dict] = list(result.get("projects") or [])
    remote_ids = {p["project_id"] for p in remote_projects}

    with get_session() as s:
        boards = s.query(Board).order_by(Board.created_at.desc()).all()
        binds = {
            b.board_id: b.flow_project_id
            for b in s.query(BoardFlowProject).all()
        }
        board_status = []
        for b in boards:
            pid: Optional[str] = binds.get(b.id)
            board_status.append({
                "board_id": b.id,
                "board_name": b.name,
                "flow_project_id": pid,
                "exists_on_flow": (pid in remote_ids) if pid else False,
            })

    return {
        "remote_projects": remote_projects,
        "truncated": bool(result.get("truncated")),
        "board_status": board_status,
    }


@router.post("/rebind")
async def rebind_board_to_project(body: dict):
    """Re-point a board at an existing Flow project id (vs creating a new
    one via /api/boards/{id}/project). Used to recover from orphans:
    user picks an existing Flow project from the dropdown, we replace
    the stale BoardFlowProject row.

    Body: ``{board_id: int, flow_project_id: str}``
    """
    from flowboard.services.flow_sdk import is_valid_project_id

    board_id = body.get("board_id") if isinstance(body, dict) else None
    flow_project_id = body.get("flow_project_id") if isinstance(body, dict) else None
    if not isinstance(board_id, int):
        raise HTTPException(422, "board_id required")
    if not isinstance(flow_project_id, str) or not flow_project_id.strip():
        raise HTTPException(422, "flow_project_id required")
    flow_project_id = flow_project_id.strip()
    if not is_valid_project_id(flow_project_id):
        raise HTTPException(422, "invalid flow_project_id shape")

    with get_session() as s:
        if not s.get(Board, board_id):
            raise HTTPException(404, "board not found")
        row = s.get(BoardFlowProject, board_id)
        if row is None:
            row = BoardFlowProject(
                board_id=board_id, flow_project_id=flow_project_id
            )
        else:
            row.flow_project_id = flow_project_id
        s.add(row)
        s.commit()
        s.refresh(row)
    logger.info("rebound board %s → flow_project %s", board_id, flow_project_id)
    return {"board_id": board_id, "flow_project_id": flow_project_id}
