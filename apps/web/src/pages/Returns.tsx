import { CreditBalance } from "./CreditBalance";
import { useEffect, useRef, useState } from "react";
import { api, money, dateTime, type Page, type Auth } from "../api";
import { ErrorMessage, Modal, Pagination } from "../components";
import { useBarcodeReader } from "../useBarcodeReader";
import { PaymentFields, type PaymentDraft } from "./PaymentFields";
import { SalesMovements } from "./SalesMovements";
type Book = {
  id: string;
  description: string;
  isbn: string | null;
  author: string | null;
  price: string;
  available: string;
};
type Original = {
  id: string;
  number: number;
  status: string;
  createdAt: string;
  warehouseId: string | null;
  customerId: string | null;
  customer: { name: string } | null;
  branch: { id: string; name: string };
  seller: { user: { name: string } };
  cashSession: { cashRegister: { name: string } } | null;
  items: Array<{
    id: string;
    description: string;
    isbn: string | null;
    quantity: string;
    unitPrice: string;
    discount: string;
    paidAmount: string;
    returns: Array<{ quantity: number; amount: string }>;
  }>;
  payments: Array<{ id: string; method: string; amount: string }>;
};
type ReturnRecord = {
  id: string;
  number: number;
  kind: string;
  createdAt: string;
  reason: string;
  returnedAmount: string;
  newAmount: string;
  difference: string;
  originalSale: { id: string; number: number };
  replacementSale: {
    number: number;
    items: Array<{
      id: string;
      description: string;
      quantity: string;
      isbn: string | null;
    }>;
    payments: Array<{ id: string; method: string; amount: string }>;
  } | null;
  customer: { name: string } | null;
  branch: { name: string };
  actor: { user: { name: string } };
  cashSession: { cashRegister: { name: string } };
  items: Array<{
    id: string;
    quantity: number;
    amount: string;
    saleItem: { description: string; isbn: string | null };
  }>;
};
type FullReturn = ReturnRecord & {
  credit: {
    id: string;
    amount: string;
    balance: string;
    status: string;
  } | null;
  movements: Array<{
    id: string;
    productId: string;
    reason: string;
    quantity: string;
    beforeQuantity: string;
    afterQuantity: string;
  }>;
};
export function ReturnsPage({ auth }: { auth: Auth }) {
  const [tab, setTab] = useState("new"),
    [source, setSource] = useState<string | null>(null),
    [detail, setDetail] = useState<string | null>(null),
    [version, setVersion] = useState(0),
    [page, setPage] = useState(1),
    [data, setData] = useState<Page<ReturnRecord> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Page<ReturnRecord>>("/returns?page=" + page)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [version, page]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PÓS-VENDA</span>
          <h1>Trocas e devoluções</h1>
          <p>
            Retorne itens, substitua livros ou gere vale-crédito com
            rastreabilidade.
          </p>
        </div>
      </div>
      <div className="stock-tabs">
        <button
          className={tab === "new" ? "primary" : "secondary"}
          onClick={() => setTab("new")}
        >
          Nova troca / devolução
        </button>
        <button
          className={tab === "history" ? "primary" : "secondary"}
          onClick={() => setTab("history")}
        >
          Histórico de trocas
        </button>
      </div>
      <ErrorMessage message={error} />
      {tab === "new" ? (
        <SalesMovements selection onView={setSource} version={version} />
      ) : (
        <section className="card stock-entry">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Número",
                    "Operação",
                    "Venda original",
                    "Data",
                    "Cliente",
                    "Filial / operador",
                    "Retornado",
                    "Novo total",
                    "Diferença",
                    "",
                  ].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => (
                  <tr key={r.id}>
                    <td>#{r.number}</td>
                    <td>{r.kind === "RETURN" ? "Devolução" : "Troca"}</td>
                    <td>#{r.originalSale.number}</td>
                    <td>{dateTime(r.createdAt)}</td>
                    <td>{r.customer?.name ?? "Não identificado"}</td>
                    <td>
                      {r.branch.name}
                      <small>{r.actor.user.name}</small>
                    </td>
                    <td>{money(r.returnedAmount)}</td>
                    <td>{money(r.newAmount)}</td>
                    <td>{money(r.difference)}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setDetail(r.id)}
                      >
                        Ver operação
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && <Pagination {...data} onChange={setPage} />}
        </section>
      )}
      {source && (
        <ReturnForm
          saleId={source}
          auth={auth}
          onClose={() => setSource(null)}
          onDone={(id) => {
            setSource(null);
            setDetail(id);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {detail && <ReturnDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
export function ReturnDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<FullReturn | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<FullReturn>("/returns/" + id)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <Modal
      title={
        data
          ? (data.kind === "RETURN" ? "Devolução #" : "Troca #") + data.number
          : "Carregando operação"
      }
      onClose={onClose}
    >
      <ErrorMessage message={error} />
      {data && (
        <>
          <p>
            Venda original #{data.originalSale.number} ·{" "}
            {dateTime(data.createdAt)}
          </p>
          <p>
            {data.branch.name} · {data.cashSession.cashRegister.name} ·{" "}
            {data.actor.user.name}
          </p>
          <p>Cliente: {data.customer?.name ?? "Não identificado"}</p>
          <p>Motivo: {data.reason}</p>
          <h3>Itens devolvidos</h3>
          {data.items.map((i) => (
            <p key={i.id}>
              {i.quantity} × {i.saleItem.description} ·{" "}
              {i.saleItem.isbn ?? "Sem ISBN"} · {money(i.amount)}
            </p>
          ))}
          <p>
            Crédito dos retornos: {money(data.returnedAmount)} · Novos livros:{" "}
            {money(data.newAmount)}
          </p>
          <h3>Diferença: {money(data.difference)}</h3>
          {data.replacementSale && (
            <div>
              <p>
                Nova mercadoria registrada na venda #
                {data.replacementSale.number}
              </p>
              {data.replacementSale.items.map((i) => (
                <p key={i.id}>
                  {i.quantity} × {i.description} · {i.isbn ?? "—"}
                </p>
              ))}
            </div>
          )}
          {data.replacementSale?.payments.map((p) => (
            <p key={p.id}>
              {p.method}: {money(p.amount)}
            </p>
          ))}
          {data.credit && (
            <div className="stock-success">
              Vale-crédito: {money(data.credit.amount)} · Saldo{" "}
              {money(data.credit.balance)}
              <small>
                Identificador: {data.credit.id} · {data.credit.status}
              </small>
            </div>
          )}
          <h3>Estoque</h3>
          {data.movements.map((m) => (
            <p key={m.id}>
              {m.reason}
              <br />
              {m.quantity} · Saldo {m.beforeQuantity} → {m.afterQuantity}
            </p>
          ))}
        </>
      )}
    </Modal>
  );
}
export function ReturnForm({
  saleId,
  auth,
  onClose,
  onDone,
}: {
  saleId: string;
  auth: Auth;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [sale, setSale] = useState<Original | null>(null),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [rows, setRows] = useState<Array<{ book: Book; quantity: number }>>([]),
    [payments, setPayments] = useState<PaymentDraft[]>([]),
    [customerId, setCustomerId] = useState(""),
    [customers, setCustomers] = useState<Array<{ id: string; name: string }>>(
      [],
    ),
    [sessions, setSessions] = useState<
      Array<{ id: string; branchId: string; cashRegister: { name: string } }>
    >([]),
    [session, setSession] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [quote, setQuote] = useState<{
      returnedAmount: string;
      newAmount: string;
      difference: string;
      credit: string;
    } | null>(null),
    [manual, setManual] = useState(false),
    [books, setBooks] = useState<Array<{ id: string; description: string }>>(
      [],
    );
  const key = useRef(crypto.randomUUID()),
    rowsRef = useRef(rows);
  useEffect(() => {
    api<Original>("/sales/" + saleId)
      .then((s) => {
        setSale(s);
        setCustomerId(s.customerId ?? "");
      })
      .catch((e) => setError(e.message));
    api<{ cashSessions: typeof sessions }>("/sales/options")
      .then((o) => setSessions(o.cashSessions))
      .catch((e) => setError(e.message));
  }, [saleId]);
  const changed = () => {
    setQuote(null);
    key.current = crypto.randomUUID();
    setError("");
  };
  function add(b: Book) {
    const current = rowsRef.current,
      old = current.find((r) => r.book.id === b.id),
      quantity = (old?.quantity ?? 0) + 1;
    if (quantity > Number(b.available)) throw Error("Estoque insuficiente.");
    const next = old
      ? current.map((r) => (r === old ? { book: b, quantity } : r))
      : [...current, { book: b, quantity }];
    rowsRef.current = next;
    setRows(next);
    changed();
  }
  const { input, pending, scan } = useBarcodeReader(
    !busy && !manual && !quote,
    async (code) => {
      if (!sale?.warehouseId) throw Error("Venda sem depósito operacional.");
      add(
        await api<Book>(
          "/sales/lookup?warehouseId=" +
            sale.warehouseId +
            "&code=" +
            encodeURIComponent(code),
        ),
      );
    },
    (e) => setError(e.message),
  );
  function payload() {
    return {
      requestKey: key.current,
      originalSaleId: saleId,
      cashSessionId: session || undefined,
      customerId: customerId || undefined,
      reason,
      items: Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([saleItemId, quantity]) => ({ saleItemId, quantity })),
      ...(rows.length
        ? {
            replacement: {
              warehouseId: sale!.warehouseId,
              customerId: customerId || null,
              items: rows.map((r) => ({
                productId: r.book.id,
                quantity: r.quantity,
                expectedUnitPrice: r.book.price,
              })),
            },
          }
        : {}),
      payments: payments.map(({ id: _, ...p }) => {
        void _;
        return p;
      }),
    };
  }
  async function calculate() {
    setBusy(true);
    setError("");
    try {
      const q = await api<NonNullable<typeof quote>>("/returns/quote", {
        method: "POST",
        body: JSON.stringify({ ...payload(), payments: [] }),
      });
      setQuote(q);
      if (Number(q.difference) <= 0) setPayments([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/returns", {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      onDone(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        sale ? "Trocar / devolver — venda #" + sale.number : "Carregando venda"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="stock-entry return-form">
        <ErrorMessage message={error} />
        {sale && (
          <>
            <p>
              {dateTime(sale.createdAt)} · {sale.branch.name} ·{" "}
              {sale.cashSession?.cashRegister.name ?? "Sem sessão histórica"} ·{" "}
              {sale.seller.user.name}
            </p>
            <p>
              Cliente original: {sale.customer?.name ?? "Não identificado"} ·
              Operador atual: {auth.name}
            </p>
            <p>
              Pagamentos originais:{" "}
              {sale.payments
                .map((p) => p.method + " " + money(p.amount))
                .join(" + ")}
            </p>
            <h3>Itens que retornam</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {[
                      "Livro / ISBN",
                      "Vendido",
                      "Já devolvido",
                      "Preço original",
                      "Desconto do item",
                      "Pago com rateio",
                      "Retornar",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((i) => {
                    const returned = i.returns.reduce(
                      (n, r) => n + r.quantity,
                      0,
                    );
                    return (
                      <tr key={i.id}>
                        <td>
                          {i.description}
                          <small>{i.isbn ?? "—"}</small>
                        </td>
                        <td>{i.quantity}</td>
                        <td>{returned}</td>
                        <td>{money(i.unitPrice)}</td>
                        <td>{money(i.discount)}</td>
                        <td>{money(i.paidAmount)}</td>
                        <td>
                          <input
                            aria-label={"Devolver " + i.description}
                            type="number"
                            min="0"
                            max={Number(i.quantity) - returned}
                            step="1"
                            disabled={busy}
                            value={quantities[i.id] ?? 0}
                            onChange={(e) => {
                              setQuantities((v) => ({
                                ...v,
                                [i.id]: Number(e.target.value),
                              }));
                              changed();
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              O cálculo aplica também o desconto geral original, sem devolver
              mais do que foi pago.
            </p>
            <h3>Novos livros (opcional)</h3>
            <form className="scan-bar" onSubmit={scan}>
              <label>
                Leitor da troca
                <input
                  ref={input}
                  aria-label="Leitor da troca"
                  disabled={busy || !!quote}
                  autoComplete="off"
                  placeholder="ISBN/EAN/SKU + Enter"
                />
              </label>
              <button className="primary" disabled={busy || !!quote}>
                Adicionar código
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  changed();
                  setManual(true);
                }}
              >
                Pesquisar livro
              </button>
            </form>
            {pending > 0 && <p>Processando leitura…</p>}
            {rows.map((r) => (
              <div className="return-new-item" key={r.book.id}>
                <span>
                  {r.book.description} · {money(r.book.price)}
                </span>
                <input
                  aria-label={"Nova quantidade " + r.book.description}
                  type="number"
                  min="1"
                  step="1"
                  value={r.quantity}
                  disabled={busy}
                  onChange={(e) => {
                    const next = rowsRef.current.map((x) =>
                      x === r ? { ...x, quantity: Number(e.target.value) } : x,
                    );
                    rowsRef.current = next;
                    setRows(next);
                    changed();
                  }}
                />
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    const next = rows.filter((x) => x !== r);
                    rowsRef.current = next;
                    setRows(next);
                    changed();
                  }}
                >
                  Remover novo item
                </button>
              </div>
            ))}
            {!rows.length && (
              <p>Sem novos livros: será uma devolução com vale-crédito.</p>
            )}
            <label>
              Caixa aberto
              <select
                value={session}
                disabled={busy}
                onChange={(e) => {
                  setSession(e.target.value);
                  changed();
                }}
              >
                <option value="">Resolver caixa do operador na filial</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.cashRegister.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motivo
              <textarea
                minLength={8}
                maxLength={2000}
                value={reason}
                disabled={busy}
                onChange={(e) => {
                  setReason(e.target.value);
                  changed();
                }}
              />
            </label>
            <form
              className="scan-bar"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const q = String(new FormData(e.currentTarget).get("q"));
                  setCustomers(
                    (
                      await api<Page<{ id: string; name: string }>>(
                        "/customers?q=" + encodeURIComponent(q),
                      )
                    ).items,
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <label>
                Identificar cliente para vale
                <input
                  name="q"
                  placeholder="Nome, documento, telefone ou e-mail"
                />
              </label>
              <button className="secondary" disabled={busy}>
                Pesquisar cliente
              </button>
            </form>
            <label>
              Cliente
              <select
                value={customerId}
                disabled={busy}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  changed();
                }}
              >
                <option value="">Não identificado</option>
                {sale.customerId && (
                  <option value={sale.customerId}>{sale.customer?.name}</option>
                )}
                {customers
                  .filter((c) => c.id !== sale.customerId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            {!quote ? (
              <button
                className="primary"
                disabled={busy || pending > 0}
                onClick={() => void calculate()}
              >
                Calcular e revisar troca
              </button>
            ) : (
              <div className="return-review">
                <h3>Conferência</h3>
                <p>
                  Retornos: {money(quote.returnedAmount)} · Novos livros:{" "}
                  {money(quote.newAmount)}
                </p>
                <strong className="pdv-grand-total">
                  {Number(quote.difference) > 0
                    ? "Diferença a pagar: "
                    : Number(quote.difference) < 0
                      ? "Vale-crédito: "
                      : "Sem diferença: "}
                  {money(
                    Number(quote.difference) < 0
                      ? quote.credit
                      : quote.difference,
                  )}
                </strong>
                {Number(quote.difference) > 0 && (
                  <>
                    <p>Receba manualmente a diferença antes de confirmar.</p>
                    <CreditBalance
                      customerId={customerId}
                      branchId={sale?.branch.id}
                    />
                    <PaymentFields
                      allowStoreCredit={!!customerId}
                      payments={payments}
                      setPayments={setPayments}
                      busy={busy}
                      renew={() => {
                        key.current = crypto.randomUUID();
                      }}
                    />
                  </>
                )}
                {Number(quote.credit) > 0 && (
                  <p>
                    Vale identificado por cliente. Não há devolução bancária
                    automática.
                  </p>
                )}
                <div className="form-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={changed}
                  >
                    Revisar itens
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void confirm()}
                  >
                    {busy ? "Confirmando…" : "Confirmar troca / devolução"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {manual && (
          <Modal title="Pesquisar novo livro" onClose={() => setManual(false)}>
            <form
              className="scan-bar"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  setBooks(
                    (
                      await api<Page<{ id: string; description: string }>>(
                        "/products?q=" +
                          encodeURIComponent(
                            String(new FormData(e.currentTarget).get("q")),
                          ),
                      )
                    ).items,
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <label>
                Título, autor, editora ou código
                <input name="q" autoFocus />
              </label>
              <button className="primary">Pesquisar</button>
            </form>
            {books.map((b) => (
              <button
                className="secondary manual-book"
                key={b.id}
                onClick={async () => {
                  try {
                    add(
                      await api<Book>(
                        "/sales/lookup?warehouseId=" +
                          sale!.warehouseId +
                          "&productId=" +
                          b.id,
                      ),
                    );
                    setManual(false);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {b.description}
              </button>
            ))}
          </Modal>
        )}
      </div>
    </Modal>
  );
}
