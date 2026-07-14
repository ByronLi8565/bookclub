import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Session } from "../../app/useSession.ts";
import type { GroupRole, RosterEntry } from "./groupClient.ts";
import { fetchGroup, redeemInvite, type GroupSummary } from "./groupClient.ts";
import { GroupRole as GroupRoles } from "../../../shared/types/groups.ts";
import { readLocal, writeLocal } from "../storage.ts";
import { useOnline } from "../net/online.ts";
import { spawnToast } from "../../ui/shared/toast/toastStore.ts";

export type ResolvedGroup =
  | { k: "loading" }
  | { k: "anon" }
  | { k: "notfound" }
  | { k: "refused" }
  | { k: "offline" }
  | { k: "member"; group: GroupSummary; role: GroupRole; isOwner: boolean; members: RosterEntry[] };

interface CachedGroupView {
  group: GroupSummary;
  role: GroupRole;
  isOwner: boolean;
  members: RosterEntry[];
}

function groupViewCacheKey(userId: string, groupRef: string): string {
  return `bookclub.groupview.${userId}.${groupRef}`;
}

function takeInviteToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("invite");
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

export function useResolvedGroup(
  groupRef: string,
  session: Session,
  storedSelectedSource: (group: GroupSummary) => string | null,
): [
  ResolvedGroup,
  Dispatch<SetStateAction<ResolvedGroup>>,
  string | null,
  Dispatch<SetStateAction<string | null>>,
] {
  const [resolved, setResolved] = useState<ResolvedGroup>({ k: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const userId = session.user?.id ?? null;
  const online = useOnline();
  const loadKey = `${groupRef}:${session.status}:${userId ?? ""}`;
  const [loadedFor, setLoadedFor] = useState(loadKey);

  if (loadedFor !== loadKey) {
    setLoadedFor(loadKey);
    setResolved(session.status === "anon" ? { k: "anon" } : { k: "loading" });
    if (session.status === "authed") setSelectedId(null);
  }

  const wasOnlineRef = useRef(online);
  useEffect(() => {
    if (online && !wasOnlineRef.current) setReloadTick((tick) => tick + 1);
    wasOnlineRef.current = online;
  }, [online]);

  useEffect(() => {
    let cancelled = false;
    if (session.status === "loading" || session.status === "anon") return;

    void (async () => {
      let view = await fetchGroup(groupRef);
      if (view.status === "notfound") {
        if (!cancelled) setResolved({ k: "notfound" });
        return;
      }
      if (view.status === "error") {
        if (cancelled) return;
        const cached = userId
          ? readLocal<CachedGroupView>(groupViewCacheKey(userId, groupRef))
          : null;
        if (cached) {
          setSelectedId(storedSelectedSource(cached.group));
          setResolved({ k: "member", ...cached, role: cached.role ?? GroupRoles.Visitor });
        } else {
          setResolved({ k: "offline" });
        }
        return;
      }
      if (!view.membership.isMember) {
        const token = takeInviteToken();
        if (token) {
          const joined = await redeemInvite(groupRef, token);
          if (joined.ok) {
            const rejoined = await fetchGroup(groupRef);
            if (rejoined.status === "ok") view = rejoined;
          } else {
            spawnToast("Invite failed", "That invite link isn't valid.", { type: "error" });
          }
        }
      }
      if (cancelled) return;
      if (view.status !== "ok" || !view.membership.isMember) {
        setResolved({ k: "refused" });
        return;
      }
      const next: CachedGroupView = {
        group: view.group,
        role: view.membership.role ?? GroupRoles.Visitor,
        isOwner: view.group.ownerId === userId,
        members: view.members,
      };
      if (userId) writeLocal(groupViewCacheKey(userId, groupRef), next);
      setSelectedId(storedSelectedSource(view.group));
      setResolved({ k: "member", ...next });
    })();
    return () => {
      cancelled = true;
    };
  }, [groupRef, session.status, userId, reloadTick, storedSelectedSource]);

  return [resolved, setResolved, selectedId, setSelectedId];
}
