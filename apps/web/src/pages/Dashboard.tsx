import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  ShoppingBag,
  Plus,
  Package,
  ArrowRight,
  CalendarDays,
  TrendingUp,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api, money, number, type Auth } from "../api";
import { Empty, Loading, ErrorMessage } from "../components";
interface DashboardData {
  revenue: string;
  grossRevenue: string;
  returnsAmount: string;
  averageTicket: string | null;
  salesCount: number;
  daySales: string;
  dayCount: number;
  monthSales: string;
  receivables: string;
  payables: string;
  balance: string;
  customerCount: number;
  productCount: number;
  series: { date: string; income: string; expense: string }[];
  recentSales: {
    id: string;
    number: number;
    total: string;
    createdAt: string;
    customer: { name: string } | null;
  }[];
  recentCustomers: { id: string; name: string; city: string | null }[];
  lowStock: {
    id: string;
    description: string;
    quantity: string;
    minStock: string;
  }[];
  topProducts: {
    id: string;
    description: string;
    quantity: string;
    total: string;
  }[];
}
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function range(preset: string) {
  const to = today();
  let from = to;
  if (preset === "month") from = `${to.slice(0, 7)}-01`;
  else if (preset !== "today")
    from = new Date(
      Date.parse(`${to}T12:00:00Z`) - (preset === "7" ? 6 : 29) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  return { from, to };
}
export function Dashboard({
  auth,
  navigate,
}: {
  auth: Auth;
  navigate: (page: string) => void;
}) {
  const [preset, setPreset] = useState("month");
  const [dates, setDates] = useState(range("month"));
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<DashboardData>(`/dashboard?from=${dates.from}&to=${dates.to}`)
      .then((r) => {
        if (active) setData(r);
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
  }, [dates]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VISÃO GERAL DO NEGÓCIO</span>
          <h1>
            Olá, {auth.name.split(" ")[0]}. <span className="greeting-dot" />
          </h1>
          <p>Vamos acompanhar o que acontece na sua empresa?</p>
        </div>
        {auth.permissions.includes("customers:write") && (
          <button className="primary" onClick={() => navigate("customers")}>
            <Plus size={18} />
            Cadastrar cliente
          </button>
        )}
      </div>
      <div className="period-bar">
        <div className="period-tabs" aria-label="Período do dashboard">
          {[
            ["today", "Hoje"],
            ["7", "7 dias"],
            ["30", "30 dias"],
            ["month", "Este mês"],
            ["custom", "Personalizado"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={preset === id ? "selected" : ""}
              onClick={() => {
                setPreset(id!);
                if (id !== "custom") setDates(range(id!));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="date-range">
          <CalendarDays size={16} />
          {preset === "custom" ? (
            <>
              <input
                aria-label="Data inicial"
                type="date"
                value={dates.from}
                onChange={(e) => {
                  if (e.target.value)
                    setDates({ ...dates, from: e.target.value });
                }}
              />
              <span>até</span>
              <input
                aria-label="Data final"
                type="date"
                value={dates.to}
                onChange={(e) => {
                  if (e.target.value)
                    setDates({ ...dates, to: e.target.value });
                }}
              />
            </>
          ) : (
            <span>
              {dates.from.split("-").reverse().join("/")} —{" "}
              {dates.to.split("-").reverse().join("/")}
            </span>
          )}
        </div>
      </div>
      <ErrorMessage message={error} />
      {loading ? (
        <Loading />
      ) : data && !error ? (
        <>
          <div className="stats-grid">
            {[
              {
                label: "Venda líquida",
                value: data.revenue,
                caption: `${data.salesCount} vendas independentes no período`,
                icon: TrendingUp,
                color: "caramel",
              },
              {
                label: "Contas a receber",
                value: data.receivables,
                caption: "Em aberto · vencimento no período",
                icon: ArrowDownLeft,
                color: "green",
              },
              {
                label: "Contas a pagar",
                value: data.payables,
                caption: "Em aberto · vencimento no período",
                icon: ArrowUpRight,
                color: "orange",
              },
              {
                label: "Saldo em caixa",
                value: data.balance,
                caption: "Saldo acumulado até o fim do período",
                icon: Wallet,
                color: "blue",
              },
            ].map((k) => (
              <section className="stat-card" key={k.label}>
                <div>
                  <span>{k.label}</span>
                  <span className={`stat-icon ${k.color}`}>
                    <k.icon size={20} />
                  </span>
                </div>
                <strong>{money(k.value)}</strong>
                <small>{k.caption}</small>
              </section>
            ))}
          </div>
          <section className="card stock-entry">
            <h2>Resultado comercial do período</h2>
            <p>
              Venda bruta de mercadorias (após descontos, inclui reposições):{" "}
              <strong>{money(data.grossRevenue)}</strong> · Retornos ocorridos:{" "}
              <strong>{money(data.returnsAmount)}</strong> · Venda líquida:{" "}
              <strong>{money(data.revenue)}</strong>
            </p>
            <p>
              Ticket médio:{" "}
              {data.averageTicket === null
                ? "Sem vendas independentes no período"
                : money(data.averageTicket)}
              . Reposições de troca não contam como novas vendas. Cada venda e
              retorno entra pela sua própria data.
            </p>
          </section>
          <div className="dashboard-main">
            <section className="card chart-card">
              <div className="card-heading">
                <div>
                  <h2>Fluxo de caixa</h2>
                  <p>Entradas e saídas realizadas no período</p>
                </div>
                <div className="chart-legend">
                  <span>
                    <i className="income-dot" />
                    Entradas
                  </span>
                  <span>
                    <i className="expense-dot" />
                    Saídas
                  </span>
                </div>
              </div>
              <div
                className="chart"
                role="img"
                aria-label="Gráfico de entradas e saídas de caixa"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.series.map((s) => ({
                      ...s,
                      income: Number(s.income),
                      expense: Number(s.expense),
                    }))}
                    margin={{ top: 15, right: 10, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="income" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="#c27347"
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="100%"
                          stopColor="#c27347"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 5"
                      vertical={false}
                      stroke="#ece9e3"
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(s) => s.slice(8) + "/" + s.slice(5, 7)}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "#8a8a83" }}
                      minTickGap={35}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "#8a8a83" }}
                      width={55}
                      tickFormatter={(v) => `R$ ${v}`}
                    />
                    <Tooltip
                      formatter={(v, n) => [
                        money(Number(v)),
                        n === "income" ? "Entradas" : "Saídas",
                      ]}
                      labelFormatter={(v) =>
                        String(v).split("-").reverse().join("/")
                      }
                    />
                    <Area
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="income"
                      stroke="#b86a3e"
                      strokeWidth={2.5}
                      fill="url(#income)"
                    />
                    <Area
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="expense"
                      stroke="#91a793"
                      strokeWidth={2}
                      fill="transparent"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-footer">
                <span>
                  Entradas{" "}
                  <strong>
                    {money(
                      data.series.reduce((s, r) => s + Number(r.income), 0),
                    )}
                  </strong>
                </span>
                <span>
                  Saídas{" "}
                  <strong>
                    {money(
                      data.series.reduce((s, r) => s + Number(r.expense), 0),
                    )}
                  </strong>
                </span>
                <span>
                  Resultado do período{" "}
                  <strong>
                    {money(
                      data.series.reduce(
                        (s, r) => s + Number(r.income) - Number(r.expense),
                        0,
                      ),
                    )}
                  </strong>
                </span>
              </div>
            </section>
            <section className="card sales-summary">
              <span className="summary-icon">
                <ShoppingBag size={23} />
              </span>
              <h2>Cada venda, um passo.</h2>
              <p>Um olhar sobre seus resultados.</p>
              <div className="summary-value">
                <span>Vendas de hoje</span>
                <strong>{money(data.daySales)}</strong>
                <small>{data.dayCount} vendas concluídas</small>
              </div>
              <div className="summary-month">
                <span>Vendas neste mês</span>
                <strong>{money(data.monthSales)}</strong>
              </div>
              <div className="mini-counts">
                <div>
                  <strong>{data.customerCount}</strong>
                  <span>clientes ativos</span>
                </div>
                <div>
                  <strong>{data.productCount}</strong>
                  <span>produtos ativos</span>
                </div>
              </div>
            </section>
          </div>
          <div className="dashboard-secondary">
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>Vendas recentes</h2>
                  <p>Últimas vendas concluídas no período</p>
                </div>
                <span className="subtle-icon">
                  <ShoppingBag size={19} />
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Venda / Cliente</th>
                      <th>Valor</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSales.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>#{s.number}</strong>
                          <small>
                            {s.customer?.name ?? "Consumidor final"}
                          </small>
                        </td>
                        <td className="money-cell">{money(s.total)}</td>
                        <td>
                          <span className="badge green">Concluída</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.recentSales.length && <Empty />}
              </div>
            </section>
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>Atenção ao estoque</h2>
                  <p>Produtos no mínimo ou abaixo dele</p>
                </div>
                <span className="count-badge">
                  {data.lowStock.length}
                  {data.lowStock.length === 5 ? "+" : ""}
                </span>
              </div>
              <div className="stock-list">
                {data.lowStock.map((p) => (
                  <div className="stock-row" key={p.id}>
                    <span className="product-icon">
                      <Package size={19} />
                    </span>
                    <div>
                      <strong>{p.description}</strong>
                      <small>Mínimo: {number(p.minStock)} un.</small>
                    </div>
                    <span
                      className={`badge ${Number(p.quantity) === 0 ? "red" : "amber"}`}
                    >
                      {number(p.quantity)} un.
                    </span>
                  </div>
                ))}
                {!data.lowStock.length && (
                  <Empty text="Tudo certo com os níveis de estoque." />
                )}
              </div>
              {auth.permissions.includes("products:read") && (
                <button
                  className="card-link"
                  onClick={() => navigate("products")}
                >
                  Ver produtos <ArrowRight size={16} />
                </button>
              )}
            </section>
          </div>
          <div className="dashboard-secondary">
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>Produtos mais vendidos</h2>
                  <p>Ranking por quantidade no período</p>
                </div>
              </div>
              <div className="rank-list">
                {data.topProducts.map((p, i) => (
                  <div key={p.id}>
                    <span className="rank">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <strong>
                      {p.description}
                      <small>{number(p.quantity)} unidades vendidas</small>
                    </strong>
                    <span>{money(p.total)}</span>
                  </div>
                ))}
                {!data.topProducts.length && <Empty />}
              </div>
            </section>
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>Novos clientes</h2>
                  <p>Cadastros realizados no período</p>
                </div>
              </div>
              <div className="customer-list">
                {data.recentCustomers.map((c) => (
                  <div key={c.id}>
                    <span className="avatar soft">
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <strong>
                      {c.name}
                      <small>{c.city ?? "Cidade não informada"}</small>
                    </strong>
                  </div>
                ))}
                {!data.recentCustomers.length && <Empty />}
              </div>
            </section>
          </div>
          <div className="demo-notice">
            Os registros iniciais são fictícios e servem para demonstração. Os
            indicadores refletem os dados persistidos no banco.
          </div>
        </>
      ) : null}
    </>
  );
}
