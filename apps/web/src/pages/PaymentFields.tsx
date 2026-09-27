import type { Dispatch, SetStateAction } from "react";
import {
  cents,
  reais,
  splitCents,
  paymentNames,
  type Checkout,
} from "@caramelo/contracts";
import { money } from "../api";
export type PaymentDraft = Checkout["payments"][number] & { id: string };
export const newPayment = (): PaymentDraft => ({
  id: crypto.randomUUID(),
  method: "PIX",
  amount: "0",
  installments: 1,
  confirmed: false,
});
export function PaymentFields({
  payments,
  setPayments,
  renew,
  busy = false,
  review = false,
  allowStoreCredit = false,
}: {
  payments: PaymentDraft[];
  setPayments: Dispatch<SetStateAction<PaymentDraft[]>>;
  renew: () => void;
  busy?: boolean;
  review?: boolean;
  allowStoreCredit?: boolean;
}) {
  function changePayment(id: string, update: Partial<PaymentDraft>) {
    setPayments((p) => p.map((x) => (x.id === id ? { ...x, ...update } : x)));
    renew();
  }
  return (
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
                  <option
                    value={v}
                    key={v}
                    disabled={v === "STORE_CREDIT" && !allowStoreCredit}
                  >
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
            ) : p.method === "STORE_CREDIT" ? (
              <p>
                Utiliza os vales mais antigos do cliente nesta filial. Não é
                recebimento externo.
              </p>
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
  );
}
