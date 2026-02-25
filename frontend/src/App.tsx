/**
 * App.tsx — killBright Activity Tracker Dashboard
 * Dense terminal-style UI inspired by Bloomberg/TradingView
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────
interface Kill {
  killID: number;
  zkb: { totalValue: number; labels: string[] };
  killmail: {
    killmail_time: string;
    solar_system_id: number;
    victim: { ship_type_id: number; character_id: number | null };
    attackers?: {
      character_id?: number;
      corporation_id?: number;
      alliance_id?: number;
      ship_type_id?: number;
      weapon_type_id?: number;
      final_blow?: boolean;
    }[];
  };
  shipCategories?: {
    victim?: { category: string; name: string; tier: string };
    attackers?: {
      shipTypeId: number;
      category: string;
      name: string;
      tier: string;
    }[];
  };
  pinpoints?: {
    nearestCelestial?: { name: string; distance?: number } | null;
    celestialData?: {
      solarsystemname?: string;
      regionname?: string;
      security?: number;
    };
  };
}
interface SystemInfo {
  id: number;
  name: string;
  region: string | null;
  time: number;
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
    shipCounts?: Record<string, number>;
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
  systems: SystemInfo[];
  lastSystem: { id: number; name: string; region: string | null };
  startTime: number;
}
interface WSMessage {
  type: string;
  data: ActivityData[];
}
interface RegionData {
  live: Record<
    string,
    {
      camps: number;
      roams: number;
      battles: number;
      other: number;
      totalValue: number;
    }
  >;
  history: Record<
    string,
    {
      sessions: number;
      kills: number;
      value: number;
      byType: Record<string, number>;
    }
  >;
}
type Page = "live" | "regions";
type SortField =
  | "classification"
  | "probability"
  | "kills"
  | "value"
  | "duration"
  | "system"
  | "lastKill";
type SortDir = "asc" | "desc";

// ─── Delta Tracking ─────────────────────────────────────────────────────────
interface DeltaValues {
  kills: number;
  value: number;
  prob: number;
}
const prevValues = new Map<string, DeltaValues>();
const flashStates = new Map<
  string,
  { kills: number; value: number; prob: number }
>();
let flashGeneration = 0;

function computeDeltas(activities: ActivityData[]): {
  deltas: Map<string, DeltaValues>;
  gen: number;
} {
  const map = new Map<string, DeltaValues>();
  const newFlash = new Map<
    string,
    { kills: number; value: number; prob: number }
  >();
  for (const a of activities) {
    const prev = prevValues.get(a.id);
    const cur = {
      kills: a.kills.length,
      value: a.totalValue,
      prob: a.probability,
    };
    prevValues.set(a.id, { ...cur });
    if (!prev) {
      map.set(a.id, { kills: 0, value: 0, prob: 0 });
      continue;
    }
    const d = {
      kills: cur.kills - prev.kills,
      value: cur.value - prev.value,
      prob: cur.prob - prev.prob,
    };
    map.set(a.id, d);
    if (d.kills !== 0 || d.value !== 0 || d.prob !== 0) {
      newFlash.set(a.id, {
        kills: d.kills > 0 ? 1 : d.kills < 0 ? -1 : 0,
        value: d.value > 0 ? 1 : d.value < 0 ? -1 : 0,
        prob: d.prob > 0 ? 1 : d.prob < 0 ? -1 : 0,
      });
    }
  }
  flashStates.clear();
  for (const [k, v] of newFlash) flashStates.set(k, v);
  flashGeneration++;
  return { deltas: map, gen: flashGeneration };
}

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
        if (msg.type === "activityUpdate" && Array.isArray(msg.data))
          setActivities(msg.data);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
      const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt.current);
      reconnectAttempt.current++;
      reconnectTimeout.current = window.setTimeout(connect, delay);
    };
    ws.onerror = () => ws.close();
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
function formatIsk(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}
function formatDuration(min: number): string {
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60),
    m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
function timeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs,
    mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h${mins % 60}m ago`;
}
function getSystemName(a: ActivityData): string {
  const n = a.lastSystem?.name;
  if (n && !/^\d+$/.test(n)) return n;
  for (const k of a.kills) {
    const s = k.pinpoints?.celestialData?.solarsystemname;
    if (s) return s;
  }
  return n || `${a.systemId}`;
}
function getRegionName(a: ActivityData): string | null {
  if (a.lastSystem?.region) return a.lastSystem.region;
  for (const k of a.kills) {
    const r = k.pinpoints?.celestialData?.regionname;
    if (r) return r;
  }
  return null;
}
function getLocation(a: ActivityData): string | null {
  if (a.stargateName) return a.stargateName;
  for (let i = a.kills.length - 1; i >= 0; i--) {
    const nc = a.kills[i]?.pinpoints?.nearestCelestial;
    if (nc?.name) return nc.name;
  }
  if (a.systemsVisited > 1) return `${a.systemsVisited} systems`;
  return null;
}
function getLastKillUrl(a: ActivityData): string | null {
  if (!a.kills.length) return null;
  return `https://zkillboard.com/kill/${a.kills[a.kills.length - 1]!.killID}/`;
}
function getShipComposition(
  a: ActivityData,
): { name: string; category: string; count: number }[] {
  const info: Record<number, { name: string; category: string }> = {};
  const presence: Record<number, Set<string>> = {};
  for (const k of a.kills) {
    const cats = k.shipCategories?.attackers;
    if (!Array.isArray(cats)) continue;
    for (const c of cats) {
      if (!c.shipTypeId || !c.name) continue;
      info[c.shipTypeId] = { name: c.name, category: c.category };
      if (!presence[c.shipTypeId]) presence[c.shipTypeId] = new Set();
      presence[c.shipTypeId]!.add(`${k.killID}-${c.shipTypeId}`);
    }
  }
  const sc = a.metrics?.shipCounts;
  return Object.entries(info)
    .map(([tid, i]) => ({
      name: i.name,
      category: i.category,
      count: sc?.[tid] ?? presence[Number(tid)]?.size ?? 1,
    }))
    .sort((a, b) => b.count - a.count);
}
function getVisitedSystems(
  a: ActivityData,
): { name: string; region: string | null; security: number | null }[] {
  const seen = new Set<number>();
  const result: {
    name: string;
    region: string | null;
    security: number | null;
  }[] = [];
  const secMap = new Map<number, number>();
  for (const k of a.kills) {
    const cd = k.pinpoints?.celestialData;
    if (cd?.security != null)
      secMap.set(k.killmail.solar_system_id, cd.security);
  }
  for (const sys of a.systems) {
    if (seen.has(sys.id)) continue;
    seen.add(sys.id);
    result.push({
      name: sys.name,
      region: sys.region,
      security: secMap.get(sys.id) ?? null,
    });
  }
  return result;
}

// ─── Shared Components ──────────────────────────────────────────────────────
const CLASS_CFG: Record<
  string,
  { label: string; fg: string; bg: string; filterGroup?: string }
> = {
  camp: {
    label: "CAMP",
    fg: "#ff4444",
    bg: "rgba(255,68,68,0.12)",
    filterGroup: "camp",
  },
  solo_camp: {
    label: "SOLOCAMP",
    fg: "#ff6655",
    bg: "rgba(255,102,85,0.12)",
    filterGroup: "camp",
  },
  smartbomb: {
    label: "SB",
    fg: "#ff8844",
    bg: "rgba(255,136,68,0.12)",
    filterGroup: "camp",
  },
  roaming_camp: {
    label: "ROAMCAMP",
    fg: "#ffcc33",
    bg: "rgba(255,204,51,0.12)",
    filterGroup: "camp",
  },
  battle: { label: "BATTLE", fg: "#cc44ff", bg: "rgba(204,68,255,0.12)" },
  roam: { label: "GANG", fg: "#22aaff", bg: "rgba(34,170,255,0.12)" },
  solo_roam: { label: "SOLO", fg: "#667788", bg: "rgba(102,119,136,0.08)" },
  activity: { label: "ACTIVITY", fg: "#556677", bg: "rgba(85,102,119,0.06)" },
};
const FILTER_GROUPS: Record<string, string[]> = {
  camp: ["camp", "solo_camp", "smartbomb", "roaming_camp"],
};

function Badge({ classification }: { classification: string }) {
  const c = CLASS_CFG[classification] ?? CLASS_CFG["activity"]!;
  return (
    <span
      style={{ color: c.fg, background: c.bg, borderColor: `${c.fg}33` }}
      className="inline-block px-1.5 py-px rounded text-[10px] font-mono font-semibold tracking-widest border leading-tight"
    >
      {c.label}
    </span>
  );
}

/** Fixed-width delta — always takes exactly 38px, never shifts layout */
function DeltaNum({
  value,
  format = "int",
}: {
  value: number;
  format?: "int" | "isk" | "pct";
}) {
  let display = "";
  let color = "transparent";
  if (value !== 0) {
    const pos = value > 0;
    color = pos ? "#44cc66" : "#ff4444";
    if (format === "isk") display = `${pos ? "+" : ""}${formatIsk(value)}`;
    else if (format === "pct") display = `${pos ? "+" : ""}${value}%`;
    else display = `${pos ? "+" : ""}${value}`;
  }
  // Always render a fixed-width box — content or empty, no layout shift
  return (
    <span
      className="text-[9px] font-mono inline-block w-[38px] text-right flex-shrink-0"
      style={{ color, minWidth: 38 }}
    >
      {display || "\u00A0"}
    </span>
  );
}

