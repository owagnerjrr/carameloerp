import { useEffect, useState, type FormEvent } from "react";
import { Plus, Search, Pencil, Users, Package } from "lucide-react";
import { api, money, number, type Auth, type Page } from "../api";
import { Loading, Empty, ErrorMessage, Modal, Pagination } from "../components";
export interface Row {
  id: string;
  name?: string;
  description?: string;
  code?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  document?: string;
  active: boolean;
  price?: string;
  cost?: string;
  stock?: number;
  margin?: number;
  category?: { name: string } | null;
  [key: string]: unknown;
}
interface Options {
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}
interface Field {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  max?: number;
  step?: string;
}
const customerFields: Field[] = [
  { name: "name", label: "Nome / Razão social", required: true, max: 160 },
  { name: "document", label: "CPF / CNPJ", max: 18 },
  { name: "registration", label: "RG / Inscrição estadual", max: 30 },
  { name: "phone", label: "Telefone", type: "tel", max: 25 },
  { name: "whatsapp", label: "WhatsApp", type: "tel", max: 25 },
  { name: "email", label: "E-mail", type: "email", max: 200 },
  { name: "postalCode", label: "CEP", max: 9 },
  { name: "street", label: "Endereço", max: 200 },
  { name: "number", label: "Número", max: 20 },
  { name: "complement", label: "Complemento", max: 200 },
  { name: "district", label: "Bairro", max: 100 },
  { name: "city", label: "Cidade", max: 100 },
  { name: "state", label: "UF (ex.: SP)", max: 2 },
];
const productFields: Field[] = [
  { name: "description", label: "Título", required: true, max: 200 },
  { name: "code", label: "SKU / código interno", required: true, max: 40 },
  { name: "barcode", label: "Código de barras", max: 40 },
  { name: "subtitle", label: "Subtítulo" },
  { name: "isbn10", label: "ISBN-10" },
  { name: "isbn13", label: "ISBN-13" },
  { name: "author", label: "Autor" },
  { name: "coauthor", label: "Coautores" },
  { name: "publisher", label: "Editora" },
  { name: "imprint", label: "Selo editorial" },
  { name: "edition", label: "Edição" },
  { name: "publicationYear", label: "Ano de publicação" },
  { name: "language", label: "Idioma" },
  { name: "genre", label: "Gênero" },
  { name: "pages", label: "Número de páginas" },
  { name: "format", label: "Formato" },
  { name: "coverType", label: "Tipo de capa" },
  { name: "weightGrams", label: "Peso (gramas)" },
  { name: "dimensions", label: "Dimensões (cm)" },
  { name: "coverUrl", label: "URL HTTPS da capa" },
  { name: "synopsis", label: "Sinopse" },
  { name: "brand", label: "Marca", max: 80 },
  {
    name: "cost",
    label: "Custo (R$)",
    type: "number",
    step: ".01",
    required: true,
  },
  {
    name: "price",
    label: "Preço de venda (R$)",
    type: "number",
    step: ".01",
    required: true,
  },
  {
    name: "minStock",
    label: "Estoque mínimo",
    type: "number",
    step: ".001",
    required: true,
  },
  { name: "location", label: "Localização", max: 80 },
  { name: "ncm", label: "NCM", max: 8 },
  { name: "cest", label: "CEST", max: 7 },
  { name: "cfop", label: "CFOP", max: 4 },
  { name: "origin", label: "Origem (0–8)", max: 1 },
  { name: "cst", label: "CST", max: 2 },
  { name: "csosn", label: "CSOSN", max: 3 },
];
export function Catalog({
  kind,
  auth,
}: {
  kind: "customers" | "products";
  auth: Auth;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Page<Row> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [success, setSuccess] = useState("");
  const customers = kind === "customers";
  const canWrite = auth.permissions.includes(`${kind}:write`);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<Row>>(`/${kind}?q=${encodeURIComponent(query)}&page=${page}`)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, page, query, version]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CADASTROS</span>
          <h1>{customers ? "Clientes" : "Livros"}</h1>
          <p>
            {customers
              ? "Boas relações começam com tudo organizado."
              : "Seu catálogo, organizado do seu jeito."}
          </p>
        </div>
        {canWrite && (
          <button className="primary" onClick={() => setEditing(null)}>
            <Plus size={18} />
            {customers ? "Novo cliente" : "Novo livro"}
          </button>
        )}
      </div>
      {success && (
        <div role="status" className="success">
          {success}
        </div>
      )}
      <ErrorMessage message={error} />
      <section className="card">
        <div className="catalog-toolbar">
          <div className="catalog-title">
            {customers ? <Users size={21} /> : <Package size={21} />}
            <strong>
              {customers ? "Todos os clientes" : "Todos os livros"}
            </strong>
            <span className="count-badge">{data?.total ?? 0}</span>
          </div>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(search);
            }}
          >
            <Search size={18} />
            <input
              aria-label={customers ? "Pesquisar clientes" : "Pesquisar livros"}
              placeholder={
                customers
                  ? "Buscar nome ou CPF/CNPJ"
                  : "Título, autor, ISBN ou SKU"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit">Buscar</button>
          </form>
        </div>
        {loading ? (
          <Loading />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {(customers
                      ? ["Cliente", "Contato", "Cidade", "Situação"]
                      : [
                          "Produto",
                          "Categoria",
                          "Preço de venda",
                          "Estoque",
                          "Margem",
                          "Situação",
                        ]
                    ).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                    {canWrite && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((row) => (
                    <tr key={row.id}>
                      {customers ? (
                        <>
                          <td>
                            <strong>{row.name}</strong>
                            <small>
                              {row.document ?? "CPF/CNPJ não informado"}
                            </small>
                          </td>
                          <td>
                            {row.email ?? "—"}
                            <small>{row.phone ?? ""}</small>
                          </td>
                          <td>
                            {row.city ?? "—"}
                            {row.state ? ` / ${row.state}` : ""}
                          </td>
                        </>
                      ) : (
                        <>
                          <td>
                            <strong>{row.description}</strong>
                            <small>{row.code}</small>
                          </td>
                          <td>{row.category?.name ?? "Sem categoria"}</td>
                          <td className="money-cell">
                            {money(row.price ?? 0)}
                          </td>
                          <td>{number(row.stock ?? 0)}</td>
                          <td>{number(row.margin ?? 0)}%</td>
                        </>
                      )}
                      <td>
                        <span
                          className={`badge ${row.active ? "green" : "neutral"}`}
                        >
                          {row.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      {canWrite && (
                        <td>
                          <button
                            className="icon-button"
                            onClick={() => setEditing(row)}
                            aria-label={`Editar ${row.name ?? row.description}`}
                          >
                            <Pencil size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data?.items.length && (
                <Empty
                  text={
                    query
                      ? "Nenhum resultado para esta busca."
                      : "Nenhum cadastro ainda. Comece pelo botão acima."
                  }
                />
              )}
            </div>
            {data && <Pagination {...data} onChange={setPage} />}
          </>
        )}
      </section>
      {!customers && (
        <p className="helper-text">
          Saldos são calculados pelos depósitos autorizados. Use Estoque para
          entradas, ajustes e histórico.
        </p>
      )}
      {editing !== undefined && (
        <CatalogForm
          kind={kind}
          row={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setSuccess("Cadastro salvo com sucesso.");
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
export function CatalogForm({
  kind,
  row,
  onClose,
  onSaved,
  initialCode = "",
}: {
  kind: "customers" | "products";
  row: Row | null;
  onClose: () => void;
  onSaved: (saved: Row) => void;
  initialCode?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Options>({
    categories: [],
    suppliers: [],
  });
  const customers = kind === "customers";
  useEffect(() => {
    if (!customers)
      api<Options>("/products/options")
        .then(setOptions)
        .catch((e) => setError(e.message));
  }, [customers]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const values: Record<string, unknown> = Object.fromEntries(form);
    values.active = form.get("active") === "true";
    if (!customers) {
      values.categoryId = form.get("categoryId") || null;
      values.supplierId = form.get("supplierId") || null;
    }
    try {
      const saved = await api<Row>(`/${kind}${row ? `/${row.id}` : ""}`, {
        method: row ? "PUT" : "POST",
        body: JSON.stringify(values),
      });
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${row ? "Editar" : "Novo"} ${customers ? "cliente" : "livro"}`}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {(customers ? customerFields : productFields).map((f) => (
            <label key={f.name}>
              {f.label}
              {f.required ? " *" : ""}
              <input
                name={f.name}
                type={f.type ?? "text"}
                required={f.required}
                maxLength={f.max}
                min={f.type === "number" ? 0 : undefined}
                max={f.type === "number" ? 9999999999.99 : undefined}
                step={f.step}
                defaultValue={String(
                  row?.[f.name] ??
                    (f.name === "barcode"
                      ? initialCode
                      : f.type === "number"
                        ? "0"
                        : ""),
                )}
              />
            </label>
          ))}
          {customers ? (
            <label className="full-width">
              Observações
              <textarea
                name="notes"
                maxLength={2000}
                rows={3}
                defaultValue={String(row?.notes ?? "")}
              />
            </label>
          ) : (
            <>
              <label>
                Unidade
                <select name="unit" defaultValue={String(row?.unit ?? "UN")}>
                  {["UN", "KG", "G", "L", "ML", "M", "M2", "CX", "PC"].map(
                    (u) => (
                      <option key={u}>{u}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Categoria
                <select
                  name="categoryId"
                  defaultValue={String(row?.categoryId ?? "")}
                >
                  <option value="">Sem categoria</option>
                  {options.categories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fornecedor
                <select
                  name="supplierId"
                  defaultValue={String(row?.supplierId ?? "")}
                >
                  <option value="">Sem fornecedor</option>
                  {options.suppliers.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            Situação
            <select name="active" defaultValue={String(row?.active ?? true)}>
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </select>
          </label>
        </div>
        {!customers && (
          <p className="helper-text">
            Os códigos fiscais são cadastrais. A emissão de documentos e as
            regras tributárias ainda não estão disponíveis.
          </p>
        )}
        <ErrorMessage message={error} />
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar cadastro"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
