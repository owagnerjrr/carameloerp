import { useEffect, useState, type FormEvent } from "react";
import { purchaseNames, divergenceNames } from "@caramelo/contracts";
import { api, money, dateTime, type Auth, type Page } from "../api";
import { Modal, ErrorMessage, Pagination } from "../components";
import { Suppliers } from "./Suppliers";
import { PurchaseEditor, type DraftLine } from "./PurchaseEditor";
import { PurchaseReceiving } from "./PurchaseReceiving";
import {
  usePurchaseRequest,
  purchaseActionNames,
  type Purchase,
  type Options,
} from "./PurchaseShared";
type List = Page<Purchase> & {
  counts: { status: string; _count: number }[];
  overdue: number;
};
type Suggestion = {
  id: string;
  description: string;
  isbn13: string | null;
  author: string | null;
  publisher: string | null;
  cost: string;
  quantity: string;
  minimum: string;
  suggested: number;
  supplierName: string | null;
};
type CostRow = {
  id: string;
  quantity: number;
  unitCost: string;
  allocatedCharges: string;
  total: string;
  receipt: {
    document: { receivedAt: string };
    order: {
      number: number;
      supplier: { name: string };
      branch: { name: string };
    };
  };
};
export function PurchasesPage({
  auth,
  initialId,
  onFinance,
}: {
  auth: Auth;
  initialId?: string;
  onFinance?: (id: string) => void;
}) {
  const [options, setOptions] = useState<Options>({
      branches: [],
      warehouses: [],
      suppliers: [],
      buyers: [],
    }),
    [tab, setTab] = useState("Pedidos"),
    [rows, setRows] = useState<List>({
      items: [],
      total: 0,
      page: 1,
      limit: 25,
      counts: [],
      overdue: 0,
    }),
    [filters, setFilters] = useState({
      q: "",
      branchId: "",
      supplierId: "",
      buyerId: "",
      status: "",
      from: "",
      to: "",
    }),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Purchase | null>(null),
    [editing, setEditing] = useState<{
      order?: Purchase;
      initial?: DraftLine[];
      branch?: string;
    } | null>(null),
    [receiving, setReceiving] = useState(false),
    [transition, setTransition] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [costs, setCosts] = useState<{
      productId: string;
      title: string;
      page: Page<CostRow>;
    } | null>(null);
  const can = (p: string) => auth.permissions.includes("purchases:" + p),
    send = usePurchaseRequest();
  async function loadOptions() {
    try {
      setOptions(await api<Options>("/purchases/options"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void loadOptions();
  }, []);
  useEffect(() => {
    let active = true;
    api<List>(`/purchases?${query}&page=${page}`)
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
  async function open(id: string) {
    setDetail(await api<Purchase>("/purchases/" + id));
    setError("");
  }
  useEffect(() => {
    if (initialId) void open(initialId).catch((e) => setError(e.message));
  }, [initialId]);
  async function reload(id: string) {
    await open(id);
    setEditing(null);
    setReceiving(false);
    setRevision((n) => n + 1);
  }
  function search(e?: FormEvent) {
    e?.preventDefault();
    setPage(1);
    setQuery(
      new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      ).toString(),
    );
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editing || receiving || transition || costs || tab === "Fornecedores")
        return;
      if (e.key === "F2" && can("create")) {
        e.preventDefault();
        setEditing({});
      }
      if (
        e.key === "F8" &&
        detail &&
        ["ORDERED", "PARTIALLY_RECEIVED"].includes(detail.status) &&
        can("receive")
      ) {
        e.preventDefault();
        setReceiving(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function state(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detail || busy) return;
    const notes = String(new FormData(e.currentTarget).get("notes") ?? "");
    setBusy(true);
    setError("");
    try {
      await send("/purchases/" + detail.id + "/state", {
        action: transition,
        notes,
      });
      await reload(detail.id);
      setTransition(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function history(productId: string, title: string, page = 1) {
    try {
      setCosts({
        productId,
        title,
        page: await api<Page<CostRow>>(
          `/purchases/cost-history?productId=${productId}&page=${page}`,
        ),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(value: string) {
    setTab(value);
    setDetail(null);
    setError("");
    if (value === "Recebimentos") {
      setFilters((v) => ({ ...v, status: "ORDERED" }));
      setQuery("status=ORDERED");
      setPage(1);
    } else if (value === "Pedidos") {
      setFilters({
        q: "",
        branchId: "",
        supplierId: "",
        buyerId: "",
        status: "",
        from: "",
        to: "",
      });
      setQuery("");
      setPage(1);
    }
  }
  return (
    <div className="purchases-page">
      <div className="section-heading">
        <div>
          <h1>Compras</h1>
          <p>Do pedido à entrada conferida na filial.</p>
        </div>
        {can("create") && (
          <button className="primary" onClick={() => setEditing({})}>
            Novo pedido
          </button>
        )}
      </div>
      <div className="purchase-tabs">
        {[
          "Pedidos",
          "Recebimentos",
          ...(auth.permissions.includes("suppliers:read")
            ? ["Fornecedores"]
            : []),
          "Reposição",
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => navigate(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {!transition && <ErrorMessage message={error} />}
      {tab === "Fornecedores" ? (
        <Suppliers auth={auth} onChanged={() => void loadOptions()} />
      ) : tab === "Reposição" ? (
        <Replenishment
          options={options}
          canCreate={can("create")}
          onCreate={(initial, branch) => setEditing({ initial, branch })}
        />
      ) : detail ? (
        <>
          <button onClick={() => setDetail(null)}>Voltar aos pedidos</button>
          <div className="section-heading">
            <div>
              <h2>
                Pedido #{detail.number} · {purchaseNames[detail.status]}
              </h2>
              <p>
                {detail.supplier.name} · {detail.branch.name} ·{" "}
                {detail.buyer.user.name}
              </p>
              <p>
                Pedido: {detail.orderedAt.slice(0, 10)} · Previsão:{" "}
                {detail.expectedAt?.slice(0, 10) ?? "Não informada"}
              </p>
            </div>
            <div className="purchase-actions">
              {auth.permissions.includes("payables:read") && onFinance && (
                <button onClick={() => onFinance(detail.id)}>
                  Contas a pagar da compra
                </button>
              )}
              {detail.status === "DRAFT" && can("edit") && (
                <>
                  <button onClick={() => setEditing({ order: detail })}>
                    Editar pedido
                  </button>
                  <button onClick={() => setTransition("SUBMIT")}>
                    Solicitar aprovação
                  </button>
                </>
              )}
              {detail.status === "PENDING" && can("approve") && (
                <button onClick={() => setTransition("APPROVE")}>
                  Aprovar pedido
                </button>
              )}
              {detail.status === "APPROVED" && can("edit") && (
                <button onClick={() => setTransition("ORDER")}>
                  Marcar como enviado
                </button>
              )}
              {["ORDERED", "PARTIALLY_RECEIVED"].includes(detail.status) &&
                can("receive") && (
                  <button
                    className="primary"
                    onClick={() => setReceiving(true)}
                  >
                    Receber mercadoria
                  </button>
                )}
              {!["RECEIVED", "CANCELLED"].includes(detail.status) &&
                can("cancel") && (
                  <button onClick={() => setTransition("CANCEL")}>
                    Cancelar saldo pendente
                  </button>
                )}
            </div>
          </div>
          <p>
            Bruto: {money(detail.subtotal)} · Desconto: {money(detail.discount)}{" "}
            · Frete: {money(detail.freight)} · Despesas:{" "}
            {money(detail.expenses)} · Total:{" "}
            <strong>{money(detail.total)}</strong>
          </p>
          {detail.notes && <p>{detail.notes}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Livro</th>
                  <th>Pedido</th>
                  <th>Recebido</th>
                  <th>Pendente</th>
                  <th>Custo</th>
                  <th>Subtotal líquido</th>
                  <th>Histórico</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.title}
                      <small>
                        {i.isbn} · {i.author} · {i.publisher}
                      </small>
                    </td>
                    <td>{i.quantity}</td>
                    <td>{i.receivedQuantity}</td>
                    <td>
                      {detail.status === "CANCELLED"
                        ? `Cancelado: ${Math.max(0, i.quantity - i.receivedQuantity)}`
                        : Math.max(0, i.quantity - i.receivedQuantity)}
                    </td>
                    <td>{money(i.unitCost)}</td>
                    <td>{money(i.subtotal)}</td>
                    <td>
                      <button
                        onClick={() => void history(i.productId, i.title)}
                      >
                        Preços de compra
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Recebimentos</h3>
          {detail.receipts.map((r, index) => (
            <section className="panel" key={r.id}>
              <h4>
                Recebimento {index + 1} · {r.document.receivedAt.slice(0, 10)}
              </h4>
              <p>
                {r.document.warehouse.name} · {r.document.actor.user.name} ·
                Total {money(r.total)}
              </p>
              <p>{r.document.notes}</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Livro</th>
                      <th>Quantidade</th>
                      <th>Custo líquido</th>
                      <th>Encargos rateados</th>
                      <th>Novo custo médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.orderItem.title}</td>
                        <td>{i.quantity}</td>
                        <td>{money(i.unitCost)}</td>
                        <td>{money(i.allocatedCharges)}</td>
                        <td>{money(i.resultingCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.divergences.map((d) => (
                <p key={d.id}>
                  {divergenceNames[d.type]} · {d.product.description} ·{" "}
                  {d.quantity} · {d.notes}
                </p>
              ))}
            </section>
          ))}
          <h3>Histórico do pedido</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>Usuário</th>
                  <th>Data/hora</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {detail.actions.map((a) => (
                  <tr key={a.id}>
                    <td>{purchaseActionNames[a.kind] ?? a.kind}</td>
                    <td>{a.actor.user.name}</td>
                    <td>{dateTime(a.createdAt)}</td>
                    <td>{a.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="purchase-metrics">
            {Object.entries(purchaseNames).map(([status, name]) => (
              <button
                key={status}
                onClick={() => {
                  setFilters((v) => ({ ...v, status }));
                  setQuery(
                    new URLSearchParams({
                      ...Object.fromEntries(
                        Object.entries(filters).filter(([, v]) => v),
                      ),
                      status,
                    }).toString(),
                  );
                  setPage(1);
                }}
              >
                {name}
                <strong>
                  {rows.counts.find((c) => c.status === status)?._count ?? 0}
                </strong>
              </button>
            ))}
            <button
              onClick={() => {
                setFilters((v) => ({ ...v, status: "LATE" }));
                setQuery("status=LATE");
                setPage(1);
              }}
            >
              Atrasados<strong>{rows.overdue}</strong>
            </button>
          </div>
          <form className="purchase-toolbar" onSubmit={search}>
            <label>
              Livro / ISBN / número
              <input
                value={filters.q}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, q: e.target.value }))
                }
              />
            </label>
            <label>
              Filial
              <select
                value={filters.branchId}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, branchId: e.target.value }))
                }
              >
                <option value="">Todas autorizadas</option>
                {options.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fornecedor
              <select
                value={filters.supplierId}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, supplierId: e.target.value }))
                }
              >
                <option value="">Todos</option>
                {options.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Comprador
              <select
                value={filters.buyerId}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, buyerId: e.target.value }))
                }
              >
                <option value="">Todos</option>
                {options.buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={filters.status}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, status: e.target.value }))
                }
              >
                <option value="">Todos</option>
                {Object.entries({ ...purchaseNames, LATE: "Atrasados" }).map(
                  ([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              De
              <input
                type="date"
                value={filters.from}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, from: e.target.value }))
                }
              />
            </label>
            <label>
              Até
              <input
                type="date"
                value={filters.to}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, to: e.target.value }))
                }
              />
            </label>
            <button>Filtrar pedidos</button>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fornecedor / filial</th>
                  <th>Comprador</th>
                  <th>Previsão</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.items.map((r) => (
                  <tr key={r.id}>
                    <td>#{r.number}</td>
                    <td>
                      {r.supplier.name}
                      <small>{r.branch.name}</small>
                    </td>
                    <td>{r.buyer.user.name}</td>
                    <td>{r.expectedAt?.slice(0, 10) ?? "—"}</td>
                    <td>{purchaseNames[r.status]}</td>
                    <td>{money(r.total)}</td>
                    <td>
                      <button
                        onClick={() =>
                          void open(r.id).catch((e) => setError(e.message))
                        }
                      >
                        Abrir pedido
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...rows} onChange={setPage} />
        </>
      )}
      {editing && (
        <PurchaseEditor
          options={options}
          order={editing.order}
          initial={editing.initial}
          initialBranch={editing.branch}
          onClose={() => setEditing(null)}
          onSaved={async (id) => {
            setTab("Pedidos");
            await reload(id);
          }}
        />
      )}
      {receiving && detail && (
        <PurchaseReceiving
          order={detail}
          options={options}
          auth={auth}
          onClose={() => setReceiving(false)}
          onSaved={() => reload(detail.id)}
        />
      )}
      {transition && (
        <Modal
          title={
            transition === "CANCEL"
              ? "Cancelar saldo pendente"
              : "Confirmar alteração do pedido"
          }
          onClose={() => {
            if (!busy) setTransition(null);
          }}
        >
          <form onSubmit={state}>
            <fieldset disabled={busy}>
              <p>
                {transition === "CANCEL"
                  ? "O estoque já recebido permanece. Uma devolução ao fornecedor será um fluxo separado."
                  : "Esta ação será registrada no histórico."}
              </p>
              <label>
                Motivo / observação
                <textarea
                  name="notes"
                  required={transition === "CANCEL"}
                  minLength={transition === "CANCEL" ? 8 : undefined}
                  maxLength={2000}
                />
              </label>
              <ErrorMessage message={error} />
              <button className="primary">Confirmar alteração</button>
            </fieldset>
          </form>
        </Modal>
      )}
      {costs && (
        <Modal
          title={"Preços de compra · " + costs.title}
          onClose={() => setCosts(null)}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Fornecedor</th>
                  <th>Filial</th>
                  <th>Pedido</th>
                  <th>Quantidade</th>
                  <th>Custo unitário líquido</th>
                  <th>Encargos</th>
                </tr>
              </thead>
              <tbody>
                {costs.page.items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.receipt.document.receivedAt.slice(0, 10)}</td>
                    <td>{c.receipt.order.supplier.name}</td>
                    <td>{c.receipt.order.branch.name}</td>
                    <td>#{c.receipt.order.number}</td>
                    <td>{c.quantity}</td>
                    <td>{money(c.unitCost)}</td>
                    <td>{money(c.allocatedCharges)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            {...costs.page}
            onChange={(p) => void history(costs.productId, costs.title, p)}
          />
        </Modal>
      )}
    </div>
  );
}
function Replenishment({
  options,
  canCreate,
  onCreate,
}: {
  options: Options;
  canCreate: boolean;
  onCreate: (lines: DraftLine[], branch: string) => void;
}) {
  const [branch, setBranch] = useState(""),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<Page<Suggestion>>({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
    }),
    [error, setError] = useState(""),
    [chosen, setChosen] = useState<Suggestion[]>([]);
  const selected = branch || options.branches[0]?.id || "";
  useEffect(() => {
    if (!selected) return;
    let active = true;
    api<Page<Suggestion>>(
      `/purchases/replenishment?branchId=${selected}&page=${page}`,
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
  }, [selected, page]);
  return (
    <section>
      <h2>Sugestão de reposição</h2>
      <p>
        Depósitos comuns da filial. Sugestão: mínimo menos saldo, com pelo menos
        uma unidade.
      </p>
      <label>
        Filial da reposição
        <select
          value={selected}
          onChange={(e) => {
            setBranch(e.target.value);
            setPage(1);
            setChosen([]);
          }}
        >
          {options.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage message={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Selecionar</th>
              <th>Livro / ISBN</th>
              <th>Autor / editora</th>
              <th>Saldo</th>
              <th>Mínimo</th>
              <th>Sugerido</th>
              <th>Fornecedor conhecido</th>
            </tr>
          </thead>
          <tbody>
            {rows.items.map((b) => (
              <tr key={b.id}>
                <td>
                  <input
                    aria-label={"Selecionar " + b.description}
                    type="checkbox"
                    checked={chosen.some((c) => c.id === b.id)}
                    onChange={(e) =>
                      setChosen((v) =>
                        e.target.checked
                          ? [...v, b]
                          : v.filter((c) => c.id !== b.id),
                      )
                    }
                  />
                </td>
                <td>
                  {b.description}
                  <small>{b.isbn13}</small>
                </td>
                <td>
                  {b.author}
                  <small>{b.publisher}</small>
                </td>
                <td>{b.quantity}</td>
                <td>{b.minimum}</td>
                <td>{b.suggested}</td>
                <td>{b.supplierName ?? "Não informado"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...rows} onChange={setPage} />
      {canCreate && (
        <button
          className="primary"
          disabled={!chosen.length}
          onClick={() =>
            onCreate(
              chosen.map((b) => ({
                productId: b.id,
                title: b.description,
                isbn: b.isbn13,
                quantity: b.suggested,
                unitCost: b.cost,
                unitDiscount: "0",
              })),
              selected,
            )
          }
        >
          Criar pedido com selecionados
        </button>
      )}
    </section>
  );
}
