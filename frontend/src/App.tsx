/**
 * App.tsx — zKill Activity Tracker Dashboard
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Attacker {
  character_id?: number;
  corporation_id?: number;
  alliance_id?: number;
  ship_type_id?: number;
  weapon_type_id?: number;
  final_blow?: boolean;
}

interface Kill {
  killID: number;
  zkb: { totalValue: number; labels: string[] };
  killmail: {
    killmail_time: string;
    solar_system_id: number;
    victim: { ship_type_id: number; character_id: number | null };
    attackers?: Attacker[];
  };
  shipCategories?: {
    victim?: { category: string; name: string; tier: string };
    attackers?: Record<
      string,
      { category: string; name: string; tier: string }
    >;
  };
  pinpoints?: {
    nearestCelestial?: { name: string; distance?: number } | null;
    celestialData?: {
      solarsystemname?: string;
      regionname?: string;
    };
  };
}

interface ActivityData {
  id: string;
  type: string;
  classification: string;
  systemId: number;
  stargateName: string | null;
  kills: Kill[];
  totalValue: number;
  lastKill: string | null;
  firstKillTime: number;
  lastActivity: number;
  composition: {
    originalCount: number;
    activeCount: number;
    killedCount: number;
    numCorps: number;
    numAlliances: number;
  };
  metrics: {
    firstSeen: number;
    campDuration: number;
    activeDuration: number;
    inactivityDuration: number;
    podKills: number;
    killFrequency: number;
    avgValuePerKill: number;
    partyMetrics: {
      characters: number;
      corporations: number;
      alliances: number;
    };
  };
  probability: number;
  maxProbability: number;
  visitedSystems: number[];
  systemsVisited: number;
  members: number[];
  systems: { id: number; name: string; region: string | null; time: number }[];
  lastSystem: { id: number; name: string; region: string | null };
  startTime: number;
}

interface WSMessage {
  type: string;
  data: ActivityData[];
}

type SortField =
  | "classification"
  | "probability"
  | "kills"
  | "value"
  | "duration"
  | "system";
type SortDir = "asc" | "desc";

// ─── WebSocket Hook ─────────────────────────────────────────────────────────

function useWebSocket() {
  const [activities, setActivities] = useState<ActivityData[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<number | null>(null);
  const reconnectAttempt = useRef(0);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      reconnectAttempt.current = 0;
    };
    ws.onmessage = (event) => {
      try {
        if (event.data === "ping") {
          ws.send("pong");
          return;
        }
        const msg: WSMessage = JSON.parse(event.data);
        if (msg.type === "activityUpdate" && Array.isArray(msg.data)) {
          console.log(
            "[WS] Activity update:",
            JSON.stringify(msg.data[0], null, 2),
          );
          if (msg.data[0]?.kills?.[0]) {
            console.log(
              "[WS] First kill shipCategories:",
              JSON.stringify(msg.data[0].kills[0].shipCategories, null, 2),
            );
            console.log(
              "[WS] First kill attackers sample:",
              JSON.stringify(
                msg.data[0].kills[0].killmail?.attackers?.slice(0, 3),
                null,
                2,
              ),
            );
          }
          setActivities(msg.data);
        }
      } catch {
        /* ignore parse errors */
      }
    };
    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
      const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt.current);
      reconnectAttempt.current++;
      reconnectTimeout.current = window.setTimeout(connect, delay);
    };
    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { activities, status };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function formatIsk(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function timeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

/** Get the system name: prefer lastSystem.name, fall back to first kill's pinpoints */
function getSystemName(activity: ActivityData): string {
  // From activity's lastSystem
  const name = activity.lastSystem?.name;
  if (name && !/^\d+$/.test(name)) return name;

  // From first kill's pinpoints celestialData
  for (const kill of activity.kills) {
    const sysName = kill.pinpoints?.celestialData?.solarsystemname;
    if (sysName) return sysName;
  }
  return name || `System ${activity.systemId}`;
}

/** Get region name */
function getRegionName(activity: ActivityData): string | null {
  const region = activity.lastSystem?.region;
  if (region) return region;
  for (const kill of activity.kills) {
    const rn = kill.pinpoints?.celestialData?.regionname;
    if (rn) return rn;
  }
  return null;
}

/** Get location description: stargate name > nearest celestial > system count */
function getLocation(activity: ActivityData): string | null {
  if (activity.stargateName) return activity.stargateName;
  // Find nearest celestial from most recent kill
  for (let i = activity.kills.length - 1; i >= 0; i--) {
    const nc = activity.kills[i]?.pinpoints?.nearestCelestial;
    if (nc?.name) return nc.name;
  }
  if (activity.systemsVisited > 1) return `${activity.systemsVisited} systems`;
  return null;
}

/** Get the last kill's zkb link */
function getLastKillUrl(activity: ActivityData): string | null {
  if (activity.kills.length === 0) return null;
  const lastKill = activity.kills[activity.kills.length - 1];
  return `https://zkillboard.com/kill/${lastKill.killID}/`;
}

// ─── Ship Composition ──────────────────────────────────────────────────────

/** Build a ship type frequency map from shipCategories data */
function getShipComposition(
  activity: ActivityData,
): { name: string; category: string; count: number }[] {
  // Collect ship info from shipCategories across all kills
  const shipInfo: Record<number, { name: string; category: string }> = {};
  const shipCharacters: Record<number, Set<string>> = {};

  for (const kill of activity.kills) {
    const attackerCats = kill.shipCategories?.attackers;
    if (!Array.isArray(attackerCats)) continue;

    for (const cat of attackerCats as {
      shipTypeId: number;
      category: string;
      name: string;
      tier: string;
    }[]) {
      if (!cat.shipTypeId || !cat.name) continue;
      shipInfo[cat.shipTypeId] = { name: cat.name, category: cat.category };
      // Track per-kill presence as a proxy for unique pilots
      if (!shipCharacters[cat.shipTypeId])
        shipCharacters[cat.shipTypeId] = new Set();
      shipCharacters[cat.shipTypeId].add(`${kill.killID}-${cat.shipTypeId}`);
    }
  }

  // Use metrics.shipCounts if available (more accurate counts from backend)
  const shipCounts = (activity.metrics as any)?.shipCounts as
    | Record<string, number>
    | undefined;

  return Object.entries(shipInfo)
    .map(([tid, info]) => ({
      name: info.name,
      category: info.category,
      count: shipCounts?.[tid] ?? shipCharacters[Number(tid)]?.size ?? 1,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Components ─────────────────────────────────────────────────────────────

const CLASSIFICATION_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  camp: {
    label: "CAMP",
    color: "text-red-400",
    bg: "bg-red-500/15 border-red-500/30",
  },
  smartbomb: {
    label: "SMARTBOMB",
    color: "text-orange-400",
    bg: "bg-orange-500/15 border-orange-500/30",
  },
  roaming_camp: {
    label: "ROAM CAMP",
    color: "text-yellow-400",
    bg: "bg-yellow-500/15 border-yellow-500/30",
  },
  battle: {
    label: "BATTLE",
    color: "text-purple-400",
    bg: "bg-purple-500/15 border-purple-500/30",
  },
  roam: {
    label: "GANG",
    color: "text-blue-400",
    bg: "bg-blue-500/15 border-blue-500/30",
  },
  activity: {
    label: "ACTIVITY",
    color: "text-gray-400",
    bg: "bg-gray-500/15 border-gray-500/30",
  },
};

function ClassificationBadge({ classification }: { classification: string }) {
  const config =
    CLASSIFICATION_CONFIG[classification] ?? CLASSIFICATION_CONFIG["activity"]!;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold tracking-wider border ${config.bg} ${config.color}`}
    >
      {config.label}
    </span>
  );
}

function ProbabilityBar({ value }: { value: number }) {
  const color =
    value >= 70
      ? "bg-red-500"
      : value >= 40
        ? "bg-orange-500"
        : value >= 15
          ? "bg-yellow-500"
          : "bg-gray-500";
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className="text-xs font-mono text-gray-400 w-8 text-right">
        {value}%
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const config = {
    connected: { color: "bg-green-500", pulse: true, text: "Live" },
    connecting: { color: "bg-yellow-500", pulse: true, text: "Connecting…" },
    disconnected: { color: "bg-red-500", pulse: false, text: "Disconnected" },
  }[status] ?? { color: "bg-gray-500", pulse: false, text: status };
  return (
    <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
      <span className="relative flex h-2 w-2">
        {config.pulse && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.color} opacity-75`}
          />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${config.color}`}
        />
      </span>
      {config.text}
    </div>
  );
}

/** Category color for ship types */
const CATEGORY_COLORS: Record<string, string> = {
  frigate: "text-green-400",
  destroyer: "text-green-300",
  cruiser: "text-blue-400",
  battlecruiser: "text-blue-300",
  battleship: "text-purple-400",
  capital: "text-red-400",
  supercapital: "text-red-300",
  industrial: "text-yellow-400",
  mining: "text-yellow-300",
};

/** Expandable ship composition popover — renders above the table scroll area */
function ShipCompRow({ activity }: { activity: ActivityData }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const ships = useMemo(() => getShipComposition(activity), [activity]);
  const charCount =
    activity.metrics?.partyMetrics?.characters ?? activity.members?.length ?? 0;
  const corpCount = activity.composition?.numCorps ?? 0;

  // Position the popup relative to the button using fixed positioning
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <td className="px-3 py-3">
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="text-left hover:text-gray-100 transition-colors group"
      >
        <div className="flex flex-col">
          <span className="text-xs font-mono text-gray-300 group-hover:text-gray-100">
            {charCount} chars{" "}
            <span className="text-gray-600 text-[10px]">▾</span>
          </span>
          <span className="text-xs text-gray-500">{corpCount} corps</span>
        </div>
      </button>
      {open && (
        <div
          ref={popRef}
          className="fixed z-50 bg-surface-2 border border-surface-3 rounded-lg shadow-2xl p-3 min-w-[260px] max-h-[360px] overflow-y-auto"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">
            Ship Composition ({ships.reduce((s, x) => s + x.count, 0)} pilots)
          </div>
          {ships.length > 0 ? (
            ships.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-0.5 text-xs gap-3"
              >
                <span
                  className={`font-mono truncate ${CATEGORY_COLORS[s.category] ?? "text-gray-300"}`}
                >
                  {s.name}
                </span>
                <span className="text-gray-500 font-mono flex-shrink-0">
                  ×{s.count}
                </span>
              </div>
            ))
          ) : (
            <div className="text-xs text-gray-600 italic">
              No ship data available
            </div>
          )}
        </div>
      )}
    </td>
  );
}

// ─── Activity Table ─────────────────────────────────────────────────────────

function ActivityTable({ activities }: { activities: ActivityData[] }) {
  const [sortField, setSortField] = useState<SortField>("probability");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState<string>("all");

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    let items = [...activities];
    if (filter !== "all")
      items = items.filter((a) => a.classification === filter);
    return items;
  }, [activities, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "classification":
          cmp = a.classification.localeCompare(b.classification);
          break;
        case "probability":
          cmp = a.probability - b.probability;
          break;
        case "kills":
          cmp = a.kills.length - b.kills.length;
          break;
        case "value":
          cmp = a.totalValue - b.totalValue;
          break;
        case "duration":
          cmp = (a.metrics?.campDuration ?? 0) - (b.metrics?.campDuration ?? 0);
          break;
        case "system": {
          const nameA = getSystemName(a);
          const nameB = getSystemName(b);
          cmp = nameA.localeCompare(nameB);
          break;
        }
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [filtered, sortField, sortDir]);

  const SortHeader = ({
    field,
    label,
    className = "",
  }: {
    field: SortField;
    label: string;
    className?: string;
  }) => (
    <th
      className={`px-3 py-2.5 text-left text-xs font-mono font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-300 transition-colors select-none ${className}`}
      onClick={() => toggleSort(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortField === field && (
          <span className="text-gray-400">
            {sortDir === "desc" ? "↓" : "↑"}
          </span>
        )}
      </span>
    </th>
  );

  const classificationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    activities.forEach((a) => {
      counts[a.classification] = (counts[a.classification] ?? 0) + 1;
    });
    return counts;
  }, [activities]);

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <div className="text-4xl mb-4">📡</div>
        <p className="text-sm font-mono">Waiting for activity data…</p>
        <p className="text-xs text-gray-600 mt-1">
          Killmails are being polled from zKillboard
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-mono transition-colors border ${
            filter === "all"
              ? "bg-gray-700/50 border-gray-600 text-gray-200"
              : "bg-transparent border-surface-3 text-gray-500 hover:text-gray-300 hover:border-gray-600"
          }`}
        >
          All ({activities.length})
        </button>
        {Object.entries(CLASSIFICATION_CONFIG).map(([key, cfg]) => {
          const count = classificationCounts[key] ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? "all" : key)}
              className={`px-3 py-1 rounded-full text-xs font-mono transition-colors border ${
                filter === key
                  ? `${cfg.bg} ${cfg.color}`
                  : "bg-transparent border-surface-3 text-gray-500 hover:text-gray-300 hover:border-gray-600"
              }`}
            >
              {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-surface-3/50">
        <table className="w-full">
          <thead className="bg-surface-2/50">
            <tr>
              <SortHeader field="classification" label="Type" />
              <SortHeader field="system" label="System" />
              <th className="px-3 py-2.5 text-left text-xs font-mono font-medium text-gray-500 uppercase tracking-wider">
                Location
              </th>
              <SortHeader field="kills" label="Kills" />
              <SortHeader field="value" label="ISK Destroyed" />
              <SortHeader
                field="probability"
                label="Probability"
                className="min-w-[140px]"
              />
              <th className="px-3 py-2.5 text-left text-xs font-mono font-medium text-gray-500 uppercase tracking-wider">
                Participants
              </th>
              <SortHeader field="duration" label="Duration" />
              <th className="px-3 py-2.5 text-left text-xs font-mono font-medium text-gray-500 uppercase tracking-wider">
                Last Kill
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3/30">
            {sorted.map((activity) => {
              const sysName = getSystemName(activity);
              const regionName = getRegionName(activity);
              const location = getLocation(activity);
              const lastKillUrl = getLastKillUrl(activity);

              return (
                <tr
                  key={activity.id}
                  className="hover:bg-surface-2/30 transition-colors animate-slide-in"
                >
                  <td className="px-3 py-3">
                    <ClassificationBadge
                      classification={activity.classification}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-200">
                        {sysName}
                      </span>
                      {regionName && (
                        <span className="text-xs text-gray-500">
                          {regionName}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {location ? (
                      <span className="text-xs text-gray-400 font-mono">
                        {location}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start">
                      <span className="text-sm font-mono font-medium text-gray-200">
                        {activity.kills.length}
                      </span>
                      {(activity.metrics?.podKills ?? 0) > 0 && (
                        <span className="text-xs text-gray-500">
                          {activity.metrics.podKills} pods
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-sm font-mono text-gray-300">
                      {formatIsk(activity.totalValue)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <ProbabilityBar value={activity.probability} />
                  </td>
                  <ShipCompRow activity={activity} />
                  <td className="px-3 py-3">
                    <span className="text-xs font-mono text-gray-400">
                      {formatDuration(activity.metrics?.campDuration ?? 0)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {lastKillUrl ? (
                      <a
                        href={lastKillUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                      >
                        {activity.lastActivity
                          ? timeAgo(activity.lastActivity)
                          : "view"}
                      </a>
                    ) : (
                      <span className="text-xs font-mono text-gray-500">
                        {activity.lastActivity
                          ? timeAgo(activity.lastActivity)
                          : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── App Component ──────────────────────────────────────────────────────────

function App() {
  const { activities, status } = useWebSocket();

  return (
    <div className="min-h-screen bg-surface-0">
      <header className="border-b border-surface-3/50 bg-surface-1/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-gray-100">
              <span className="text-red-400">z</span>Kill Activity Tracker
            </h1>
            <span className="text-xs font-mono text-gray-600 hidden sm:inline">
              EVE Online PvP Detection
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-gray-600">
              {activities.length} active
            </span>
            <StatusDot status={status} />
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <ActivityTable activities={activities} />
      </main>

      <footer className="border-t border-surface-3/30 mt-auto">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between text-xs text-gray-600 font-mono">
          <span>Data from zKillboard RedisQ → ESI</span>
          <span>Gatecamps • Gangs • Roams</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
