import {
  Agent,
  callable,
  type Connection,
  type ConnectionContext,
  getAgentByName,
  getCurrentAgent,
} from "agents";
import { monotonicFactory } from "ulidx";
import {
  NoteRejectionReason,
  type ApplyOpsResult,
  type Highlight,
  type HighlightAnchor,
  type NoteOp,
} from "../../shared/types/notes.ts";
import type { GroupRole } from "../../shared/types/groups.ts";
import { GroupAction, permits } from "../../shared/groupPermissions.ts";
import {
  noteImageIds,
  removeNoteImageReferences,
  unreferencedImageIds,
} from "../../shared/notes/images.ts";
import type { Env } from "../env.ts";
import { currentIdentity } from "../auth/cookies.ts";
import { deleteImages } from "../services/images.ts";
import {
  addNote,
  addReply,
  applyOperations,
  editNote,
  emptyNoteState,
  rebindHighlight,
  removeNote,
  removeSourceNotes,
  type NoteStamp,
  type NoteState,
} from "./noteState.ts";

export type { NoteState } from "./noteState.ts";

const ulid = monotonicFactory();

export interface ConnIdentity {
  userId: string;
  name: string;
  role: GroupRole;
  avatarImageId?: string;
}

export interface OnlinePeer {
  id: string;
  name: string;
  role: GroupRole;
  avatarImageId?: string;
}

export class NoteAgent extends Agent<Env, NoteState> {
  initialState: NoteState = emptyNoteState();

  private stamp: NoteStamp = { id: () => ulid(), now: () => new Date().toISOString() };

