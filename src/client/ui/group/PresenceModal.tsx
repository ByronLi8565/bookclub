import { useEffect, useRef, useState } from "react";
import toolIcon from "@assets/tool.svg";
import trashIcon from "@assets/trash.svg";
import { formatBytes } from "../../../shared/format.ts";
import { GroupAction, permits } from "../../../shared/groupPermissions.ts";
import { GroupRole as GroupRoles } from "../../../shared/types/groups.ts";
import {
  avatarImagePath,
  avatarInitial,
  deleteNoteImage,
  fetchSource,
  listGroupImages,
  type BookMetadataPatch,
  type GroupImage,
  type GroupRole,
  type GroupSummary,
  type RosterEntry,
} from "../../logic/groups/groupClient.ts";
import { inspectSource } from "../../logic/sources/checkHealth.ts";
import type { OnlinePeer } from "../../logic/notes/useNoteAgent.ts";
import { downloadSourceCopy } from "../../logic/groups/sourceAccess.ts";
import { isNative } from "../../logic/net/api.ts";
import { DropdownMenu, type DropdownTriggerProps } from "../shared/DropdownMenu.tsx";
import { Modal, ModalPagerTabs } from "../shared/Modal.tsx";
import { spawnToast } from "../shared/toast/toastStore.ts";
import { BackupControls } from "./BackupControls.tsx";
import { InviteControls } from "./InviteModal.tsx";

interface Person {
  id: string;
  name: string;
  email: string;
  role: GroupRole;
  isOnline: boolean;
  avatarImageId?: string;
}

const ASSIGNABLE_ROLES = [GroupRoles.Visitor, GroupRoles.Member, GroupRoles.Admin] as const;

function assignableRoles(viewerRole: GroupRole, currentRole: GroupRole): GroupRole[] {
  if (currentRole === GroupRoles.Owner) return [];
  if (viewerRole === GroupRoles.Owner) return [...ASSIGNABLE_ROLES];
  if (viewerRole === GroupRoles.Admin && currentRole !== GroupRoles.Admin) {
    return [GroupRoles.Visitor, GroupRoles.Member];
  }
  return [];
}

function mergePeople(members: RosterEntry[], online: OnlinePeer[]): Person[] {
  const onlineIds = new Set(online.map((person) => person.id));
  const byId = new Map<string, Person>();
  for (const member of members) {
    byId.set(member.id, { ...member, isOnline: onlineIds.has(member.id) });
  }

  for (const person of online) {
    const member = byId.get(person.id);
    byId.set(person.id, { ...member, ...person, email: member?.email ?? "", isOnline: true });
  }
  return [...byId.values()].toSorted((a, b) => Number(b.isOnline) - Number(a.isOnline));
}

