import { CreditBalance } from "./CreditBalance";
import { SalesMovements } from "./SalesMovements";
import { ReturnForm, ReturnDetail } from "./Returns";
import { PaymentFields, newPayment, type PaymentDraft } from "./PaymentFields";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  cents,
  reais,
  discountCents,
  paymentNames,
  type Discount,
} from "@caramelo/contracts";
import { api, money, dateTime, type Auth, type Page } from "../api";
import { ErrorMessage, Modal } from "../components";
import { CatalogForm, type Row } from "./Catalog";
import { useBarcodeReader } from "../useBarcodeReader";
type Book = {
  id: string;
  description: string;
  isbn: string | null;
  author: string | null;
  publisher: string | null;
  code: string;
  price: string;
  available: string;
};
type CartLine = { book: Book; quantity: number; discount: Discount };
type Customer = { id: string; name: string; document?: string | null };
type Options = {
  cashSessions: Array<{
    id: string;
    branchId: string;
    cashRegister: { name: string };
    openedBy: { user: { name: string } };
  }>;
  warehouses: Array<{
    id: string;
    name: string;
    branch: { id: string; name: string };
  }>;
  operators: Array<{ id: string; user: { name: string } }>;
};
type Sale = {
  cashSession?: { cashRegister: { name: string } } | null;
  returns?: Array<{ id: string; number: number; kind: string }>;
  exchangeOrigin?: { id: string } | null;
  id: string;
  number: number;
  createdAt: string;
  status: string;
  total: string;
  subtotal: string | null;
  discount: string;
  warehouseId: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  requestKey?: string | null;
  branch: { name: string };
  seller: { user: { name: string } };
  customer: Customer | null;
  items: Array<{
    id: string;
    description: string;
    isbn: string | null;
    author: string | null;
    quantity: string;
    unitPrice: string;
    discount: string;
  }>;
  payments: Array<{
    id: string;
    method: keyof typeof paymentNames;
    amount: string;
    receivedAmount: string | null;
    change: string;
    installments: number;
    cardBrand: string | null;
    reference: string | null;
    reversedAt: string | null;
    financialEntries?: Array<{
      id: string;
      installment: number;
      amount: string;
      dueDate: string;
      status: string;
    }>;
  }>;
  movements?: Array<{
    id: string;
    type: string;
    quantity: string;
    beforeQuantity: string;
    afterQuantity: string;
    reason: string;
  }>;
  financialEntries?: Array<{ id: string; amount: string; status: string }>;
};
const zero = (): Discount => ({ type: "AMOUNT", value: "0" });
function preview(rows: CartLine[], discount: Discount) {
  try {
    let subtotal = 0n,
      lineDiscount = 0n;
    const items = rows.map((r) => {
      const gross = cents(r.book.price) * BigInt(r.quantity);
      const off = discountCents(gross, r.discount);
      if (off > gross) throw Error("Desconto excede o item.");
      subtotal += gross;
      lineDiscount += off;
      return reais(gross - off);
    });
    const header = discountCents(subtotal - lineDiscount, discount);
    if (header > subtotal - lineDiscount)
      throw Error("Desconto excede o total.");
    return {
      subtotal: reais(subtotal),
      discount: reais(lineDiscount + header),
      total: reais(subtotal - lineDiscount - header),
      items,
      error: "",
    };
  } catch {
    return {
      subtotal: "0.00",
      discount: "0.00",
      total: "0.00",
      items: [],
      error: "Confira quantidades e descontos.",
    };
  }
}
export function SalesPage({ auth }: { auth: Auth }) {
  const [tab, setTab] = useState(
      auth.permissions.includes("sales:create") ? "new" : "history",
    ),
    [options, setOptions] = useState<Options>({
      cashSessions: [],
      warehouses: [],
      operators: [],
    }),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    api<Options>("/sales/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BALCÃO DA LIVRARIA</span>
          <h1>PDV / Vendas</h1>
          <p>Venda por unidade com estoque e pagamentos registrados.</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="stock-tabs">
        {auth.permissions.includes("sales:create") && (
          <button
            className={tab === "new" ? "primary" : "secondary"}
            onClick={() => setTab("new")}
          >
            Nova Venda
          </button>
        )}
        <button
          className={tab === "history" ? "primary" : "secondary"}
          onClick={() => setTab("history")}
        >
          Histórico de vendas
        </button>
      </div>
      {auth.permissions.includes("sales:create") && (
        <div hidden={tab !== "new"}>
          <PointOfSale
            auth={auth}
            options={options}
            active={tab === "new"}
            version={version}
            onDone={() => setVersion((v) => v + 1)}
            onView={setDetail}
          />
        </div>
      )}
      <div hidden={tab !== "history"}>
        <SalesMovements version={version} onView={setDetail} />
      </div>
      {detail && (
        <SaleDetail
          id={detail}
          auth={auth}
          onClose={() => setDetail(null)}
          onChange={() => setVersion((v) => v + 1)}
        />
      )}
    </>
  );
}
function DiscountInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: Discount;
  onChange: (d: Discount) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pdv-discount">
      <select
        aria-label={"Tipo de " + label}
        value={value.type}
        disabled={disabled}
        onChange={(e) =>
          onChange({ ...value, type: e.target.value as Discount["type"] })
        }
      >
        <option value="AMOUNT">R$</option>
        <option value="PERCENT">%</option>
      </select>
      <input
        aria-label={label}
        type="number"
        min="0"
        step="0.01"
        value={value.value}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
      />
    </div>
  );
}
function PointOfSale({
  auth,
  options,
  active,
  onDone,
  onView,
  version,
}: {
  version: number;
  auth: Auth;
  options: Options;
  active: boolean;
  onDone: () => void;
  onView: (id: string) => void;
}) {
  const [cashSession, setCashSession] = useState("");
  const [warehouse, setWarehouse] = useState(""),
    [rows, updateRows] = useState<CartLine[]>([]),
    [customer, setCustomer] = useState<Customer | null>(null),
    [discount, setDiscount] = useState<Discount>(zero),
    [payments, setPayments] = useState<PaymentDraft[]>([newPayment()]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [success, setSuccess] = useState<Sale | null>(null);
  const [bookSearch, setBookSearch] = useState(false),
    [bookResults, setBookResults] = useState<Row[]>([]),
    [customerSearch, setCustomerSearch] = useState(false),
    [customerResults, setCustomerResults] = useState<Customer[]>([]),
    [createCustomer, setCreateCustomer] = useState(false);
  const rowsRef = useRef(rows);
  function setRows(action: SetStateAction<CartLine[]>) {
    const next =
      typeof action === "function" ? action(rowsRef.current) : action;
    rowsRef.current = next;
    updateRows(next);
  }
  const key = useRef(crypto.randomUUID());
  const renew = () => {
    key.current = crypto.randomUUID();
    setError("");
  };
  const totals = preview(rows, discount);
  useEffect(() => {
    let current = true;
    if (success?.id)
      void api<Sale>("/sales/" + success.id)
        .then((sale) => {
          if (current) setSuccess(sale);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [version, success?.id]);
  function add(book: Book) {
    const current = rowsRef.current,
      old = current.find((r) => r.book.id === book.id),
      qty = (old?.quantity ?? 0) + 1;
    if (qty > Number(book.available)) throw Error("Estoque insuficiente.");
    setRows(
      old
        ? current.map((r) => (r === old ? { ...r, book, quantity: qty } : r))
        : [...current, { book, quantity: 1, discount: zero() }],
    );
    renew();
  }
  const { input, pending, scan } = useBarcodeReader(
    active &&
      !bookSearch &&
      !customerSearch &&
      !createCustomer &&
      !review &&
      !busy &&
      !success,
    async (code) => {
      if (!warehouse)
        throw Error("Selecione a filial e o depósito antes da leitura.");
      const book = await api<Book>(
        "/sales/lookup?warehouseId=" +
          warehouse +
          "&code=" +
          encodeURIComponent(code),
      );
      add(book);
    },
    (e) => setError(e.message),
  );
  function changeQuantity(id: string, quantity: number) {
    setRows((r) => r.map((x) => (x.book.id === id ? { ...x, quantity } : x)));
    renew();
  }
  const cart = () => ({
    warehouseId: warehouse,
    customerId: customer?.id ?? null,
    discount,
    items: rows.map((r) => ({
      productId: r.book.id,
      quantity: r.quantity,
      expectedUnitPrice: r.book.price,
      discount: r.discount,
    })),
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !active ||
        busy ||
        review ||
        success ||
        bookSearch ||
        customerSearch ||
        createCustomer ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey
      )
        return;
      const keys = ["F2", "F3", "F4", "F8", "F10"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      if (e.key === "F2") setCustomerSearch(true);
      if (e.key === "F3" && warehouse) setBookSearch(true);
      if (e.key === "F4")
        document
          .querySelector<HTMLInputElement>('[aria-label="Desconto da venda"]')
          ?.focus();
      if (e.key === "F8")
        document
          .querySelector<HTMLInputElement>(
            '[aria-label="Valor do pagamento 1"]',
          )
          ?.focus();
      if (e.key === "F10" && rows.length && pending === 0) void reviewSale();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function reviewSale() {
    setBusy(true);
    setError("");
    try {
      await api("/sales/quote", {
        method: "POST",
        body: JSON.stringify(cart()),
      });
      setReview(true);
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
      const sale = await api<Sale>("/sales", {
        method: "POST",
        body: JSON.stringify({
          requestKey: key.current,
          cashSessionId: cashSession || undefined,
          cart: cart(),
          payments: payments.map(({ id: _, ...p }) => {
            void _;
            return p;
          }),
        }),
      });
      setSuccess(sale);
      setReview(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setRows([]);
    setCustomer(null);
    setDiscount(zero());
    setPayments([newPayment()]);
    setSuccess(null);
    renew();
  }
  let paid = "0.00",
    remaining = "0.00";
  try {
    const sum = payments.reduce((n, p) => n + cents(p.amount), 0n);
    paid = reais(sum);
    remaining = reais(cents(totals.total) - sum);
  } catch {
    remaining = "—";
  }
  if (success)
    return (
      <section className="card pdv-completed">
        <span className="eyebrow">
          {success.status === "CANCELLED"
            ? "VENDA CANCELADA"
            : "VENDA CONCLUÍDA"}
        </span>
        <h2>Venda #{success.number}</h2>
        <strong className="pdv-grand-total">{money(success.total)}</strong>
        <p>
          {success.branch.name} · Operador {success.seller.user.name}
        </p>
        {success.payments.map((p) => (
          <p key={p.id}>
            {paymentNames[p.method]}: {money(p.amount)} · Troco:{" "}
            {money(p.change)}
          </p>
        ))}
        <div className="form-actions">
          <button className="primary" onClick={reset}>
            Nova venda
          </button>
          <button className="secondary" onClick={() => onView(success.id)}>
            Ver venda
          </button>
        </div>
      </section>
    );
  return (
    <div className="pdv-layout">
      <section className="card stock-entry">
        <p className="helper-text">
          F2 cliente · F3 livro · F4 desconto · F8 pagamento · F10 finalizar ·
          Esc fechar modal
        </p>
        <label>
          Caixa aberto
          <select
            aria-label="Caixa do PDV"
            value={cashSession}
            disabled={busy || review || rows.length > 0}
            onChange={(e) => {
              setCashSession(e.target.value);
              renew();
            }}
          >
            <option value="">Caixa do operador na filial selecionada</option>
            {options.cashSessions?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.cashRegister.name} · {s.openedBy.user.name}
              </option>
            ))}
          </select>
        </label>
        {!options.cashSessions?.length && (
          <p className="stock-warning">
            Abra uma sessão no menu Caixa antes de vender.
          </p>
        )}
        <div className="pdv-context">
          <label>
            Filial / depósito
            <select
              aria-label="Filial do PDV"
              disabled={rows.length > 0 || pending > 0 || busy || review}
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
          <p>
            Operador: <strong>{auth.name}</strong>
          </p>
        </div>
        <p className="helper-text">
          O carrinho não reserva estoque. A disponibilidade será validada
          novamente ao confirmar.
        </p>
        <fieldset className="stock-fieldset" disabled={busy || review}>
          <form className="scan-bar" onSubmit={scan}>
            <label>
              ISBN/EAN/SKU
              <input
                ref={input}
                aria-label="Leitor do PDV"
                autoComplete="off"
                placeholder="Leia o código e pressione Enter"
              />
            </label>
            <button className="primary">Adicionar código</button>
            <button
              type="button"
              className="secondary"
              disabled={!warehouse}
              onClick={() => setBookSearch(true)}
            >
              Adicionar livro
            </button>
          </form>
          {pending > 0 && (
            <p role="status">Processando {pending} leitura(s)…</p>
          )}
          <ErrorMessage message={error || totals.error} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Livro / ISBN / Autor",
                    "Quantidade",
                    "Preço",
                    "Desconto",
                    "Subtotal",
                    "",
                  ].map((s, i) => (
                    <th key={i}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, index) => (
                  <tr key={r.book.id}>
                    <td>
                      <strong>{r.book.description}</strong>
                      <small>{r.book.isbn ?? r.book.code}</small>
                      <small>
                        {r.book.author ?? "—"} · Disponível: {r.book.available}
                      </small>
                    </td>
                    <td>
                      <div className="pdv-quantity">
                        <button
                          className="secondary"
                          aria-label={"Diminuir " + r.book.description}
                          disabled={r.quantity <= 1}
                          onClick={() =>
                            changeQuantity(r.book.id, r.quantity - 1)
                          }
                        >
                          −
                        </button>
                        <input
                          aria-label={"Quantidade de " + r.book.description}
                          type="number"
                          min="1"
                          max={r.book.available}
                          step="1"
                          value={r.quantity}
                          onChange={(e) =>
                            changeQuantity(r.book.id, Number(e.target.value))
                          }
                        />
                        <button
                          className="secondary"
                          aria-label={"Aumentar " + r.book.description}
                          onClick={() =>
                            changeQuantity(r.book.id, r.quantity + 1)
                          }
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td>{money(r.book.price)}</td>
                    <td>
                      <DiscountInput
                        label={"Desconto de " + r.book.description}
                        value={r.discount}
                        disabled={!auth.permissions.includes("sales:discount")}
                        onChange={(d) => {
                          setRows((v) =>
                            v.map((x) => (x === r ? { ...x, discount: d } : x)),
                          );
                          renew();
                        }}
                      />
                    </td>
                    <td>{money(totals.items[index] ?? "0")}</td>
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
          {!rows.length && (
            <p className="empty">
              Leia um livro ou pesquise para iniciar a venda.
            </p>
          )}
          <div className="pdv-customer">
            <span>
              Cliente:{" "}
              <strong>{customer?.name ?? "Consumidor não identificado"}</strong>
            </span>
            <button
              className="secondary"
              onClick={() => setCustomerSearch(true)}
            >
              Selecionar cliente
            </button>
            {customer && (
              <button
                className="secondary"
                onClick={() => {
                  setCustomer(null);
                  renew();
                }}
              >
                Sem identificação
              </button>
            )}
            {auth.permissions.includes("customers:write") && (
              <button
                className="secondary"
                onClick={() => setCreateCustomer(true)}
              >
                Cadastrar cliente
              </button>
            )}
          </div>
        </fieldset>
      </section>
      <aside className="card stock-entry pdv-checkout">
        <h2>Resumo da venda</h2>
        <div className="pdv-totals">
          <span>Subtotal</span>
          <strong>{money(totals.subtotal)}</strong>
          <span>Descontos</span>
          <strong>{money(totals.discount)}</strong>
        </div>
        <label>
          Desconto no total
          <DiscountInput
            label="Desconto da venda"
            value={discount}
            disabled={
              busy || review || !auth.permissions.includes("sales:discount")
            }
            onChange={(d) => {
              setDiscount(d);
              renew();
            }}
          />
        </label>
        <strong className="pdv-grand-total" aria-label="Total da venda">
          {money(totals.total)}
        </strong>
        <CreditBalance
          customerId={customer?.id}
          branchId={
            options.warehouses.find((w) => w.id === warehouse)?.branch.id
          }
          version={version}
        />
        <h3>Pagamentos</h3>
        <p className="helper-text">
          Confirme PIX e cartão somente após receber fora do Caramelo.
        </p>
        <PaymentFields
          allowStoreCredit={!!customer && !!warehouse}
          payments={payments}
          setPayments={setPayments}
          renew={renew}
          busy={busy}
          review={review}
        />
        <div className="pdv-totals">
          <span>Aplicado</span>
          <strong>{money(paid)}</strong>
          <span>Restante</span>
          <strong>{remaining === "—" ? remaining : money(remaining)}</strong>
        </div>
        <button
          className="primary pdv-finalize"
          disabled={
            !warehouse ||
            !rows.length ||
            busy ||
            pending > 0 ||
            !!totals.error ||
            rows.some((r) => !Number.isInteger(r.quantity) || r.quantity < 1)
          }
          onClick={() => void reviewSale()}
        >
          Finalizar venda
        </button>
      </aside>
      {bookSearch && (
        <Modal
          title="Adicionar livro ao carrinho"
          onClose={() => setBookSearch(false)}
        >
          <ErrorMessage message={error} />
          <SearchForm
            label="Título, autor, ISBN, editora ou SKU"
            onSearch={async (q) => {
              const r = await api<Page<Row>>(
                "/products?q=" + encodeURIComponent(q),
              );
              setBookResults(r.items.filter((b) => b.active));
            }}
            onError={setError}
          />
          {bookResults.map((b) => (
            <button
              className="secondary manual-book"
              key={b.id}
              onClick={async () => {
                try {
                  const book = await api<Book>(
                    "/sales/lookup?warehouseId=" +
                      warehouse +
                      "&productId=" +
                      b.id,
                  );
                  add(book);
                  setBookSearch(false);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {b.description} — {String(b.author ?? b.code)}
            </button>
          ))}
        </Modal>
      )}
      {customerSearch && (
        <Modal
          title="Selecionar cliente"
          onClose={() => setCustomerSearch(false)}
        >
          <ErrorMessage message={error} />
          <SearchForm
            label="Nome, CPF/CNPJ, telefone ou e-mail"
            onSearch={async (q) =>
              setCustomerResults(
                (
                  await api<Page<Customer>>(
                    "/customers?q=" + encodeURIComponent(q),
                  )
                ).items,
              )
            }
            onError={setError}
          />
          {customerResults.map((c) => (
            <button
              className="secondary manual-book"
              key={c.id}
              onClick={() => {
                setCustomer(c);
                setCustomerSearch(false);
                renew();
              }}
            >
              {c.name} — {c.document ?? "Sem documento"}
            </button>
          ))}
        </Modal>
      )}
      {createCustomer && (
        <CatalogForm
          kind="customers"
          row={null}
          onClose={() => setCreateCustomer(false)}
          onSaved={(c) => {
            setCustomer(c as unknown as Customer);
            setCreateCustomer(false);
            renew();
          }}
        />
      )}
      {review && (
        <Modal
          title="Confirmar venda"
          onClose={() => {
            if (!busy) setReview(false);
          }}
        >
          <p>
            {options.warehouses.find((w) => w.id === warehouse)?.branch.name} ·
            Operador {auth.name}
          </p>
          <p>{customer?.name ?? "Consumidor não identificado"}</p>
          {rows.map((r) => (
            <p key={r.book.id}>
              {r.quantity} × {r.book.description}
            </p>
          ))}
          <p>
            Subtotal: {money(totals.subtotal)} · Descontos:{" "}
            {money(totals.discount)}
          </p>
          <h3>Total: {money(totals.total)}</h3>
          {payments.map((p) => (
            <p key={p.id}>
              {paymentNames[p.method]}: {money(p.amount || "0")}{" "}
              {p.method === "CREDIT_CARD" ? `em ${p.installments}x` : ""}
            </p>
          ))}
          <ErrorMessage message={error} />
          <div className="form-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Revisar venda
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? "Confirmando…" : "Confirmar venda"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function SearchForm({
  label,
  onSearch,
  onError,
}: {
  label: string;
  onSearch: (q: string) => Promise<void>;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="scan-bar"
      onSubmit={async (e) => {
        e.preventDefault();
        const q = String(new FormData(e.currentTarget).get("q"));
        setBusy(true);
        try {
          await onSearch(q);
        } catch (e) {
          onError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {label}
        <input name="q" autoFocus maxLength={100} />
      </label>
      <button className="primary" disabled={busy}>
        Pesquisar
      </button>
    </form>
  );
}
function SaleDetail({
  id,
  auth,
  onClose,
  onChange,
}: {
  id: string;
  auth: Auth;
  onClose: () => void;
  onChange: () => void;
}) {
  const [returning, setReturning] = useState(false),
    [returnDetail, setReturnDetail] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [sale, setSale] = useState<Sale | null>(null),
    [error, setError] = useState(""),
    [cancel, setCancel] = useState(false),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    api<Sale>("/sales/" + id)
      .then(setSale)
      .catch((e) => setError(e.message));
  }, [id, revision]);
  async function cancelSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const s = await api<Sale>("/sales/" + id + "/cancel", {
        method: "POST",
        body: JSON.stringify({
          requestKey: key.current,
          reason: data.get("reason"),
          refundConfirmed: data.get("refundConfirmed") === "on",
        }),
      });
      setSale(s);
      setCancel(false);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={sale ? "Venda #" + sale.number : "Carregando venda"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ErrorMessage message={error} />
      {sale && (
        <>
          <p>
            {sale.branch.name} · {sale.seller.user.name} ·{" "}
            {dateTime(sale.createdAt)}
          </p>
          <p>
            Cliente: {sale.customer?.name ?? "Consumidor não identificado"} ·{" "}
            <strong>
              {sale.status === "CANCELLED"
                ? "CANCELADA"
                : sale.status === "COMPLETED"
                  ? "CONCLUÍDA"
                  : sale.status}
            </strong>
          </p>
          <p>
            Caixa:{" "}
            {sale.cashSession?.cashRegister.name ?? "Sem sessão histórica"}
          </p>
          {sale.returns?.map((r) => (
            <button
              className="secondary"
              key={r.id}
              onClick={() => setReturnDetail(r.id)}
            >
              {r.kind === "RETURN" ? "Devolução" : "Troca"} #{r.number}
            </button>
          ))}
          {auth.permissions.includes("returns:create") &&
            sale.status === "COMPLETED" &&
            sale.requestKey && (
              <button className="secondary" onClick={() => setReturning(true)}>
                Trocar / devolver
              </button>
            )}
          {returning && (
            <ReturnForm
              saleId={id}
              auth={auth}
              onClose={() => setReturning(false)}
              onDone={(rid) => {
                setReturning(false);
                setReturnDetail(rid);
                setRevision((v) => v + 1);
                onChange();
              }}
            />
          )}
          {returnDetail && (
            <ReturnDetail
              id={returnDetail}
              onClose={() => setReturnDetail(null)}
            />
          )}
          {sale.cancelReason && (
            <p>Motivo do cancelamento: {sale.cancelReason}</p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Livro / ISBN",
                    "Quantidade",
                    "Preço",
                    "Desconto",
                    "Subtotal",
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sale.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.description}
                      <small>
                        {i.isbn ?? "—"} · {i.author ?? "—"}
                      </small>
                    </td>
                    <td>{i.quantity}</td>
                    <td>{money(i.unitPrice)}</td>
                    <td>{money(i.discount)}</td>
                    <td>
                      {Number.isInteger(Number(i.quantity))
                        ? money(
                            reais(
                              cents(i.unitPrice) * BigInt(Number(i.quantity)) -
                                cents(i.discount),
                            ),
                          )
                        : "Legado fracionário"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Desconto geral: {money(sale.discount)}</p>
          <h3>Total: {money(sale.total)}</h3>
          {sale.payments.map((p) => (
            <div className="pdv-payment" key={p.id}>
              <strong>
                {paymentNames[p.method] ?? p.method}: {money(p.amount)}
              </strong>
              <p>
                {p.installments} parcela(s) · Troco: {money(p.change ?? "0")}{" "}
                {p.reversedAt ? "· Revertido no sistema" : ""}
              </p>
              {p.cardBrand && <p>Bandeira: {p.cardBrand}</p>}
              {p.reference && <p>Referência: {p.reference}</p>}
              {p.financialEntries?.map((f) => (
                <small key={f.id}>
                  Parcela {f.installment}: {money(f.amount)} · Vencimento
                  previsto {f.dueDate.slice(0, 10)} · {f.status}
                  <br />
                </small>
              ))}
            </div>
          ))}
          <h3>Movimentações de estoque</h3>
          {sale.movements?.map((m) => (
            <p key={m.id}>
              {m.reason}: {m.quantity} · {m.beforeQuantity} → {m.afterQuantity}
              <small>Movimento {m.id}</small>
            </p>
          ))}
          {auth.permissions.includes("sales:cancel") &&
            sale.status === "COMPLETED" &&
            sale.requestKey &&
            !sale.returns?.length &&
            !sale.exchangeOrigin &&
            !cancel && (
              <button className="secondary" onClick={() => setCancel(true)}>
                Cancelar venda
              </button>
            )}
          {cancel && (
            <form onSubmit={(e) => void cancelSubmit(e)}>
              <label>
                Motivo do cancelamento
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={2000}
                  disabled={busy}
                />
              </label>
              <label className="pdv-checkbox">
                <input
                  type="checkbox"
                  name="refundConfirmed"
                  required
                  disabled={busy}
                />
                Confirmo que tratei a devolução manual dos valores. Não há
                estorno bancário automático.
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Cancelando…" : "Confirmar cancelamento"}
              </button>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
