import { useEffect, useRef, useState } from "react";
import { useBoardStore } from "../store/board";
import { AccountPanel } from "./AccountPanel";
import {
  listFlowProjects,
  rebindBoardToFlowProject,
  type BoardFlowStatus,
  type FlowRemoteProject,
} from "../api/client";

/**
 * Left sidebar listing every local "project" (Board). Click an item to
 * switch the active board; the canvas re-loads its nodes/edges. Provides
 * inline create / rename / delete (with confirm) — all backed by the
 * /api/boards CRUD that already cascades to children on delete.
 */
export function ProjectSidebar() {
  const boards = useBoardStore((s) => s.boards);
  const activeId = useBoardStore((s) => s.boardId);
  const switchBoard = useBoardStore((s) => s.switchBoard);
  const createNewBoard = useBoardStore((s) => s.createNewBoard);
  const deleteBoardById = useBoardStore((s) => s.deleteBoardById);
  const renameBoard = useBoardStore((s) => s.renameBoard);

  const [collapsed, setCollapsed] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newDialogName, setNewDialogName] = useState("");
  const [newDialogBusy, setNewDialogBusy] = useState(false);
  const newDialogInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Flow project sync — keyed map { board_id → BoardFlowStatus } so each
  // sidebar entry can render an orphan badge when its bound project no
  // longer exists on Flow. Loaded on mount + on user click of the sync
  // button. Remote-projects list is cached for the rebind picker.
  const [flowStatus, setFlowStatus] = useState<Map<number, BoardFlowStatus>>(
    () => new Map(),
  );
  const [remoteProjects, setRemoteProjects] = useState<FlowRemoteProject[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [rebindTarget, setRebindTarget] = useState<{
    boardId: number;
    boardName: string;
  } | null>(null);

  async function runFlowSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await listFlowProjects();
      setRemoteProjects(res.remote_projects);
      setFlowStatus(new Map(res.board_status.map((b) => [b.board_id, b])));
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRebind(boardId: number, flowProjectId: string) {
    try {
      await rebindBoardToFlowProject(boardId, flowProjectId);
      setRebindTarget(null);
      await runFlowSync();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "rebind failed");
    }
  }

  // First-mount sync — best-effort, silent on failure (extension might
  // not be connected yet; user can hit the button to retry).
  useEffect(() => {
    runFlowSync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (renamingId !== null) {
      setTimeout(() => renameInputRef.current?.select(), 30);
    }
  }, [renamingId]);

  // Click-outside closes the kebab menu.
  useEffect(() => {
    if (openMenuId === null) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest(".project-sidebar__menu") && !t.closest(".project-sidebar__kebab")) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openMenuId]);

  function handleNew() {
    setNewDialogName("Untitled");
    setNewDialogOpen(true);
    setTimeout(() => newDialogInputRef.current?.select(), 30);
  }

  function closeNewDialog() {
    if (newDialogBusy) return;
    setNewDialogOpen(false);
    setNewDialogName("");
  }

  async function commitNewDialog() {
    if (newDialogBusy) return;
    const name = newDialogName.trim() || "Untitled";
    setNewDialogBusy(true);
    try {
      await createNewBoard(name);
    } finally {
      setNewDialogBusy(false);
      setNewDialogOpen(false);
      setNewDialogName("");
    }
  }

  // Esc closes the new-project dialog.
  useEffect(() => {
    if (!newDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNewDialog();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDialogOpen, newDialogBusy]);

  function startRename(id: number, currentName: string) {
    setRenamingId(id);
    setRenameDraft(currentName);
    setOpenMenuId(null);
  }

  async function commitRename() {
    if (renamingId === null) return;
    const name = renameDraft.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    // Only the active board can be renamed via the existing renameBoard
    // action; for other boards, switch first then rename. Keeps the
    // backend round-trip simple.
    if (renamingId !== activeId) {
      await switchBoard(renamingId);
    }
    await renameBoard(name);
    setRenamingId(null);
  }

  function openDeleteConfirm(id: number, name: string) {
    setOpenMenuId(null);
    setDeleteTarget({ id, name });
  }

  async function commitDelete() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteBoardById(deleteTarget.id);
    } finally {
      setDeleteBusy(false);
      setDeleteTarget(null);
    }
  }

  function cancelDelete() {
    if (deleteBusy) return;
    setDeleteTarget(null);
  }

  // Esc closes the delete-confirm dialog.
  useEffect(() => {
    if (!deleteTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDelete();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, deleteBusy]);

  return (
    <aside className={`project-sidebar${collapsed ? " project-sidebar--collapsed" : ""}`}>
      <div className="project-sidebar__header">
        {!collapsed && <span className="project-sidebar__title">Projects</span>}
        <button
          type="button"
          className="project-sidebar__icon-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="project-sidebar__row">
            <button
              type="button"
              className="project-sidebar__new"
              onClick={handleNew}
            >
              <span aria-hidden="true">+</span> New project
            </button>
            <button
              type="button"
              className="project-sidebar__sync"
              onClick={runFlowSync}
              disabled={syncing}
              title="Refresh Google Flow project list + check which boards are orphaned"
              aria-label="Sync with Google Flow"
            >
              {syncing ? "…" : "🔄"}
            </button>
          </div>
          {syncError && (
            <div className="project-sidebar__sync-error" role="status">
              Flow sync: {syncError}
            </div>
          )}
          <ul className="project-sidebar__list">
            {boards.map((b) => {
              const isActive = b.id === activeId;
              const isRenaming = b.id === renamingId;
              const status = flowStatus.get(b.id);
              // Orphan = bound flow_project_id is missing from Flow's
              // remote list. We only flag once we've synced at least
              // once (status is present); pre-sync state is "unknown".
              const isOrphan =
                status !== undefined
                && status.flow_project_id !== null
                && status.exists_on_flow === false;
              return (
                <li
                  key={b.id}
                  className={`project-sidebar__item${isActive ? " project-sidebar__item--active" : ""}`}
                >
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      className="project-sidebar__rename-input"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="project-sidebar__name"
                        onClick={() => switchBoard(b.id)}
                        title={
                          isOrphan
                            ? `${b.name} — Flow project ${status?.flow_project_id ?? ""} không tồn tại trên Google Flow. Click ⋯ → Rebind to re-link.`
                            : b.name
                        }
                      >
                        {b.name || "Untitled"}
                        {isOrphan && (
                          <span
                            className="project-sidebar__orphan-badge"
                            title="Flow project not found — rebind required"
                            aria-label="orphan"
                          >
                            ⚠
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="project-sidebar__kebab"
                        onClick={() =>
                          setOpenMenuId((cur) => (cur === b.id ? null : b.id))
                        }
                        aria-label="Project actions"
                      >
                        ⋯
                      </button>
                      {openMenuId === b.id && (
                        <div className="project-sidebar__menu" role="menu">
                          <button
                            type="button"
                            onClick={() => startRename(b.id, b.name)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setRebindTarget({ boardId: b.id, boardName: b.name });
                            }}
                          >
                            Rebind to Flow project…
                          </button>
                          <button
                            type="button"
                            className="project-sidebar__menu-danger"
                            onClick={() => openDeleteConfirm(b.id, b.name)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
            {boards.length === 0 && (
              <li className="project-sidebar__empty">No projects yet</li>
            )}
          </ul>
        </>
      )}

      {/* Pinned-bottom account chip — sits below the project list because
          the list above has flex: 1 and pushes everything that follows
          to the bottom of the column. */}
      <AccountPanel collapsed={collapsed} />

      {deleteTarget && (
        <div
          className="project-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelDelete();
          }}
        >
          <div
            className="project-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
          >
            <h2 id="delete-project-title" className="project-modal__title">
              Delete project?
            </h2>
            <p className="project-modal__hint">
              <strong>"{deleteTarget.name}"</strong> sẽ bị xoá vĩnh viễn cùng
              với tất cả nodes, edges, generations, và assets bên trong. Không
              thể khôi phục.
            </p>
            <div className="project-modal__actions">
              <button
                type="button"
                className="project-modal__btn"
                onClick={cancelDelete}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="project-modal__btn project-modal__btn--danger"
                onClick={commitDelete}
                disabled={deleteBusy}
                autoFocus
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {newDialogOpen && (
        <div
          className="project-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeNewDialog();
          }}
        >
          <div
            className="project-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
          >
            <h2 id="new-project-title" className="project-modal__title">
              New project
            </h2>
            <p className="project-modal__hint">
              Tên project hiển thị trong sidebar. Có thể đổi sau.
            </p>
            <input
              ref={newDialogInputRef}
              className="project-modal__input"
              type="text"
              maxLength={80}
              value={newDialogName}
              onChange={(e) => setNewDialogName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNewDialog();
                if (e.key === "Escape") closeNewDialog();
              }}
              placeholder="Untitled"
              disabled={newDialogBusy}
              autoFocus
            />
            <div className="project-modal__actions">
              <button
                type="button"
                className="project-modal__btn"
                onClick={closeNewDialog}
                disabled={newDialogBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="project-modal__btn project-modal__btn--primary"
                onClick={commitNewDialog}
                disabled={newDialogBusy}
              >
                {newDialogBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rebindTarget && (
        <div
          className="project-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRebindTarget(null);
          }}
        >
          <div
            className="project-modal project-modal--rebind"
            role="dialog"
            aria-modal="true"
            aria-label="Rebind board to Flow project"
          >
            <div className="project-modal__title">
              Rebind "{rebindTarget.boardName}" to a Flow project
            </div>
            <p className="project-modal__hint">
              Pick an existing Google Flow project to link this board to.
              The previous link (if any) is overwritten — no Flow project
              is deleted by this action.
            </p>
            {remoteProjects.length === 0 ? (
              <div className="project-sidebar__empty" style={{ padding: 12 }}>
                No Flow projects loaded yet. Make sure the extension is
                connected, then click 🔄.
              </div>
            ) : (
              <ul className="project-sidebar__rebind-list">
                {remoteProjects.map((p) => {
                  const currentBindId = flowStatus.get(
                    rebindTarget.boardId,
                  )?.flow_project_id;
                  const isCurrent = p.project_id === currentBindId;
                  return (
                    <li key={p.project_id}>
                      <button
                        type="button"
                        className={`project-sidebar__rebind-row${
                          isCurrent
                            ? " project-sidebar__rebind-row--current"
                            : ""
                        }`}
                        onClick={() => {
                          if (!isCurrent) {
                            void handleRebind(
                              rebindTarget.boardId,
                              p.project_id,
                            );
                          }
                        }}
                        disabled={isCurrent}
                      >
                        <span className="project-sidebar__rebind-title">
                          {p.project_title}
                          {isCurrent && (
                            <span className="project-sidebar__rebind-current">
                              · current
                            </span>
                          )}
                        </span>
                        <span className="project-sidebar__rebind-id">
                          {p.project_id.slice(0, 8)}…
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="project-modal__actions">
              <button
                type="button"
                className="project-modal__btn"
                onClick={() => setRebindTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
