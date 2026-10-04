import { useEffect, useRef, useState, type FormEvent } from "react";
import { addScanned, transferNames } from "@caramelo/contracts";
import { api, dateTime, type Auth } from "../api";
import { Modal, ErrorMessage, Pagination } from "../components";
import { useBarcodeReader } from "../useBarcodeReader";
type Book = {
  id: string;
  description: string;
  code: string;
  isbn13: string | null;
  active?: boolean;
};
type Line = {
  productId: string;
  title: string;
  isbn13?: string | null;
  quantity: number;
};
type Warehouse = {
  id: string;
  name: string;
  branchId: string;
  branch: { name: string };
};
type Options = {
  company: string;
  branchId: string | null;
  warehouses: Warehouse[];
  responsibles: {
    id: string;
    branchId: string | null;
    user: { name: string };
  }[];
};
type Transfer = {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  notes: string;
  responsibleId: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  transitWarehouseId: string;
  origin: Warehouse;
  destination: Warehouse;
  responsible: { user: { name: string } };
  items: {
    id: string;
    productId: string;
    quantity: number;
    received: number;
    returned: number;
    product: Book;
  }[];
};
type Detail = Transfer & {
  transitBalances: { productId: string; quantity: string }[];
  history: { id: string; action: string; createdAt: string }[];
  documents: {
    id: string;
    kind: string;
    createdAt: string;
    notes: string;
    actor: { user: { name: string } };
    items: { title: string; quantity: string }[];
    movements: {
      id: string;
      warehouseId: string;
      quantity: string;
      transferGroup: string;
    }[];
    divergences: {
      id: string;
      code: string;
      kind: string;
      expected: number;
      observed: number;
      reason: string;
    }[];
  }[];
};
type Action =
  | "create"
  | "edit"
  | "prepare"
  | "send"
  | "receive"
  | "return"
  | "cancel"
  | "divergence";
