import { useEffect, useState, lazy, Suspense, type FormEvent } from "react";
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingBag,
  Wallet,
  ChartNoAxesCombined,
  ShieldCheck,
  FileText,
  Layers,
  Menu,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Building2,
  LockKeyhole,
  ArrowRight,
  ClipboardList,
} from "lucide-react";
import { api, type Auth } from "./api";
import { Loading, ErrorMessage } from "./components";
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Catalog = lazy(() =>
  import("./pages/Catalog").then((m) => ({ default: m.Catalog })),
);
const UsersPage = lazy(() =>
  import("./pages/Administration").then((m) => ({ default: m.UsersPage })),
);
const AuditPage = lazy(() =>
  import("./pages/Administration").then((m) => ({ default: m.AuditPage })),
);
const pages = [
  {
    id: "dashboard",
    label: "Visão geral",
    icon: LayoutDashboard,
    permission: "dashboard:read",
  },
  {
    id: "customers",
    label: "Clientes",
    icon: Users,
    permission: "customers:read",
  },
  {
    id: "products",
    label: "Produtos",
    icon: Package,
    permission: "products:read",
  },
  {
    id: "users",
    label: "Usuários e perfis",
    icon: ShieldCheck,
    permission: "users:manage",
  },
  {
    id: "audit",
    label: "Auditoria",
    icon: ClipboardList,
    permission: "audit:read",
  },
];
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        c<span>•</span>
      </span>
      <div>
        caramelo<span>ERP</span>
      </div>
    </div>
  );
}
export function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    try {
      const user = await api<Auth>("/auth/me");
      setAuth(user);
      setPage(
        (current) =>
          pages.find(
            (p) => p.id === current && user.permissions.includes(p.permission),
          )?.id ??
          pages.find((p) => user.permissions.includes(p.permission))?.id ??
          "",
      );
    } catch {
      setAuth(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const expired = () => {
      setAuth(null);
      setError("Sua sessão expirou. Entre novamente.");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setAuth(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading) return <Loading />;
  if (!auth) return <Login onLogin={load} sessionMessage={error} />;
  const navigate = (id: string) => {
    setPage(id);
    setMobile(false);
    setError("");
  };
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      {mobile && (
        <button
          className="backdrop"
          onClick={() => setMobile(false)}
          aria-label="Fechar menu"
        />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <Brand />
        <div className="workspace">
          <span className="workspace-icon">
            <Building2 size={18} />
          </span>
          <div>
            <strong>{auth.companyName}</strong>
            <small>Espaço da sua empresa</small>
          </div>
        </div>
        <span className="nav-label">SEU NEGÓCIO</span>
        <nav aria-label="Menu principal">
          {pages
            .filter(
              (p) =>
                ["dashboard", "customers", "products"].includes(p.id) &&
                auth.permissions.includes(p.permission),
            )
            .map((p) => (
              <button
                key={p.id}
                className={`nav-item ${page === p.id ? "active" : ""}`}
                title={p.label}
                onClick={() => navigate(p.id)}
              >
                <p.icon size={20} />
                <span>{p.label}</span>
                {page === p.id && <span className="active-dot" />}
              </button>
            ))}
        </nav>
        <span className="nav-label future-label">PRÓXIMAS ETAPAS</span>
        <div className="future-nav">
          {[
            { label: "Estoque", icon: Layers },
            { label: "Vendas", icon: ShoppingBag },
            { label: "Financeiro", icon: Wallet },
            { label: "Relatórios", icon: ChartNoAxesCombined },
            { label: "Fiscal", icon: FileText },
          ].map((p) => (
            <div
              className="nav-item planned"
              key={p.label}
              title={`${p.label} — previsto no roadmap`}
            >
              <p.icon size={19} />
              <span>{p.label}</span>
              <small>Em breve</small>
            </div>
          ))}
        </div>
        {pages.some(
          (p) =>
            ["users", "audit"].includes(p.id) &&
            auth.permissions.includes(p.permission),
        ) && (
          <>
            <span className="nav-label">ADMINISTRAÇÃO</span>
            <nav aria-label="Administração">
              {pages
                .filter(
                  (p) =>
                    ["users", "audit"].includes(p.id) &&
                    auth.permissions.includes(p.permission),
                )
                .map((p) => (
                  <button
                    key={p.id}
                    className={`nav-item ${page === p.id ? "active" : ""}`}
                    title={p.label}
                    onClick={() => navigate(p.id)}
                  >
                    <p.icon size={19} />
                    <span>{p.label}</span>
                  </button>
                ))}
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="foundation">
            <span className="status-dot" />
            <div>
              <strong>Um bom começo.</strong>
              <p>Mais clareza para o seu negócio.</p>
            </div>
          </div>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            <span>Recolher menu</span>
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              onClick={() => setMobile(!mobile)}
              aria-label="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <span>Meu negócio</span>
            <ChevronRight size={14} />
            <strong>{pages.find((p) => p.id === page)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment">Ambiente de desenvolvimento</span>
            <div className="profile">
              <span className="avatar">
                {auth.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{auth.name}</strong>
                <small>{auth.role}</small>
              </div>
            </div>
            <button
              className="icon-button"
              onClick={() => void logout()}
              title="Sair"
              aria-label="Sair"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main>
          <ErrorMessage message={error} />
          <Suspense fallback={<Loading />}>
            {page === "dashboard" ? (
              <Dashboard auth={auth} navigate={navigate} />
            ) : page === "customers" || page === "products" ? (
              <Catalog key={page} kind={page} auth={auth} />
            ) : page === "users" ? (
              <UsersPage auth={auth} />
            ) : page === "audit" ? (
              <AuditPage />
            ) : (
              <p>Seu perfil ainda não possui módulos disponíveis.</p>
            )}
          </Suspense>
        </main>
        <footer>
          Caramelo ERP <span>Feito para o seu negócio crescer.</span>
          <small>Base inicial · v0.1</small>
        </footer>
      </div>
    </div>
  );
}
function Login({
  onLogin,
  sessionMessage,
}: {
  onLogin: () => Promise<void>;
  sessionMessage: string;
}) {
  const [error, setError] = useState(sessionMessage);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify(data) });
      await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">GESTÃO COM MAIS LEVEZA</span>
          <h1>
            Seu negócio.
            <br />
            Tudo no lugar.
          </h1>
          <p>
            Uma visão clara de hoje.
            <br />
            Mais espaço para crescer amanhã.
          </p>
          <div className="login-illustration">
            <div className="illustration-tile">
              <ChartNoAxesCombined size={32} />
              <span>Clareza para decidir</span>
              <ArrowUpRight size={24} />
            </div>
            <div className="illustration-lines">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <span className="illustration-caption">Cada passo conta.</span>
          </div>
        </div>
        <small>Caramelo ERP · Gestão para empresas brasileiras</small>
      </section>
      <section className="login-form">
        <div className="login-card">
          <span className="login-lock">
            <LockKeyhole size={22} />
          </span>
          <h2>Bom ter você por aqui.</h2>
          <p>Acesse o espaço da sua empresa.</p>
          <form onSubmit={(e) => void submit(e)}>
            <label>
              Empresa
              <input
                name="company"
                placeholder="Identificador da empresa"
                defaultValue="caramelo-demo"
                required
                autoComplete="organization"
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                name="email"
                placeholder="voce@empresa.com.br"
                required
                autoComplete="username"
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                name="password"
                placeholder="Sua senha"
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
            <ErrorMessage message={error} />
            <button className="primary login-submit" disabled={busy}>
              {busy ? "Entrando…" : "Entrar no Caramelo"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="login-note">
            <ShieldCheck size={18} />
            <span>
              Seu acesso é vinculado à sua empresa e ao seu perfil de
              permissões.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
