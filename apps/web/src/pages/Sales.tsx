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
  splitCents,
  paymentNames,
  type Discount,
  type Checkout,
} from "@caramelo/contracts";
import { api, money, dateTime, type Auth, type Page } from "../api";
import { ErrorMessage, Modal, Pagination } from "../components";
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
  warehouses: Array<{
    id: string;
    name: string;
    branch: { id: string; name: string };
  }>;
  operators: Array<{ id: string; user: { name: string } }>;
};
type PaymentDraft = Checkout["payments"][number] & { id: string };
type Sale = {
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
const newPayment = (): PaymentDraft => ({
  id: crypto.randomUUID(),
  method: "PIX",
  amount: "0",
  installments: 1,
  confirmed: false,
});
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
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
        <SalesHistory options={options} version={version} onView={setDetail} />
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
  function changePayment(id: string, update: Partial<PaymentDraft>) {
    setPayments((p) => p.map((x) => (x.id === id ? { ...x, ...update } : x)));
    renew();
  }
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
        <h3>Pagamentos manuais</h3>
        <p className="helper-text">
          Confirme PIX e cartão somente após receber fora do Caramelo.
        </p>
        <fieldset className="stock-fieldset" disabled={busy || review}>
          {payments.map((p, i) => {
            let change = "—",
              parts = "";
            try {
              change = reais(cents(p.receivedAmount ?? "0") - cents(p.amount));
              if (p.method === "CREDIT_CARD")
                parts = splitCents(cents(p.amount), p.installments)
                  .map((v) => money(reais(v)))
                  .join(" + ");
            } catch {
              /* incomplete form */
            }
            return (
              <div className="pdv-payment" key={p.id}>
                <label>
                  Forma de pagamento
                  <select
                    aria-label={`Forma de pagamento ${i + 1}`}
                    value={p.method}
                    onChange={(e) =>
                      changePayment(p.id, {
                        method: e.target.value as PaymentDraft["method"],
                        receivedAmount: undefined,
                        installments: 1,
                        confirmed: false,
                      })
                    }
                  >
                    {Object.entries(paymentNames).map(([v, n]) => (
                      <option value={v} key={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Valor aplicado (R$)
                  <input
                    aria-label={`Valor do pagamento ${i + 1}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={p.amount}
                    onChange={(e) =>
                      changePayment(p.id, { amount: e.target.value })
                    }
                  />
                </label>
                {p.method === "CASH" ? (
                  <>
                    <label>
                      Valor recebido (R$)
                      <input
                        aria-label={`Valor recebido ${i + 1}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={p.receivedAmount ?? ""}
                        onChange={(e) =>
                          changePayment(p.id, {
                            receivedAmount: e.target.value,
                          })
                        }
                      />
                    </label>
                    <p>
                      Troco:{" "}
                      <strong>{change === "—" ? change : money(change)}</strong>
                    </p>
                  </>
                ) : (
                  <label className="pdv-checkbox">
                    <input
                      type="checkbox"
                      aria-label={`Recebimento externo confirmado ${i + 1}`}
                      checked={p.confirmed}
                      onChange={(e) =>
                        changePayment(p.id, { confirmed: e.target.checked })
                      }
                    />
                    Pagamento confirmado na maquininha / conta externa
                  </label>
                )}
                {p.method === "CREDIT_CARD" && (
                  <>
                    <label>
                      Parcelas
                      <select
                        aria-label={`Parcelas ${i + 1}`}
                        value={p.installments}
                        onChange={(e) =>
                          changePayment(p.id, {
                            installments: Number(e.target.value),
                          })
                        }
                      >
                        {Array.from({ length: 12 }, (_, n) => (
                          <option key={n} value={n + 1}>
                            {n + 1}x
                          </option>
                        ))}
                      </select>
                    </label>
                    <small>{parts}</small>
                  </>
                )}
                {(p.method === "CREDIT_CARD" || p.method === "DEBIT_CARD") && (
                  <label>
                    Bandeira (opcional)
                    <input
                      value={p.cardBrand ?? ""}
                      maxLength={60}
                      onChange={(e) =>
                        changePayment(p.id, { cardBrand: e.target.value })
                      }
                    />
                  </label>
                )}
                <label>
                  Referência / observação (opcional)
                  <input
                    value={p.reference ?? ""}
                    maxLength={200}
                    placeholder="Sem dados sensíveis do cartão"
                    onChange={(e) =>
                      changePayment(p.id, { reference: e.target.value })
                    }
                  />
                </label>
                <button
                  className="secondary"
                  onClick={() => {
                    setPayments((v) => v.filter((x) => x.id !== p.id));
                    renew();
                  }}
                >
                  Remover pagamento {i + 1}
                </button>
              </div>
            );
          })}
          <button
            className="secondary"
            disabled={payments.length >= 8}
            onClick={() => {
              setPayments((v) => [...v, newPayment()]);
              renew();
            }}
          >
            Adicionar pagamento
          </button>
        </fieldset>
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
function SalesHistory({
  options,
  version,
  onView,
}: {
  options: Options;
  version: number;
  onView: (id: string) => void;
}) {
  const filters = useRef<HTMLFormElement>(null);
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [query, setQuery] = useState("from=" + today() + "&to=" + today()),
    [page, setPage] = useState(1),
    [data, setData] = useState<Page<Sale> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setError("");
    api<Page<Sale>>("/sales?" + query + "&page=" + page)
      .then((r) => {
        if (current) setData(r);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [query, page, version]);
  function period(days: number) {
    const end = today(),
      start = new Date(end + "T12:00:00Z");
    start.setUTCDate(start.getUTCDate() - days + 1);
    const day = start.toISOString().slice(0, 10);
    setFrom(day);
    setTo(end);
    const values = new FormData(filters.current!);
    values.set("from", day);
    values.set("to", end);
    setQuery(
      new URLSearchParams(
        [...values.entries()].filter(([, v]) => !!v) as [string, string][],
      ).toString(),
    );
    setPage(1);
  }
  return (
    <section className="card stock-entry">
      <h2>Histórico de vendas</h2>
      <div className="stock-tabs">
        {[
          [1, "Hoje"],
          [7, "7 dias"],
          [30, "30 dias"],
        ].map(([d, n]) => (
          <button
            className="secondary"
            key={d}
            onClick={() => period(Number(d))}
          >
            {n}
          </button>
        ))}
      </div>
      <form
        ref={filters}
        className="stock-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.entries(
            Object.fromEntries(new FormData(e.currentTarget)),
          ).filter(([, v]) => !!v);
          setQuery(
            new URLSearchParams(values as [string, string][]).toString(),
          );
          setPage(1);
        }}
      >
        <label>
          De
          <input
            type="date"
            name="from"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            name="to"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          Filial
          <select name="branchId">
            <option value="">Todas autorizadas</option>
            {[
              ...new Map(
                options.warehouses.map((w) => [w.branch.id, w.branch]),
              ).values(),
            ].map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Operador
          <select name="operatorId">
            <option value="">Todos</option>
            {options.operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cliente
          <input
            name="customerQuery"
            placeholder="Nome, documento ou contato"
          />
        </label>
        <label>
          Status
          <select name="status">
            <option value="">Todos</option>
            <option value="COMPLETED">Concluída</option>
            <option value="CANCELLED">Cancelada</option>
            <option value="QUOTE">Orçamento legado</option>
            <option value="ORDER">Pedido legado</option>
            <option value="RETURNED">Devolvida legada</option>
          </select>
        </label>
        <button className="primary">Filtrar vendas</button>
      </form>
      <ErrorMessage message={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Número / Data",
                "Cliente",
                "Filial / Operador",
                "Exemplares",
                "Total",
                "Pagamento",
                "Status",
                "",
              ].map((s, i) => (
                <th key={i}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id}>
                <td>
                  #{s.number}
                  <small>{dateTime(s.createdAt)}</small>
                </td>
                <td>{s.customer?.name ?? "Não identificado"}</td>
                <td>
                  {s.branch.name}
                  <small>{s.seller.user.name}</small>
                </td>
                <td>{s.items.reduce((n, i) => n + Number(i.quantity), 0)}</td>
                <td>{money(s.total)}</td>
                <td>
                  {s.payments
                    .map((p) => paymentNames[p.method] ?? p.method)
                    .join(" + ")}
                </td>
                <td>
                  {s.status === "COMPLETED"
                    ? "Concluída"
                    : s.status === "CANCELLED"
                      ? "Cancelada"
                      : s.status}
                </td>
                <td>
                  <button className="secondary" onClick={() => onView(s.id)}>
                    Ver venda #{s.number}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.items.length === 0 && <p>Nenhuma venda neste período.</p>}
      {data && <Pagination {...data} onChange={setPage} />}
    </section>
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
  const [sale, setSale] = useState<Sale | null>(null),
    [error, setError] = useState(""),
    [cancel, setCancel] = useState(false),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    api<Sale>("/sales/" + id)
      .then(setSale)
      .catch((e) => setError(e.message));
  }, [id]);
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
