import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  CloudRain,
  CloudSnow,
  Copy,
  ExternalLink,
  Gift,
  Globe2,
  Hand,
  Heart,
  Home,
  Info,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  MoveUpRight,
  Orbit,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunset,
  Tv,
  Users,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { AvatarCreator, WorldScene } from "@hello-world/world-engine";
import type {
  AvatarAppearance,
  CameraMode,
  ResidentProfile,
  Weather,
  WorldEvent,
  WorldEventKind,
} from "@hello-world/contracts";
import { useWorld } from "./lib/world";

type Page = "home" | "world" | "director";
type ModalName = "creator" | "obs" | "twitch" | "director" | "reset" | null;
const cameras: { value: CameraMode; label: string }[] = [
  { value: "neighborhood", label: "Neighborhood" },
  { value: "orbit", label: "Free orbit" },
  { value: "street", label: "Street level" },
  { value: "follow", label: "Follow resident" },
  { value: "cinematic", label: "Cinematic" },
];
const weatherOptions: { value: Weather; label: string; icon: typeof Sun }[] = [
  { value: "sunny", label: "Sunny", icon: Sun },
  { value: "sunset", label: "Golden hour", icon: Sunset },
  { value: "rain", label: "Rain", icon: CloudRain },
  { value: "snow", label: "Snow", icon: CloudSnow },
];
const eventLabels: Record<WorldEventKind, string> = {
  join: "moved into the neighborhood",
  chat: "said",
  wave: "waved hello",
  dance: "started a dance",
  gift: "sent a little kindness",
  social: "made a connection",
  weather: "changed the atmosphere",
  confetti: "started a celebration",
  raid: "welcomed a visiting community",
  custom: "made a little change",
};
const greetings = [
  "Every great story starts with a hello.",
  "Good neighbors. Unexpected stories.",
  "A little world with a life of its own.",
];

function pageFromLocation(): Page {
  if (window.location.pathname.startsWith("/director")) return "director";
  if (window.location.pathname.startsWith("/world")) return "world";
  return "home";
}

