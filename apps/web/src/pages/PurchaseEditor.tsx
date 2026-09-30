import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, money } from "../api";
import { Modal, ErrorMessage } from "../components";
import { useBarcodeReader } from "../useBarcodeReader";
import {
  cents,
  decimal,
  usePurchaseRequest,
  type Book,
  type Options,
  type Purchase,
} from "./PurchaseShared";
export type DraftLine = {
  productId: string;
  title: string;
  isbn: string | null;
  quantity: number;
  unitCost: string;
  unitDiscount: string;
};
export function PurchaseEditor({
  options,
  order,
  initial,
  initialBranch,
  onClose,
  onSaved,
}: {
  options: Options;
  order?: Purchase;
  initial?: DraftLine[];
  initialBranch?: string;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [branchId, setBranch] = useState(
      order?.branchId ?? initialBranch ?? options.branches[0]?.id ?? "",
    ),
    [supplierId, setSupplier] = useState(order?.supplierId ?? ""),
    [buyerId, setBuyer] = useState(order?.buyerId ?? ""),
    [orderedAt, setDate] = useState(
      order?.orderedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    ),
    [expectedAt, setExpected] = useState(order?.expectedAt?.slice(0, 10) ?? ""),
    [notes, setNotes] = useState(order?.notes ?? ""),
    [freight, setFreight] = useState(order?.freight ?? "0"),
    [expenses, setExpenses] = useState(order?.expenses ?? "0"),
    [lines, setLines] = useState<DraftLine[]>(order?.items ?? initial ?? []),
    [q, setQ] = useState(""),
    [results, setResults] = useState<Book[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null),
    send = usePurchaseRequest();
  function add(b: Book) {
    setLines((old) =>
      old.some((i) => i.productId === b.id)
        ? old.map((i) =>
            i.productId === b.id ? { ...i, quantity: i.quantity + 1 } : i,
          )
        : [
            ...old,
            {
              productId: b.id,
              title: b.description,
              isbn: b.isbn13,
              quantity: 1,
              unitCost: b.cost,
              unitDiscount: "0",
            },
          ],
    );
  }
  const reader = useBarcodeReader(
    !busy,
    async (code) => {
      const books = await api<Book[]>(
        "/purchases/books?code=" + encodeURIComponent(code),
      );
      if (!books[0]) throw Error("Livro não encontrado.");
      add(books[0]);
      setError("");
    },
    (e) => setError(e.message),
  );
  async function search() {
    try {
      setResults(
        await api<Book[]>("/purchases/books?q=" + encodeURIComponent(q)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "F4") {
        e.preventDefault();
        reader.input.current?.focus();
      }
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        form.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [reader.input]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || reader.pending) return;
    setBusy(true);
    setError("");
    try {
      const result = await send<{ orderId: string }>(
        "/purchases" + (order ? "/" + order.id : ""),
        {
          order: {
            branchId,
            supplierId,
            buyerId,
            orderedAt,
            expectedAt: expectedAt || null,
            notes,
            freight,
            expenses,
            items: lines.map(
              ({ productId, quantity, unitCost, unitDiscount }) => ({
                productId,
                quantity,
                unitCost,
                unitDiscount,
              }),
            ),
          },
        },
        order ? "PUT" : "POST",
      );
      await onSaved(result.orderId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const gross = lines.reduce(
      (n, l) => n + cents(l.unitCost) * BigInt(l.quantity || 0),
      0n,
    ),
    discount = lines.reduce(
      (n, l) => n + cents(l.unitDiscount) * BigInt(l.quantity || 0),
      0n,
    );
  return (
    <Modal
      title={order ? "Editar pedido" : "Novo pedido de compra"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form ref={form} onSubmit={save}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Filial de destino
              <select
                required
                value={branchId}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setBuyer("");
                }}
              >
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
                required
                value={supplierId}
                onChange={(e) => setSupplier(e.target.value)}
              >
                <option value="">Selecione</option>
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
                required
                value={buyerId}
                onChange={(e) => setBuyer(e.target.value)}
              >
                <option value="">Selecione</option>
                {options.buyers
                  .filter((b) => !b.branchId || b.branchId === branchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.user.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Data do pedido
              <input
                type="date"
                required
                value={orderedAt}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Previsão de entrega
              <input
                type="date"
                min={orderedAt}
                value={expectedAt}
                onChange={(e) => setExpected(e.target.value)}
              />
            </label>
          </div>
          <label>
            Ler ISBN / código de barras
            <input
              ref={reader.input}
              onKeyDown={(e) => {
                if (e.key === "Enter") reader.scan(e);
              }}
              autoComplete="off"
            />
          </label>
          <div className="purchase-toolbar">
            <label>
              Pesquisar livro
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void search();
                  }
                }}
              />
            </label>
            <button type="button" onClick={() => void search()}>
              Pesquisar
            </button>
          </div>
          {results.length > 0 && (
            <div className="purchase-results">
              {results.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    add(b);
                    reader.input.current?.focus();
                  }}
                >
                  {b.description} · {b.isbn13} · {b.author} · {b.publisher}
                </button>
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Livro</th>
                  <th>Quantidade</th>
                  <th>Custo unitário</th>
                  <th>Desconto unitário</th>
                  <th>Subtotal</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.productId}>
                    <td>
                      {l.title}
                      <small>{l.isbn}</small>
                    </td>
                    <td>
                      <input
                        aria-label={"Quantidade " + l.title}
                        type="number"
                        required
                        min="1"
                        max="100000"
                        step="1"
                        value={l.quantity}
                        onChange={(e) =>
                          setLines((v) =>
                            v.map((i) =>
                              i.productId === l.productId
                                ? {
                                    ...i,
                                    quantity: Math.trunc(
                                      Number(e.target.value),
                                    ),
                                  }
                                : i,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={"Custo " + l.title}
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        value={l.unitCost}
                        onChange={(e) =>
                          setLines((v) =>
                            v.map((i) =>
                              i.productId === l.productId
                                ? { ...i, unitCost: e.target.value }
                                : i,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={"Desconto " + l.title}
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        value={l.unitDiscount}
                        onChange={(e) =>
                          setLines((v) =>
                            v.map((i) =>
                              i.productId === l.productId
                                ? { ...i, unitDiscount: e.target.value }
                                : i,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      {money(
                        decimal(
                          (cents(l.unitCost) - cents(l.unitDiscount)) *
                            BigInt(l.quantity || 0),
                        ),
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setLines((v) =>
                            v.filter((i) => i.productId !== l.productId),
                          )
                        }
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-grid">
            <label>
              Frete previsto
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
              />
            </label>
            <label>
              Outras despesas previstas
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
              />
            </label>
            <label>
              Observações
              <textarea
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
          <p>
            Bruto: {money(decimal(gross))} · Descontos:{" "}
            {money(decimal(discount))} · Total:{" "}
            <strong>
              {money(
                decimal(gross - discount + cents(freight) + cents(expenses)),
              )}
            </strong>
          </p>
          <ErrorMessage message={error} />
          <button
            className="primary"
            disabled={busy || reader.pending > 0 || !lines.length}
          >
            Salvar pedido
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
