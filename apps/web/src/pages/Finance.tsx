import { useEffect, useState, type FormEvent } from "react";
import { api, money, type Auth } from "../api";
import { ErrorMessage, Modal, Pagination } from "../components";
import { PayablesPage } from "./Payables";
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
  PAID: "Recebido",
  OVERDUE: "Atrasado",
  CANCELLED: "Cancelado",
  CASH: "Dinheiro",
  PIX: "PIX",
  DEBIT_CARD: "Débito",
  CREDIT_CARD: "Crédito",
  BANK_SLIP: "Boleto",
  TRANSFER: "Transferência",
  OTHER: "Outro",
  SALE: "Venda",
  PURCHASE: "Compra",
  MANUAL: "Manual",
  LEGACY: "Legado",
  RECEIPT: "Recebimento",
  REVERSAL: "Reversão administrativa",
  PAYMENT: "Pagamento",
};
type Ref = { id: string; name: string };
type Entry = {
  id: string;
  description: string;
  amount: string;
  balance: string;
  paid: string;
  situation: string;
  status: string;
  dueDate: string;
  expectedDate: string;
  installment: number;
  origin: string;
  notes: string | null;
  externalReference: string | null;
  branch: Ref | null;
  customer: Ref | null;
  sale: { id: string; number: number } | null;
  payment: { method: string; installments: number } | null;
};
type Detail = Entry & {
  installments: Entry[];
  settlements: {
    id: string;
    kind: string;
    amount: string;
    paidAt: string;
    reference: string;
    notes: string;
    actor: { user: { name: string } };
  }[];
  history: { id: string; action: string; createdAt: string }[];
};
type Flow = {
  from: string;
  to: string;
  receivable: string;
  payable: string;
  received: string;
  paid: string;
  reversed: string;
  realized: string;
  forecastIn: string;
  forecastOut: string;
  forecast: string;
  overdueIn: string;
  overdueOut: string;
  days: {
    date: string;
    received: string;
    paid: string;
    reversed: string;
    realized: string;
    forecastIn: string;
    forecastOut: string;
    forecast: string;
  }[];
};
export function FinancePage(props: {
  auth: Auth;
  initialPurchaseId?: string;
  onPurchase: (id: string) => void;
}) {
  const { auth } = props;
  const [tab, setTab] = useState(
    auth.permissions.includes("payables:read")
      ? "payables"
      : auth.permissions.includes("receivables:read")
        ? "receivables"
        : "flow",
  );
  return (
    <section>
      <nav className="finance-tabs" aria-label="Áreas financeiras">
        {[
          ["payables", "Contas a Pagar", "payables:read"],
          ["receivables", "Contas a Receber", "receivables:read"],
          ["flow", "Fluxo de Caixa", "finance:read"],
        ]
          .filter(([, , p]) => auth.permissions.includes(p!))
          .map(([id, name]) => (
            <button
              key={id}
              className={tab === id ? "primary" : "secondary"}
              aria-pressed={tab === id}
              onClick={() => setTab(id!)}
            >
              {name}
            </button>
          ))}
      </nav>
      {tab === "payables" ? (
        <PayablesPage {...props} />
      ) : (
        <Receivables auth={auth} flow={tab === "flow"} />
      )}
    </section>
  );
}
function Receivables({ auth, flow }: { auth: Auth; flow: boolean }) {
  const [filters, setFilters] = useState({
    branchId: "",
    customerId: "",
    supplierId: "",
    status: "",
    origin: "",
    method: "",
    from: "",
    to: "",
    q: "",
  });
  const [options, setOptions] = useState<{
    company: Ref;
    branches: Ref[];
    customers: Ref[];
  }>();
  const [suppliers, setSuppliers] = useState<Ref[]>([]);
  const [rows, setRows] = useState<Entry[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [data, setData] = useState<Flow>();
  const [detail, setDetail] = useState<Detail>(),
    [action, setAction] = useState<"receive" | "forecast">(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(crypto.randomUUID());
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  );
  query.set("page", String(page));
  const search = query.toString();
  useEffect(() => {
    let active = true;
    api<{ company: Ref; branches: Ref[]; customers: Ref[]; suppliers: Ref[] }>(
      "/receivables/options",
    )
      .then((v) => {
        if (active) {
          setOptions(v);
          setSuppliers(v.suppliers);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [auth]);
  useEffect(() => {
    let active = true;
    setError("");
    if (flow) {
      api<Flow>("/finance?" + search)
        .then((v) => {
          if (active) setData(v);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    } else {
      api<{ items: Entry[]; total: number }>("/receivables?" + search)
        .then((v) => {
          if (active) {
            setRows(v.items);
            setTotal(v.total);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [flow, search, reload]);
  const filter = (k: keyof typeof filters, v: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };
  async function open(id: string) {
    try {
      setDetail(await api<Detail>("/receivables/" + id));
      setAction(undefined);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!detail || busy) return;
    const values = Object.fromEntries(new FormData(ev.currentTarget));
    setBusy(true);
    try {
      await api(
        `/receivables/${detail.id}/${action === "receive" ? "receipts" : "forecast"}`,
        { method: "POST", body: JSON.stringify({ ...values, requestKey }) },
      );
      await open(detail.id);
      setReload((n) => n + 1);
      setRequestKey(crypto.randomUUID());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="finance-page">
      <div className="page-heading">
        <div>
          <h1>{flow ? "Fluxo de Caixa" : "Contas a Receber"}</h1>
          <p>
            {options?.company.name ?? auth.companyName} ·{" "}
            {flow
              ? "Realizado e previsto, sem duplicar o faturamento"
              : "Parcelas de vendas e recebimentos administrativos"}
          </p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="panel">
        <div className="payable-filters">
          <label>
            Pesquisar
            <input
              aria-label="Pesquisar recebíveis"
              value={filters.q}
              onChange={(e) => filter("q", e.target.value)}
            />
          </label>
          <label>
            Filial
            <select
              aria-label="Filial financeira"
              value={filters.branchId}
              onChange={(e) => filter("branchId", e.target.value)}
            >
              <option value="">Todas autorizadas</option>
              {options?.branches.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cliente
            <select
              aria-label="Cliente financeiro"
              value={filters.customerId}
              onChange={(e) => filter("customerId", e.target.value)}
            >
              <option value="">Todos</option>
              {options?.customers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {flow && (
            <label>
              Fornecedor
              <select
                aria-label="Fornecedor financeiro"
                value={filters.supplierId}
                onChange={(e) => filter("supplierId", e.target.value)}
              >
                <option value="">Todos</option>
                {suppliers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(
            [
              [
                "status",
                ["PENDING", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"],
                "Status financeiro",
              ],
              [
                "method",
                [
                  "CASH",
                  "PIX",
                  "DEBIT_CARD",
                  "CREDIT_CARD",
                  "BANK_SLIP",
                  "TRANSFER",
                  "OTHER",
                ],
                "Forma financeira",
              ],
              [
                "origin",
                flow
                  ? ["SALE", "PURCHASE", "MANUAL", "OTHER", "LEGACY"]
                  : ["SALE", "LEGACY"],
                "Origem financeira",
              ],
            ] as const
          ).map(([key, values, label]) => (
            <label key={key}>
              {label}
              <select
                aria-label={label}
                value={filters[key]}
                onChange={(e) => filter(key, e.target.value)}
              >
                <option value="">Todos</option>
                {values.map((v) => (
                  <option key={v} value={v}>
                    {labels[v]}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            De
            <input
              aria-label="Período financeiro inicial"
              type="date"
              value={filters.from}
              onChange={(e) => filter("from", e.target.value)}
            />
          </label>
          <label>
            Até
            <input
              aria-label="Período financeiro final"
              type="date"
              value={filters.to}
              onChange={(e) => filter("to", e.target.value)}
            />
          </label>
        </div>
        <div className="finance-tabs">
          {[1, 7, 30].map((n) => (
            <button
              className="secondary"
              key={n}
              onClick={() => {
                setPage(1);
                setFilters((f) => ({
                  ...f,
                  from: today(),
                  to: new Date(new Date(today()).getTime() + (n - 1) * 86400000)
                    .toISOString()
                    .slice(0, 10),
                }));
              }}
            >
              {n === 1 ? "Hoje" : `${n} dias`}
            </button>
          ))}
          <button
            className="secondary"
            onClick={() => {
              setFilters({
                branchId: "",
                customerId: "",
                supplierId: "",
                status: "",
                origin: "",
                method: "",
                from: "",
                to: "",
                q: "",
              });
              setPage(1);
            }}
          >
            Limpar filtros
          </button>
        </div>
        <p className="muted">
          {flow
            ? "Realizado pela data da liquidação; previsto pela data esperada. Forma filtra liquidações e previsões de cartão; contas a pagar ainda sem forma definida ficam fora dessa seleção. Saldos em aberto incluem atrasados fora do período."
            : "O período filtra o vencimento original. Previsão pode ser ajustada antes da primeira baixa."}
        </p>
      </div>
      {flow ? (
        data && (
          <>
            <div className="finance-metrics">
              {[
                ["Recebido no período", data.received],
                ["Pago no período", data.paid],
                ["Reversões administrativas", data.reversed],
                ["Resultado realizado", data.realized],
                ["A receber em aberto", data.receivable],
                ["A pagar em aberto", data.payable],
                ["Recebíveis atrasados", data.overdueIn],
                ["Contas vencidas", data.overdueOut],
                ["Entradas previstas", data.forecastIn],
                ["Saídas previstas", data.forecastOut],
                ["Resultado previsto", data.forecast],
              ].map(([name, value]) => (
                <article className="panel" key={name}>
                  <span>{name}</span>
                  <strong>{money(value!)}</strong>
                </article>
              ))}
            </div>
            <p>
              Período: {data.from} a {data.to}. Resultado não equivale a saldo
              bancário. Reversões não confirmam estorno externo.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {[
                      "Dia",
                      "Entradas realizadas",
                      "Saídas realizadas",
                      "Reversões",
                      "Resultado realizado",
                      "Entradas previstas",
                      "Saídas previstas",
                      "Resultado previsto",
                    ].map((v) => (
                      <th key={v}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      {[
                        d.received,
                        d.paid,
                        d.reversed,
                        d.realized,
                        d.forecastIn,
                        d.forecastOut,
                        d.forecast,
                      ].map((v, i) => (
                        <td key={i}>{money(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Vencimento",
                    "Descrição / Venda",
                    "Filial",
                    "Cliente",
                    "Forma",
                    "Parcela",
                    "Original",
                    "Recebido",
                    "Saldo",
                    "Status",
                    "Ações",
                  ].map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{e.dueDate.slice(0, 10)}</td>
                    <td>{e.description}</td>
                    <td>{e.branch?.name ?? "Legado"}</td>
                    <td>{e.customer?.name ?? "Consumidor"}</td>
                    <td>{labels[e.payment?.method ?? "OTHER"]}</td>
                    <td>
                      {e.installment}/{e.payment?.installments ?? 1}
                    </td>
                    <td>{money(e.amount)}</td>
                    <td>{money(e.paid)}</td>
                    <td>{money(e.balance)}</td>
                    <td>{labels[e.situation]}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => void open(e.id)}
                      >
                        Ver recebível
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} limit={25} onChange={setPage} />
        </>
      )}
      {detail && (
        <Modal
          title="Detalhes do recebível"
          onClose={() => {
            if (!busy) {
              setDetail(undefined);
              setAction(undefined);
            }
          }}
        >
          <p>
            {detail.description} · {detail.branch?.name} ·{" "}
            {detail.customer?.name ?? "Consumidor"}
          </p>
          <p>
            Venda original: {detail.sale ? `#${detail.sale.number}` : "Legado"}{" "}
            · Origem: {labels[detail.origin]}
          </p>
          <p>
            Original: {money(detail.amount)} · Recebido: {money(detail.paid)} ·{" "}
            <strong>Saldo: {money(detail.balance)}</strong> ·{" "}
            {labels[detail.situation]}
          </p>
          <p>
            Vencimento: {detail.dueDate.slice(0, 10)} · Previsão:{" "}
            {detail.expectedDate.slice(0, 10)}
          </p>
          <p>
            {detail.notes} {detail.externalReference}
          </p>
          <ErrorMessage message={error} />
          <div className="finance-tabs">
            {detail.status === "OPEN" &&
              detail.sale &&
              auth.permissions.includes("receivables:receive") && (
                <button
                  className="primary"
                  onClick={() => {
                    setRequestKey(crypto.randomUUID());
                    setAction("receive");
                  }}
                >
                  Registrar recebimento
                </button>
              )}
            {detail.status === "OPEN" &&
              Number(detail.paid) === 0 &&
              auth.permissions.includes("receivables:edit") && (
                <button
                  className="secondary"
                  onClick={() => {
                    setRequestKey(crypto.randomUUID());
                    setAction("forecast");
                  }}
                >
                  Editar previsão
                </button>
              )}
          </div>
          {action && (
            <form onSubmit={submit} className="form-grid">
              {action === "receive" ? (
                <>
                  <label>
                    Valor recebido
                    <input
                      name="amount"
                      aria-label="Valor recebido"
                      inputMode="decimal"
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={detail.balance}
                      defaultValue={detail.balance}
                      required
                    />
                  </label>
                  <label>
                    Data do recebimento
                    <input
                      name="receivedAt"
                      type="date"
                      defaultValue={today()}
                      max={today()}
                      required
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Data prevista
                    <input
                      name="expectedDate"
                      type="date"
                      defaultValue={detail.expectedDate.slice(0, 10)}
                      required
                    />
                  </label>
                  <label>
                    Motivo
                    <input name="reason" minLength={8} required />
                  </label>
                </>
              )}
              <label>
                Referência
                <input
                  name="reference"
                  maxLength={160}
                  defaultValue={detail.externalReference ?? ""}
                />
              </label>
              <label>
                Observações
                <textarea
                  name="notes"
                  maxLength={1000}
                  defaultValue={detail.notes ?? ""}
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Salvando…" : "Confirmar operação"}
              </button>
            </form>
          )}
          <h3>Parcelas da venda</h3>
          {detail.installments.map((e) => (
            <p key={e.id}>
              {e.installment}/{detail.payment?.installments} ·{" "}
              {e.dueDate.slice(0, 10)} · {money(e.amount)} ·{" "}
              {labels[e.situation]}
            </p>
          ))}
          <h3>Histórico de recebimentos</h3>
          {detail.settlements.map((s) => (
            <p key={s.id}>
              {labels[s.kind]} · {s.paidAt.slice(0, 10)} · {money(s.amount)} ·{" "}
              {s.actor.user.name} · {s.reference} {s.notes}
            </p>
          ))}
          <h3>Auditoria</h3>
          {detail.history.map((h) => (
            <p key={h.id}>
              {h.createdAt} · {h.action}
            </p>
          ))}
        </Modal>
      )}
    </div>
  );
}
