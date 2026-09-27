import { useEffect, useRef, useState, type FormEvent } from "react";
import { cents, reais, paymentNames } from "@caramelo/contracts";
import { api, money, dateTime, type Auth, type Page } from "../api";
import { ErrorMessage, Modal, Pagination } from "../components";
type Summary = {
  creditIssued: string;
  opening: string;
  sales: Record<string, string>;
  supplies: string;
  withdrawals: string;
  reversals: string;
  totalSold: string;
  expected: string;
};
type Session = {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingAmount: string;
  expectedAmount: string | null;
  countedAmount: string | null;
  difference: string | null;
  openingNotes: string | null;
  closingNotes: string | null;
  cashRegister: { name: string };
  branch: { name: string };
  openedBy: { user: { name: string } };
  summary: Summary;
  movements: Array<{
    id: string;
    createdAt: string;
    kind: string;
    method: string | null;
    amount: string;
    description: string;
    actor: { user: { name: string } } | null;
  }>;
};
type Options = {
  registers: Array<{
    id: string;
    name: string;
    branch: { id: string; name: string };
  }>;
  branches: Array<{ id: string; name: string }>;
};
const kinds: Record<string, string> = {
  OPENING: "Abertura",
  SUPPLY: "Suprimento",
  WITHDRAWAL: "Sangria",
  RECEIPT: "Recebimento de venda",
  REVERSAL: "Cancelamento/estorno registrado",
  LEGACY: "Legado",
};
function CashSummary({ value }: { value: Summary }) {
  return (
    <div className="cash-summary">
      <div>
        <span>Dinheiro esperado na gaveta</span>
        <strong className="pdv-grand-total">{money(value.expected)}</strong>
        <small>PIX e cartões não compõem o dinheiro físico.</small>
      </div>
      <dl>
        {[
          ["Fundo inicial", value.opening],
          ...Object.entries(value.sales).map(([key, v]) => [
            paymentNames[key as keyof typeof paymentNames] ??
              (key === "OTHER" ? "Outros" : key),
            v,
          ]),
          ["Suprimentos", value.supplies],
          ["Sangrias", value.withdrawals],
          ["Cancelamentos / estornos", value.reversals],
          ["Vales emitidos", value.creditIssued],
          ["Total vendido líquido", value.totalSold],
        ].map(([key, v]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{money(v!)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
export function CashPage({ auth }: { auth: Auth }) {
  const [options, setOptions] = useState<Options>({
      registers: [],
      branches: [],
    }),
    [data, setData] = useState<Page<Session> | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Session | null>(null),
    [version, setVersion] = useState(0),
    [page, setPage] = useState(1),
    [modal, setModal] = useState<
      "open" | "SUPPLY" | "WITHDRAWAL" | "close" | "terminal" | null
    >(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [counted, setCounted] = useState("");
  const key = useRef(crypto.randomUUID());
  const operate = auth.permissions.includes("cash:operate");
  useEffect(() => {
    let current = true;
    Promise.all([
      api<Options>("/cash/options"),
      api<Page<Session>>("/cash/sessions?page=" + page),
    ])
      .then(([o, d]) => {
        if (current) {
          setOptions(o);
          setData(d);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      current = false;
    };
  }, [version, page]);
  useEffect(() => {
    let current = true;
    if (selected)
      api<Session>("/cash/sessions/" + selected)
        .then((s) => {
          if (current) setDetail(s);
        })
        .catch((e) => setError(e.message));
    return () => {
      current = false;
    };
  }, [selected, version]);
  function show(which: typeof modal) {
    key.current = crypto.randomUUID();
    setError("");
    setCounted("");
    setModal(which);
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modal || busy || !operate || e.altKey || e.ctrlKey || e.metaKey)
        return;
      if (e.key === "F2") {
        e.preventDefault();
        show("open");
      }
      if (e.key === "F10" && detail?.status === "OPEN") {
        e.preventDefault();
        show("close");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal, busy, operate, detail]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      let url = "",
        payload: object = {};
      if (modal === "terminal") {
        url = "/cash/registers";
        payload = { branchId: f.branchId, name: f.name };
      } else if (modal === "open") {
        url = "/cash/sessions";
        payload = {
          requestKey: key.current,
          cashRegisterId: f.cashRegisterId,
          openingAmount: f.openingAmount,
          notes: f.notes,
        };
      } else if (modal === "close") {
        url = "/cash/sessions/" + selected + "/close";
        payload = {
          requestKey: key.current,
          expectedAmount: detail!.summary.expected,
          countedAmount: counted,
          notes: f.notes,
        };
      } else {
        url = "/cash/sessions/" + selected + "/movements";
        payload = {
          requestKey: key.current,
          kind: modal,
          amount: f.amount,
          reason: f.reason,
        };
      }
      const r = await api<{ id: string }>(url, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (modal === "open") setSelected(r.id);
      setModal(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  let diff = "—";
  try {
    if (detail && counted)
      diff = money(reais(cents(counted) - cents(detail.summary.expected)));
  } catch {
    /* draft */
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO DA FILIAL</span>
          <h1>Caixa</h1>
          <p>Dinheiro físico, recebimentos e conferência rastreável.</p>
        </div>
        {operate && (
          <button className="primary" onClick={() => show("open")}>
            Abrir caixa
          </button>
        )}
      </div>
      <p className="helper-text">
        Atalhos: F2 abrir caixa · F10 fechar a sessão selecionada · Esc sair do
        formulário.
      </p>
      <ErrorMessage message={error} />
      {auth.permissions.includes("cash:manage") && (
        <button className="secondary" onClick={() => show("terminal")}>
          Novo terminal
        </button>
      )}
      <section className="card stock-entry">
        <h2>Sessões de caixa</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Status",
                  "Filial / terminal",
                  "Operador",
                  "Abertura",
                  "Fechamento",
                  "Conferência",
                  "",
                ].map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>
                      {s.status === "OPEN" ? "CAIXA ABERTO" : "CAIXA FECHADO"}
                    </strong>
                  </td>
                  <td>
                    {s.branch.name}
                    <small>{s.cashRegister.name}</small>
                  </td>
                  <td>{s.openedBy.user.name}</td>
                  <td>{dateTime(s.openedAt)}</td>
                  <td>{s.closedAt ? dateTime(s.closedAt) : "Em operação"}</td>
                  <td>
                    {s.difference !== null ? money(s.difference) : "Pendente"}
                  </td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => setSelected(s.id)}
                    >
                      Ver caixa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pagination {...data} onChange={setPage} />}
      </section>
      {detail && (
        <section className="card stock-entry cash-detail">
          <div className="page-heading">
            <div>
              <h2>
                {detail.cashRegister.name} ·{" "}
                {detail.status === "OPEN" ? "CAIXA ABERTO" : "CAIXA FECHADO"}
              </h2>
              <p>
                {detail.branch.name} · {detail.openedBy.user.name} ·{" "}
                {dateTime(detail.openedAt)}
              </p>
            </div>
            {operate && detail.status === "OPEN" && (
              <div className="form-actions">
                <button className="secondary" onClick={() => show("SUPPLY")}>
                  Suprimento
                </button>
                <button
                  className="secondary"
                  onClick={() => show("WITHDRAWAL")}
                >
                  Sangria
                </button>
                <button className="primary" onClick={() => show("close")}>
                  Fechar caixa
                </button>
              </div>
            )}
          </div>
          <button
            className="secondary"
            onClick={() => setVersion((v) => v + 1)}
          >
            Atualizar resumo
          </button>
          <p>
            Observação de abertura: {detail.openingNotes ?? "Não informada"}
          </p>
          <CashSummary value={detail.summary} />
          {detail.status === "CLOSED" && (
            <p className="stock-warning">
              Contado: {money(detail.countedAmount!)} · Diferença:{" "}
              <strong>{money(detail.difference!)}</strong>
              <br />
              Fechamento: {detail.closingNotes}
            </p>
          )}
          <h3>Movimentações da sessão</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Data/hora",
                    "Operação",
                    "Meio",
                    "Valor",
                    "Operador",
                    "Motivo / origem",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.movements.map((m) => (
                  <tr key={m.id}>
                    <td>{dateTime(m.createdAt)}</td>
                    <td>{kinds[m.kind] ?? m.kind}</td>
                    <td>
                      {paymentNames[m.method as keyof typeof paymentNames] ??
                        m.method ??
                        "—"}
                    </td>
                    <td>{money(m.amount)}</td>
                    <td>{m.actor?.user.name ?? "Legado"}</td>
                    <td>{m.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {modal && (
        <Modal
          title={
            modal === "open"
              ? "Abrir caixa"
              : modal === "close"
                ? "Conferir e fechar caixa"
                : modal === "terminal"
                  ? "Novo terminal"
                  : modal === "SUPPLY"
                    ? "Suprimento"
                    : "Sangria"
          }
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <form className="operation-form" onSubmit={(e) => void submit(e)}>
            {modal === "terminal" ? (
              <>
                <label>
                  Filial
                  <select name="branchId" required>
                    {options.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nome do terminal
                  <input name="name" required maxLength={80} />
                </label>
              </>
            ) : modal === "open" ? (
              <>
                <p>Operador: {auth.name}</p>
                <label>
                  Terminal / filial
                  <select
                    aria-label="Terminal / filial"
                    name="cashRegisterId"
                    required
                  >
                    {options.registers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.branch.name} — {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!options.registers.length && (
                  <p>Cadastre um terminal para iniciar.</p>
                )}
                <label>
                  Fundo inicial
                  <input
                    name="openingAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue="0"
                  />
                </label>
                <label>
                  Observações
                  <textarea name="notes" maxLength={2000} />
                </label>
              </>
            ) : modal === "close" ? (
              <>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setVersion((v) => v + 1)}
                >
                  Atualizar resumo
                </button>
                <CashSummary value={detail!.summary} />
                <label>
                  Dinheiro contado
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                  />
                </label>
                <h3>Diferença: {diff}</h3>
                <label>
                  Observação da conferência
                  <textarea
                    name="notes"
                    maxLength={2000}
                    placeholder="Explique diferenças encontradas"
                  />
                </label>
                <p>
                  O fechamento preserva esta conferência e bloqueia novas
                  operações na sessão.
                </p>
              </>
            ) : (
              <>
                <label>
                  Valor
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  Motivo
                  <textarea
                    name="reason"
                    required
                    minLength={8}
                    maxLength={2000}
                  />
                </label>
              </>
            )}
            <ErrorMessage message={error} />
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Voltar
              </button>
              <button className="primary" disabled={busy}>
                {busy
                  ? "Gravando…"
                  : modal === "open"
                    ? "Confirmar abertura"
                    : modal === "close"
                      ? "Confirmar fechamento"
                      : "Confirmar operação"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
