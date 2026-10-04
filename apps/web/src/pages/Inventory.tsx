import { useEffect, useRef, useState, type FormEvent } from "react";
import { inventoryNames } from "@caramelo/contracts";
import { api, money, dateTime, type Auth } from "../api";
import { ErrorMessage, Modal, Pagination } from "../components";
import { useBarcodeReader } from "../useBarcodeReader";
type Book = {
  id: string;
  description: string;
  code: string;
  isbn13: string | null;
};
type Options = {
  warehouses: Array<{
    id: string;
    name: string;
    branchId: string;
    branch: { name: string };
  }>;
  responsibles: Array<{
    id: string;
    branchId: string | null;
    user: { name: string };
  }>;
};
type Count = {
  round: number;
  quantity: number;
  source: string;
  updatedAt: string;
  acceptedAt?: string | null;
  actor: { user: { name: string } };
};
type Item = {
  id: string;
  productId: string;
  title: string;
  isbn: string | null;
  sku: string;
  systemQuantity?: string;
  referenceQuantity?: string | null;
  unitCost?: string;
  difference?: string | null;
  adjustment?: string | null;
  reason?: string | null;
  justification?: string | null;
  countedQuantity: number | null;
  accepted: boolean;
  currentRound: number;
  counts: Count[];
};
type Inventory = {
  id: string;
  code: string;
  description: string;
  warehouseId: string;
  branchId: string;
  responsibleId: string;
  scope: string;
  selectedIds: string[];
  blind: boolean;
  blindRecount: boolean;
  scheduledAt: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  closedAt: string | null;
  warehouse: { name: string };
  branch: { name: string };
  responsible: { user: { name: string } };
  approver?: { user: { name: string } } | null;
  items: Item[];
  history: Array<{ id: string; action: string; createdAt: string }>;
  documents: Array<{
    id: string;
    movements: Array<{
      id: string;
      productId: string;
      quantity: string;
      reason: string;
    }>;
  }>;
};
type List = {
  items: Array<Inventory & { _count: { items: number } }>;
  total: number;
  page: number;
  divergent: number | null;
  groups: Array<{ status: string; _count: number }>;
};
const reasonNames: Record<string, string> = {
  LOSS: "Perda",
  DAMAGED: "Avaria",
  THEFT: "Furto/extravio",
  OPERATIONAL: "Erro operacional",
  UNREGISTERED_IN: "Entrada não registrada",
  UNREGISTERED_OUT: "Saída não registrada",
  COUNT_ERROR: "Erro de contagem",
  LOCATION: "Localização incorreta",
  OTHER: "Outro",
};
export function InventoryPage({ auth }: { auth: Auth }) {
  const [options, setOptions] = useState<Options>({
      warehouses: [],
      responsibles: [],
    }),
    [data, setData] = useState<List | null>(null),
    [detail, setDetail] = useState<Inventory | null>(null),
    [editor, setEditor] = useState<"new" | "edit" | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [filter, setFilter] = useState({
      q: "",
      branchId: "",
      warehouseId: "",
      responsibleId: "",
      status: "",
      from: "",
      to: "",
      page: 1,
    });
  const [itemFilter, setItemFilter] = useState("ALL"),
    [search, setSearch] = useState(""),
    [books, setBooks] = useState<Book[]>([]),
    [last, setLast] = useState(""),
    [action, setAction] = useState<{
      kind: string;
      productId?: string;
      title: string;
    } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const can = (p: string) => auth.permissions.includes("inventory:" + p);
  useEffect(() => {
    let active = true;
    api<Options>("/inventory/options")
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
    const q = new URLSearchParams(
      Object.entries(filter)
        .filter(([, v]) => v !== "")
        .map(([k, v]) => [k, String(v)]),
    );
    api<List>("/inventory?" + q)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [filter, version]);
  async function open(id: string) {
    setError("");
    try {
      setDetail(await api<Inventory>("/inventory/" + id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function command(kind: string, extra: object = {}) {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api("/inventory/" + detail.id + "/" + kind, {
        method: "POST",
        body: JSON.stringify({ requestKey: crypto.randomUUID(), ...extra }),
      });
      await open(detail.id);
      setVersion((v) => v + 1);
      setAction(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const counting =
    !!detail &&
    ["COUNTING", "RECOUNT_REQUIRED"].includes(detail.status) &&
    can("count");
  const reader = useBarcodeReader(
    counting,
    async (code) => {
      if (!detail) return;
      await api("/inventory/" + detail.id + "/count", {
        method: "POST",
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          code,
          quantity: 1,
          mode: "ADD",
          source: "SCANNER",
        }),
      });
      await open(detail.id);
      setLast(code);
    },
    (e) => setError(e.message),
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey) return;
      if (e.key === "F2" && !detail && can("create")) {
        e.preventDefault();
        setEditor("new");
      }
      if (e.key === "F4") {
        e.preventDefault();
        (counting ? reader.input : searchRef).current?.focus();
      }
      if (e.key === "F8" && detail && can("review")) {
        e.preventDefault();
        setItemFilter("DIFFERENT");
      }
      if (
        e.ctrlKey &&
        e.key === "Enter" &&
        counting &&
        !busy &&
        !reader.pending &&
        !editor &&
        !action
      ) {
        e.preventDefault();
        void command("complete");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function find(e: FormEvent) {
    e.preventDefault();
    try {
      setBooks(
        await api<Book[]>("/inventory/books?q=" + encodeURIComponent(search)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const rows =
    detail?.items.filter(
      (i) =>
        itemFilter === "ALL" ||
        (itemFilter === "PENDING" && i.countedQuantity === null) ||
        (itemFilter === "RECOUNT" && i.currentRound > 1 && !i.accepted) ||
        (itemFilter === "ACCEPTED" && i.accepted) ||
        (itemFilter === "DIFFERENT" &&
          i.difference != null &&
          Number(i.difference) !== 0) ||
        (itemFilter === "SHORT" && Number(i.difference) < 0) ||
        (itemFilter === "SURPLUS" && Number(i.difference) > 0) ||
        (itemFilter === "UNJUSTIFIED" &&
          i.difference != null &&
          Number(i.difference) !== 0 &&
          !i.reason),
    ) ?? [];
  const counted =
    detail?.items.filter((i) => i.countedQuantity !== null).length ?? 0;
  return (
    <div className="inventory-page">
      <div className="page-heading">
        <div>
          <h1>Inventários</h1>
          <p>Contagem física, revisão e ajustes auditáveis por depósito.</p>
        </div>
        {can("create") && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => setEditor("new")}
          >
            Novo inventário
          </button>
        )}
      </div>
      <ErrorMessage message={error} />
      {!detail ? (
        <>
          <div className="inventory-metrics">
            {[
              ["Em andamento", ["COUNTING", "RECOUNT_REQUIRED"]],
              ["Aguardando revisão", ["UNDER_REVIEW", "APPROVED"]],
              ["Finalizados", ["CLOSED"]],
            ].map(([name, status]) => (
              <div className="card" key={String(name)}>
                <span>{name}</span>
                <strong>
                  {data?.groups
                    .filter((g) => (status as string[]).includes(g.status))
                    .reduce((n, g) => n + g._count, 0) ?? 0}
                </strong>
              </div>
            ))}
            {can("review") && (
              <div className="card">
                <span>Com divergência</span>
                <strong>{data?.divergent ?? 0}</strong>
              </div>
            )}
          </div>
          <div className="inventory-filters">
            <label>
              Número
              <input
                ref={searchRef}
                value={filter.q}
                onChange={(e) =>
                  setFilter({ ...filter, q: e.target.value, page: 1 })
                }
              />
            </label>
            <label>
              Filial
              <select
                value={filter.branchId}
                onChange={(e) =>
                  setFilter({ ...filter, branchId: e.target.value, page: 1 })
                }
              >
                <option value="">Todas autorizadas</option>
                {Array.from(
                  new Map(
                    options.warehouses.map((w) => [w.branchId, w.branch.name]),
                  ),
                ).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Depósito
              <select
                value={filter.warehouseId}
                onChange={(e) =>
                  setFilter({ ...filter, warehouseId: e.target.value, page: 1 })
                }
              >
                <option value="">Todos</option>
                {options.warehouses.map((w) => (
                  <option value={w.id} key={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={filter.status}
                onChange={(e) =>
                  setFilter({ ...filter, status: e.target.value, page: 1 })
                }
              >
                <option value="">Todos</option>
                {Object.entries(inventoryNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Responsável
              <select
                value={filter.responsibleId}
                onChange={(e) =>
                  setFilter({
                    ...filter,
                    responsibleId: e.target.value,
                    page: 1,
                  })
                }
              >
                <option value="">Todos</option>
                {options.responsibles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              De
              <input
                type="date"
                value={filter.from}
                onChange={(e) =>
                  setFilter({ ...filter, from: e.target.value, page: 1 })
                }
              />
            </label>
            <label>
              Até
              <input
                type="date"
                value={filter.to}
                onChange={(e) =>
                  setFilter({ ...filter, to: e.target.value, page: 1 })
                }
              />
            </label>
          </div>
          <div className="inventory-table">
            <table>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Filial / depósito</th>
                  <th>Responsável</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th>Títulos</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((v) => (
                  <tr key={v.id}>
                    <td>{v.code}</td>
                    <td>
                      {v.branch.name} / {v.warehouse.name}
                    </td>
                    <td>{v.responsible.user.name}</td>
                    <td>{dateTime(v.createdAt)}</td>
                    <td>{inventoryNames[v.status]}</td>
                    <td>{v._count.items}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => void open(v.id)}
                      >
                        Abrir {v.code}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={filter.page}
            total={data?.total ?? 0}
            limit={25}
            onChange={(page) => setFilter({ ...filter, page })}
          />
        </>
      ) : (
        <>
          <div className="card">
            <h2>
              {detail.code} — {inventoryNames[detail.status]}
            </h2>
            <p>
              {detail.description} · {detail.branch.name} /{" "}
              {detail.warehouse.name} · {detail.responsible.user.name}
            </p>
            <p>
              Contados: {counted} / {detail.items.length} títulos · Pendentes:{" "}
              {detail.items.length - counted} · Progresso:{" "}
              {detail.items.length
                ? Math.round((100 * counted) / detail.items.length)
                : 0}
              % · Unidades contadas:{" "}
              {detail.items.reduce((n, i) => n + (i.countedQuantity ?? 0), 0)}
            </p>
            <div className="inventory-actions">
              <button
                className="secondary"
                onClick={() => {
                  setDetail(null);
                  setBooks([]);
                  setItemFilter("ALL");
                }}
              >
                Voltar à lista
              </button>
              {detail.status === "DRAFT" && can("create") && (
                <button className="secondary" onClick={() => setEditor("edit")}>
                  Editar rascunho
                </button>
              )}
              {detail.status === "DRAFT" && can("count") && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void command("start")}
                >
                  Iniciar contagem
                </button>
              )}
              {counting && (
                <button
                  className="primary"
                  disabled={busy || reader.pending > 0}
                  onClick={() => void command("complete")}
                >
                  Concluir contagem
                </button>
              )}
              {detail.status === "UNDER_REVIEW" && can("approve") && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void command("approve")}
                >
                  Aprovar inventário
                </button>
              )}
              {detail.status === "APPROVED" && can("close") && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    setAction({ kind: "close", title: "Confirmar fechamento" })
                  }
                >
                  Fechar inventário
                </button>
              )}
              {!["CLOSED", "CANCELLED"].includes(detail.status) &&
                can("cancel") && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      setAction({
                        kind: "cancel",
                        title: "Cancelar inventário",
                      })
                    }
                  >
                    Cancelar inventário
                  </button>
                )}
            </div>
          </div>
          {counting && (
            <div className="card">
              <form onSubmit={reader.scan}>
                <label>
                  Leia ou digite ISBN/EAN/SKU
                  <input
                    className="inventory-reader"
                    ref={reader.input}
                    aria-label="Leitor de inventário"
                    autoComplete="off"
                  />
                </label>
                <button className="secondary" type="submit">
                  Ler código
                </button>
              </form>
              <p aria-live="polite">
                {reader.pending
                  ? "Processando leituras…"
                  : "Última leitura: " + (last || "nenhuma")}
              </p>
              <form onSubmit={find}>
                <label>
                  Buscar livro
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <button className="secondary">Pesquisar livros</button>
              </form>
              {books.map((b) => (
                <button
                  key={b.id}
                  className="secondary"
                  disabled={busy || reader.pending > 0}
                  onClick={() =>
                    void command("count", {
                      productId: b.id,
                      quantity: 1,
                      mode: "ADD",
                    })
                  }
                >
                  Contar {b.description}
                </button>
              ))}
            </div>
          )}
          {detail.status !== "DRAFT" && (
            <>
              <label>
                Exibir itens
                <select
                  value={itemFilter}
                  onChange={(e) => setItemFilter(e.target.value)}
                >
                  {Object.entries({
                    ALL: "Todos",
                    PENDING: "Não contados",
                    RECOUNT: "Recontagem necessária",
                    ACCEPTED: "Rodadas aceitas",
                    ...(can("review")
                      ? {
                          DIFFERENT: "Somente divergentes",
                          SHORT: "Faltas",
                          SURPLUS: "Sobras",
                          UNJUSTIFIED: "Sem justificativa",
                        }
                      : {}),
                  }).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inventory-table">
                <table>
                  <thead>
                    <tr>
                      <th>Livro / ISBN / SKU</th>
                      {can("review") && (
                        <>
                          <th>Sistema inicial</th>
                          <th>Referência da rodada</th>
                        </>
                      )}
                      <th>Contado</th>
                      {can("review") && (
                        <>
                          <th>Diferença inicial</th>
                          <th>Ajuste</th>
                          <th>Custo do ajuste</th>
                        </>
                      )}
                      <th>Situação / rodada</th>
                      <th>Justificativa / ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => (
                      <tr key={i.id}>
                        <td>
                          {i.title}
                          <small>{i.isbn || i.sku}</small>
                        </td>
                        {can("review") && (
                          <>
                            <td>{i.systemQuantity}</td>
                            <td>{i.referenceQuantity ?? "—"}</td>
                          </>
                        )}
                        <td>
                          {counting && !i.accepted ? (
                            <CountEditor
                              key={
                                i.id +
                                ":" +
                                i.currentRound +
                                ":" +
                                i.countedQuantity
                              }
                              item={i}
                              disabled={busy || reader.pending > 0}
                              save={(quantity) =>
                                command("count", {
                                  productId: i.productId,
                                  quantity,
                                  mode: "SET",
                                })
                              }
                            />
                          ) : (
                            (i.countedQuantity ?? "Não contado")
                          )}
                        </td>
                        {can("review") && (
                          <>
                            <td>{i.difference ?? "—"}</td>
                            <td>{i.adjustment ?? "—"}</td>
                            <td>
                              {i.adjustment == null
                                ? "—"
                                : money(
                                    Number(i.adjustment) * Number(i.unitCost),
                                  )}
                            </td>
                          </>
                        )}
                        <td>
                          {i.countedQuantity === null
                            ? "Não contado"
                            : i.difference == null
                              ? "Contado"
                              : Number(i.difference) < 0
                                ? "Falta"
                                : Number(i.difference) > 0
                                  ? "Sobra"
                                  : "Correto"}{" "}
                          · {i.currentRound}
                          <small>{i.counts.at(-1)?.actor.user.name}</small>
                        </td>
                        <td>
                          {i.reason
                            ? reasonNames[i.reason] +
                              ": " +
                              (i.justification ?? "")
                            : "—"}
                          {counting && !i.accepted && (
                            <button
                              className="secondary"
                              disabled={busy || reader.pending > 0}
                              onClick={() =>
                                setAction({
                                  kind: "restart",
                                  productId: i.productId,
                                  title: "Reiniciar rodada: " + i.title,
                                })
                              }
                            >
                              Reiniciar rodada
                            </button>
                          )}
                          {["UNDER_REVIEW", "APPROVED"].includes(
                            detail.status,
                          ) &&
                            can("review") && (
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  setAction({
                                    kind: "recount",
                                    productId: i.productId,
                                    title: "Solicitar recontagem: " + i.title,
                                  })
                                }
                              >
                                Recontar {i.title}
                              </button>
                            )}
                          {detail.status === "UNDER_REVIEW" &&
                            can("review") && (
                              <button
                                className="secondary"
                                onClick={() =>
                                  setAction({
                                    kind: "justify",
                                    productId: i.productId,
                                    title: "Justificar: " + i.title,
                                  })
                                }
                              >
                                Justificar {i.title}
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {can("review") && detail.status !== "DRAFT" && (
            <div className="card">
              <h2>Relatório e histórico</h2>
              <a
                className="secondary"
                href={"/api/inventory/" + detail.id + "/export"}
              >
                Exportar CSV
              </a>
              <p>
                Início: {detail.startedAt ? dateTime(detail.startedAt) : "—"} ·
                Fim: {detail.closedAt ? dateTime(detail.closedAt) : "—"} ·
                Aprovador: {detail.approver?.user.name ?? "—"}
              </p>
              <p>
                Divergentes:{" "}
                {
                  detail.items.filter(
                    (i) => i.difference != null && Number(i.difference) !== 0,
                  ).length
                }{" "}
                · Faltas:{" "}
                {detail.items.reduce(
                  (n, i) => n + Math.max(0, -Number(i.difference)),
                  0,
                )}{" "}
                · Sobras:{" "}
                {detail.items.reduce(
                  (n, i) => n + Math.max(0, Number(i.difference)),
                  0,
                )}{" "}
                · Impacto estimado dos ajustes:{" "}
                {money(
                  detail.items.reduce(
                    (n, i) =>
                      n + Number(i.adjustment ?? 0) * Number(i.unitCost ?? 0),
                    0,
                  ),
                )}
              </p>
              {detail.items.map((i) => (
                <details key={i.id}>
                  <summary>Rodadas — {i.title}</summary>
                  {i.counts.map((c) => (
                    <p key={c.round}>
                      Rodada {c.round}: {c.quantity} · {c.actor.user.name} ·{" "}
                      {c.source} · {dateTime(c.updatedAt)}
                    </p>
                  ))}
                </details>
              ))}
              <h3>Movimentos gerados</h3>
              {detail.documents
                .flatMap((d) => d.movements)
                .map((m) => (
                  <p key={m.id}>
                    {m.quantity} · {m.reason}
                  </p>
                ))}
              <h3>Auditoria</h3>
              {detail.history.map((h) => (
                <p key={h.id}>
                  {h.action} · {dateTime(h.createdAt)}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {editor && (
        <InventoryEditor
          options={options}
          initial={editor === "edit" ? detail : null}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setEditor(null);
            setVersion((v) => v + 1);
            void open(id);
          }}
        />
      )}
      {action && (
        <Modal
          title={action.title}
          onClose={() => {
            if (!busy) setAction(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void command(action.kind, {
                notes: String(f.get("notes") ?? ""),
                ...(action.productId
                  ? {
                      productIds: [action.productId],
                      productId: action.productId,
                    }
                  : {}),
                ...(action.kind === "justify"
                  ? { reason: String(f.get("reason")) }
                  : {}),
              });
            }}
          >
            {action.kind === "close" && (
              <p>
                Os ajustes aprovados serão aplicados em uma única transação.
                Este inventário ficará imutável.
              </p>
            )}
            {action.kind === "justify" && (
              <label>
                Motivo
                <select name="reason" aria-label="Motivo">
                  {Object.entries(reasonNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Observação / motivo
              <textarea
                name="notes"
                required={action.kind !== "close"}
                minLength={
                  action.kind === "cancel" ? 8 : action.kind === "close" ? 0 : 3
                }
                maxLength={1000}
              />
            </label>
            <button className="primary" disabled={busy}>
              Confirmar operação
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function CountEditor({
  item,
  disabled,
  save,
}: {
  item: Item;
  disabled: boolean;
  save: (q: number) => Promise<void>;
}) {
  const [q, setQ] = useState(item.countedQuantity ?? 0);
  return (
    <div className="inventory-count">
      <input
        aria-label={"Quantidade " + item.title}
        type="number"
        min={0}
        max={1000000}
        step={1}
        value={q}
        onChange={(e) => setQ(Number(e.target.value))}
      />
      <button
        className="secondary"
        disabled={disabled || !Number.isInteger(q) || q < 0}
        onClick={() => void save(q)}
      >
        Salvar {item.title}
      </button>
      <button
        className="secondary"
        disabled={disabled}
        aria-label={"Mais um " + item.title}
        onClick={() => void save((item.countedQuantity ?? 0) + 1)}
      >
        +1
      </button>
      <button
        className="secondary"
        disabled={disabled || !item.countedQuantity}
        aria-label={"Menos um " + item.title}
        onClick={() => void save((item.countedQuantity ?? 0) - 1)}
      >
        −1
      </button>
      <button
        className="secondary"
        disabled={disabled}
        onClick={() => void save(0)}
      >
        Zerar {item.title}
      </button>
    </div>
  );
}
function InventoryEditor({
  options,
  initial,
  onClose,
  onSaved,
}: {
  options: Options;
  initial: Inventory | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? ""),
    [scope, setScope] = useState(initial?.scope ?? "FULL"),
    [selected, setSelected] = useState<Book[]>(
      initial?.selectedIds.map((id) => ({
        id,
        description: id,
        code: "",
        isbn13: null,
      })) ?? [],
    ),
    [q, setQ] = useState(""),
    [books, setBooks] = useState<Book[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const branch = options.warehouses.find((w) => w.id === warehouseId)?.branchId;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const v = await api<{ inventoryId: string }>(
        "/inventory" + (initial ? "/" + initial.id + "/edit" : ""),
        {
          method: "POST",
          body: JSON.stringify({
            requestKey: crypto.randomUUID(),
            warehouseId,
            scope,
            responsibleId: f.get("responsibleId"),
            description: f.get("description"),
            scheduledAt: f.get("scheduledAt"),
            blind: f.get("blind") === "on",
            blindRecount: f.get("blindRecount") === "on",
            productIds: scope === "PARTIAL" ? selected.map((b) => b.id) : [],
          }),
        },
      );
      onSaved(v.inventoryId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? "Editar inventário" : "Novo inventário"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ErrorMessage message={error} />
      <form onSubmit={save}>
        <label>
          Filial / depósito
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            required
            disabled={!!initial}
          >
            <option value="">Selecione</option>
            {options.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.branch.name} / {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Descrição
          <input
            name="description"
            defaultValue={initial?.description}
            required
            minLength={3}
            maxLength={200}
          />
        </label>
        <label>
          Responsável
          <select
            name="responsibleId"
            aria-label="Responsável"
            defaultValue={initial?.responsibleId}
            required
          >
            <option value="">Selecione</option>
            {options.responsibles
              .filter((r) => !r.branchId || r.branchId === branch)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.user.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Data prevista
          <input
            name="scheduledAt"
            type="date"
            defaultValue={
              initial?.scheduledAt.slice(0, 10) ??
              new Date().toISOString().slice(0, 10)
            }
            required
          />
        </label>
        <label>
          Tipo
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="FULL">Completo</option>
            <option value="PARTIAL">Parcial</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            name="blind"
            defaultChecked={initial?.blind ?? true}
          />{" "}
          Contagem cega
        </label>
        <label>
          <input
            type="checkbox"
            name="blindRecount"
            defaultChecked={initial?.blindRecount ?? true}
          />{" "}
          Recontagem cega
        </label>
        {scope === "PARTIAL" && (
          <>
            <label>
              Busca do escopo
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ISBN, SKU, título, autor, editora, categoria ou localização"
              />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void api<Book[]>("/inventory/books?q=" + encodeURIComponent(q))
                  .then(setBooks)
                  .catch((e) => setError(e.message));
              }}
            >
              Buscar escopo
            </button>
            {books.map((b) => (
              <button
                className="secondary"
                type="button"
                key={b.id}
                disabled={selected.some((s) => s.id === b.id)}
                onClick={() => setSelected((s) => [...s, b])}
              >
                Selecionar {b.description}
              </button>
            ))}
            {selected.map((b) => (
              <p key={b.id}>
                {b.description}{" "}
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setSelected((s) => s.filter((x) => x.id !== b.id))
                  }
                >
                  Remover
                </button>
              </p>
            ))}
          </>
        )}
        <button
          className="primary"
          disabled={busy || (scope === "PARTIAL" && !selected.length)}
        >
          Salvar rascunho
        </button>
      </form>
    </Modal>
  );
}
