import { useEffect, useRef, useState, type FormEvent } from "react";
import { payableMethods } from "@caramelo/contracts";
import { api, money, type Auth } from "../api";
import { Modal, ErrorMessage, Pagination } from "../components";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const labels: Record<string, string> = {
  PENDING: "Pendente",
  PARTIAL: "Parcial",
  PAID: "Paga",
  OVERDUE: "Vencida",
  CANCELLED: "Cancelada",
  MANUAL: "Manual",
  OTHER: "Outra",
  PURCHASE: "Compra",
  CASH: "Dinheiro",
  PIX: "PIX",
  BANK_SLIP: "Boleto",
  TRANSFER: "Transferência",
  DEBIT_CARD: "Débito",
  CREDIT_CARD: "Crédito",
};
type Ref = { id: string; name: string };
type Options = {
  company: Ref;
  branches: Ref[];
  suppliers: Ref[];
  categories: Ref[];
  receipts: {
    id: string;
    total: string;
    order: { id: string; number: number; branchId: string; supplierId: string };
    financialObligations: { id: string }[];
  }[];
};
type Entry = {
  id: string;
  description: string;
  amount: string;
  interest: string;
  penalty: string;
  discount: string;
  total: string;
  paid: string;
  balance: string;
  situation: string;
  dueDate: string;
  installment: number;
  obligation: {
    id: string;
    description: string;
    origin: string;
    documentNumber: string;
    issuedAt: string;
    competence: string;
    notes: string;
    branch: Ref;
    supplier: Ref | null;
    category: Ref;
    purchaseOrder: { id: string; number: number } | null;
    purchaseReceiptId: string | null;
    actor: { user: { name: string } };
  };
};
type Detail = Entry & {
  installments: Entry[];
  settlements: {
    id: string;
    paidAt: string;
    amount: string;
    method: string;
    reference: string;
    notes: string;
    actor: { user: { name: string } };
  }[];
  history: {
    id: string;
    action: string;
    createdAt: string;
    metadata: unknown;
    actor: { user: { name: string } } | null;
  }[];
};
type Indicators = {
  open: string;
  overdue: string;
  today: string;
  next7: string;
  paidMonth: string;
};
type Group = {
  id: string;
  name: string;
  original: string;
  paid: string;
  balance: string;
};
type Reports = {
  suppliers: Group[];
  categories: Group[];
  branches: Group[];
  payments: {
    id: string;
    amount: string;
    paidAt: string;
    method: string;
    entry: { description: string };
  }[];
  purchases: {
    entryId: string;
    purchaseOrderId: string;
    purchaseReceiptId: string;
    amount: string;
    balance: string;
  }[];
};
const date = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
export function PayablesPage({
  auth,
  initialPurchaseId,
  onPurchase,
}: {
  auth: Auth;
  initialPurchaseId?: string;
  onPurchase: (id: string) => void;
}) {
  const [options, setOptions] = useState<Options | null>(null),
    [items, setItems] = useState<Entry[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [mode, setMode] = useState<
      "create" | "pay" | "edit" | "cancel" | "category" | null
    >(null),
    [indicators, setIndicators] = useState<Indicators | null>(null),
    [reports, setReports] = useState<Reports | null>(null);
  const [filters, setFilters] = useState({
    purchaseOrderId: initialPurchaseId ?? "",
    q: "",
    branchId: "",
    supplierId: "",
    categoryId: "",
    status: "",
    origin: "",
    from: "",
    to: "",
    issuedFrom: "",
    issuedTo: "",
    documentNumber: "",
  });
  const search = useRef<HTMLInputElement>(null),
    form = useRef<HTMLFormElement>(null),
    retry = useRef({ payload: "", key: "" });
  const [origin, setOrigin] = useState("MANUAL"),
    [receiptId, setReceiptId] = useState(""),
    [count, setCount] = useState(1),
    [dueDates, setDueDates] = useState([today()]);
  const can = (p: string) => auth.permissions.includes("payables:" + p);
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  ).toString();
  useEffect(() => {
    let active = true;
    Promise.all([
      api<Options>("/payables/options"),
      api<Indicators>("/payables/indicators"),
      api<{ items: Entry[]; total: number }>(`/payables?${query}&page=${page}`),
    ])
      .then(([o, i, l]) => {
        if (active) {
          setOptions(o);
          setIndicators(i);
          setItems(l.items);
          setTotal(l.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [query, page, version]);
  useEffect(() => {
    if (initialPurchaseId) {
      setOrigin("PURCHASE");
      setFilters((f) => ({ ...f, purchaseOrderId: initialPurchaseId }));
    }
  }, [initialPurchaseId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "F2" &&
        !mode &&
        !detail &&
        auth.permissions.includes("payables:create")
      ) {
        e.preventDefault();
        setOrigin(initialPurchaseId ? "PURCHASE" : "MANUAL");
        setReceiptId("");
        setMode("create");
      }
      if (e.key === "F4" && !mode) {
        e.preventDefault();
        search.current?.focus();
      }
      if (
        e.key === "F8" &&
        detail &&
        !mode &&
        Number(detail.balance) > 0 &&
        detail.situation !== "CANCELLED" &&
        auth.permissions.includes("payables:pay")
      ) {
        e.preventDefault();
        setMode("pay");
      }
      if (e.ctrlKey && e.key === "Enter" && mode) {
        e.preventDefault();
        form.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, detail, auth.permissions, initialPurchaseId]);
  async function open(id: string) {
    try {
      setDetail(await api<Detail>("/payables/" + id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(path: string, payload: object) {
    const serialized = JSON.stringify({ path, payload });
    if (retry.current.payload !== serialized)
      retry.current = { payload: serialized, key: crypto.randomUUID() };
    return api<{ entryIds?: string[] }>(path, {
      method: "POST",
      body: JSON.stringify({ ...payload, requestKey: retry.current.key }),
    });
  }
  const receipt = options?.receipts.find((r) => r.id === receiptId);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (mode === "category") {
        await api("/payables/categories", {
          method: "POST",
          body: JSON.stringify({ name: data.name }),
        });
      } else if (mode === "create") {
        const result = await send("/payables", {
          origin,
          branchId: receipt?.order.branchId ?? data.branchId,
          supplierId: receipt?.order.supplierId ?? (data.supplierId || null),
          categoryId: data.categoryId,
          description: data.description,
          documentNumber: data.documentNumber,
          issuedAt: data.issuedAt,
          competence: data.competence,
          amount: receipt?.total ?? data.amount,
          dueDates,
          notes: data.notes,
          ...(origin === "PURCHASE" ? { purchaseReceiptId: receiptId } : {}),
        });
        if (result.entryIds?.[0]) await open(result.entryIds[0]);
      } else if (detail) {
        await send(
          `/payables/${detail.id}/${mode === "pay" ? "payments" : mode}`,
          data,
        );
        await open(detail.id);
      }
      setMode(null);
      retry.current = { payload: "", key: "" };
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function filter(k: keyof typeof filters, v: string) {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
    setReports(null);
  }
  function preset(days: number) {
    const d = today();
    setFilters((f) => ({
      ...f,
      from: d,
      to: new Date(new Date(d).getTime() + days * 86400000)
        .toISOString()
        .slice(0, 10),
    }));
    setPage(1);
  }
  const refs = (rows: Ref[]) =>
    rows.map((r) => (
      <option key={r.id} value={r.id}>
        {r.name}
      </option>
    ));
  const formTitle =
    mode === "create"
      ? "Nova conta a pagar"
      : mode === "pay"
        ? "Registrar pagamento"
        : mode === "edit"
          ? "Editar vencimento e ajustes"
          : mode === "cancel"
            ? "Cancelar conta"
            : "Nova categoria";
  return (
    <div className="payables-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Financeiro</p>
          <h1>Contas a Pagar</h1>
          <p>Obrigações e pagamentos administrativos • {auth.companyName}</p>
        </div>
        <div className="payable-actions">
          {can("create") && (
            <button
              className="primary"
              onClick={() => {
                setOrigin(initialPurchaseId ? "PURCHASE" : "MANUAL");
                setReceiptId("");
                setMode("create");
              }}
            >
              Nova conta
            </button>
          )}
          {can("edit") && (
            <button onClick={() => setMode("category")}>Nova categoria</button>
          )}
        </div>
      </header>
      <ErrorMessage message={error} />
      {indicators && (
        <div className="payable-indicators">
          {(
            [
              ["today", "A pagar hoje"],
              ["next7", "Próximos 7 dias"],
              ["overdue", "Vencidas"],
              ["open", "Total em aberto"],
              ["paidMonth", "Pago no mês"],
            ] as const
          ).map(([k, l]) => (
            <div className="panel" key={k}>
              <span>{l}</span>
              <strong>{money(indicators[k])}</strong>
            </div>
          ))}
        </div>
      )}
      <section className="panel">
        <div className="payable-filters">
          <label>
            Pesquisar
            <input
              ref={search}
              value={filters.q}
              onChange={(e) => filter("q", e.target.value)}
              placeholder="Descrição ou fornecedor"
            />
          </label>
          <label>
            Filial
            <select
              aria-label="Filial"
              value={filters.branchId}
              onChange={(e) => filter("branchId", e.target.value)}
            >
              <option value="">Todas autorizadas</option>
              {refs(options?.branches ?? [])}
            </select>
          </label>
          <label>
            Fornecedor
            <select
              aria-label="Fornecedor"
              value={filters.supplierId}
              onChange={(e) => filter("supplierId", e.target.value)}
            >
              <option value="">Todos</option>
              {refs(options?.suppliers ?? [])}
            </select>
          </label>
          <label>
            Categoria
            <select
              aria-label="Categoria"
              value={filters.categoryId}
              onChange={(e) => filter("categoryId", e.target.value)}
            >
              <option value="">Todas</option>
              {refs(options?.categories ?? [])}
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="Status"
              value={filters.status}
              onChange={(e) => filter("status", e.target.value)}
            >
              <option value="">Todos</option>
              {["PENDING", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"].map(
                (k) => (
                  <option key={k} value={k}>
                    {labels[k]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Origem
            <select
              aria-label="Origem"
              value={filters.origin}
              onChange={(e) => filter("origin", e.target.value)}
            >
              <option value="">Todas</option>
              {["MANUAL", "PURCHASE", "OTHER"].map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Documento
            <input
              value={filters.documentNumber}
              onChange={(e) => filter("documentNumber", e.target.value)}
            />
          </label>
          {(
            [
              ["from", "Vencimento inicial"],
              ["to", "Vencimento final"],
              ["issuedFrom", "Emissão inicial"],
              ["issuedTo", "Emissão final"],
            ] as const
          ).map(([k, l]) => (
            <label key={k}>
              {l}
              <input
                type="date"
                value={filters[k]}
                onChange={(e) => filter(k, e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="payable-actions">
          <button onClick={() => preset(0)}>Hoje</button>
          <button onClick={() => preset(7)}>Próximos 7 dias</button>
          <button onClick={() => preset(30)}>Próximos 30 dias</button>
          <a className="button" href={`/api/payables/export?${query}`}>
            Exportar CSV
          </a>
          <button
            onClick={() =>
              void api<Reports>("/payables/reports?" + query)
                .then(setReports)
                .catch((e) => setError(e.message))
            }
          >
            Relatórios
          </button>
        </div>
      </section>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Vencimento",
                "Descrição",
                "Fornecedor",
                "Filial",
                "Categoria",
                "Valor",
                "Pago",
                "Saldo",
                "Status",
                "Origem",
                "Ação",
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr
                key={i.id}
                className={i.situation === "OVERDUE" ? "payable-overdue" : ""}
              >
                <td>{date(i.dueDate)}</td>
                <td>
                  {i.description} · {i.installment}
                </td>
                <td>{i.obligation.supplier?.name ?? "—"}</td>
                <td>{i.obligation.branch.name}</td>
                <td>{i.obligation.category.name}</td>
                <td>{money(i.total)}</td>
                <td>{money(i.paid)}</td>
                <td>{money(i.balance)}</td>
                <td>{labels[i.situation]}</td>
                <td>{labels[i.obligation.origin]}</td>
                <td>
                  <button onClick={() => void open(i.id)}>Ver conta</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p>Nenhuma conta encontrada.</p>}
      </div>
      <Pagination page={page} total={total} limit={25} onChange={setPage} />
      {reports && (
        <section className="panel">
          <h2>Relatórios filtrados</h2>
          {(
            [
              ["suppliers", "Por fornecedor"],
              ["categories", "Por categoria"],
              ["branches", "Por filial"],
            ] as const
          ).map(([key, title]) => (
            <div key={key}>
              <h3>{title}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Original</th>
                      <th>Pago</th>
                      <th>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports[key].map((g) => (
                      <tr key={g.id}>
                        <td>{g.name}</td>
                        <td>{money(g.original)}</td>
                        <td>{money(g.paid)}</td>
                        <td>{money(g.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <h3>Pagamentos por período</h3>
          <p>
            O intervalo de vencimentos é usado como período de pagamento nesta
            consulta.
          </p>
          <ul>
            {reports.payments.map((p) => (
              <li key={p.id}>
                {date(p.paidAt)} • {p.entry.description} • {money(p.amount)} •{" "}
                {labels[p.method]}
              </li>
            ))}
          </ul>
          <h3>Compras × contas geradas</h3>
          <p>
            {reports.purchases.length} parcelas vinculadas nos filtros atuais.
          </p>
        </section>
      )}
      {detail && !mode && (
        <Modal title="Detalhes da conta" onClose={() => setDetail(null)}>
          <div className="payable-detail">
            <h3>{detail.description}</h3>
            <p>
              {labels[detail.situation]} • Saldo:{" "}
              <strong>{money(detail.balance)}</strong> • Pago:{" "}
              {money(detail.paid)}
            </p>
            <p>
              Origem: {labels[detail.obligation.origin]} • Filial:{" "}
              {detail.obligation.branch.name} • Fornecedor:{" "}
              {detail.obligation.supplier?.name ?? "—"}
            </p>
            <p>
              Categoria: {detail.obligation.category.name} • Documento:{" "}
              {detail.obligation.documentNumber || "—"}
            </p>
            <p>
              Emissão: {date(detail.obligation.issuedAt)} • Competência:{" "}
              {date(detail.obligation.competence)} • Responsável:{" "}
              {detail.obligation.actor.user.name}
            </p>
            <p>
              Original: {money(detail.amount)} • Juros: {money(detail.interest)}{" "}
              • Multa: {money(detail.penalty)} • Desconto:{" "}
              {money(detail.discount)}
            </p>
            <p>{detail.obligation.notes}</p>
            {detail.obligation.purchaseOrder && (
              <button
                disabled={!auth.permissions.includes("purchases:read")}
                onClick={() => onPurchase(detail.obligation.purchaseOrder!.id)}
              >
                Abrir compra #{detail.obligation.purchaseOrder.number}
              </button>
            )}
            <div className="payable-actions">
              {can("pay") &&
                Number(detail.balance) > 0 &&
                detail.situation !== "CANCELLED" && (
                  <button className="primary" onClick={() => setMode("pay")}>
                    Registrar pagamento
                  </button>
                )}
              {can("edit") &&
                detail.installments.every((i) => Number(i.paid) === 0) &&
                detail.situation !== "CANCELLED" && (
                  <button onClick={() => setMode("edit")}>Editar</button>
                )}
              {can("cancel") &&
                detail.installments.every((i) => Number(i.paid) === 0) &&
                detail.situation !== "CANCELLED" && (
                  <button onClick={() => setMode("cancel")}>
                    Cancelar conta
                  </button>
                )}
            </div>
            <h3>Parcelas</h3>
            <ul>
              {detail.installments.map((i, index) => (
                <li key={i.id}>
                  <button onClick={() => void open(i.id)}>
                    {index + 1}/{detail.installments.length} · {date(i.dueDate)}{" "}
                    · {money(i.balance)} · {labels[i.situation]}
                  </button>
                </li>
              ))}
            </ul>
            <h3>Pagamentos</h3>
            {detail.settlements.map((p) => (
              <p key={p.id}>
                {date(p.paidAt)} · {money(p.amount)} · {labels[p.method]} ·{" "}
                {p.actor.user.name} · {p.reference} {p.notes}
              </p>
            ))}
            <h3>Histórico / auditoria</h3>
            {detail.history.map((h) => (
              <details key={h.id}>
                <summary>
                  {new Date(h.createdAt).toLocaleString("pt-BR")} · {h.action} ·{" "}
                  {h.actor?.user.name}
                </summary>
                <pre>{JSON.stringify(h.metadata, null, 2)}</pre>
              </details>
            ))}
          </div>
        </Modal>
      )}
      {mode && (
        <Modal
          title={formTitle}
          onClose={() => {
            if (!busy) setMode(null);
          }}
        >
          <form ref={form} onSubmit={submit} className="payable-form">
            <ErrorMessage message={error} />
            {mode === "category" ? (
              <label>
                Nome da categoria
                <input name="name" required minLength={2} maxLength={80} />
              </label>
            ) : mode === "create" ? (
              <>
                <label>
                  Origem
                  <select
                    aria-label="Origem"
                    value={origin}
                    onChange={(e) => {
                      setOrigin(e.target.value);
                      setReceiptId("");
                    }}
                  >
                    {["MANUAL", "PURCHASE", "OTHER"].map((k) => (
                      <option key={k} value={k}>
                        {labels[k]}
                      </option>
                    ))}
                  </select>
                </label>
                {origin === "PURCHASE" ? (
                  <label>
                    Recebimento da compra
                    <select
                      aria-label="Recebimento da compra"
                      required
                      value={receiptId}
                      onChange={(e) => setReceiptId(e.target.value)}
                    >
                      <option value="">Selecione o recebimento</option>
                      {options?.receipts
                        .filter(
                          (r) =>
                            !initialPurchaseId ||
                            r.order.id === initialPurchaseId,
                        )
                        .map((r) => (
                          <option
                            key={r.id}
                            value={r.id}
                            disabled={r.financialObligations.length > 0}
                          >
                            Compra #{r.order.number} • {money(r.total)} •{" "}
                            {r.id.slice(0, 8)}{" "}
                            {r.financialObligations.length
                              ? "(financeiro já confirmado)"
                              : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label>
                      Filial
                      <select aria-label="Filial" name="branchId" required>
                        <option value="">Selecione</option>
                        {refs(options?.branches ?? [])}
                      </select>
                    </label>
                    <label>
                      Fornecedor
                      <select aria-label="Fornecedor" name="supplierId">
                        <option value="">Sem fornecedor</option>
                        {refs(options?.suppliers ?? [])}
                      </select>
                    </label>
                  </>
                )}
                <label>
                  Categoria
                  <select aria-label="Categoria" name="categoryId" required>
                    <option value="">Selecione</option>
                    {refs(options?.categories ?? [])}
                  </select>
                </label>
                <label>
                  Descrição
                  <input
                    name="description"
                    required
                    minLength={3}
                    maxLength={200}
                  />
                </label>
                <label>
                  Número/documento
                  <input name="documentNumber" maxLength={100} />
                </label>
                <label>
                  Valor original
                  <input
                    name="amount"
                    inputMode="decimal"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    readOnly={origin === "PURCHASE"}
                    {...(origin === "PURCHASE"
                      ? { value: receipt?.total ?? "" }
                      : {})}
                  />
                </label>
                <label>
                  Data de emissão
                  <input
                    name="issuedAt"
                    type="date"
                    required
                    defaultValue={today()}
                  />
                </label>
                <label>
                  Competência
                  <input
                    name="competence"
                    type="date"
                    required
                    defaultValue={today()}
                  />
                </label>
                <label>
                  Quantidade de parcelas
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={count}
                    onChange={(e) => {
                      const n = Math.max(
                        1,
                        Math.min(60, Number(e.target.value)),
                      );
                      setCount(n);
                      setDueDates((old) =>
                        Array.from({ length: n }, (_, i) => old[i] ?? ""),
                      );
                    }}
                  />
                </label>
                {dueDates.map((d, i) => (
                  <label key={i}>
                    Vencimento {i + 1}/{count}
                    <input
                      type="date"
                      required
                      value={d}
                      onChange={(e) =>
                        setDueDates((old) =>
                          old.map((v, j) => (j === i ? e.target.value : v)),
                        )
                      }
                    />
                  </label>
                ))}
                <p>
                  Centavos residuais ficam na última parcela. Cada recebimento
                  pode ser confirmado uma única vez.
                </p>
                <label>
                  Observações
                  <textarea name="notes" maxLength={1000} />
                </label>
              </>
            ) : mode === "pay" ? (
              <>
                <p>
                  Saldo disponível: {money(detail!.balance)}. Registro
                  administrativo, sem comunicação bancária.
                </p>
                <label>
                  Valor do pagamento
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={detail!.balance}
                    defaultValue={detail!.balance}
                    required
                  />
                </label>
                <label>
                  Data do pagamento
                  <input
                    name="paidAt"
                    type="date"
                    defaultValue={today()}
                    max={today()}
                    required
                  />
                </label>
                <label>
                  Forma de pagamento
                  <select aria-label="Forma de pagamento" name="method">
                    {payableMethods.map((m) => (
                      <option key={m} value={m}>
                        {labels[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Referência
                  <input name="reference" maxLength={160} />
                </label>
                <label>
                  Observações
                  <textarea name="notes" maxLength={1000} />
                </label>
              </>
            ) : mode === "edit" ? (
              <>
                <label>
                  Vencimento
                  <input
                    name="dueDate"
                    type="date"
                    defaultValue={detail!.dueDate.slice(0, 10)}
                    required
                  />
                </label>
                {(
                  [
                    ["amount", "Valor original"],
                    ["interest", "Juros"],
                    ["penalty", "Multa"],
                    ["discount", "Desconto"],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <input
                      name={k}
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={detail![k]}
                      readOnly={
                        k === "amount" &&
                        detail!.obligation.origin === "PURCHASE"
                      }
                      required
                    />
                  </label>
                ))}
                <label>
                  Justificativa
                  <textarea
                    name="reason"
                    required
                    minLength={8}
                    maxLength={1000}
                  />
                </label>
              </>
            ) : (
              <label>
                Motivo do cancelamento
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={1000}
                />
              </label>
            )}
            <button className="primary" disabled={busy} type="submit">
              {busy ? "Salvando…" : "Confirmar"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