function BookMetadataEditor({
  groupRef,
  sourceId,
  author,
  canEdit,
  onUpdate,
  onClose,
}: {
  groupRef: string;
  sourceId: string;
  author: string | null;
  canEdit: boolean;
  onUpdate: (sourceId: string, patch: BookMetadataPatch) => Promise<boolean>;
  onClose: () => void;
}): React.ReactElement {
  const [draftAuthor, setDraftAuthor] = useState(author ?? "");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const refreshStarted = useRef(false);

  useEffect(() => {
    if (!canEdit || refreshStarted.current) return;
    refreshStarted.current = true;
    let cancelled = false;
    void (async () => {
      const fetched = await fetchSource(groupRef, sourceId);
      if (fetched) {
        const inspection = await inspectSource(fetched.file);
        const wordCount = inspection.ok ? inspection.metadata.wordCount : null;
        if (!cancelled && wordCount !== null) await onUpdate(sourceId, { wordCount });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, groupRef, onUpdate, sourceId]);

  async function saveAuthor(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    const saved = await onUpdate(sourceId, { author: draftAuthor.trim() || null });
    setSaving(false);
    if (saved) onClose();
  }

  async function download(): Promise<void> {
    setDownloading(true);
    const result = await downloadSourceCopy(groupRef, sourceId);
    setDownloading(false);
    if (!result.ok) {
      spawnToast("Download failed", "Couldn't fetch the book from storage.", { type: "error" });
      return;
    }
    spawnToast(
      isNative ? "Saved for offline" : "Downloading book",
      isNative ? "This book now reads without a connection." : "Saving a copy to your device.",
      { type: "info" },
    );
  }

  return (
    <div className="group-book-metadata">
      {canEdit && (
        <>
          <label htmlFor={`book-author-${sourceId}`}>Author</label>
          <form className="settings-text-submit-form" onSubmit={(event) => void saveAuthor(event)}>
            <input
              id={`book-author-${sourceId}`}
              value={draftAuthor}
              onChange={(event) => setDraftAuthor(event.target.value)}
              placeholder="Author name"
            />
            <button
              type="submit"
              className="settings-action settings-text-submit-button"
              disabled={saving}
              aria-label="Save author"
              title="Save author (Enter)"
            >
              <span aria-hidden="true">↵</span>
            </button>
          </form>
        </>
      )}
      <button
        type="button"
        className="settings-action group-book-download"
        disabled={downloading}
        onClick={() => void download()}
      >
        {downloading ? "downloading…" : isNative ? "Save offline" : "Download local copy"}
      </button>
    </div>
  );
}

function BookDeleteButton({
  title,
  disabled,
  onConfirm,
}: {
  title: string;
  disabled: boolean;
  onConfirm: () => void;
}): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const confirmationRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!confirming) return;
    const frame = window.requestAnimationFrame(() => {
      confirmationRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    });
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !ref.current?.contains(target)) setConfirming(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [confirming]);

  return (
    <div className="group-book-delete" ref={ref}>
      <button
        type="button"
        className="group-book-icon"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${title}`}
        aria-expanded={confirming}
        title="Delete book"
      >
        <img src={trashIcon} alt="" aria-hidden="true" />
      </button>
      {confirming && (
        <dialog ref={confirmationRef} className="delete-confirm" open aria-label="Confirm delete">
          <p>This will delete the book for EVERYONE. Really delete?</p>
          <div className="delete-confirm-actions">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              aria-label="cancel delete"
              title="Keep book"
            >
              ✕
            </button>
            <span>|</span>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
              aria-label="confirm delete"
              title="Delete book"
              disabled={disabled}
            >
              ✓
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

function BookDeleteModal({
  title,
  deleting,
  onCancel,
  onDelete,
}: {
  title: string;
  deleting: boolean;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}): React.ReactElement {
  const [typedTitle, setTypedTitle] = useState("");
  const matches = typedTitle === title;

  return (
    <Modal title="delete book" className="book-delete-modal" onClose={onCancel}>
      <form
        className="modal-body book-delete-confirm-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !deleting) void onDelete();
        }}
      >
        <p>
          Deleting this book will permanently remove <strong>{title}</strong> and all of its notes
          for everyone in the club.
        </p>
        <p className="book-delete-backup-warning">
          We strongly recommend backing up your notes before continuing. This cannot be undone.
        </p>
        <label htmlFor="book-delete-title">
          Type the full book name, <strong>{title}</strong>, to confirm.
        </label>
        <input
          id="book-delete-title"
          value={typedTitle}
          onChange={(event) => setTypedTitle(event.target.value)}
          autoComplete="off"
          autoFocus
        />
        <div className="book-delete-final-actions">
          <button type="button" onClick={onCancel} disabled={deleting}>
            cancel
          </button>
          <button type="submit" disabled={!matches || deleting}>
            {deleting ? "deleting…" : "delete book and notes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PersonRoleControl({
  person,
  viewerRole,
  onChange,
}: {
  person: Person;
  viewerRole: GroupRole;
  onChange: (memberId: string, role: GroupRole) => Promise<boolean>;
}): React.ReactElement {
  const roles = assignableRoles(viewerRole, person.role);
  const [pendingRole, setPendingRole] = useState<GroupRole | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pendingRole) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !ref.current?.contains(target)) setPendingRole(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pendingRole]);

  if (roles.length === 0) return <span className="invite-person-role label">{person.role}</span>;

  return (
    <div className="invite-person-role-control" ref={ref}>
      <DropdownMenu
        className="book-menu settings-dropdown invite-person-role-dropdown"
        items={roles.map((role) => ({
          key: role,
          label: role,
          title: `Change role to ${role}`,
          checked: role === person.role,
          className: role === person.role ? "book-menu-item is-active" : "book-menu-item",
          onSelect: () => setPendingRole(role),
        }))}
        Trigger={PersonRoleDropdownTrigger}
        triggerProps={{
          label: person.role,
          ariaLabel: `Change role for ${person.name}`,
          disabled: saving,
        }}
      />
      {pendingRole && pendingRole !== person.role && (
        <dialog
          className="delete-confirm role-change-confirm"
          open
          aria-label="Confirm role change"
        >
          <p>Really change this user to {pendingRole.toUpperCase()}?</p>
          <div className="delete-confirm-actions">
            <button
              type="button"
              onClick={() => setPendingRole(null)}
              aria-label="cancel role change"
              title="Keep current role"
            >
              ✕
            </button>
            <span>|</span>
            <button
              type="button"
              onClick={() => {
                setSaving(true);
                void onChange(person.id, pendingRole).then((changed) => {
                  setSaving(false);
                  if (changed) setPendingRole(null);
                });
              }}
              aria-label="confirm role change"
              title={`Change role to ${pendingRole}`}
              disabled={saving}
            >
              ✓
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

function PersonRoleDropdownTrigger({
  open,
  toggle,
  label,
  ariaLabel,
  disabled,
}: DropdownTriggerProps & {
  label: string;
  ariaLabel: string;
  disabled: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="settings-action settings-dropdown-trigger invite-person-role label"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onClick={toggle}
    >
      <span>{label}</span>
      <span className="book-menu-arrow" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

export function PresenceModal({
  groupRef,
  group,
  members,
  online,
  viewerId,
  viewerRole,
  onChangeMemberRole,
  onDeleteBook,
  onUpdateBookMetadata,
  onClose,
}: {
  groupRef: string;
  group: GroupSummary;
  members: RosterEntry[];
  online: OnlinePeer[];
  viewerId: string;
  viewerRole: GroupRole;
  onChangeMemberRole: (memberId: string, role: GroupRole) => Promise<boolean>;
  onDeleteBook: (sourceId: string) => Promise<boolean>;
  onUpdateBookMetadata: (sourceId: string, patch: BookMetadataPatch) => Promise<boolean>;
  onClose: () => void;
}): React.ReactElement {
  const [page, setPage] = useState<"people" | "books" | "images">("people");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingBookDelete, setPendingBookDelete] = useState<{
    sourceId: string;
    title: string;
  } | null>(null);
  const [editingMetadata, setEditingMetadata] = useState<string | null>(null);
  const [images, setImages] = useState<GroupImage[] | null>(null);
  const [imageTotalSize, setImageTotalSize] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const [visibleImages, setVisibleImages] = useState<Set<string>>(new Set());
  const people = mergePeople(members, online);
  const onlineCount = people.filter((person) => person.isOnline).length;
  const totalSize = group.sources.reduce(
    (total, sourceId) => total + (group.sourceMeta[sourceId]?.size ?? 0),
    0,
  );

  useEffect(() => {
    if (page !== "images" || images !== null) return;
    let cancelled = false;
    void listGroupImages(groupRef).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setImageError("Could not load images.");
        return;
      }
      setImages(result.value.images);
      setImageTotalSize(result.value.totalSize);
    });
    return () => {
      cancelled = true;
    };
  }, [groupRef, images, page]);

  async function deleteSource(sourceId: string): Promise<void> {
    setDeleting(sourceId);
    const deleted = await onDeleteBook(sourceId);
    setDeleting(null);
    if (deleted) setPendingBookDelete(null);
  }

  function toggleImage(imageId: string): void {
    setVisibleImages((current) => {
      const next = new Set(current);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  }

  async function deleteImage(image: GroupImage, index: number): Promise<void> {
    if (!window.confirm(`Delete image ${index + 1} from this club and all notes?`)) return;
    setDeleting(image.id);
    const result = await deleteNoteImage(groupRef, image.id);
    if (result.ok) {
      setImages((current) => current?.filter((candidate) => candidate.id !== image.id) ?? null);
      setImageTotalSize((current) => Math.max(0, current - image.size));
      setVisibleImages((current) => {
        const next = new Set(current);
        next.delete(image.id);
        return next;
      });
      setImageError(null);
    } else {
      setImageError("Could not delete image.");
    }
    setDeleting(null);
  }

  if (pendingBookDelete) {
    return (
      <BookDeleteModal
        title={pendingBookDelete.title}
        deleting={deleting === pendingBookDelete.sourceId}
        onCancel={() => {
          if (deleting === null) setPendingBookDelete(null);
        }}
        onDelete={() => deleteSource(pendingBookDelete.sourceId)}
      />
    );
  }

  return (
    <Modal title="group" className="modal--invite" onClose={onClose}>
      <div className="modal-body group-modal-body">
        {page === "people" && (
          <InviteControls groupRef={groupRef}>
            <div className="invite-people">
              <p className="invite-people-head label">
                {onlineCount} of {people.length} online
              </p>
              <ul className="invite-people-list">
                {people.map((person) => (
                  <li key={person.id} className={person.isOnline ? "" : "person--offline"}>
                    <span className="invite-avatar">
                      {person.avatarImageId ? (
                        <img src={avatarImagePath(person.id, person.avatarImageId)} alt="" />
                      ) : (
                        avatarInitial(person.name)
                      )}
                      <span
                        className={`presence-pip presence-pip--${person.isOnline ? "on" : "off"}`}
                      />
                    </span>
                    <span className="invite-person-text">
                      <span className="invite-person-name truncate">{person.name}</span>
                      {person.email && (
                        <span className="invite-person-email truncate">{person.email}</span>
                      )}
                    </span>
                    <PersonRoleControl
                      person={person}
                      viewerRole={viewerRole}
                      onChange={onChangeMemberRole}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </InviteControls>
        )}
        {page === "books" && (
          <div className="group-books">
            {permits(viewerRole, GroupAction.ManageBackups) && (
              <BackupControls groupRef={groupRef} groupId={group.groupId} />
            )}
            <p className="group-books-summary label">
              {group.sources.length} {group.sources.length === 1 ? "book" : "books"} ·{" "}
              {formatBytes(totalSize)} total
            </p>
            <ul className="group-books-list">
              {group.sources.map((sourceId) => {
                const meta = group.sourceMeta[sourceId];
                const title = group.bookTitles[sourceId] ?? meta?.title ?? "Untitled book";
                const wordCount = meta?.wordCount;
                const deleteAction =
                  meta?.addedBy === viewerId
                    ? GroupAction.DeleteOwnBook
                    : GroupAction.DeleteAnyBook;
                const canDelete = meta ? permits(viewerRole, deleteAction) : false;
                const editAction =
                  meta?.addedBy === viewerId
                    ? GroupAction.EditOwnBookMetadata
                    : GroupAction.EditAnyBookMetadata;
                const canEditMetadata = meta ? permits(viewerRole, editAction) : false;
                const canUseBookTools = permits(viewerRole, GroupAction.ReadBook);
                const metadataOpen = editingMetadata === sourceId;
                return (
                  <li key={sourceId}>
                    <div className="group-book-row">
                      <div className="group-book-info">
                        <strong className="group-book-name">{title}</strong>
                        {meta?.author && <span className="group-book-author">{meta.author}</span>}
                        <span className="group-book-stats">
                          {wordCount !== null && wordCount !== undefined && (
                            <>{wordCount.toLocaleString()} words · </>
                          )}
                          {formatBytes(meta?.size ?? 0)}
                        </span>
                      </div>
                      {(canUseBookTools || canDelete) && (
                        <div className="group-book-actions">
                          {canUseBookTools && (
                            <button
                              type="button"
                              className="group-book-icon"
                              onClick={() => setEditingMetadata(metadataOpen ? null : sourceId)}
                              aria-expanded={metadataOpen}
                              aria-label={canEditMetadata ? "Edit book metadata" : "Book tools"}
                              title="Book tools"
                            >
                              <img src={toolIcon} alt="" aria-hidden="true" />
                            </button>
                          )}
                          {canDelete && (
                            <BookDeleteButton
                              title={title}
                              disabled={deleting !== null}
                              onConfirm={() => setPendingBookDelete({ sourceId, title })}
                            />
                          )}
                        </div>
                      )}
                    </div>
                    {metadataOpen && (
                      <BookMetadataEditor
                        groupRef={groupRef}
                        sourceId={sourceId}
                        author={meta?.author ?? null}
                        canEdit={canEditMetadata}
                        onUpdate={onUpdateBookMetadata}
                        onClose={() => setEditingMetadata(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {page === "images" && (
          <div className="group-images">
            <p className="group-books-summary label">
              {images?.length ?? 0} {images?.length === 1 ? "image" : "images"} ·{" "}
              {formatBytes(imageTotalSize)} total
            </p>
            {imageError && <p className="group-images-error">{imageError}</p>}
            {images === null && !imageError && <p className="group-images-loading">Loading…</p>}
            {images && (
              <ul className="group-images-list">
                {images.map((image, index) => {
                  const visible = visibleImages.has(image.id);
                  return (
                    <li key={image.id}>
                      <div className="group-image-row">
                        <span className="group-image-info">
                          <strong>image {index + 1}</strong>
                          <span>
                            uploaded by {image.uploaderName} · size {formatBytes(image.size)}
                          </span>
                        </span>
                        <div className="group-image-actions">
                          <button
                            type="button"
                            className="group-image-view"
                            onClick={() => toggleImage(image.id)}
                            aria-expanded={visible}
                          >
                            [{visible ? "hide" : "view"}]
                          </button>
                          {permits(viewerRole, GroupAction.DeleteAnyImage) && (
                            <button
                              type="button"
                              className="group-book-icon"
                              disabled={deleting !== null}
                              onClick={() => void deleteImage(image, index)}
                              aria-label={`Delete image ${index + 1}`}
                              title="Delete image"
                            >
                              <img src={trashIcon} alt="" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                      {visible && (
                        <img
                          className="group-image-preview"
                          src={`/groups/${groupRef}/images/${encodeURIComponent(image.id)}`}
                          alt={`Upload ${index + 1}`}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      <ModalPagerTabs
        tabs={[
          { id: "people", label: "People", title: "People and invitations" },
          { id: "books", label: "Books", title: "Book club library" },
          { id: "images", label: "Images", title: "Book club images" },
        ]}
        active={page}
        onChange={setPage}
        className="settings-tabs"
      />
    </Modal>
  );
}