const actionNames: Record<Action, string> = {
  create: "Nova transferência",
  edit: "Editar transferência",
  prepare: "Preparar transferência",
  send: "Enviar transferência",
  receive: "Receber transferência",
  return: "Retornar à origem",
  cancel: "Cancelar transferência",
  divergence: "Registrar divergência",
};
export function TransfersPage({ auth }: { auth: Auth }) {
  const [options, setOptions] = useState<Options>(),
    [rows, setRows] = useState<Transfer[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Detail>(),
    [action, setAction] = useState<Action>(),
    [indicators, setIndicators] = useState<
      { status: string; _count: number }[]
    >([]),
    [divergent, setDivergent] = useState(0);
  const [filters, setFilters] = useState({
    q: "",
    originId: "",
    destinationId: "",
    responsibleId: "",
    book: "",
    from: "",
    to: "",
    status: "",
  });
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  );
  query.set("page", String(page));
  const search = query.toString();
  useEffect(() => {
    let active = true;
    api<Options>("/transfers/options")
      .then((v) => {
        if (active) setOptions(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    api<{
      items: Transfer[];
      total: number;
      groups: { status: string; _count: number }[];
      divergent: number;
    }>("/transfers?" + search)
      .then((v) => {
        if (active) {
          setRows(v.items);
          setTotal(v.total);
          setIndicators(v.groups);
          setDivergent(v.divergent);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [search, refresh]);
  const can = (p: string) => auth.permissions.includes("transfers:" + p);
  const side = (dest = false) =>
    !options?.branchId ||
    options.branchId ===
      (dest ? detail?.destination.branchId : detail?.origin.branchId);
  async function open(id: string) {
    try {
      setDetail(await api<Detail>("/transfers/" + id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (action) return;
      if (e.key === "F2" && can("create")) {
        e.preventDefault();
        setAction("create");
      }
      if (
        e.key === "F8" &&
        detail &&
        side(true) &&
        can("receive") &&
        ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(detail.status)
      ) {
        e.preventDefault();
        setAction("receive");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <p>Estoque / Transferências · {options?.company}</p>
          <h1>Transferências entre filiais</h1>
        </div>
        {can("create") && (
          <button className="primary" onClick={() => setAction("create")}>
            Nova transferência
          </button>
        )}
      </div>
      <ErrorMessage message={error} />
      <div className="transfer-indicators">
        {[
          ["Em preparação", ["DRAFT", "READY"]],
          ["Em trânsito", ["IN_TRANSIT"]],
          ["Parcialmente recebidas", ["PARTIALLY_RECEIVED"]],
          ["Concluídas", ["RECEIVED", "CLOSED_RETURNED"]],
        ].map(([label, statuses]) => (
          <article key={String(label)}>
            <span>{label}</span>
            <strong>
              {indicators
                .filter((i) => (statuses as string[]).includes(i.status))
                .reduce((n, i) => n + i._count, 0)}
            </strong>
          </article>
        ))}
        <article>
          <span>Com divergência</span>
          <strong>{divergent}</strong>
        </article>
      </div>
      <div className="payable-filters">
        {(
          [
            ["q", "Número"],
            ["book", "Livro / ISBN"],
            ["from", "Data inicial"],
            ["to", "Data final"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              type={key === "from" || key === "to" ? "date" : "text"}
              value={filters[key]}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, [key]: e.target.value }));
              }}
            />
          </label>
        ))}
        {(["originId", "destinationId"] as const).map((key) => (
          <label key={key}>
            {key === "originId" ? "Origem" : "Destino"}
            <select
              aria-label={
                key === "originId" ? "Filtrar origem" : "Filtrar destino"
              }
              value={filters[key]}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, [key]: e.target.value }));
              }}
            >
              <option value="">Todas</option>
              {options?.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.branch.name} · {w.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Status
          <select
            aria-label="Status da transferência"
            value={filters.status}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, status: e.target.value }));
            }}
          >
            <option value="">Todos</option>
            {Object.entries(transferNames).map(([v, name]) => (
              <option key={v} value={v}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsável
          <select
            aria-label="Filtrar responsável"
            value={filters.responsibleId}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, responsibleId: e.target.value }));
            }}
          >
            <option value="">Todos</option>
            {options?.responsibles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.user.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Número",
                "Origem",
                "Destino",
                "Data",
                "Responsável",
                "Status",
                "Itens / Unidades",
                "Ações",
              ].map((v) => (
                <th key={v}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>{t.code}</td>
                <td>{t.origin.branch.name}</td>
                <td>{t.destination.branch.name}</td>
                <td>{dateTime(t.createdAt)}</td>
                <td>{t.responsible.user.name}</td>
                <td>{transferNames[t.status]}</td>
                <td>
                  {t.items.length} /{" "}
                  {t.items.reduce((n, i) => n + i.quantity, 0)}
                </td>
                <td>
                  <button className="secondary" onClick={() => void open(t.id)}>
                    Ver transferência
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={total} limit={25} onChange={setPage} />
      {detail && !action && (
        <Modal title={detail.code} onClose={() => setDetail(undefined)}>
          <h3>{transferNames[detail.status]}</h3>
          <p>
            {detail.origin.branch.name} / {detail.origin.name} →{" "}
            {detail.destination.branch.name} / {detail.destination.name}
          </p>
          <p>
            Responsável: {detail.responsible.user.name}. {detail.notes}
          </p>
          <div className="finance-tabs">
            {detail.status === "DRAFT" && side() && can("create") && (
              <button className="secondary" onClick={() => setAction("edit")}>
                Editar transferência
              </button>
            )}
            {detail.status === "DRAFT" && side() && can("send") && (
              <button className="primary" onClick={() => setAction("prepare")}>
                Preparar transferência
              </button>
            )}
            {detail.status === "READY" && side() && can("send") && (
              <button className="primary" onClick={() => setAction("send")}>
                Enviar transferência
              </button>
            )}
            {["DRAFT", "READY"].includes(detail.status) &&
              side() &&
              can("cancel") && (
                <button
                  className="secondary"
                  onClick={() => setAction("cancel")}
                >
                  Cancelar transferência
                </button>
              )}
            {["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(detail.status) && (
              <>
                {side(true) && can("receive") && (
                  <>
                    <button
                      className="primary"
                      onClick={() => setAction("receive")}
                    >
                      Receber transferência
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setAction("divergence")}
                    >
                      Registrar divergência
                    </button>
                  </>
                )}
                {side() && can("return") && (
                  <button
                    className="secondary"
                    onClick={() => setAction("return")}
                  >
                    Retornar à origem
                  </button>
                )}
              </>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Livro</th>
                  <th>Planejado / enviado</th>
                  <th>Recebido</th>
                  <th>Retornado</th>
                  <th>Em trânsito</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product.description}</td>
                    <td>{i.quantity}</td>
                    <td>{i.received}</td>
                    <td>{i.returned}</td>
                    <td>
                      {detail.transitBalances.find(
                        (b) => b.productId === i.productId,
                      )?.quantity ?? "0"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Histórico e documentos</h3>
          {detail.documents.map((d) => (
            <article key={d.id} className="transfer-document">
              <strong>
                {d.kind.replace("TRANSFER_", "")} · {dateTime(d.createdAt)} ·{" "}
                {d.actor.user.name}
              </strong>
              <p>{d.notes}</p>
              {d.items.map((i, n) => (
                <p key={n}>
                  {i.title}: {i.quantity}
                </p>
              ))}
              <p>
                {d.movements.length} movimentos vinculados · Documento {d.id}
              </p>
              {d.divergences.map((v) => (
                <p key={v.id}>
                  Divergência {v.kind} · {v.code} · esperado {v.expected},
                  observado {v.observed}, diferença {v.observed - v.expected}:{" "}
                  {v.reason}
                </p>
              ))}
            </article>
          ))}
          <h3>Auditoria</h3>
          {detail.history.map((h) => (
            <p key={h.id}>
              {dateTime(h.createdAt)} · {h.action}
            </p>
          ))}
        </Modal>
      )}
      {action && options && (
        <TransferForm
          action={action}
          options={options}
          detail={action === "create" ? undefined : detail}
          close={() => setAction(undefined)}
          saved={async (id) => {
            setAction(undefined);
            setRefresh((n) => n + 1);
            await open(id);
          }}
        />
      )}
    </section>
  );
}
function TransferForm({
  action,
  options,
  detail,
  close,
  saved,
}: {
  action: Action;
  options: Options;
  detail?: Detail;
  close: () => void;
  saved: (id: string) => Promise<void>;
}) {
  const editing = action === "create" || action === "edit",
    moving = action === "receive" || action === "return";
  const [origin, setOrigin] = useState(
      detail?.originWarehouseId ??
        options.warehouses.find(
          (w) => !options.branchId || w.branchId === options.branchId,
        )?.id ??
        "",
    ),
    [destination, setDestination] = useState(
      detail?.destinationWarehouseId ?? "",
    ),
    [responsible, setResponsible] = useState(detail?.responsibleId ?? ""),
    [notes, setNotes] = useState(editing ? (detail?.notes ?? "") : ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [books, setBooks] = useState<Book[]>([]),
    [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>(
    editing
      ? (detail?.items.map((i) => ({
          productId: i.productId,
          title: i.product.description,
          isbn13: i.product.isbn13,
          quantity: i.quantity,
        })) ?? [])
      : (detail?.items
          .filter((i) => i.quantity - i.received - i.returned > 0)
          .map((i) => ({
            productId: i.productId,
            title: i.product.description,
            isbn13: i.product.isbn13,
            quantity: 0,
          })) ?? []),
  );
  const key = useRef(crypto.randomUUID()),
    form = useRef<HTMLFormElement>(null);
  function add(b: Book) {
    if (editing && b.active === false) throw Error("Livro inativo.");
    if (
      moving &&
      !detail?.items.some(
        (i) => i.productId === b.id && i.quantity - i.received - i.returned > 0,
      )
    )
      throw Error(
        "ISBN inesperado ou sem saldo pendente. Registre uma divergência.",
      );
    setLines((current) => {
      const added = addScanned(
        current.map((i) => ({
          book: { id: i.productId, description: i.title, isbn13: i.isbn13 },
          quantity: i.quantity,
          unitCost: "0",
        })),
        b,
        "0",
      );
      return added.map((i) => ({
        productId: i.book.id,
        title: i.book.description,
        isbn13: i.book.isbn13,
        quantity: i.quantity,
      }));
    });
  }
  const reader = useBarcodeReader(
    (editing || moving) && !busy,
    async (code) => {
      const result = await api<Book[]>(
        "/transfers/books?code=" + encodeURIComponent(code),
      );
      if (!result[0])
        throw Error(
          "ISBN não encontrado; registre divergência se recebido fisicamente.",
        );
      add(result[0]);
    },
    (e) => setError(e.message),
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F4") {
        e.preventDefault();
        reader.input.current?.focus();
      }
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        if (!reader.pending && !busy) form.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reader.input, reader.pending, busy]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || reader.pending) return;
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const body = editing
        ? {
            requestKey: key.current,
            originWarehouseId: origin,
            destinationWarehouseId: destination,
            responsibleId: responsible,
            notes,
            items: lines.map(({ productId, quantity }) => ({
              productId,
              quantity,
            })),
          }
        : {
            requestKey: key.current,
            notes,
            ...(moving
              ? {
                  items: lines
                    .filter((l) => l.quantity > 0)
                    .map(({ productId, quantity }) => ({
                      productId,
                      quantity,
                    })),
                }
              : {}),
            ...(action === "divergence"
              ? {
                  divergence: {
                    code: fields.code,
                    kind: fields.kind,
                    expected: Number(fields.expected),
                    observed: Number(fields.observed),
                    reason: fields.reason,
                  },
                }
              : {}),
          };
      const result = await api<{ transferId: string }>(
        action === "create"
          ? "/transfers"
          : `/transfers/${detail!.id}/${action}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      await saved(result.transferId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const originBranch = options.warehouses.find(
    (w) => w.id === origin,
  )?.branchId;
  return (
    <Modal
      title={actionNames[action]}
      onClose={() => {
        if (!busy && !reader.pending) close();
      }}
    >
      <ErrorMessage message={error} />
      {(editing || moving) && (
        <>
          <form onSubmit={reader.scan}>
            <label>
              Leitor ISBN / EAN / SKU
              <input
                ref={reader.input}
                aria-label="Leitor de transferência"
                autoComplete="off"
                placeholder="Código + Enter"
                disabled={busy}
              />
            </label>
            <button className="secondary" disabled={busy}>
              Adicionar leitura
            </button>
            <span role="status">
              {reader.pending ? `Processando ${reader.pending} leituras` : ""}
            </span>
          </form>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setBooks(
                  await api<Book[]>(
                    "/transfers/books?q=" + encodeURIComponent(search),
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Buscar livro
              <input
                aria-label="Buscar livro para transferência"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button className="secondary">Buscar livros</button>
          </form>
          {books.map((b) => (
            <button
              key={b.id}
              className="secondary"
              onClick={() => {
                try {
                  add(b);
                  setBooks([]);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {b.description} · {b.isbn13 ?? b.code}
            </button>
          ))}
        </>
      )}
      <form ref={form} onSubmit={submit}>
        {editing && (
          <div className="form-grid">
            <label>
              Origem
              <select
                aria-label="Depósito de origem"
                value={origin}
                disabled={!!detail}
                onChange={(e) => {
                  setOrigin(e.target.value);
                  setDestination("");
                  setResponsible("");
                }}
                required
              >
                <option value="">Selecione</option>
                {options.warehouses
                  .filter(
                    (w) => !options.branchId || w.branchId === options.branchId,
                  )
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.branch.name} · {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Destino
              <select
                aria-label="Depósito de destino"
                value={destination}
                disabled={!!detail}
                onChange={(e) => setDestination(e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {options.warehouses
                  .filter((w) => w.branchId !== originBranch)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.branch.name} · {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Responsável
              <select
                aria-label="Responsável pela transferência"
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {options.responsibles
                  .filter((r) => !r.branchId || r.branchId === originBranch)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.user.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
        {(editing || moving) && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Livro</th>
                  {moving && (
                    <>
                      <th>Enviado</th>
                      <th>Recebido antes</th>
                      <th>Pendente</th>
                    </>
                  )}
                  <th>{moving ? "Conferido agora" : "Quantidade"}</th>
                  {editing && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const i = detail?.items.find(
                      (i) => i.productId === l.productId,
                    ),
                    pending =
                      !editing && i
                        ? i.quantity - i.received - i.returned
                        : 1000000;
                  return (
                    <tr key={l.productId}>
                      <td>
                        {l.title} · {l.isbn13}
                      </td>
                      {moving && (
                        <>
                          <td>{i?.quantity}</td>
                          <td>{i?.received}</td>
                          <td>{pending}</td>
                        </>
                      )}
                      <td>
                        <input
                          aria-label={"Quantidade " + l.title}
                          type="number"
                          min={editing ? 1 : 0}
                          max={pending}
                          step={1}
                          value={l.quantity}
                          onChange={(e) =>
                            setLines((rows) =>
                              rows.map((r) =>
                                r.productId === l.productId
                                  ? { ...r, quantity: Number(e.target.value) }
                                  : r,
                              ),
                            )
                          }
                        />
                      </td>
                      {editing && (
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              setLines((rows) =>
                                rows.filter((r) => r.productId !== l.productId),
                              )
                            }
                          >
                            Remover
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {action === "divergence" && (
          <div className="form-grid">
            <label>
              ISBN / código inesperado
              <input name="code" required maxLength={160} />
            </label>
            <label>
              Tipo
              <select name="kind">
                <option value="MISSING">Faltante</option>
                <option value="DAMAGED">Danificado</option>
                <option value="WRONG">Produto diferente</option>
                <option value="EXCESS">Excedente</option>
                <option value="UNEXPECTED">ISBN inesperado</option>
              </select>
            </label>
            <label>
              Esperado
              <input name="expected" type="number" min={0} step={1} required />
            </label>
            <label>
              Observado
              <input name="observed" type="number" min={0} step={1} required />
            </label>
            <label>
              Motivo
              <input name="reason" required minLength={8} maxLength={1000} />
            </label>
            <p>
              Registro sem entrada de estoque. Excedentes exigem regularização e
              novo envio autorizado.
            </p>
          </div>
        )}
        <label>
          {moving || action === "cancel" ? "Justificativa" : "Observações"}
          <textarea
            aria-label="Observações da operação"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            required={action === "return" || action === "cancel"}
            minLength={
              action === "return" || action === "cancel" ? 8 : undefined
            }
          />
        </label>
        {action === "send" && (
          <p>
            O envio retira saldo da origem e coloca em trânsito. O destino só
            terá disponibilidade após conferência.
          </p>
        )}
        {action === "receive" && (
          <p>
            Informe apenas o conferido agora. Recebimento parcial exige
            justificativa; o restante fica em trânsito.
          </p>
        )}
        {action === "return" && (
          <p>
            Confirme somente unidades ainda em trânsito que chegaram fisicamente
            à origem.
          </p>
        )}
        <button className="primary" disabled={busy || reader.pending > 0}>
          {busy ? "Confirmando…" : "Confirmar operação"}
        </button>
      </form>
    </Modal>
  );
}