/** Cell that flashes green/red on data change then fades */
function FlashCell({
  children,
  flash,
  className = "",
}: {
  children: React.ReactNode;
  flash: number;
  className?: string;
}) {
  const [active, setActive] = useState(false);
  const prevFlash = useRef(0);
  const mountRef = useRef(false);
  useEffect(() => {
    mountRef.current = true;
  }, []);
  useEffect(() => {
    if (!mountRef.current) return;
    if (flash !== 0 && flash !== prevFlash.current) {
      setActive(true);
      const t = setTimeout(() => setActive(false), 700);
      prevFlash.current = flash;
      return () => clearTimeout(t);
    }
    prevFlash.current = flash;
  }, [flash]);
  const bg = active
    ? flash > 0
      ? "rgba(68,204,102,0.10)"
      : "rgba(255,68,68,0.10)"
    : "transparent";
  return (
    <td
      className={`tc-cell ${className}`}
      style={{ background: bg, transition: "background 0.4s ease-out" }}
    >
      {children}
    </td>
  );
}

function ProbCell({ value, delta }: { value: number; delta: number }) {
  const w = Math.min(100, value);
  const color =
    value >= 70
      ? "#ff4444"
      : value >= 40
        ? "#ff8844"
        : value >= 15
          ? "#ffcc33"
          : "#334455";
  return (
    <div className="flex items-center gap-1" style={{ minWidth: 110 }}>
      <div
        className="h-[3px] rounded-full overflow-hidden"
        style={{ background: "#1a1a26", width: 48, flexShrink: 0 }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${w}%`, background: color }}
        />
      </div>
      <span
        className="text-[10px] font-mono w-[26px] text-right flex-shrink-0"
        style={{ color }}
      >
        {value}%
      </span>
      <DeltaNum value={delta} format="pct" />
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const cfg = {
    connected: { color: "#44cc66", label: "LIVE" },
    connecting: { color: "#ffcc33", label: "CONN" },
    disconnected: { color: "#ff4444", label: "DOWN" },
  }[status] ?? { color: "#667788", label: "???" };
  return (
    <div
      className="flex items-center gap-1.5 text-[10px] font-mono"
      style={{ color: cfg.color }}
    >
      <span className="relative flex h-1.5 w-1.5">
        {status === "connected" && (
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
            style={{ background: cfg.color }}
          />
        )}
        <span
          className="relative inline-flex rounded-full h-1.5 w-1.5"
          style={{ background: cfg.color }}
        />
      </span>
      {cfg.label}
    </div>
  );
}

const CAT_COLORS: Record<string, string> = {
  frigate: "#44cc66",
  destroyer: "#66cc88",
  cruiser: "#4488ff",
  battlecruiser: "#6688ff",
  battleship: "#8844ff",
  capital: "#ff4444",
  supercapital: "#ff6644",
  industrial: "#ffcc33",
  mining: "#ffaa33",
};

// ─── Popovers ───────────────────────────────────────────────────────────────
function usePopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({
      top: r.bottom + 2,
      left: Math.min(r.left, window.innerWidth - 260),
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        popRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return { open, setOpen, btnRef, popRef, pos };
}

function ShipPopover({ activity }: { activity: ActivityData }) {
  const { open, setOpen, btnRef, popRef, pos } = usePopover();
  const ships = useMemo(() => getShipComposition(activity), [activity]);
  const chars =
    activity.metrics?.partyMetrics?.characters ?? activity.members?.length ?? 0;
  const corps = activity.composition?.numCorps ?? 0;
  return (
    <td className="tc-cell">
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="text-left group cursor-pointer"
      >
        <span className="text-[11px] font-mono text-gray-300 group-hover:text-gray-100">
          {chars}
          <span className="text-gray-600 text-[9px]">ch</span>
        </span>
        <span className="text-gray-600 mx-0.5">&middot;</span>
        <span className="text-[10px] font-mono text-gray-500">
          {corps}
          <span className="text-gray-600 text-[9px]">co</span>
        </span>
      </button>
      {open && (
        <div
          ref={popRef}
          className="fixed z-50 rounded shadow-2xl p-2 min-w-[220px] max-h-[300px] overflow-y-auto text-[10px] font-mono"
          style={{
            top: pos.top,
            left: pos.left,
            background: "#12121a",
            border: "1px solid #222233",
          }}
        >
          <div
            className="text-[9px] text-gray-600 uppercase tracking-widest mb-1.5 pb-1"
            style={{ borderBottom: "1px solid #1a1a26" }}
          >
            COMP &mdash; {ships.reduce((s, x) => s + x.count, 0)} pilots
          </div>
          {ships.length > 0 ? (
            ships.map((s, i) => (
              <div key={i} className="flex items-center justify-between py-px">
                <span
                  className="truncate"
                  style={{ color: CAT_COLORS[s.category] ?? "#99aabb" }}
                >
                  {s.name}
                </span>
                <span className="text-gray-600 flex-shrink-0 ml-2">
                  &times;{s.count}
                </span>
              </div>
            ))
          ) : (
            <div className="text-gray-600 italic">No ship data</div>
          )}
        </div>
      )}
    </td>
  );
}

function SystemsPopover({ activity }: { activity: ActivityData }) {
  const { open, setOpen, btnRef, popRef, pos } = usePopover();
  const systems = useMemo(() => getVisitedSystems(activity), [activity]);
  const loc = getLocation(activity);
  const isMulti = activity.systemsVisited > 1;
  const secColor = (s: number | null) =>
    s == null
      ? "#667788"
      : s >= 0.5
        ? "#44cc66"
        : s > 0.0
          ? "#ffcc33"
          : "#ff4444";
  const secLabel = (s: number | null) => (s == null ? "?" : s.toFixed(1));

  if (!isMulti)
    return (
      <td className="tc-cell">
        <span
          className="text-[10px] font-mono text-gray-500 truncate block max-w-[160px]"
          title={loc ?? undefined}
        >
          {loc ?? "\u2014"}
        </span>
      </td>
    );

  return (
    <td className="tc-cell">
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="text-left group cursor-pointer"
      >
        <span className="text-[10px] font-mono text-gray-400 group-hover:text-gray-200 truncate block max-w-[160px]">
          {loc ?? `${activity.systemsVisited} sys`}
          <span className="text-gray-600 text-[9px] ml-0.5">&#x25BE;</span>
        </span>
      </button>
      {open && (
        <div
          ref={popRef}
          className="fixed z-50 rounded shadow-2xl p-2 min-w-[260px] max-h-[300px] overflow-y-auto text-[10px] font-mono"
          style={{
            top: pos.top,
            left: pos.left,
            background: "#12121a",
            border: "1px solid #222233",
          }}
        >
          <div
            className="text-[9px] text-gray-600 uppercase tracking-widest mb-1.5 pb-1"
            style={{ borderBottom: "1px solid #1a1a26" }}
          >
            ROUTE &mdash; {systems.length} systems
          </div>
          {systems.map((s, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span
                className="w-[28px] text-right flex-shrink-0 font-semibold"
                style={{ color: secColor(s.security) }}
              >
                {secLabel(s.security)}
              </span>
              <span className="text-gray-200 truncate flex-1">{s.name}</span>
              {s.region && (
                <span className="text-gray-600 flex-shrink-0 truncate max-w-[100px]">
                  {s.region}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </td>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE PAGE
// ═══════════════════════════════════════════════════════════════════════════
function LivePage({ activities }: { activities: ActivityData[] }) {
  const [sortField, setSortField] = useState<SortField>("probability");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("all");
  const toggleSort = (f: SortField) => {
    if (sortField === f) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(f);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    if (filter === "all") return [...activities];
    const group = FILTER_GROUPS[filter];
    if (group)
      return activities.filter((a) => group.includes(a.classification));
    return activities.filter((a) => a.classification === filter);
  }, [activities, filter]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        let c = 0;
        switch (sortField) {
          case "classification":
            c = a.classification.localeCompare(b.classification);
            break;
          case "probability":
            c = a.probability - b.probability;
            break;
          case "kills":
            c = a.kills.length - b.kills.length;
            break;
          case "value":
            c = a.totalValue - b.totalValue;
            break;
          case "duration":
            c = (a.metrics?.campDuration ?? 0) - (b.metrics?.campDuration ?? 0);
            break;
          case "system":
            c = getSystemName(a).localeCompare(getSystemName(b));
            break;
          case "lastKill":
            c = (a.lastActivity ?? 0) - (b.lastActivity ?? 0);
            break;
        }
        return sortDir === "desc" ? -c : c;
      }),
    [filtered, sortField, sortDir],
  );

  // Filter counts: group camp types under "camp" filter
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    const campGroup = FILTER_GROUPS["camp"]!;
    let campTotal = 0;
    activities.forEach((a) => {
      if (campGroup.includes(a.classification)) campTotal++;
      else c[a.classification] = (c[a.classification] ?? 0) + 1;
    });
    if (campTotal > 0) c["camp"] = campTotal;
    return c;
  }, [activities]);

  const { deltas, gen } = useMemo(
    () => computeDeltas(activities),
    [activities],
  );
  const [, setFlashTick] = useState(0);
  useEffect(() => {
    setFlashTick(gen);
  }, [gen]);

  const SH = ({
    field,
    label,
    right,
  }: {
    field: SortField;
    label: string;
    right?: boolean;
  }) => (
    <th
      className={`tc-header cursor-pointer select-none hover:text-gray-400 transition-colors ${right ? "text-right" : "text-left"}`}
      onClick={() => toggleSort(field)}
    >
      <span
        className="flex items-center gap-0.5"
        style={{ justifyContent: right ? "flex-end" : "flex-start" }}
      >
        {label}
        {sortField === field && (
          <span className="text-gray-500">
            {sortDir === "desc" ? "\u25BC" : "\u25B2"}
          </span>
        )}
      </span>
    </th>
  );

  if (!activities.length)
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-600 font-mono text-xs">
        <div className="mb-2 text-lg">&#x25CE;</div>
        <div>AWAITING FEED...</div>
        <div className="text-[10px] text-gray-700 mt-1">
          Polling zKillboard RedisQ
        </div>
      </div>
    );

  // Build filter buttons
  const filterButtons: {
    key: string;
    label: string;
    fg: string;
    count: number;
  }[] = [];
  if (counts["camp"])
    filterButtons.push({
      key: "camp",
      label: "CAMP",
      fg: CLASS_CFG["camp"]!.fg,
      count: counts["camp"]!,
    });
  for (const [k, cfg] of Object.entries(CLASS_CFG)) {
    if (FILTER_GROUPS["camp"]!.includes(k)) continue;
    const n = counts[k] ?? 0;
    if (!n) continue;
    filterButtons.push({ key: k, label: cfg.label, fg: cfg.fg, count: n });
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1"
        style={{ borderBottom: "1px solid #1a1a26" }}
      >
        <button
          onClick={() => setFilter("all")}
          className={`tc-filter-btn ${filter === "all" ? "tc-filter-active" : ""}`}
        >
          ALL {activities.length}
        </button>
        {filterButtons.map((fb) => (
          <button
            key={fb.key}
            onClick={() => setFilter(filter === fb.key ? "all" : fb.key)}
            className={`tc-filter-btn ${filter === fb.key ? "tc-filter-active" : ""}`}
            style={
              filter === fb.key
                ? { color: fb.fg, borderColor: `${fb.fg}44` }
                : undefined
            }
          >
            {fb.label} {fb.count}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full"
          style={{ borderCollapse: "separate", borderSpacing: 0 }}
        >
          <thead>
            <tr style={{ background: "#0d0d14" }}>
              <SH field="classification" label="TYPE" />
              <SH field="system" label="SYSTEM" />
              <th className="tc-header text-left">LOC</th>
              <SH field="kills" label="K" right />
              <SH field="value" label="ISK" right />
              <SH field="probability" label="PROB" />
              <th className="tc-header text-left">COMP</th>
              <SH field="duration" label="DUR" right />
              <SH field="lastKill" label="LAST" right />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const sn = getSystemName(a),
                rn = getRegionName(a),
                url = getLastKillUrl(a);
              const d = deltas.get(a.id) ?? { kills: 0, value: 0, prob: 0 };
              const fl = flashStates.get(a.id) ?? {
                kills: 0,
                value: 0,
                prob: 0,
              };
              const pods = a.metrics?.podKills ?? 0;
              return (
                <tr key={a.id} className="tc-row">
                  <td className="tc-cell">
                    <Badge classification={a.classification} />
                  </td>
                  <td className="tc-cell">
                    <span className="text-[11px] font-mono text-gray-200">
                      {sn}
                    </span>
                    {rn && (
                      <span className="text-[9px] text-gray-600 ml-1">
                        {rn}
                      </span>
                    )}
                  </td>
                  <SystemsPopover activity={a} />
                  <FlashCell flash={fl.kills} className="text-right">
                    <div className="flex items-center justify-end">
                      <span className="text-[11px] font-mono text-gray-200">
                        {a.kills.length}
                      </span>
                      {pods > 0 && (
                        <span className="text-[9px] text-gray-600 ml-0.5">
                          {pods}p
                        </span>
                      )}
                      <DeltaNum value={d.kills} />
                    </div>
                  </FlashCell>
                  <FlashCell flash={fl.value} className="text-right">
                    <div className="flex items-center justify-end">
                      <span className="text-[11px] font-mono text-gray-300">
                        {formatIsk(a.totalValue)}
                      </span>
                      <DeltaNum value={d.value} format="isk" />
                    </div>
                  </FlashCell>
                  <FlashCell flash={fl.prob}>
                    <ProbCell value={a.probability} delta={d.prob} />
                  </FlashCell>
                  <ShipPopover activity={a} />
                  <td className="tc-cell text-right">
                    <span className="text-[10px] font-mono text-gray-500">
                      {formatDuration(a.metrics?.campDuration ?? 0)}
                    </span>
                  </td>
                  <td className="tc-cell text-right">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-mono text-blue-500 hover:text-blue-400 no-underline"
                      >
                        {a.lastActivity ? timeAgo(a.lastActivity) : "view"}
                      </a>
                    ) : (
                      <span className="text-[10px] font-mono text-gray-600">
                        {a.lastActivity ? timeAgo(a.lastActivity) : "\u2014"}
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

// ═══════════════════════════════════════════════════════════════════════════
// REGIONS PAGE
// ═══════════════════════════════════════════════════════════════════════════
function RegionsPage() {
  const [data, setData] = useState<RegionData | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/regions/activity?hours=${hours}`);
      setData(await res.json());
    } catch (e) {
      console.error("Failed to fetch regions:", e);
    }
    setLoading(false);
  }, [hours]);
  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 15_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  if (loading && !data)
    return (
      <div className="flex items-center justify-center py-10 text-gray-600 font-mono text-[10px]">
        LOADING REGIONS...
      </div>
    );

  const allRegions = new Set([
    ...Object.keys(data?.live ?? {}),
    ...Object.keys(data?.history ?? {}),
  ]);
  const regionList = [...allRegions]
    .map((region) => {
      const live = data?.live?.[region] ?? {
        camps: 0,
        roams: 0,
        battles: 0,
        other: 0,
        totalValue: 0,
      };
      const hist = data?.history?.[region] ?? {
        sessions: 0,
        kills: 0,
        value: 0,
        byType: {},
      };
      const totalLive = live.camps + live.roams + live.battles + live.other;
      return {
        region,
        live,
        hist,
        totalLive,
        totalActivity: totalLive + hist.sessions,
      };
    })
    .sort(
      (a, b) => b.totalLive - a.totalLive || b.totalActivity - a.totalActivity,
    );

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1"
        style={{ borderBottom: "1px solid #1a1a26" }}
      >
        <span className="text-[9px] font-mono text-gray-600 mr-1">RANGE</span>
        {[6, 12, 24, 48, 168].map((h) => (
          <button
            key={h}
            onClick={() => setHours(h)}
            className={`tc-filter-btn ${hours === h ? "tc-filter-active" : ""}`}
          >
            {h < 24 ? `${h}H` : `${h / 24}D`}
          </button>
        ))}
        <button
          onClick={fetchData}
          className="tc-filter-btn ml-auto text-gray-600 hover:text-gray-400"
        >
          &#x21BB; REFRESH
        </button>
      </div>
      {regionList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-600 font-mono text-[10px]">
          NO REGIONAL DATA
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full"
            style={{ borderCollapse: "separate", borderSpacing: 0 }}
          >
            <thead>
              <tr style={{ background: "#0d0d14" }}>
                <th className="tc-header text-left">REGION</th>
                <th
                  className="tc-header text-right"
                  style={{ color: "#ff4444" }}
                >
                  CAMPS
                </th>
                <th
                  className="tc-header text-right"
                  style={{ color: "#4488ff" }}
                >
                  GANGS
                </th>
                <th
                  className="tc-header text-right"
                  style={{ color: "#8844ff" }}
                >
                  BATTLES
                </th>
                <th className="tc-header text-right">OTHER</th>
                <th className="tc-header text-right">LIVE ISK</th>
                <th className="tc-header text-right">HIST SESS</th>
                <th className="tc-header text-right">HIST KILLS</th>
                <th className="tc-header text-right">HIST ISK</th>
              </tr>
            </thead>
            <tbody>
              {regionList.map(({ region, live, hist, totalLive }) => (
                <tr key={region} className="tc-row">
                  <td className="tc-cell">
                    <span className="text-[11px] font-mono text-gray-200">
                      {region}
                    </span>
                    {totalLive > 0 && (
                      <span className="text-[9px] font-mono text-red-500 ml-1.5 animate-pulse-subtle">
                        &bull; {totalLive}
                      </span>
                    )}
                  </td>
                  <td className="tc-cell text-right">
                    <span
                      className="text-[11px] font-mono"
                      style={{ color: live.camps > 0 ? "#ff4444" : "#2a2a3a" }}
                    >
                      {live.camps || "\u00B7"}
                    </span>
                  </td>
                  <td className="tc-cell text-right">
                    <span
                      className="text-[11px] font-mono"
                      style={{ color: live.roams > 0 ? "#4488ff" : "#2a2a3a" }}
                    >
                      {live.roams || "\u00B7"}
                    </span>
                  </td>
                  <td className="tc-cell text-right">
                    <span
                      className="text-[11px] font-mono"
                      style={{
                        color: live.battles > 0 ? "#8844ff" : "#2a2a3a",
                      }}
                    >
                      {live.battles || "\u00B7"}
                    </span>
                  </td>
                  <td className="tc-cell text-right">
                    <span
                      className="text-[11px] font-mono"
                      style={{ color: live.other > 0 ? "#667788" : "#2a2a3a" }}
                    >
                      {live.other || "\u00B7"}
                    </span>
                  </td>
                  <td className="tc-cell text-right">
                    <span className="text-[10px] font-mono text-gray-500">
                      {live.totalValue > 0
                        ? formatIsk(live.totalValue)
                        : "\u00B7"}
                    </span>
                  </td>
                  <td className="tc-cell text-right">
                    <span className="text-[10px] font-mono text-gray-600">
                      {hist.sessions || "\u00B7"}
                    </span>
                  </td>
                  <td className="tc-cell text-right">
                    <span className="text-[10px] font-mono text-gray-600">
                      {hist.kills || "\u00B7"}
                    </span>
                  </td>
                  <td className="tc-cell text-right">
                    <span className="text-[10px] font-mono text-gray-600">
                      {hist.value > 0 ? formatIsk(hist.value) : "\u00B7"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════════════════
function App() {
  const { activities, status } = useWebSocket();
  const [page, setPage] = useState<Page>("live");
  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "#0a0a0f" }}
    >
      <header
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{
          height: 32,
          background: "#0d0d14",
          borderBottom: "1px solid #1a1a26",
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono font-semibold tracking-tight text-gray-300">
            <span style={{ color: "#ff4444" }}>kill</span>Bright
          </span>
          <div
            className="flex items-center"
            style={{ borderLeft: "1px solid #1a1a26", paddingLeft: 8 }}
          >
            {(["live", "regions"] as Page[]).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
                style={{
                  color: page === p ? "#e8e8ee" : "#556677",
                  background: page === p ? "#1a1a26" : "transparent",
                  borderRadius: 2,
                }}
              >
                {p === "live" ? `Live (${activities.length})` : "Regions"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-mono text-gray-700">
            zKB&middot;RedisQ&rarr;ESI
          </span>
          <StatusIndicator status={status} />
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        {page === "live" && <LivePage activities={activities} />}
        {page === "regions" && <RegionsPage />}
      </main>
    </div>
  );
}

export default App;