  private async commit(next: NoteState, forcedImageDeletes: string[] = []): Promise<void> {
    const removed = [
      ...new Set([...unreferencedImageIds(this.state.notes, next.notes), ...forcedImageDeletes]),
    ];
    const pending = [...new Set([...(this.state.pendingImageDeletes ?? []), ...removed])];
    this.setState(pending.length > 0 ? { ...next, pendingImageDeletes: pending } : next);
    if (pending.length === 0) return;

    await deleteImages(this.env, this.name, pending);
    const remaining = (this.state.pendingImageDeletes ?? []).filter((id) => !pending.includes(id));
    if (remaining.length > 0) {
      this.setState({ ...this.state, pendingImageDeletes: remaining });
    } else {
      const { pendingImageDeletes: _, ...state } = this.state;
      this.setState(state);
    }
  }

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const me = await currentIdentity(ctx.request, this.env);
    if (!me) return connection.close(1008, "unauthenticated");
    const group = await getAgentByName(this.env.GroupAgent, this.name);
    const profile = await group.memberProfile(me.id);
    if (!profile) return connection.close(1008, "forbidden");
    connection.setState({
      userId: me.id,
      name: profile.name,
      role: profile.role,
      ...(profile.avatarImageId ? { avatarImageId: profile.avatarImageId } : {}),
    } satisfies ConnIdentity);
    this.broadcastPresence();
  }

  onClose(connection: Connection): void {
    this.broadcastPresence(connection.id);
  }

  private broadcastPresence(excludeId?: string): void {
    const seen = new Map<string, OnlinePeer>();
    for (const conn of this.getConnections<ConnIdentity>()) {
      if (conn.id === excludeId) continue;
      const s = conn.state;
      if (s?.userId) {
        seen.set(s.userId, {
          id: s.userId,
          name: s.name,
          role: s.role,
          ...(s.avatarImageId ? { avatarImageId: s.avatarImageId } : {}),
        });
      }
    }
    this.broadcast(JSON.stringify({ type: "presence", users: [...seen.values()] }));
  }

  private get me(): ConnIdentity {
    const { connection } = getCurrentAgent<NoteAgent>();
    if (!connection) throw new Error("note mutation outside a connection");
    return connection.state as ConnIdentity;
  }

  @callable()
  addNote(sourceId: string, body: string, highlights: Highlight[], tags: string[] = []): void {
    const { userId, name, role } = this.me;
    if (!permits(role, GroupAction.CreateNote)) return;
    this.setState(
      addNote(this.state, sourceId, { id: userId, name }, body, highlights, this.stamp, tags),
    );
  }

  @callable()
  addReply(sourceId: string, parent: string, body: string): void {
    const { userId, name, role } = this.me;
    if (!permits(role, GroupAction.ReplyToNote)) return;
    this.setState(addReply(this.state, sourceId, { id: userId, name }, parent, body, this.stamp));
  }

  @callable()
  async editNote(id: string, body: string): Promise<void> {
    if (!permits(this.me.role, GroupAction.EditOwnNote)) return;
    await this.commit(editNote(this.state, id, body, this.stamp.now(), this.me.userId));
  }

  @callable()
  async removeNote(id: string): Promise<void> {
    const { userId, role } = this.me;
    if (!permits(role, GroupAction.DeleteOwnNote)) return;
    await this.commit(
      removeNote(
        this.state,
        id,
        this.stamp.now(),
        userId,
        permits(role, GroupAction.ModerateNotes),
      ),
    );
  }

  @callable()
  rebindHighlight(noteId: string, highlightId: string, anchor: HighlightAnchor): void {
    const { userId, role } = this.me;
    const note = this.state.notes.find((candidate) => candidate.id === noteId);
    if (!note) return;
    const action =
      note.author.id === userId ? GroupAction.RebindOwnHighlight : GroupAction.RebindAnyHighlight;
    if (!permits(role, action)) return;
    this.setState(rebindHighlight(this.state, noteId, highlightId, anchor));
  }

  // The local-first write path: a batch of client-authored ops is folded into
  // authoritative state idempotently, in order. Author identity comes from the
  // connection (never the payload), so a replayed queue cannot be misattributed.
  // Returns which ops stuck and which were refused, so the client can prune its
  // pending queue and surface conflicts without ever silently losing authored
  // content. Reads `this.state` fresh: Durable Objects serialize RPC calls, so
  // each batch sees the previous batch's committed state.
  @callable()
  async applyOperations(ops: NoteOp[]): Promise<ApplyOpsResult> {
    const { userId, name, role } = this.me;
    if (!permits(role, GroupAction.CreateNote)) {
      return {
        appliedOpIds: [],
        rejectedOps: ops.map((op) => ({ opId: op.opId, reason: NoteRejectionReason.Forbidden })),
      };
    }
    const result = applyOperations(this.state, ops, {
      author: { id: userId, name },
      isOwner: permits(role, GroupAction.ModerateNotes),
    });
    await this.commit(result.state);
    return { appliedOpIds: result.appliedOpIds, rejectedOps: result.rejectedOps };
  }

  exportState(): NoteState {
    return this.state;
  }

  referencesImage(imageId: string): boolean {
    return this.state.notes.some((note) => noteImageIds(note.body).has(imageId));
  }

  async deleteImage(imageId: string): Promise<void> {
    await this.commit(
      {
        ...this.state,
        notes: this.state.notes.map((note) => {
          const body = removeNoteImageReferences(note.body, imageId);
          return body === note.body
            ? note
            : { ...note, body, editedAt: this.stamp.now(), version: note.version + 1 };
        }),
      },
      [imageId],
    );
  }

  importState(state: NoteState): void {
    this.setState(state);
  }

  async removeSource(sourceId: string): Promise<void> {
    await this.commit(removeSourceNotes(this.state, sourceId));
  }

  clear(): void {
    this.setState(emptyNoteState());
  }

  updateMemberRole(userId: string, role: GroupRole): void {
    for (const connection of this.getConnections<ConnIdentity>()) {
      if (connection.state?.userId === userId) {
        connection.setState({ ...connection.state, role });
      }
    }
    this.broadcastPresence();
  }

  updateMemberProfile(userId: string, name: string, avatarImageId?: string): void {
    const needsNoteUpdate = this.state.notes.some(
      (note) => note.author.id === userId && note.author.name !== name,
    );
    if (needsNoteUpdate) {
      this.setState({
        ...this.state,
        notes: this.state.notes.map((note) =>
          note.author.id === userId ? { ...note, author: { ...note.author, name } } : note,
        ),
      });
    }
    for (const connection of this.getConnections<ConnIdentity>()) {
      if (connection.state?.userId === userId) {
        const { avatarImageId: _oldAvatar, ...current } = connection.state;
        connection.setState({ ...current, name, ...(avatarImageId ? { avatarImageId } : {}) });
      }
    }
    this.broadcastPresence();
  }
}
