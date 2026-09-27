import { useBarcodeReader } from "../useBarcodeReader";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { addScanned } from "@caramelo/contracts";
import { api, ApiError, money, dateTime, type Auth, type Page } from "../api";
import { ErrorMessage, Modal, Pagination } from "../components";
import { CatalogForm, type Row } from "./Catalog";
type Book = Row & {
  id: string;
  description: string;
  author?: string;
  publisher?: string;
  isbn13?: string;
  barcode?: string;
  cost: string;
};
type StockRow = {
  productId: string;
  description: string;
  isbn13: string | null;
  barcode: string | null;
  author: string | null;
  publisher: string | null;
  branchId: string;
  branchName: string;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  minStock: string;
  location: string | null;
  status: string;
};
type Options = {
  warehouses: Array<{
    id: string;
    name: string;
    branch: { id: string; name: string };
  }>;
  suppliers: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
};
type Movement = {
  sale?: { id: string; number: number; status: string } | null;
  id: string;
  createdAt: string;
  type: string;
  quantity: string;
  beforeQuantity: string | null;
  afterQuantity: string | null;
  reason: string;
  warehouse: { name: string; branch: { name: string } };
  actor: { user: { name: string } };
  document: { id: string; kind: string; documentNumber: string | null } | null;
};
const statusName: Record<string, string> = {
  NORMAL: "NORMAL",
  LOW: "ESTOQUE BAIXO",
  ZERO: "SEM ESTOQUE",
};
export function StockPage({ auth }: { auth: Auth }) {
  const [tab, setTab] = useState("stock"),
    [options, setOptions] = useState<Options>({
      warehouses: [],
      suppliers: [],
      categories: [],
    }),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  const [filters, setFilters] = useState({
      q: "",
      branchId: "",
      publisher: "",
      categoryId: "",
      status: "",
    }),
    [page, setPage] = useState(1),
    [data, setData] = useState<Page<StockRow> | null>(null),
    [selected, setSelected] = useState<StockRow | null>(null),
    [adjust, setAdjust] = useState<StockRow | null>(null);
  useEffect(() => {
    api<Options>("/stock/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => !!v),
    );
    query.set("page", String(page));
    api<Page<StockRow>>("/stock?" + query)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [filters, page, version]);
  const branches = [
    ...new Map(options.warehouses.map((w) => [w.branch.id, w.branch])).values(),
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Estoque da livraria</h1>
          <p>Disponibilidade por unidade, entradas e histórico rastreável.</p>
        </div>
      </div>
      <div className="stock-tabs">
        <button
          className={tab === "stock" ? "primary" : "secondary"}
          onClick={() => setTab("stock")}
        >
          Consultar estoque
        </button>
        {auth.permissions.includes("stock:receive") && (
          <button
            className={tab === "entry" ? "primary" : "secondary"}
            onClick={() => setTab("entry")}
          >
            Entrada de Livros
          </button>
        )}
      </div>
      <ErrorMessage message={error} />
      <div hidden={tab !== "stock"}>
        <form
          className="stock-filters panel"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(
              new FormData(e.currentTarget),
            ) as typeof filters;
            setFilters(v);
            setPage(1);
          }}
        >
          <label>
            Filial
            <select name="branchId">
              <option value="">Todas as filiais autorizadas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Título, ISBN, autor ou SKU
            <input name="q" placeholder="Pesquisar livros" />
          </label>
          <label>
            Editora
            <input name="publisher" />
          </label>
          <label>
            Categoria
            <select name="categoryId">
              <option value="">Todas</option>
              {options.categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status">
              <option value="">Todos</option>
              {Object.entries(statusName).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button className="primary">Filtrar</button>
        </form>
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Livro / ISBN",
                    "Autor / Editora",
                    "Filial / Depósito",
                    "Quantidade",
                    "Mínimo / Estante",
                    "Status",
                    "Ações",
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => (
                  <tr key={r.productId + r.warehouseId}>
                    <td>
                      <strong>{r.description}</strong>
                      <small>{r.isbn13 ?? r.barcode ?? "Sem ISBN/EAN"}</small>
                    </td>
                    <td>
                      {r.author ?? "—"}
                      <small>{r.publisher ?? "—"}</small>
                    </td>
                    <td>
                      {r.branchName}
                      <small>{r.warehouseName}</small>
                    </td>
                    <td>{r.quantity}</td>
                    <td>
                      {r.minStock}
                      <small>{r.location ?? "—"}</small>
                    </td>
                    <td>
                      <span
                        className={
                          "badge " +
                          (r.status === "NORMAL" ? "green" : "neutral")
                        }
                      >
                        {statusName[r.status]}
                      </span>
                    </td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setSelected(r)}
                      >
                        Rede e histórico
                      </button>
                      {auth.permissions.includes("stock:adjust") && (
                        <button
                          className="secondary"
                          onClick={() => setAdjust(r)}
                        >
                          Ajustar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data?.items.length === 0 && (
            <p className="empty">Nenhum livro encontrado neste filtro.</p>
          )}
          {data && <Pagination {...data} onChange={setPage} />}
        </section>
      </div>
      {auth.permissions.includes("stock:receive") && (
        <div hidden={tab !== "entry"}>
          <Entry
            options={options}
            active={tab === "entry"}
            canCreate={auth.permissions.includes("products:write")}
            onConfirmed={() => setVersion((v) => v + 1)}
          />
        </div>
      )}
      {selected && <History row={selected} onClose={() => setSelected(null)} />}
      {adjust && (
        <Adjustment
          row={adjust}
          onClose={() => setAdjust(null)}
          onDone={() => {
            setAdjust(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
function Entry({
  options,
  active,
  canCreate,
  onConfirmed,
}: {
  options: Options;
  active: boolean;
  canCreate: boolean;
  onConfirmed: () => void;
}) {
  const [rows, setRows] = useState<
      Array<{ book: Book; quantity: number; unitCost: string }>
    >([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [warehouse, setWarehouse] = useState(""),
    [supplier, setSupplier] = useState("");
  const [doc, setDoc] = useState(""),
    [invoice, setInvoice] = useState(""),
    [received, setReceived] = useState(new Date().toLocaleDateString("en-CA")),
    [notes, setNotes] = useState("");
  const [unknown, setUnknown] = useState(""),
    [create, setCreate] = useState(false),
    [manual, setManual] = useState(false),
    [results, setResults] = useState<Book[]>([]),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const renew = () => {
    key.current = crypto.randomUUID();
    setMessage("");
  };

  const add = (book: Book) => {
    setRows((r) => addScanned(r, book, book.cost));
    renew();
  };
  const { input, pending, scan } = useBarcodeReader(
    active && !manual && !create && !review && !busy,
    async (code) => {
      const book = await api<Book>(
        "/products/lookup?code=" + encodeURIComponent(code),
      );
      add(book);
      setError("");
      setUnknown("");
    },
    (e, code) => {
      setError(e.message);
      if (e instanceof ApiError && e.status === 404) setUnknown(code);
    },
  );
  const total =
      rows.reduce(
        (n, r) => n + Math.round(Number(r.unitCost || 0) * 100) * r.quantity,
        0,
      ) / 100,
    quantity = rows.reduce((n, r) => n + r.quantity, 0);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/stock/entries", {
        method: "POST",
        body: JSON.stringify({
          requestKey: key.current,
          warehouseId: warehouse,
          supplierId: supplier,
          documentNumber: doc,
          invoiceNumber: invoice,
          receivedAt: received,
          notes,
          items: rows.map((r) => ({
            productId: r.book.id,
            quantity: r.quantity,
            unitCost: r.unitCost,
          })),
        }),
      });
      setRows([]);
      setReview(false);
      renew();
      setMessage("Entrada confirmada e persistida. Documento " + result.id);
      onConfirmed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel stock-entry">
      <h2>Entrada de Livros</h2>
      <p>
        Leia ISBN/EAN ou SKU e pressione Enter. Repetições somam exemplares.
      </p>
      <ErrorMessage message={error} />
      {message && (
        <p role="status" className="stock-success">
          {message}
        </p>
      )}
      <fieldset disabled={busy || review} className="stock-fieldset">
        <div className="form-grid">
          <label>
            Filial / depósito
            <select
              aria-label="Filial da entrada"
              value={warehouse}
              onChange={(e) => {
                setWarehouse(e.target.value);
                renew();
              }}
            >
              <option value="">Selecione a unidade</option>
              {options.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.branch.name} — {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fornecedor / distribuidora
            <select
              aria-label="Fornecedor da entrada"
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
                renew();
              }}
            >
              <option value="">Selecione o fornecedor</option>
              {options.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Número do documento
            <input
              value={doc}
              maxLength={80}
              onChange={(e) => {
                setDoc(e.target.value);
                renew();
              }}
            />
          </label>
          <label>
            Número da nota
            <input
              value={invoice}
              maxLength={80}
              onChange={(e) => {
                setInvoice(e.target.value);
                renew();
              }}
            />
          </label>
          <label>
            Data de recebimento
            <input
              type="date"
              value={received}
              onChange={(e) => {
                setReceived(e.target.value);
                renew();
              }}
            />
          </label>
          <label>
            Observações
            <input
              value={notes}
              maxLength={2000}
              onChange={(e) => {
                setNotes(e.target.value);
                renew();
              }}
            />
          </label>
        </div>
        <form className="scan-bar" onSubmit={scan}>
          <label>
            Leitura ISBN/EAN/SKU
            <input
              ref={input}
              aria-label="Leitura ISBN/EAN/SKU"
              placeholder="Leia o código e pressione Enter"
              autoComplete="off"
            />
          </label>
          <button className="primary">Adicionar código</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setManual(true)}
          >
            Adicionar manualmente
          </button>
        </form>
        {pending > 0 && <p role="status">Processando {pending} leitura(s)…</p>}
        {unknown && (
          <div className="stock-warning">
            Livro não encontrado: {unknown}.{" "}
            {canCreate && (
              <button className="secondary" onClick={() => setCreate(true)}>
                Cadastrar livro
              </button>
            )}
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Livro / ISBN",
                  "Autor / Editora",
                  "Qtd.",
                  "Custo (R$)",
                  "Total",
                  "",
                ].map((v, i) => (
                  <th key={i}>{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.book.id}>
                  <td>
                    <strong>{r.book.description}</strong>
                    <small>
                      {r.book.isbn13 ?? r.book.barcode ?? r.book.code}
                    </small>
                  </td>
                  <td>
                    {r.book.author ?? "—"}
                    <small>{r.book.publisher ?? "—"}</small>
                  </td>
                  <td>
                    <input
                      aria-label={"Quantidade de " + r.book.description}
                      type="number"
                      min="1"
                      max="1000000"
                      value={r.quantity}
                      onChange={(e) => {
                        setRows((v) =>
                          v.map((x) =>
                            x === r
                              ? { ...x, quantity: Number(e.target.value) }
                              : x,
                          ),
                        );
                        renew();
                      }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={"Custo de " + r.book.description}
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.unitCost}
                      onChange={(e) => {
                        setRows((v) =>
                          v.map((x) =>
                            x === r ? { ...x, unitCost: e.target.value } : x,
                          ),
                        );
                        renew();
                      }}
                    />
                  </td>
                  <td>
                    {money(
                      (Math.round(Number(r.unitCost || 0) * 100) * r.quantity) /
                        100,
                    )}
                  </td>
                  <td>
                    <button
                      className="secondary"
                      aria-label={"Remover " + r.book.description}
                      onClick={() => {
                        setRows((v) => v.filter((x) => x !== r));
                        renew();
                      }}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stock-summary">
          <span>
            {rows.length} títulos · {quantity} exemplares
          </span>
          <strong>{money(total)}</strong>
          <button
            className="primary"
            disabled={
              !warehouse ||
              !supplier ||
              !received ||
              !rows.length ||
              pending > 0 ||
              rows.some(
                (r) =>
                  !Number.isInteger(r.quantity) ||
                  r.quantity <= 0 ||
                  !/^\d{1,8}(\.\d{1,2})?$/.test(r.unitCost),
              )
            }
            onClick={() => setReview(true)}
          >
            Confirmar entrada
          </button>
        </div>
      </fieldset>
      {create && (
        <CatalogForm
          kind="products"
          row={null}
          initialCode={unknown}
          onClose={() => setCreate(false)}
          onSaved={(saved) => {
            add(saved as Book);
            setCreate(false);
            setUnknown("");
            setError("");
          }}
        />
      )}
      {manual && (
        <Modal
          title="Adicionar livro manualmente"
          onClose={() => setManual(false)}
        >
          <form
            className="scan-bar"
            onSubmit={async (e) => {
              e.preventDefault();
              const q = String(new FormData(e.currentTarget).get("q"));
              try {
                const r = await api<Page<Book>>(
                  "/products?q=" + encodeURIComponent(q),
                );
                setResults(r.items.filter((b) => b.active));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Título, autor, ISBN ou SKU
              <input name="q" autoFocus />
            </label>
            <button className="primary">Buscar livro</button>
          </form>
          <p>Selecione um livro e altere a quantidade na tabela da entrada.</p>
          {results.map((b) => (
            <button
              className="manual-book secondary"
              key={b.id}
              onClick={() => {
                add(b);
                setManual(false);
              }}
            >
              {b.description} — {b.author ?? b.code}
            </button>
          ))}
          {results.length === 0 && <p>Pesquise para selecionar um livro.</p>}
        </Modal>
      )}
      {review && (
        <Modal
          title="Resumo da entrada"
          onClose={() => {
            if (!busy) setReview(false);
          }}
        >
          <p>
            <strong>Filial:</strong>{" "}
            {options.warehouses.find((w) => w.id === warehouse)?.branch.name}
          </p>
          <p>
            <strong>Depósito:</strong>{" "}
            {options.warehouses.find((w) => w.id === warehouse)?.name}
          </p>
          <p>
            <strong>Fornecedor:</strong>{" "}
            {options.suppliers.find((s) => s.id === supplier)?.name}
          </p>
          <p>
            {rows.length} títulos · {quantity} exemplares
          </p>
          <h3>{money(total)}</h3>
          <ErrorMessage message={error} />
          <div className="form-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Revisar
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? "Confirmando…" : "Confirmar"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function History({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [network, setNetwork] = useState<{
      branches: Array<{ id: string; name: string; quantity: string }>;
      total: string;
      scope: string;
    } | null>(null),
    [history, setHistory] = useState<Page<Movement> | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    api<typeof network>("/stock/books/" + row.productId)
      .then(setNetwork)
      .catch((e) => setError(e.message));
  }, [row.productId]);
  useEffect(() => {
    api<Page<Movement>>(
      "/stock/movements?productId=" + row.productId + "&page=" + page,
    )
      .then(setHistory)
      .catch((e) => setError(e.message));
  }, [row.productId, page]);
  return (
    <Modal title={row.description + " — rede e histórico"} onClose={onClose}>
      <ErrorMessage message={error} />
      <div className="stock-network">
        {network?.branches.map((b) => (
          <div className="panel" key={b.id}>
            <small>{b.name}</small>
            <strong>{b.quantity}</strong>
          </div>
        ))}
        <div className="panel">
          <small>Total autorizado</small>
          <strong>{network?.total ?? "—"}</strong>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Data",
                "Tipo / Origem",
                "Filial",
                "Qtd.",
                "Anterior",
                "Posterior",
                "Usuário",
              ].map((s) => (
                <th key={s}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history?.items.map((m) => (
              <tr key={m.id}>
                <td>{dateTime(m.createdAt)}</td>
                <td>
                  {m.sale
                    ? m.type === "OUT"
                      ? "SAÍDA POR VENDA"
                      : "CANCELAMENTO DE VENDA"
                    : m.document?.kind === "ENTRY"
                      ? "ENTRADA_COMPRA"
                      : m.type}
                  <small>
                    {m.sale
                      ? "Venda #" + m.sale.number
                      : m.document
                        ? "Documento " +
                          (m.document.documentNumber || m.document.id)
                        : "Legado sem documento"}
                  </small>
                  <small>{m.reason}</small>
                </td>
                <td>
                  {m.warehouse.branch.name}
                  <small>{m.warehouse.name}</small>
                </td>
                <td>
                  {Number(m.quantity) > 0 ? "+" : ""}
                  {m.quantity}
                </td>
                <td>{m.beforeQuantity ?? "—"}</td>
                <td>{m.afterQuantity ?? "—"}</td>
                <td>{m.actor.user.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history && <Pagination {...history} onChange={setPage} />}
    </Modal>
  );
}
function Adjustment({
  row,
  onClose,
  onDone,
}: {
  row: StockRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    key = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("/stock/adjustments", {
        method: "POST",
        body: JSON.stringify({
          requestKey: key.current,
          warehouseId: row.warehouseId,
          productId: row.productId,
          expectedQuantity: row.quantity,
          quantity: Number(form.get("quantity")),
          reason: form.get("reason"),
        }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Ajustar contagem física"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {row.description} · {row.branchName} · {row.warehouseName}
      </p>
      <p>
        Saldo atual: <strong>{row.quantity}</strong>. A diferença será
        registrada com seu usuário.
      </p>
      <form
        onSubmit={(e) => void submit(e)}
        onChange={() => {
          key.current = crypto.randomUUID();
        }}
      >
        <label>
          Contagem física
          <input
            name="quantity"
            type="number"
            min="0"
            max="1000000"
            step="1"
            required
            defaultValue={row.quantity}
            disabled={busy}
          />
        </label>
        <label>
          Motivo
          <textarea
            name="reason"
            minLength={8}
            maxLength={2000}
            required
            disabled={busy}
          />
        </label>
        <ErrorMessage message={error} />
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Confirmar ajuste"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
