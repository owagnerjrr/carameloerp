import { useEffect, useState } from "react";
import { cents, reais } from "@caramelo/contracts";
import { api, money, dateTime } from "../api";
import { ErrorMessage, Modal } from "../components";
type Credit = {
  id: string;
  amount: string;
  balance: string;
  status: string;
  createdAt: string;
  returnOperation: { number: number; branch: { name: string } };
  creditMovements: Array<{
    id: string;
    kind: string;
    amount: string;
    beforeBalance: string;
    afterBalance: string;
    createdAt: string;
    sale: { number: number } | null;
    actor: { user: { name: string } };
  }>;
};
const kinds: Record<string, string> = {
  ISSUE: "Emissão",
  REDEEM: "Utilização",
  RESTORE: "Restauração",
};
export function CreditBalance({
  customerId,
  branchId,
  version = 0,
}: {
  customerId?: string;
  branchId?: string;
  version?: number;
}) {
  const [credits, setCredits] = useState<Credit[]>([]),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setCredits([]);
    setError("");
    if (!customerId || !branchId) return;
    setLoading(true);
    api<Credit[]>("/credits?customerId=" + customerId + "&branchId=" + branchId)
      .then((d) => {
        if (active) setCredits(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId, branchId, version, refresh]);
  if (!customerId || !branchId)
    return (
      <p className="helper-text">
        Identifique o cliente e selecione a filial para consultar vale-crédito.
      </p>
    );
  const total = credits
    .filter((c) => c.status === "AVAILABLE")
    .reduce((n, c) => n + cents(c.balance), 0n);
  return (
    <div className="stock-entry">
      <strong>
        Vale-crédito disponível nesta filial:{" "}
        {loading ? "Consultando…" : money(reais(total))}
      </strong>
      <ErrorMessage message={error} />
      <p className="helper-text">
        Consumo automático dos vales mais antigos. Saldo confirmado no servidor
        ao concluir.
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setRefresh((v) => v + 1);
          setOpen(true);
        }}
      >
        Ver vales e histórico
      </button>
      {open && (
        <Modal
          title="Vales do cliente nesta filial"
          onClose={() => setOpen(false)}
        >
          {credits.length === 0 ? (
            <p>Nenhum vale nesta filial.</p>
          ) : (
            credits.map((c) => (
              <section className="stock-entry" key={c.id}>
                <h3>Vale da troca/devolução #{c.returnOperation.number}</h3>
                <p>
                  {c.returnOperation.branch.name} · {dateTime(c.createdAt)} ·{" "}
                  {c.status === "USED" ? "Utilizado" : "Disponível"}
                </p>
                <p>
                  Original: {money(c.amount)} · Saldo: {money(c.balance)}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Data",
                          "Operação",
                          "Valor",
                          "Antes",
                          "Depois",
                          "Origem",
                          "Operador",
                        ].map((t) => (
                          <th key={t}>{t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {c.creditMovements.map((m) => (
                        <tr key={m.id}>
                          <td>{dateTime(m.createdAt)}</td>
                          <td>{kinds[m.kind] ?? m.kind}</td>
                          <td>{money(m.amount)}</td>
                          <td>{money(m.beforeBalance)}</td>
                          <td>{money(m.afterBalance)}</td>
                          <td>
                            {m.sale
                              ? "Venda #" + m.sale.number
                              : "Troca/devolução #" + c.returnOperation.number}
                          </td>
                          <td>{m.actor.user.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </Modal>
      )}
    </div>
  );
}
