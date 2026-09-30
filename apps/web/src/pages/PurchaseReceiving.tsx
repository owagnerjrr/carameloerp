import { useEffect, useRef, useState, type FormEvent } from "react";
import { divergenceNames } from "@caramelo/contracts";
import { api, type Auth } from "../api";
import { Modal, ErrorMessage } from "../components";
import { useBarcodeReader } from "../useBarcodeReader";
import {
  decimal,
  cents,
  usePurchaseRequest,
  type Book,
  type Options,
  type Purchase,
} from "./PurchaseShared";
type Line = { orderItemId: string; quantity: number; unitCost: string };
type Divergence = {
  productId: string;
  type: string;
  quantity: number;
  notes: string;
};
export function PurchaseReceiving({
  order,
  options,
  auth,
  onClose,
  onSaved,
}: {
  order: Purchase;
  options: Options;
  auth: Auth;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [lines, setLines] = useState<Line[]>(
      order.items.map((i) => ({
        orderItemId: i.id,
        quantity: 0,
        unitCost: decimal(cents(i.unitCost) - cents(i.unitDiscount)),
      })),
    ),
    latest = useRef(lines),
    [warehouseId, setWarehouse] = useState(
      options.warehouses.find((w) => w.branchId === order.branchId)?.id ?? "",
    ),
    [receivedAt, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [freight, setFreight] = useState("0"),
    [expenses, setExpenses] = useState("0"),
    [notes, setNotes] = useState(""),
    [excessReason, setReason] = useState(""),
    [divergences, setDivergences] = useState<Divergence[]>([]),
    [unknown, setUnknown] = useState<Book[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const canExcess = auth.permissions.includes("purchases:excess"),
    send = usePurchaseRequest(),
    form = useRef<HTMLFormElement>(null);
  function change(value: Line[]) {
    latest.current = value;
    setLines(value);
  }
  const reader = useBarcodeReader(
    !busy,
    async (code) => {
      const books = await api<Book[]>(
          "/purchases/books?code=" + encodeURIComponent(code),
        ),
        book = books[0];
      if (!book)
        throw Error(
          "ISBN/código não cadastrado. Cadastre o livro antes de registrar a ocorrência.",
        );
      const item = order.items.find((i) => i.productId === book.id);
      if (!item) {
        setUnknown((old) =>
          old.some((b) => b.id === book.id) ? old : [...old, book],
        );
        throw Error(
          "Produto não solicitado. Registre uma divergência; ele não entrará no estoque.",
        );
      }
      const line = latest.current.find((l) => l.orderItemId === item.id)!;
      if (
        line.quantity + 1 > item.quantity - item.receivedQuantity &&
        !canExcess
      )
        throw Error("Quantidade acima do pedido.");
      change(
        latest.current.map((l) =>
          l.orderItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l,
        ),
      );
      setError("");
    },
    (e) => setError(e.message),
  );
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
  const excess = lines.some((l) => {
    const i = order.items.find((i) => i.id === l.orderItemId)!;
    return l.quantity > Math.max(0, i.quantity - i.receivedQuantity);
  });
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (busy || reader.pending) return;
    setBusy(true);
    setError("");
    try {
      await send("/purchases/" + order.id + "/receipts", {
        warehouseId,
        receivedAt,
        freight,
        expenses,
        notes,
        excessReason,
        items: lines.filter((l) => l.quantity > 0),
        divergences,
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={"Receber pedido #" + order.number}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form ref={form} onSubmit={confirm}>
        <fieldset disabled={busy}>
          <p>
            Registre somente unidades aceitas no estoque. Itens danificados ou
            diferentes devem constar nas divergências.
          </p>
          <div className="form-grid">
            <label>
              Depósito de destino
              <select
                required
                value={warehouseId}
                onChange={(e) => setWarehouse(e.target.value)}
              >
                {options.warehouses
                  .filter((w) => w.branchId === order.branchId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Data do recebimento
              <input
                type="date"
                required
                min={order.orderedAt.slice(0, 10)}
                value={receivedAt}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <label>
            Ler ISBN / código de barras
            <input
              ref={reader.input}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter") reader.scan(e);
              }}
            />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Livro</th>
                  <th>Pedido</th>
                  <th>Já recebido</th>
                  <th>Conferido agora</th>
                  <th>Falta</th>
                  <th>Custo líquido unitário real</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => {
                  const l = lines.find((l) => l.orderItemId === i.id)!;
                  return (
                    <tr key={i.id}>
                      <td>
                        {i.title}
                        <small>{i.isbn}</small>
                      </td>
                      <td>{i.quantity}</td>
                      <td>{i.receivedQuantity}</td>
                      <td>
                        <input
                          aria-label={"Conferido " + i.title}
                          type="number"
                          required
                          min="0"
                          max={
                            canExcess
                              ? 100000
                              : Math.max(0, i.quantity - i.receivedQuantity)
                          }
                          step="1"
                          value={l.quantity}
                          onChange={(e) =>
                            change(
                              lines.map((x) =>
                                x.orderItemId === i.id
                                  ? {
                                      ...x,
                                      quantity: Math.trunc(
                                        Number(e.target.value),
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        {Math.max(
                          0,
                          i.quantity - i.receivedQuantity - l.quantity,
                        )}
                      </td>
                      <td>
                        <input
                          aria-label={"Custo real " + i.title}
                          type="number"
                          required
                          min="0"
                          step="0.01"
                          value={l.unitCost}
                          onChange={(e) =>
                            change(
                              lines.map((x) =>
                                x.orderItemId === i.id
                                  ? { ...x, unitCost: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {excess && (
            <label>
              Justificativa do excedente
              <textarea
                required
                minLength={8}
                maxLength={2000}
                value={excessReason}
                onChange={(e) => setReason(e.target.value)}
              />
              <small>
                Quantidade acima do pedido. A confirmação exige permissão
                específica.
              </small>
            </label>
          )}
          <div className="form-grid">
            <label>
              Frete desta entrega
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
              />
            </label>
            <label>
              Despesas desta entrega
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
              />
            </label>
            <label>
              Observações da conferência
              <textarea
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
          <h3>Divergências</h3>
          {divergences.map((d, index) => (
            <div className="purchase-divergence form-grid" key={index}>
              <label>
                Produto da divergência
                <select
                  value={d.productId}
                  required
                  onChange={(e) =>
                    setDivergences((v) =>
                      v.map((x, n) =>
                        n === index ? { ...x, productId: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {order.items.map((i) => (
                    <option key={i.productId} value={i.productId}>
                      {i.title}
                    </option>
                  ))}
                  {unknown.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.description}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo da divergência
                <select
                  value={d.type}
                  onChange={(e) =>
                    setDivergences((v) =>
                      v.map((x, n) =>
                        n === index ? { ...x, type: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {Object.entries(divergenceNames)
                    .filter(([key]) => key !== "EXCESS")
                    .map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Quantidade divergente
                <input
                  type="number"
                  required
                  min="1"
                  max="100000"
                  step="1"
                  value={d.quantity}
                  onChange={(e) =>
                    setDivergences((v) =>
                      v.map((x, n) =>
                        n === index
                          ? {
                              ...x,
                              quantity: Math.trunc(Number(e.target.value)),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Descrição da divergência
                <textarea
                  required
                  minLength={8}
                  maxLength={2000}
                  value={d.notes}
                  onChange={(e) =>
                    setDivergences((v) =>
                      v.map((x, n) =>
                        n === index ? { ...x, notes: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setDivergences((v) => v.filter((_, n) => n !== index))
                }
              >
                Remover divergência
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setDivergences((v) => [
                ...v,
                {
                  productId: unknown.at(-1)?.id ?? order.items[0]!.productId,
                  type: unknown.length ? "UNORDERED" : "MISSING",
                  quantity: 1,
                  notes: "",
                },
              ])
            }
          >
            Adicionar divergência
          </button>
          <ErrorMessage message={error} />
          <div className="modal-actions">
            <button
              className="primary"
              disabled={
                busy ||
                reader.pending > 0 ||
                (!lines.some((l) => l.quantity > 0) && !divergences.length)
              }
            >
              Confirmar recebimento
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
