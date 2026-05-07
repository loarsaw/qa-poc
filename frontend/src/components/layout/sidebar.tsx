import { NavLink, useNavigate, useParams } from "react-router-dom";
import {
  useSessions,
  useCreateSession,
  useDeleteSession,
  useHealth,
} from "@/hooks";
import { truncate, formatDate } from "@/lib/utils";
import { Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/chat", icon: "💬", label: "Chat" },
  { to: "/upload", icon: "⬆️", label: "Upload" },
  { to: "/library", icon: "📚", label: "Library" },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const { data: sessionsData } = useSessions();
  const { data: health } = useHealth();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  const sessions = sessionsData?.items ?? [];
  const dbOk = health?.database === "connected";

  async function handleNew() {
    const s = await createSession.mutateAsync({});
    navigate(`/chat/${s.id}`);
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await deleteSession.mutateAsync(id);
    if (sessionId === id) navigate("/chat");
  }

  return (
    <aside className="flex flex-col w-64 min-w-[256px] bg-surface border-r border-border overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-base">
          ✦
        </div>
        <span className="font-bold text-base tracking-tight bg-gradient-to-r from-accent to-purple bg-clip-text text-transparent">
          QA·Bot
        </span>
        {/* DB health dot */}
        <div className="ml-auto flex items-center gap-1.5">
          <div
            className={cn(
              "w-2 h-2 rounded-full animate-pulse-dot",
              dbOk
                ? "bg-green shadow-[0_0_6px_#34d399]"
                : "bg-red shadow-[0_0_6px_#f87171]",
            )}
            title={health ? `DB: ${health.database}` : "Checking…"}
          />
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-0.5 px-2 pt-3">
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to !== "/chat"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                isActive
                  ? "bg-surface2 text-accent"
                  : "text-muted2 hover:bg-surface2 hover:text-text",
              )
            }
          >
            <span className="text-base w-5 text-center">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Sessions heading + new button */}
      <div className="flex items-center justify-between px-4 pt-5 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Sessions
        </span>
        <button
          onClick={handleNew}
          disabled={createSession.isPending}
          className="w-6 h-6 rounded-md bg-accent/10 hover:bg-accent/20 text-accent flex items-center justify-center text-sm transition-all cursor-pointer border-0"
          title="New session"
        >
          {createSession.isPending ? <Spinner size={12} /> : "+"}
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 ? (
          <p className="text-xs text-muted px-3 py-2">No sessions yet</p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate(`/chat/${s.id}`)}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all",
                sessionId === s.id
                  ? "bg-surface2 border-l-2 border-accent"
                  : "hover:bg-surface2",
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text truncate">
                  {truncate(s.title || "Untitled", 26)}
                </p>
                <p className="text-[10px] text-muted">
                  {s.message_count} msgs · {formatDate(s.created_at)}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(e, s.id)}
                className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-muted hover:text-red transition-all text-xs cursor-pointer border-0 bg-transparent"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
