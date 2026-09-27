import { useEffect, useRef, useState } from "react";
import { paymentNames } from "@caramelo/contracts";
import { api, money, dateTime, type Page } from "../api";
import { ErrorMessage, Pagination } from "../components";
type Column = { key: string; label: string; money: boolean };
type Results = Page<Record<string, string | number>> & { columns: Column[] };
type Options = {
  warehouses: Array<{ branch: { id: string; name: string } }>;
  operators: Array<{ id: string; user: { name: string } }>;
  cashRegisters: Array<{ id: string; name: string }>;
};
const date = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
const views = {
  sales: "Vendas",
  items: "Itens",
  cash: "Caixas",
  operators: "Por operador",
  payments: "Por forma de pagamento",
  hours: "Por horário",
  periods: "Períodos do dia",
};
export function SalesMovements({
  version = 0,
  onView,
  selection = false,
}: {
  version?: number;
  onView: (id: string) => void;
  selection?: boolean;
}) {
  const [view, setView] = useState<keyof typeof views>("sales"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<Results | null>(null),
    [error, setError] = useState(""),
    [options, setOptions] = useState<Options>({
      warehouses: [],
      operators: [],
      cashRegisters: [],
    });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    api<Options>("/sales/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let current = true;
    setError("");
    api<Results>("/sales/analysis?" + query + "&view=" + view + "&page=" + page)
      .then((d) => {
        if (current) setData(d);
      })
      .catch((e) => {
        if (current) {
          setError(e.message);
          setData(null);
        }
      });
    return () => {
      current = false;
    };
  }, [query, view, page, version]);
  function apply() {
    const values = [...new FormData(form.current!).entries()].filter(
      ([, v]) => !!v,
    ) as [string, string][];
    setQuery(new URLSearchParams(values).toString());
    setPage(1);
  }
  function period(days: number, offset = 0) {
    const f = form.current!,
      from = f.elements.namedItem("from") as HTMLInputElement,
      to = f.elements.namedItem("to") as HTMLInputElement;
    if (!days) {
      from.value = "";
      to.value = "";
    } else {
      const end = new Date(date() + "T12:00:00Z");
      end.setUTCDate(end.getUTCDate() - offset);
      to.value = end.toISOString().slice(0, 10);
      end.setUTCDate(end.getUTCDate() - days + 1);
      from.value = end.toISOString().slice(0, 10);
    }
    apply();
  }
  async function download() {
    try {
      const response = await fetch(
        "/api/sales/analysis?" + query + "&view=" + view + "&csv=true",
        { credentials: "same-origin" },
      );
      if (!response.ok) throw Error((await response.json()).message);
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = "caramelo-" + view + ".csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card stock-entry">
      <h2>
        {selection ? "Localizar venda original" : "Movimentações de vendas"}
      </h2>
      <p>
        Pesquise sem informar o dia da compra. Valores líquidos descontam os
        itens devolvidos; pagamentos mostram registros externos não estornados.
      </p>
      <div className="stock-tabs">
        {[
          [0, "Todo histórico"],
          [1, "Hoje"],
          [7, "7 dias"],
          [30, "30 dias"],
        ].map(([d, label]) => (
          <button
            className="secondary"
            key={label}
            onClick={() => period(Number(d))}
          >
            {label}
          </button>
        ))}
        <button className="secondary" onClick={() => period(1, 1)}>
          Ontem
        </button>
      </div>
      <form
        ref={form}
        className="stock-filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label>
          De
          <input type="date" name="from" />
        </label>
        <label>
          Até
          <input type="date" name="to" />
        </label>
        <label>
          Número da venda / pedido
          <input name="number" type="number" min="1" />
        </label>
        <label>
          Cliente / CPF/CNPJ / contato
          <input name="customerQuery" maxLength={100} />
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
          Caixa / terminal
          <select name="cashRegisterId">
            <option value="">Todos</option>
            {options.cashRegisters?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
          Livro
          <input name="book" maxLength={100} />
        </label>
        <label>
          ISBN/EAN
          <input name="isbn" maxLength={80} />
        </label>
        <label>
          Autor
          <input name="author" maxLength={100} />
        </label>
        <label>
          Editora
          <input name="publisher" maxLength={100} />
        </label>
        <label>
          Forma de pagamento
          <select name="method">
            <option value="">Todas</option>
            {Object.entries(paymentNames).map(([key, name]) => (
              <option value={key} key={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status">
            <option value="">Todos</option>
            <option value="COMPLETED">Concluída</option>
            <option value="CANCELLED">Cancelada</option>
            <option value="ORDER">Pedido legado</option>
            <option value="QUOTE">Orçamento legado</option>
            <option value="RETURNED">Devolvida legada</option>
          </select>
        </label>
        <label>
          Operação vinculada
          <select name="operation">
            <option value="">Todas</option>
            <option value="EXCHANGE">Com troca</option>
            <option value="RETURN">Com devolução</option>
          </select>
        </label>
        <button className="primary">Filtrar vendas</button>
      </form>
      {!selection && (
        <div className="stock-tabs" aria-label="Visões de vendas">
          {Object.entries(views).map(([id, name]) => (
            <button
              key={id}
              className={view === id ? "primary" : "secondary"}
              onClick={() => {
                setView(id as keyof typeof views);
                setPage(1);
              }}
            >
              {name}
            </button>
          ))}
          <button className="secondary" onClick={() => void download()}>
            Exportar CSV
          </button>
        </div>
      )}
      <ErrorMessage message={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {data?.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              {["sales", "items"].includes(view) && <th>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row, i) => (
              <tr key={String(row.id ?? row.group) + i}>
                {data.columns.map((c) => (
                  <td key={c.key}>
                    {c.money && row[c.key] !== ""
                      ? money(row[c.key]!)
                      : ["date", "opened", "closed"].includes(c.key) &&
                          String(row[c.key]).includes("T")
                        ? dateTime(String(row[c.key]))
                        : row[c.key] === "COMPLETED"
                          ? "Concluída"
                          : row[c.key] === "CANCELLED"
                            ? "Cancelada"
                            : row[c.key]}
                  </td>
                ))}
                {["sales", "items"].includes(view) && (
                  <td>
                    <button
                      className="secondary"
                      onClick={() => onView(String(row.id))}
                    >
                      {selection ? "Trocar / devolver #" : "Ver venda #"}
                      {row.number}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && !data.total && <p>Nenhum resultado com estes filtros.</p>}
      {data && <Pagination {...data} onChange={setPage} />}
    </section>
  );
}
