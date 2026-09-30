import { useEffect, useState, type FormEvent } from "react";
import { api, type Auth, type Page } from "../api";
import { ErrorMessage, Modal, Pagination } from "../components";
type Supplier = Record<string, string | boolean | number | null> & {
  id: string;
  name: string;
  active: boolean;
};
const fields: [string, string, string?][] = [
  ["name", "Razão social"],
  ["tradeName", "Nome fantasia"],
  ["document", "CPF/CNPJ"],
  ["registration", "Inscrição estadual"],
  ["phone", "Telefone"],
  ["whatsapp", "WhatsApp"],
  ["email", "E-mail", "email"],
  ["website", "Site", "url"],
  ["postalCode", "CEP"],
  ["street", "Endereço"],
  ["number", "Número"],
  ["complement", "Complemento"],
  ["district", "Bairro"],
  ["city", "Cidade"],
  ["state", "Estado (UF)"],
  ["contact", "Contato comercial"],
  ["paymentTerms", "Condição padrão de pagamento"],
];
const types: Record<string, string> = {
  PUBLISHER: "Editora",
  DISTRIBUTOR: "Distribuidora",
  WHOLESALER: "Atacadista",
  OTHER: "Outro",
};
export function Suppliers({
  auth,
  onChanged,
}: {
  auth: Auth;
  onChanged: () => void;
}) {
  const [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<Page<Supplier>>({
      items: [],
      total: 0,
      page: 1,
      limit: 25,
    }),
    [editing, setEditing] = useState<Supplier | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<Page<Supplier>>(
      `/suppliers?q=${encodeURIComponent(query)}&page=${page}&limit=25`,
    )
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [query, page, revision]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget),
      data: Record<string, unknown> = {};
    for (const [key] of fields) data[key] = String(form.get(key) ?? "");
    data.type = form.get("type");
    data.notes = form.get("notes");
    data.active = form.get("active") === "on";
    data.deliveryDays = form.get("deliveryDays")
      ? Number(form.get("deliveryDays"))
      : null;
    try {
      await api("/suppliers" + (editing.id ? "/" + editing.id : ""), {
        method: editing.id ? "PUT" : "POST",
        body: JSON.stringify(data),
      });
      setEditing(null);
      setRevision((n) => n + 1);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="section-heading">
        <h2>Fornecedores</h2>
        {auth.permissions.includes("suppliers:write") && (
          <button
            className="primary"
            onClick={() => {
              setError("");
              setEditing({ id: "", name: "", active: true, type: "OTHER" });
            }}
          >
            Novo fornecedor
          </button>
        )}
      </div>
      <form
        className="purchase-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q);
        }}
      >
        <label>
          Pesquisar fornecedores
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, documento, cidade ou contato"
          />
        </label>
        <button>Buscar</button>
      </form>
      {!editing && <ErrorMessage message={error} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fornecedor</th>
              <th>Documento</th>
              <th>Contato</th>
              <th>Cidade</th>
              <th>Status</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.items.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  <small>{s.tradeName}</small>
                </td>
                <td>{s.document}</td>
                <td>
                  {s.contact}
                  <small>{s.phone}</small>
                </td>
                <td>{s.city}</td>
                <td>{s.active ? "Ativo" : "Inativo"}</td>
                <td>
                  {auth.permissions.includes("suppliers:write") && (
                    <button
                      onClick={() => {
                        setError("");
                        setEditing(s);
                      }}
                    >
                      Editar fornecedor
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...rows} onChange={setPage} />
      {editing && (
        <Modal
          title={editing.id ? "Editar fornecedor" : "Novo fornecedor"}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <div className="form-grid">
                {fields.map(([key, label, type]) => (
                  <label key={key}>
                    {label}
                    <input
                      name={key}
                      type={type ?? "text"}
                      required={key === "name"}
                      maxLength={key === "state" ? 2 : 300}
                      defaultValue={String(editing[key] ?? "")}
                    />
                  </label>
                ))}
                <label>
                  Tipo
                  <select
                    name="type"
                    defaultValue={String(editing.type ?? "OTHER")}
                  >
                    {Object.entries(types).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prazo médio de entrega (dias)
                  <input
                    name="deliveryDays"
                    type="number"
                    min="0"
                    max="3650"
                    defaultValue={String(editing.deliveryDays ?? "")}
                  />
                </label>
                <label>
                  Observações
                  <textarea
                    name="notes"
                    maxLength={2000}
                    defaultValue={String(editing.notes ?? "")}
                  />
                </label>
                <label>
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={editing.active}
                  />
                  Ativo
                </label>
              </div>
              <ErrorMessage message={error} />
              <button className="primary">Salvar fornecedor</button>
            </fieldset>
          </form>
        </Modal>
      )}
    </section>
  );
}
