import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, ShieldCheck } from "lucide-react";
import { api, dateTime, type Auth, type Page } from "../api";
import { Loading, ErrorMessage, Empty, Modal, Pagination } from "../components";
interface Member {
  branchId?: string | null;
  id: string;
  active: boolean;
  user: { name: string; email: string };
  role: { id: string; name: string };
}
interface Role {
  id: string;
  name: string;
  permissions: { permissionCode: string }[];
}
export function UsersPage({ auth }: { auth: Auth }) {
  const [data, setData] = useState<Page<Member> | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState<Member | null | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([
      api<Page<Member>>(`/users?page=${page}`),
      api<Role[]>("/roles"),
    ])
      .then(([d, r]) => {
        if (active) {
          setData(d);
          setRoles(r);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page, version]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>Usuários e perfis</h1>
          <p>O acesso certo para cada pessoa da sua equipe.</p>
        </div>
        <button className="primary" onClick={() => setEditing(null)}>
          <Plus size={18} />
          Novo usuário
        </button>
      </div>
      <ErrorMessage message={error} />
      {success && (
        <div className="success" role="status">
          {success}
        </div>
      )}
      <section className="card">
        {!data ? (
          <Loading />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>Perfil</th>
                    <th>Situação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>
                          {m.user.name}
                          {m.id === auth.membershipId ? " (você)" : ""}
                        </strong>
                        <small>{m.user.email}</small>
                      </td>
                      <td>{m.role.name}</td>
                      <td>
                        <span
                          className={`badge ${m.active ? "green" : "neutral"}`}
                        >
                          {m.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          disabled={m.id === auth.membershipId}
                          onClick={() => setEditing(m)}
                          aria-label={`Editar acesso de ${m.user.name}`}
                        >
                          <Pencil size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...data} onChange={setPage} />
          </>
        )}
      </section>
      <div className="role-grid">
        {roles.map((role) => (
          <section className="card role-card" key={role.id}>
            <ShieldCheck size={20} />
            <h2>{role.name}</h2>
            <p>
              {role.permissions
                .map(
                  (p) =>
                    ({
                      "dashboard:read": "Dashboard",
                      "customers:read": "Consultar clientes",
                      "customers:write": "Editar clientes",
                      "products:read": "Consultar produtos",
                      "products:write": "Editar produtos",
                      "users:manage": "Gerenciar usuários",
                      "audit:read": "Consultar auditoria",
                      "sales:read": "Consultar vendas",
                      "sales:create": "Vender no PDV",
                      "sales:discount": "Conceder descontos",
                      "sales:cancel": "Cancelar vendas",
                      "cash:read": "Consultar caixa",
                      "cash:operate": "Operar caixa",
                      "cash:manage": "Gerenciar caixas",
                      "returns:create": "Trocar/devolver",
                    })[p.permissionCode] ?? p.permissionCode,
                )
                .join(" · ")}
            </p>
          </section>
        ))}
      </div>
      {editing !== undefined && (
        <UserForm
          member={editing}
          roles={roles}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setVersion((v) => v + 1);
            setSuccess("Acesso salvo com sucesso.");
          }}
        />
      )}
    </>
  );
}
function UserForm({
  member,
  roles,
  onClose,
  onSaved,
}: {
  member: Member | null;
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  useEffect(() => {
    api<Array<{ id: string; name: string }>>("/branches")
      .then(setBranches)
      .catch((e) => setError(e.message));
  }, []);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values: Record<string, unknown> = Object.fromEntries(
      new FormData(event.currentTarget),
    );
    if (member) values.active = values.active === "true";
    values.branchId = values.branchId || null;
    try {
      await api(`/users${member ? `/${member.id}` : ""}`, {
        method: member ? "PATCH" : "POST",
        body: JSON.stringify(values),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={member ? `Acesso de ${member.user.name}` : "Novo usuário"}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {!member && (
            <>
              <label>
                Nome
                <input name="name" required minLength={2} maxLength={120} />
              </label>
              <label>
                E-mail
                <input name="email" type="email" required maxLength={200} />
              </label>
              <label className="full-width">
                Senha inicial (mínimo 12 caracteres)
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
            </>
          )}
          <label>
            Perfil
            <select name="roleId" required defaultValue={member?.role.id ?? ""}>
              <option value="" disabled>
                Selecione um perfil
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {member && (
            <label>
              Situação
              <select name="active" defaultValue={String(member.active)}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
            </label>
          )}
          <label>
            Filial autorizada
            <select name="branchId" defaultValue={member?.branchId ?? ""}>
              <option value="">Todas as filiais</option>
              {branches.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <small>
              Administrador possui acesso à empresa inteira. Perfis restritos
              não acessam o dashboard financeiro consolidado.
            </small>
          </label>
        </div>
        {member && (
          <p className="helper-text">
            Ao salvar, todas as sessões anteriores deste acesso serão
            encerradas.
          </p>
        )}
        <ErrorMessage message={error} />
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar acesso"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
interface Audit {
  id: string;
  createdAt: string;
  action: string;
  module: string;
  recordId: string;
  actor: { user: { name: string } } | null;
}
export function AuditPage() {
  const [data, setData] = useState<Page<Audit> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Page<Audit>>(`/audit?page=${page}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>Auditoria</h1>
          <p>Rastreabilidade das operações importantes da sua empresa.</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <section className="card">
        {!data ? (
          <Loading />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data e hora</th>
                    <th>Usuário</th>
                    <th>Ação</th>
                    <th>Módulo</th>
                    <th>Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id}>
                      <td>{dateTime(a.createdAt)}</td>
                      <td>{a.actor?.user.name ?? "Sistema"}</td>
                      <td>
                        {{
                          LOGIN: "Entrada no sistema",
                          CREATE: "Cadastro criado",
                          UPDATE: "Cadastro alterado",
                          ACCESS_UPDATE: "Acesso alterado",
                          SEED: "Demonstração criada",
                        }[a.action] ?? a.action}
                      </td>
                      <td>
                        {{
                          auth: "Autenticação",
                          customers: "Clientes",
                          products: "Produtos",
                          users: "Usuários",
                          system: "Sistema",
                        }[a.module] ?? a.module}
                      </td>
                      <td>
                        <code>{a.recordId}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.items.length && <Empty />}
            </div>
            <Pagination {...data} onChange={setPage} />
          </>
        )}
      </section>
    </>
  );
}