function readDisplayName() {
  try {
    return localStorage.getItem("hello-world-display-name") || "";
  } catch {
    return "";
  }
}
function saveDisplayName(name: string) {
  try {
    localStorage.setItem("hello-world-display-name", name);
  } catch {
    /* The server still persists residents if browser storage is unavailable. */
  }
}
function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "HW";
}
function relativeTime(time: number) {
  const diff = Math.max(0, (Date.now() - time) / 1000);
  return diff < 60
    ? "just now"
    : diff < 3600
      ? `${Math.floor(diff / 60)}m ago`
      : `${Math.floor(diff / 3600)}h ago`;
}
function prettyActivity(value: string) {
  return value.replace(/[-_]/g, " ").replace(/^./, (s) => s.toUpperCase());
}

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-empty">
        <Globe2 size={34} />
        <h3>The world needs a moment.</h3>
        <p>
          Your browser may not support WebGL. Try refreshing or enabling
          hardware acceleration.
        </p>
        <button
          className="button secondary"
          onClick={() => window.location.reload()}
        >
          Reload world <RotateCcw size={15} />
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const focusable = box.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], textarea:not(:disabled), [tabindex="0"]',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === box.current)
        ) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">MAKE YOURSELF AT HOME</span>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function AvatarBadge({
  resident,
  small = false,
}: {
  resident: ResidentProfile;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar-badge ${small ? "small" : ""}`}
      style={
        {
          "--avatar-color": resident.appearance.outfit.color,
          "--skin-color": resident.appearance.skinTone,
        } as React.CSSProperties
      }
    >
      <span className="avatar-head" />
      <span className="avatar-shoulders" />
    </span>
  );
}

export default function App() {
  const world = useWorld();
  const {
    snapshot,
    runtime,
    connection,
    mode,
    twitch,
    clients,
    settings,
    pending,
    isDirector,
    error,
    sendEvent,
    residentId,
  } = world;
  const overlay = window.location.pathname.startsWith("/overlay");
  const queryCamera = new URLSearchParams(window.location.search).get("camera");
  const [page, setPage] = useState<Page>(pageFromLocation);
  const [camera, setCamera] = useState<CameraMode>(() =>
    cameras.some((x) => x.value === queryCamera)
      ? (queryCamera as CameraMode)
      : "neighborhood",
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () =>
      new URLSearchParams(window.location.search).get("resident") || undefined,
  );
  const [modal, setModal] = useState<ModalName>(null);
  const [name, setName] = useState(readDisplayName);
  const [creatorStep, setCreatorStep] = useState<"name" | "appearance">("name");
  const [directorKey, setDirectorKey] = useState("");
  const [chat, setChat] = useState("");
  const [target, setTarget] = useState("");
  const [copied, setCopied] = useState(false);
  const [activityTab, setActivityTab] = useState<"residents" | "moments">(
    "residents",
  );
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const me = snapshot.residents.find((r) => r.id === residentId);
  const visibleResidents = me
    ? [
        me,
        ...snapshot.residents.filter((resident) => resident.id !== me.id),
      ].slice(0, 12)
    : snapshot.residents.slice(0, 12);
  const hiddenResidentCount = Math.max(
    0,
    snapshot.residents.length - visibleResidents.length,
  );
  const selected = snapshot.residents.find((r) => r.id === selectedId) || me;
  const socialTarget = target || selected?.id;
  const ready = connection === "online";
  const recentEvents = snapshot.eventHistory.slice(-20).reverse();
  const activeWeather =
    weatherOptions.find((w) => w.value === snapshot.weather) ||
    weatherOptions[0];
  const WeatherIcon = activeWeather.icon;
  const friendCount = selected
    ? snapshot.relationships.filter(
        (r) =>
          (r.residentA === selected.id || r.residentB === selected.id) &&
          r.friendship > 0,
      ).length
    : 0;
  const selectedRelationships = selected
    ? snapshot.relationships
        .filter(
          (relationship) =>
            relationship.residentA === selected.id ||
            relationship.residentB === selected.id,
        )
        .sort((a, b) => b.friendship - a.friendship)
        .slice(0, 3)
    : [];
  const overlayUrl = `${window.location.origin}/overlay?camera=${camera}${selectedId ? `&resident=${encodeURIComponent(selectedId)}` : ""}`;
  const authorization = world.capabilities.authorization;
  const broadcasterName = authorization?.startsWith("authorized ")
    ? authorization.slice("authorized ".length)
    : null;
  const hostName =
    mode === "demo"
      ? "Local preview world"
      : broadcasterName
        ? `${broadcasterName}’s community`
        : "Connected Twitch community";

  useEffect(() => {
    // The connection becomes online only after an authoritative snapshot arrives.
    // Preserve an OBS query selection while the initial/cache snapshot is loading.
    if (!ready) return;
    const currentIds = new Set(
      snapshot.residents.map((resident) => resident.id),
    );
    if (target && !currentIds.has(target)) setTarget("");
    if (selectedId && !currentIds.has(selectedId)) setSelectedId(me?.id);
    else if (!selectedId && me) setSelectedId(me.id);
  }, [ready, snapshot.residents, selectedId, target, me?.id]);

  useEffect(() => {
    const onPopState = () => {
      setPage(pageFromLocation());
      setModal(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("is-overlay", overlay);
    return () => document.documentElement.classList.remove("is-overlay");
  }, [overlay]);
  useEffect(() => {
    if (!localNotice) return;
    const timeout = setTimeout(() => setLocalNotice(null), 4200);
    return () => clearTimeout(timeout);
  }, [localNotice]);
  useEffect(() => {
    if (isDirector && modal === "director") {
      setModal(null);
      setLocalNotice("Director Studio unlocked. Make a little magic.");
    }
  }, [isDirector, modal]);

  const closeModal = useCallback(() => setModal(null), []);
  function navigate(next: Page) {
    setPage(next);
    const path = next === "home" ? "/" : `/${next}`;
    if (window.location.pathname !== path)
      window.history.pushState(null, "", path);
    window.scrollTo(0, 0);
  }
  function openCreator() {
    setCreatorStep(me ? "appearance" : "name");
    setModal("creator");
  }
  function enterWorld() {
    navigate("world");
  }
  function saveAppearance(appearance: AvatarAppearance) {
    const displayName = (name.trim() || me?.displayName || "Neighbor").slice(
      0,
      25,
    );
    saveDisplayName(displayName);
    if (me)
      sendEvent(
        "custom",
        { action: "update-avatar", appearance },
        { displayName },
      );
    else
      sendEvent(
        "join",
        { appearance, personality: ["friendly", "curious"] },
        { displayName },
      );
    setModal(null);
    navigate("world");
    setLocalNotice(
      me
        ? "Your new look is on its way to the world."
        : "Your move-in request is on its way. Welcome, neighbor.",
    );
  }
  function action(
    kind: WorldEventKind,
    payload?: Parameters<typeof sendEvent>[1],
  ) {
    if (!me && !["weather", "confetti", "raid"].includes(kind)) {
      openCreator();
      return;
    }
    sendEvent(kind, payload, {
      targetId:
        socialTarget && socialTarget !== me?.id ? socialTarget : undefined,
    });
    setLocalNotice(
      settings.approvalRequired
        ? "Your moment is waiting for the Director’s approval."
        : "Your moment is on its way to the neighborhood.",
    );
  }
  function sendChat(event: FormEvent) {
    event.preventDefault();
    if (!chat.trim()) return;
    if (!me) {
      openCreator();
      return;
    }
    sendEvent("chat", undefined, { text: chat.trim().slice(0, 180) });
    setChat("");
    setLocalNotice(
      settings.approvalRequired
        ? "Your message is waiting for the Director’s approval."
        : "Your message is on its way.",
    );
  }
  async function copyOverlay() {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setLocalNotice("Select and copy the browser-source URL below.");
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await sceneRef.current?.requestFullscreen();
    } catch {
      setLocalNotice("Fullscreen is unavailable in this browser.");
    }
  }

  if (overlay)
    return (
      <main
        className="overlay-stage"
        aria-label="HELLO WORLD transparent OBS overlay"
      >
        <SceneBoundary>
          <WorldScene
            runtime={runtime}
            transparent
            cameraMode={camera}
            selectedResidentId={selectedId}
            quality={
              new URLSearchParams(window.location.search).get("quality") ===
              "low"
                ? "low"
                : "high"
            }
          />
        </SceneBoundary>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <button
          className="brand-mark"
          aria-label="HELLO WORLD home"
          onClick={() => navigate("home")}
        >
          <span />
          <span />
          <span />
          <span />
        </button>
        <span className="rail-rule" />
        <nav>
          {(
            [
              { value: "home", icon: Home, label: "Discover" },
              { value: "world", icon: Globe2, label: "Your world" },
              { value: "director", icon: Settings2, label: "Director Studio" },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              className={`rail-button ${page === item.value ? "active" : ""}`}
              aria-label={item.label}
              aria-current={page === item.value ? "page" : undefined}
              title={item.label}
              onClick={() => navigate(item.value)}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button
            className="rail-button"
            title="OBS setup"
            aria-label="OBS setup"
            onClick={() => setModal("obs")}
          >
            <Tv size={20} />
            <span>Stream</span>
          </button>
          <button
            className="rail-profile"
            aria-label={
              me ? `Customize ${me.displayName}` : "Create your resident"
            }
            onClick={openCreator}
          >
            {me ? initials(me.displayName) : <Plus size={19} />}
          </button>
        </div>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <button className="wordmark" onClick={() => navigate("home")}>
            HELLO<span>WORLD</span>
            <span className="wordmark-period">.</span>
          </button>
          <div className="topbar-center">
            <span className="tiny-star">✦</span> YOUR PEOPLE. THEIR OWN LITTLE
            WORLD.
          </div>
          <div className="topbar-actions">
            <button
              className={`connection-pill ${ready ? "connected" : ""}`}
              onClick={() => setModal("twitch")}
            >
              <span className="status-dot" />
              {ready
                ? mode === "live"
                  ? "Twitch connected"
                  : "Demo mode"
                : connection === "connecting"
                  ? "Connecting"
                  : "Offline"}
              <ChevronDown size={12} />
            </button>
            <button
              className="button small secondary header-join"
              onClick={openCreator}
            >
              {me ? "My resident" : "Create resident"}
              <ArrowRight size={14} />
            </button>
          </div>
        </header>

        <main className="page-content">
          <section className="page-heading">
            <div>
              <div className="breadcrumb">
                <span className="breadcrumb-dot" />
                {page === "home"
                  ? "WELCOME TO THE NEIGHBORHOOD"
                  : page === "director"
                    ? "YOUR WORLD, YOUR DIRECTION"
                    : "HELLO NEIGHBORHOOD"}
                <span className="version-label">EARLY ACCESS</span>
              </div>
              <h1>
                {page === "home" ? (
                  <>
                    Little world.
                    <br className="mobile-break" /> Endless stories
                    <span>.</span>
                  </>
                ) : page === "director" ? (
                  <>
                    Set the scene<span>.</span>
                  </>
                ) : (
                  <>
                    Make yourself at home<span>.</span>
                  </>
                )}
              </h1>
              <p>
                {page === "home"
                  ? "Turn your community into a living, breathing neighborhood."
                  : page === "director"
                    ? "A little atmosphere. A shared moment. You make the magic happen."
                    : greetings[0]}
              </p>
            </div>
            <div className="heading-actions">
              {page === "director" ? (
                <button
                  className={`button ${isDirector ? "secondary" : "primary"}`}
                  onClick={() =>
                    isDirector ? setModal("obs") : setModal("director")
                  }
                >
                  {isDirector ? <Tv size={16} /> : <LockKeyhole size={15} />}
                  {isDirector ? "Set up OBS" : "Unlock studio"}
                  {isDirector && <ArrowRight size={15} />}
                </button>
              ) : (
                <button
                  className="button text-button"
                  onClick={() => setModal("obs")}
                >
                  <Tv size={16} />
                  Bring it to your stream
                  <MoveUpRight size={14} />
                </button>
              )}
            </div>
          </section>

          <div
            className={`world-layout ${page === "director" ? "director-layout" : ""}`}
          >
            <section className="world-column">
              <div className="scene-card" ref={sceneRef}>
                <SceneBoundary>
                  <WorldScene
                    runtime={runtime}
                    cameraMode={camera}
                    selectedResidentId={selectedId}
                    onResidentSelect={setSelectedId}
                    quality="high"
                  />
                </SceneBoundary>
                <div className="scene-top">
                  <div className="world-title-badge">
                    <span
                      className={`world-live-dot ${ready ? "" : "inactive"}`}
                    />
                    <span>HELLO NEIGHBORHOOD</span>
                    <span className="badge-divider" />
                    <span className="scene-mode">
                      {mode === "demo" ? "DEMO WORLD" : "TWITCH WORLD"}
                    </span>
                  </div>
                  <div className="weather-badge">
                    <WeatherIcon size={15} />
                    <span>{activeWeather.label}</span>
                  </div>
                </div>
                {!ready && (
                  <div className="connection-banner">
                    <span className="status-dot" />
                    {connection === "connecting"
                      ? "Connecting to the neighborhood…"
                      : "Connection lost. Showing your last saved world."}
                  </div>
                )}
                {page === "home" && (
                  <div className="landing-intro">
                    <span className="live-label">
                      <span />A WORLD THAT GROWS WITH YOU
                    </span>
                    <h2>
                      Your community.
                      <br />A life of its own.
                    </h2>
                    <p>Move in. Make friends. Let the unexpected happen.</p>
                    <button
                      className="button primary enter-button"
                      onClick={enterWorld}
                    >
                      Enter the world
                      <ArrowRight size={18} />
                    </button>
                    <span className="intro-caption">
                      {mode === "demo"
                        ? "Explore in Demo Mode · No Twitch account needed"
                        : "Your connected community is waiting"}
                    </span>
                  </div>
                )}
                <div className="scene-bottom">
                  <div className="camera-control">
                    <Orbit size={15} />
                    <select
                      aria-label="Camera view"
                      value={camera}
                      onChange={(e) => setCamera(e.target.value as CameraMode)}
                    >
                      {cameras.map((c) => (
                        <option value={c.value} key={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} />
                  </div>
                  <div className="scene-controls">
                    <span className="scene-tip">
                      Drag to explore · Scroll to zoom
                    </span>
                    <button
                      className="scene-icon"
                      aria-label="Enter fullscreen"
                      title="Fullscreen"
                      onClick={fullscreen}
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
              {page === "director" ? (
                <div className="director-summary">
                  <div>
                    <span className="metric-icon">
                      <ShieldCheck size={19} />
                    </span>
                    <div>
                      <strong>
                        {settings.approvalRequired
                          ? "Approval on"
                          : "Open interactions"}
                      </strong>
                      <span>{settings.cooldownSeconds}s action cooldown</span>
                    </div>
                  </div>
                  <div>
                    <span className="metric-icon">
                      <Users size={19} />
                    </span>
                    <div>
                      <strong>
                        {snapshot.residents.length} / {settings.maxResidents}
                      </strong>
                      <span>Neighborhood residents</span>
                    </div>
                  </div>
                  <div>
                    <span className="metric-icon">
                      <Radio size={19} />
                    </span>
                    <div>
                      <strong>
                        {clients} {clients === 1 ? "session" : "sessions"}
                      </strong>
                      <span>
                        {ready
                          ? "Connected to this server"
                          : "Server unavailable"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="world-footer">
                  <div className="world-footer-name">
                    <span className="neighborhood-symbol">
                      <Home size={19} />
                    </span>
                    <div>
                      <h3>
                        Hello Neighborhood{" "}
                        <span className="small-tag">
                          {mode === "demo" ? "PUBLIC DEMO" : "LIVE WORLD"}
                        </span>
                      </h3>
                      <p>A place for your people to become a story.</p>
                    </div>
                  </div>
                  <div className="world-footer-stats">
                    <span>
                      <Users size={16} />
                      <strong>{snapshot.residents.length}</strong> residents
                    </span>
                    <span>
                      <Heart size={15} />
                      <strong>{snapshot.relationships.length}</strong>{" "}
                      connections
                    </span>
                  </div>
                </div>
              )}
              {page !== "director" && (
                <button
                  className="host-strip"
                  onClick={() => setModal("twitch")}
                >
                  <span className="host-strip-icon">
                    <Radio size={18} />
                  </span>
                  <span>
                    <strong>{hostName}</strong>
                    <small>
                      {mode === "demo"
                        ? "Demo Mode · Shared on this running server"
                        : twitch}
                    </small>
                  </span>
                  <span className="host-strip-action">
                    {mode === "demo" ? "Connect Twitch" : "Connection details"}
                    <ChevronRight size={14} />
                  </span>
                </button>
              )}
              {page === "home" ? (
                <div className="promise-row">
                  <div>
                    <span>01</span>
                    <h3>Be a little more you.</h3>
                    <p>Create a resident with your own look and personality.</p>
                  </div>
                  <div>
                    <span>02</span>
                    <h3>Make a little history.</h3>
                    <p>Say hello. Share a moment. Build a friendship.</p>
                  </div>
                  <div>
                    <span>03</span>
                    <h3>Bring everyone along.</h3>
                    <p>One shared world, on your screen and your stream.</p>
                  </div>
                </div>
              ) : page === "world" ? (
                <div className="interaction-card">
                  <div className="section-title">
                    <div>
                      <span className="eyebrow">
                        LEAVE A LITTLE GOOD ENERGY
                      </span>
                      <h3>
                        {me
                          ? `Hey, ${me.displayName}. What’s the move?`
                          : "Your story starts with a hello."}
                      </h3>
                    </div>
                    {me && (
                      <button
                        className="icon-button"
                        aria-label="Customize resident"
                        onClick={openCreator}
                      >
                        <WandSparkles size={18} />
                      </button>
                    )}
                  </div>
                  {me ? (
                    <>
                      <div className="interaction-actions">
                        <button
                          className="gesture-button"
                          disabled={!ready}
                          onClick={() => action("wave")}
                        >
                          <Hand size={20} />
                          <span>Wave hello</span>
                        </button>
                        <button
                          className="gesture-button"
                          disabled={!ready}
                          onClick={() => action("dance")}
                        >
                          <AudioLines size={20} />
                          <span>Dance a little</span>
                        </button>
                        <button
                          className="gesture-button"
                          disabled={
                            !ready || !socialTarget || socialTarget === me.id
                          }
                          onClick={() =>
                            action("social", { action: "befriend" })
                          }
                        >
                          <Heart size={20} />
                          <span>Make a friend</span>
                        </button>
                        <button
                          className="gesture-button"
                          disabled={
                            !ready || !socialTarget || socialTarget === me.id
                          }
                          onClick={() => action("gift", { amount: 1 })}
                        >
                          <Gift size={20} />
                          <span>Send a gift</span>
                        </button>
                      </div>
                      <div className="target-row">
                        <label htmlFor="target-resident">
                          Share a moment with
                        </label>
                        <select
                          id="target-resident"
                          value={target}
                          onChange={(e) => {
                            setTarget(e.target.value);
                            if (e.target.value) setSelectedId(e.target.value);
                          }}
                        >
                          <option value="">
                            {selected && selected.id !== me.id
                              ? selected.displayName
                              : "Choose a neighbor"}
                          </option>
                          {snapshot.residents
                            .filter((r) => r.id !== me.id)
                            .map((r) => (
                              <option value={r.id} key={r.id}>
                                {r.displayName}
                              </option>
                            ))}
                        </select>
                      </div>
                      <form className="chat-form" onSubmit={sendChat}>
                        <MessageCircle size={17} />
                        <input
                          aria-label="Say something to the neighborhood"
                          placeholder="Say something to the neighborhood…"
                          value={chat}
                          maxLength={180}
                          onChange={(e) => setChat(e.target.value)}
                        />
                        <button
                          aria-label="Send message"
                          disabled={!chat.trim() || !ready}
                        >
                          <ArrowRight size={18} />
                        </button>
                      </form>
                      <p className="control-caption">
                        <ShieldCheck size={12} />
                        {settings.approvalRequired
                          ? "Your moments are reviewed by the Director."
                          : `Keep it kind. Actions have a ${settings.cooldownSeconds}s cooldown.`}
                      </p>
                    </>
                  ) : (
                    <div className="join-prompt">
                      <p>
                        There’s a place here with your name on it. Create a
                        resident to join in.
                      </p>
                      <button
                        className="button primary"
                        disabled={!ready}
                        onClick={openCreator}
                      >
                        Create your resident
                        <Plus size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="activity-log panel">
                  <div className="section-title">
                    <div>
                      <span className="eyebrow">
                        THE NEIGHBORHOOD REMEMBERS
                      </span>
                      <h3>Event history</h3>
                    </div>
                    <span className="counter">
                      {snapshot.eventHistory.length}
                    </span>
                  </div>
                  <EventList
                    events={recentEvents.slice(0, 8)}
                    residents={snapshot.residents}
                  />
                </div>
              )}
            </section>

            <aside className="community-column">
              {page === "director" ? (
                <>
                  <section className="panel director-panel">
                    <div className="section-title">
                      <div>
                        <span className="eyebrow">DIRECTOR STUDIO</span>
                        <h3>Make a little magic.</h3>
                      </div>
                      <span
                        className={`studio-status ${isDirector ? "unlocked" : ""}`}
                      >
                        {isDirector ? (
                          <ShieldCheck size={16} />
                        ) : (
                          <LockKeyhole size={16} />
                        )}
                      </span>
                    </div>
                    {!isDirector && (
                      <div className="studio-lock">
                        <p>
                          Director controls are private. Unlock the studio with
                          your server’s Director key.
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => setModal("director")}
                        >
                          Unlock controls
                          <LockKeyhole size={14} />
                        </button>
                      </div>
                    )}
                    <div className="control-section">
                      <label className="control-label">
                        SET THE ATMOSPHERE
                      </label>
                      <div className="weather-grid">
                        {weatherOptions.map((w) => (
                          <button
                            className={`weather-option ${snapshot.weather === w.value ? "selected" : ""}`}
                            key={w.value}
                            disabled={!isDirector || !ready}
                            onClick={() =>
                              sendEvent("weather", { weather: w.value })
                            }
                          >
                            <w.icon size={21} />
                            <span>{w.label}</span>
                            {snapshot.weather === w.value && (
                              <span className="selected-dot" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="control-section">
                      <label className="control-label">
                        GIVE THE WORLD A MOMENT
                      </label>
                      <button
                        className="moment-button"
                        disabled={!isDirector || !ready}
                        onClick={() =>
                          sendEvent("confetti", { action: "celebrate" })
                        }
                      >
                        <span className="moment-icon coral">
                          <Sparkles size={20} />
                        </span>
                        <span>
                          <strong>Throw a celebration</strong>
                          <small>A little confetti goes a long way</small>
                        </span>
                        <Plus size={17} />
                      </button>
                      <button
                        className="moment-button"
                        disabled={!isDirector || !ready || mode !== "demo"}
                        onClick={() => sendEvent("raid", { amount: 5 })}
                      >
                        <span className="moment-icon purple">
                          <Users size={20} />
                        </span>
                        <span>
                          <strong>Welcome a community</strong>
                          <small>
                            {mode === "demo"
                              ? "Test a visiting raid · Demo event"
                              : "Triggered by live Twitch raids"}
                          </small>
                        </span>
                        <Plus size={17} />
                      </button>
                    </div>
                    <div className="control-section">
                      <label className="control-label">
                        KEEP IT YOUR KIND OF WORLD
                      </label>
                      <button
                        className="invite-neighbor"
                        disabled={
                          !isDirector ||
                          !ready ||
                          mode !== "demo" ||
                          snapshot.residents.length >= settings.maxResidents
                        }
                        onClick={() => world.spawnDemoResident()}
                      >
                        <Users size={16} />
                        <span>Invite a demo neighbor</span>
                        <Plus size={14} />
                      </button>
                      <div className="setting-row">
                        <div>
                          <strong>Approve interactions</strong>
                          <p>Review viewer actions first</p>
                        </div>
                        <button
                          className={`toggle ${settings.approvalRequired ? "on" : ""}`}
                          role="switch"
                          aria-checked={settings.approvalRequired}
                          aria-label="Require interaction approval"
                          disabled={!isDirector || !ready}
                          onClick={() =>
                            world.updateSettings({
                              approvalRequired: !settings.approvalRequired,
                            })
                          }
                        >
                          <span />
                        </button>
                      </div>
                      <div className="setting-input-row">
                        <label htmlFor="cooldown">
                          Action cooldown <span>seconds</span>
                        </label>
                        <input
                          id="cooldown"
                          type="number"
                          min={0}
                          max={60}
                          value={settings.cooldownSeconds}
                          disabled={!isDirector || !ready}
                          onChange={(e) =>
                            world.updateSettings({
                              cooldownSeconds: Math.min(
                                60,
                                Math.max(0, Number(e.target.value)),
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="setting-input-row">
                        <label htmlFor="population">
                          Population limit <span>residents</span>
                        </label>
                        <input
                          id="population"
                          type="number"
                          min={1}
                          max={50}
                          value={settings.maxResidents}
                          disabled={!isDirector || !ready}
                          onChange={(e) =>
                            world.updateSettings({
                              maxResidents: Math.min(
                                50,
                                Math.max(1, Number(e.target.value)),
                              ),
                            })
                          }
                        />
                      </div>
                      <button
                        className="pause-button"
                        disabled={!isDirector || !ready}
                        onClick={() =>
                          world.updateSettings({ paused: !settings.paused })
                        }
                      >
                        {settings.paused ? (
                          <Play size={14} />
                        ) : (
                          <Pause size={14} />
                        )}
                        {settings.paused
                          ? "Resume viewer interactions"
                          : "Pause viewer interactions"}
                      </button>
                    </div>
                  </section>
                  <section className="panel approval-panel">
                    <div className="section-title">
                      <h3>Waiting in the wings</h3>
                      <span className="counter">{pending.length}</span>
                    </div>
                    {pending.length ? (
                      pending.slice(0, 8).map((event) => (
                        <div className="pending-event" key={event.id}>
                          <span>
                            <strong>{event.actorDisplayName}</strong>
                            <small>
                              {event.kind}
                              {event.text ? ` · ${event.text}` : ""}
                            </small>
                          </span>
                          <button
                            className="icon-button"
                            disabled={!isDirector}
                            aria-label={`Approve ${event.actorDisplayName} ${event.kind}`}
                            onClick={() => world.approve(event.id)}
                          >
                            <Check size={17} />
                          </button>
                          <button
                            className="icon-button"
                            disabled={!isDirector}
                            aria-label={`Reject ${event.actorDisplayName} ${event.kind}`}
                            onClick={() => world.reject(event.id)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state compact">
                        <ShieldCheck size={22} />
                        <p>All caught up.</p>
                        <span>
                          Pending viewer interactions will appear here.
                        </span>
                      </div>
                    )}
                  </section>
                  <button
                    className="reset-button"
                    disabled={!isDirector || !ready}
                    onClick={() => setModal("reset")}
                  >
                    <RotateCcw size={14} />
                    Reset this world
                  </button>
                </>
              ) : (
                <>
                  <section className="welcome-card">
                    <div className="welcome-card-top">
                      <span className="sparkle-icon">
                        <Sparkles size={21} />
                      </span>
                      <span className="live-label quiet">
                        YOUR NEXT CHAPTER
                      </span>
                    </div>
                    <h2>
                      {me ? (
                        <>
                          Looking good,
                          <br />
                          {me.displayName}
                          <span>.</span>
                        </>
                      ) : (
                        <>
                          You belong
                          <br />
                          in the story<span>.</span>
                        </>
                      )}
                    </h2>
                    <p>
                      {me
                        ? "Your resident is making memories. Drop in and see where the day takes you."
                        : "A familiar face. A new friend. A little chaos. It all starts with your resident."}
                    </p>
                    <button
                      className="button primary"
                      disabled={!ready}
                      onClick={openCreator}
                    >
                      {me ? "Meet your resident" : "Create your resident"}
                      {me ? (
                        <WandSparkles size={16} />
                      ) : (
                        <ArrowRight size={16} />
                      )}
                    </button>
                    <div className="saved-note">
                      <ShieldCheck size={12} />
                      {me
                        ? "Your world is saved on this server"
                        : "Make it yours. Make yourself at home."}
                    </div>
                  </section>
                  <section className="panel community-panel">
                    <div className="panel-tabs">
                      <button
                        className={activityTab === "residents" ? "active" : ""}
                        onClick={() => setActivityTab("residents")}
                      >
                        Neighbors<span>{snapshot.residents.length}</span>
                      </button>
                      <button
                        className={activityTab === "moments" ? "active" : ""}
                        onClick={() => setActivityTab("moments")}
                      >
                        Little moments
                      </button>
                    </div>
                    {activityTab === "residents" ? (
                      <div className="residents-list">
                        {snapshot.residents.length ? (
                          visibleResidents.map((resident) => (
                            <button
                              className={`resident-row ${selected?.id === resident.id ? "selected" : ""}`}
                              key={resident.id}
                              onClick={() => {
                                setSelectedId(resident.id);
                                if (resident.id !== me?.id)
                                  setTarget(resident.id);
                              }}
                            >
                              <AvatarBadge resident={resident} />
                              <span className="resident-info">
                                <strong>
                                  {resident.displayName}
                                  {resident.id === me?.id && <small>YOU</small>}
                                </strong>
                                <span>{prettyActivity(resident.activity)}</span>
                              </span>
                              <span className="resident-presence" />
                              <ChevronRight size={14} />
                            </button>
                          ))
                        ) : (
                          <div className="empty-state">
                            <Users size={26} />
                            <p>
                              {ready
                                ? "A fresh start."
                                : "Finding your neighbors…"}
                            </p>
                            <span>
                              {ready
                                ? "Be the first to make yourself at home."
                                : "Residents will appear when the server connects."}
                            </span>
                          </div>
                        )}
                        {hiddenResidentCount > 0 && (
                          <span className="more-residents">
                            + {hiddenResidentCount} more around the neighborhood
                          </span>
                        )}
                      </div>
                    ) : (
                      <EventList
                        events={recentEvents.slice(0, 7)}
                        residents={snapshot.residents}
                        compact
                      />
                    )}
                  </section>
                  {selected && (
                    <section className="panel resident-detail">
                      <div className="section-title">
                        <div className="detail-heading">
                          <AvatarBadge resident={selected} small />
                          <div>
                            <h3>{selected.displayName}</h3>
                            <span>
                              {selected.location.zone ||
                                "Exploring the neighborhood"}
                            </span>
                          </div>
                        </div>
                        <span className="detail-flower">✺</span>
                      </div>
                      <div className="personality-tags">
                        {selected.personality.slice(0, 3).map((trait) => (
                          <span key={trait}>{prettyActivity(trait)}</span>
                        ))}
                      </div>
                      <div className="needs-grid">
                        {(
                          [
                            { key: "energy", label: "Energy", icon: Zap },
                            { key: "social", label: "Social", icon: Heart },
                            { key: "fun", label: "Fun", icon: Sparkles },
                          ] as const
                        ).map((need) => (
                          <div
                            className={`need-meter ${need.key}`}
                            key={need.key}
                          >
                            <div>
                              <need.icon size={12} />
                              <span>{need.label}</span>
                              <strong>
                                {Math.round(selected.needs[need.key])}
                              </strong>
                            </div>
                            <span className="meter-track">
                              <span
                                style={{
                                  width: `${Math.max(0, Math.min(100, selected.needs[need.key]))}%`,
                                }}
                              />
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="friend-count">
                        <Heart size={13} />
                        {friendCount}{" "}
                        {friendCount === 1 ? "connection" : "connections"} and a
                        story still unfolding
                      </div>
                      <div className="relationship-history">
                        <div className="relationship-heading">
                          <span>A LITTLE HISTORY</span>
                          <Heart size={13} />
                        </div>
                        {selectedRelationships.length ? (
                          selectedRelationships.map((relationship) => {
                            const otherId =
                              relationship.residentA === selected.id
                                ? relationship.residentB
                                : relationship.residentA;
                            const other = snapshot.residents.find(
                              (resident) => resident.id === otherId,
                            );
                            const latestMemory = relationship.memories.at(-1);
                            return (
                              <button
                                className="relationship-row"
                                key={`${relationship.residentA}:${relationship.residentB}`}
                                disabled={!other}
                                onClick={() => {
                                  setSelectedId(otherId);
                                  if (otherId !== me?.id) setTarget(otherId);
                                }}
                              >
                                <span className="relationship-person">
                                  {other && (
                                    <AvatarBadge resident={other} small />
                                  )}
                                  <span>
                                    <strong>
                                      {other?.displayName ||
                                        "Resident no longer in this world"}
                                    </strong>
                                    <small>
                                      Friendship ·{" "}
                                      {Math.round(relationship.friendship)} /
                                      100
                                    </small>
                                  </span>
                                  {other && <ChevronRight size={13} />}
                                </span>
                                <span
                                  className={`relationship-memory ${latestMemory ? "" : "unrecorded"}`}
                                >
                                  {latestMemory
                                    ? `“${latestMemory}”`
                                    : "No shared memory recorded yet."}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <p className="relationship-empty">
                            No shared memories yet. A hello is a lovely place to
                            start.
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                  <button
                    className="studio-link"
                    onClick={() => navigate("director")}
                  >
                    <span className="studio-link-icon">
                      <Settings2 size={18} />
                    </span>
                    <span>
                      <strong>Your world. Your direction.</strong>
                      <small>Open Director Studio</small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                </>
              )}
            </aside>
          </div>
          <footer className="site-footer">
            <span>
              HELLO WORLD<span className="footer-dot">.</span>{" "}
              <span>A little more connected.</span>
            </span>
            <div>
              <span className={`status-dot ${ready ? "ready" : ""}`} />
              {ready
                ? `${clients} connected ${clients === 1 ? "session" : "sessions"}`
                : connection === "connecting"
                  ? "Connecting to world server"
                  : "World server offline"}
              <span className="footer-divider" />
              {mode === "demo" ? "DEMO EXPERIENCE" : "TWITCH CONNECTED"}
            </div>
          </footer>
        </main>
      </div>

      {(error || localNotice) && (
        <div
          className={`toast ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ? <Info size={18} /> : <Check size={18} />}
          <span>{error || localNotice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => {
              world.clearError();
              setLocalNotice(null);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {modal === "creator" && (
        <Modal
          title={
            creatorStep === "name"
              ? "Every story needs a name."
              : "A little more you."
          }
          subtitle={
            creatorStep === "name"
              ? "How should your neighbors know you?"
              : "Make a resident you’ll love running into."
          }
          wide={creatorStep === "appearance"}
          onClose={closeModal}
        >
          {creatorStep === "name" ? (
            <form
              className="name-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) setCreatorStep("appearance");
              }}
            >
              <label htmlFor="resident-name">Your resident’s name</label>
              <input
                id="resident-name"
                autoFocus
                maxLength={25}
                minLength={1}
                placeholder="What should we call you?"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p>
                <ShieldCheck size={13} />A friendly name for a shared
                neighborhood. Keep it kind.
              </p>
              <button
                className="button primary"
                type="submit"
                disabled={!name.trim() || !ready}
              >
                Make it yours
                <ArrowRight size={16} />
              </button>
            </form>
          ) : (
            <div className="creator-content">
              <AvatarCreator
                initialAppearance={me?.appearance}
                displayName={name || me?.displayName}
                onSave={saveAppearance}
                onCancel={closeModal}
              />
            </div>
          )}
        </Modal>
      )}
      {modal === "obs" && (
        <Modal
          title="Your world, on your stream."
          subtitle="Add HELLO WORLD as an OBS Browser Source."
          onClose={closeModal}
        >
          <div className="obs-preview">
            <span className="checkerboard-icon">
              <Tv size={30} />
            </span>
            <div>
              <strong>Transparent. Stream ready.</strong>
              <p>
                Your residents and their little moments, without the app chrome.
              </p>
            </div>
          </div>
          <div className="setup-steps">
            <div>
              <span>1</span>
              <p>
                In OBS, add a <strong>Browser</strong> source.
              </p>
            </div>
            <div>
              <span>2</span>
              <p>
                Paste this URL and set the size to <strong>1920 × 1080</strong>.
              </p>
            </div>
          </div>
          <label className="control-label" htmlFor="overlay-url">
            YOUR BROWSER-SOURCE URL
          </label>
          <div className="copy-field">
            <input
              readOnly
              id="overlay-url"
              value={overlayUrl}
              onFocus={(e) => e.target.select()}
            />
            <button
              aria-label="Copy OBS browser-source URL"
              onClick={copyOverlay}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
          <div className="obs-settings">
            <label htmlFor="obs-camera">Camera framing</label>
            <select
              id="obs-camera"
              value={camera}
              onChange={(e) => setCamera(e.target.value as CameraMode)}
            >
              {cameras.map((c) => (
                <option value={c.value} key={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <p className="help-note">
            <Info size={14} />
            Keep the world server running. Use the same accessible host as this
            app. For a lighter source, add <code>&amp;quality=low</code>.
          </p>
          <a
            className="button secondary full-width"
            href={overlayUrl}
            target="_blank"
            rel="noreferrer"
          >
            Preview transparent overlay
            <ExternalLink size={15} />
          </a>
        </Modal>
      )}
      {modal === "twitch" && (
        <Modal
          title={
            mode === "live"
              ? "Your community is connected."
              : "A little preview of what’s possible."
          }
          subtitle={
            mode === "live"
              ? "Twitch events feed the same world you see here."
              : "You’re exploring HELLO WORLD in Demo Mode."
          }
          onClose={closeModal}
        >
          <div className="integration-status">
            <span className="integration-icon">
              <Radio size={28} />
            </span>
            <div>
              <strong>
                {mode === "live" ? "Live Twitch adapter" : "Demo Mode"}
              </strong>
              <p>
                {twitch ||
                  "Twitch credentials are not configured on this server."}
              </p>
            </div>
          </div>
          <div className="twitch-capabilities">
            {Object.entries(world.capabilities).map(([capability, status]) => (
              <div key={capability}>
                <span>{prettyActivity(capability)}</span>
                <strong>{status}</strong>
              </div>
            ))}
          </div>
          {world.oauthConfigured && (
            <button
              className="button twitch-connect full-width"
              disabled={!isDirector || !ready}
              onClick={() => void world.connectTwitch()}
            >
              <Radio size={16} />
              {isDirector
                ? "Connect with Twitch"
                : "Unlock Director Studio to connect Twitch"}
              <ArrowRight size={15} />
            </button>
          )}
          <div className="integration-explanation">
            <h3>
              {mode === "demo"
                ? "Real world. Demo events."
                : "From chat to your neighborhood."}
            </h3>
            <p>
              {mode === "demo"
                ? "Your residents, friendships, and shared world are real. Director celebrations and raids are labeled demo events until you connect Twitch."
                : "Chat commands and authorized channel events become validated world actions. Availability depends on your broadcaster’s granted permissions."}
            </p>
            <div className="command-list">
              <code>!join</code>
              <code>!wave</code>
              <code>!dance</code>
              <code>!hello</code>
              <code>!gift username</code>
            </div>
            <h3>Connect your channel</h3>
            <p>
              Configure Twitch credentials and broadcaster permissions on the
              server. Your access tokens and client secret stay out of this app.
            </p>
            <a
              className="text-link"
              href="https://github.com/mylife-as-miles/hello-world/blob/main/docs/TWITCH.md"
              target="_blank"
              rel="noreferrer"
            >
              Read the Twitch setup guide
              <ExternalLink size={13} />
            </a>
          </div>
          <button
            className="button primary full-width"
            onClick={() => {
              setModal(null);
              navigate("world");
            }}
          >
            Back to the neighborhood
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {modal === "director" && (
        <Modal
          title="A little behind-the-scenes magic."
          subtitle="Unlock private Director controls for this world."
          onClose={closeModal}
        >
          <form
            className="name-form"
            onSubmit={(e) => {
              e.preventDefault();
              world.authenticateDirector(directorKey);
              setDirectorKey("");
            }}
          >
            <label htmlFor="director-key">Director key</label>
            <input
              id="director-key"
              type="password"
              autoFocus
              autoComplete="off"
              value={directorKey}
              onChange={(e) => setDirectorKey(e.target.value)}
              placeholder="Your private server key"
            />
            <p>
              <LockKeyhole size={13} />
              Set DIRECTOR_KEY on your server. Keep this key private.
            </p>
            <button
              className="button primary"
              disabled={!directorKey.trim() || !ready}
            >
              Unlock Studio
              <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "reset" && (
        <Modal
          title="Start a fresh chapter?"
          subtitle="This resets residents, relationships, and event history for everyone connected to this world."
          onClose={closeModal}
        >
          <div className="reset-confirm">
            <p>
              Your current neighborhood will be replaced with a fresh demo
              world. This action can’t be undone in the app.
            </p>
            <div>
              <button className="button secondary" onClick={closeModal}>
                Keep our story
              </button>
              <button
                className="button danger"
                onClick={() => {
                  world.reset();
                  setModal(null);
                }}
              >
                Reset world
                <RotateCcw size={15} />
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EventList({
  events,
  residents,
  compact = false,
}: {
  events: WorldEvent[];
  residents: ResidentProfile[];
  compact?: boolean;
}) {
  return (
    <div className={`event-list ${compact ? "compact-events" : ""}`}>
      {events.length ? (
        events.map((event) => (
          <div className="event-row" key={event.id}>
            <span className={`event-icon ${event.kind}`}>
              {event.kind === "join" ? (
                <Home size={14} />
              ) : event.kind === "gift" || event.kind === "social" ? (
                <Heart size={14} />
              ) : event.kind === "chat" ? (
                <MessageCircle size={14} />
              ) : event.kind === "weather" ? (
                <Sun size={14} />
              ) : (
                <Sparkles size={14} />
              )}
            </span>
            <div>
              <p>
                <strong>{event.actorDisplayName}</strong>{" "}
                {eventLabels[event.kind]}
                {event.targetId &&
                  residents.find((r) => r.id === event.targetId) && (
                    <span>
                      {" "}
                      with{" "}
                      <strong>
                        {
                          residents.find((r) => r.id === event.targetId)!
                            .displayName
                        }
                      </strong>
                    </span>
                  )}
                {event.text && (
                  <span className="event-text"> “{event.text}”</span>
                )}
              </p>
              <span className="event-meta">
                {relativeTime(event.timestamp)}
                <span />
                {event.source === "demo"
                  ? "DEMO"
                  : event.source === "twitch"
                    ? "TWITCH"
                    : event.source === "simulation"
                      ? "WORLD"
                      : "VIEWER"}
              </span>
            </div>
          </div>
        ))
      ) : (
        <div className="empty-state">
          <Sparkles size={25} />
          <p>The best is yet to come.</p>
          <span>Your neighborhood’s little moments will appear here.</span>
        </div>
      )}
    </div>
  );
}
