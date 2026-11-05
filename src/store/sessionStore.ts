import { create } from "zustand";
import { persist } from "zustand/middleware";
import { backend, isDesktop, type AuthMethod, type PortForward } from "@/lib/backend";
import { newId } from "@/lib/utils";

/** A saved SSH connection profile shown in the sidebar. */
export interface SshSession {
  id: string;
  name: string;
  group: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  /** The password / key passphrase is saved in the Windows Credential Manager (never here). */
  hasPassword?: boolean;
  hasPassphrase?: boolean;
  forwards?: PortForward[];
  createdAt: number;
  lastUsedAt?: number;
  /** Plain-text secrets from older versions; moved to the Credential Manager by `migrateSecrets`. */
  password?: string;
  passphrase?: string;
}

export type SshSessionInput = Omit<SshSession, "id" | "createdAt" | "lastUsedAt" | "password" | "passphrase">;

export const sessionLabel = (s: Pick<SshSession, "username" | "host" | "port">) =>
  `${s.username}@${s.host}${s.port !== 22 ? `:${s.port}` : ""}`;

interface SessionState {
  sessions: SshSession[];
  addSession: (input: SshSessionInput) => SshSession;
  updateSession: (id: string, patch: Partial<SshSession>) => void;
  removeSession: (id: string) => void;
  duplicateSession: (id: string) => void;
  touchSession: (id: string) => void;
  /** Moves session `id` next to `targetId` (dragging in the sidebar), into the target's group. */
  moveSession: (id: string, targetId: string, after: boolean) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],

      addSession: (input) => {
        const session: SshSession = { ...input, id: newId(), createdAt: Date.now() };
        set((s) => ({ sessions: [...s.sessions, session] }));
        return session;
      },

      updateSession: (id, patch) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),

      removeSession: (id) => {
        set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
        if (isDesktop) backend.credentialDelete(id).catch((e) => console.warn("credential delete failed", e));
      },

      duplicateSession: (id) => {
        const src = get().sessions.find((x) => x.id === id);
        if (!src) return;
        const { id: _id, createdAt: _c, lastUsedAt: _l, password: _p, passphrase: _pp, ...rest } = src;
        const copy = get().addSession({ ...rest, name: `${src.name} (copy)` });
        if (isDesktop && (src.hasPassword || src.hasPassphrase)) {
          backend.credentialCopy(src.id, copy.id, sessionLabel(src)).catch((e) => console.warn("credential copy failed", e));
        }
      },

      touchSession: (id) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, lastUsedAt: Date.now() } : x)),
        })),

      moveSession: (id, targetId, after) =>
        set((s) => {
          const moving = s.sessions.find((x) => x.id === id);
          const target = s.sessions.find((x) => x.id === targetId);
          if (!moving || !target || id === targetId) return s;
          const rest = s.sessions.filter((x) => x.id !== id);
          const at = rest.indexOf(target) + (after ? 1 : 0);
          rest.splice(at, 0, { ...moving, group: target.group });
          return { sessions: rest };
        }),
    }),
    {
      name: "wlt.sessions",
      version: 2,
      // v1 showed sessions sorted by name; v2 shows the saved order, so start from that order.
      migrate: (state, version) => {
        const s = state as Pick<SessionState, "sessions">;
        if (version < 2) s.sessions = [...s.sessions].sort((a, b) => a.name.localeCompare(b.name));
        return s as SessionState;
      },
    },
  ),
);

/**
 * Sessions as the sidebar shows them: named groups A→Z, then ungrouped ones;
 * inside a group, the saved (user-dragged) order.
 */
export function groupSessions(sessions: SshSession[]): [group: string, items: SshSession[]][] {
  const map = new Map<string, SshSession[]>();
  for (const s of sessions) map.set(s.group || "", [...(map.get(s.group || "") ?? []), s]);
  return [...map.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
}

/**
 * Moves plain-text passwords saved by older versions into the Windows
 * Credential Manager and removes them from local storage. Runs at startup.
 */
export async function migrateSecrets() {
  if (!isDesktop) return;
  const { sessions, updateSession } = useSessionStore.getState();
  for (const s of sessions) {
    const patch: Partial<SshSession> = {};
    try {
      if (s.password) {
        await backend.credentialSet(s.id, "password", s.password, sessionLabel(s));
        Object.assign(patch, { password: undefined, hasPassword: true });
      }
      if (s.passphrase) {
        await backend.credentialSet(s.id, "passphrase", s.passphrase, sessionLabel(s));
        Object.assign(patch, { passphrase: undefined, hasPassphrase: true });
      }
    } catch (e) {
      console.warn(`could not migrate secrets of ${s.name}`, e);
    }
    if (Object.keys(patch).length) updateSession(s.id, patch);
  }
}
