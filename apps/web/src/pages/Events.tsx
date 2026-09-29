import { useEffect, useRef, useState, type FormEvent } from "react";
import { eventNames, addScanned } from "@caramelo/contracts";
import { api, dateTime, type Auth, type Page } from "../api";
import { Modal, ErrorMessage, Pagination } from "../components";
import { useBarcodeReader } from "../useBarcodeReader";
type Options = {
  branches: { id: string; name: string }[];
  warehouses: { id: string; name: string; branchId: string }[];
  responsibles: {
    id: string;
    branchId: string | null;
    user: { name: string };
  }[];
};
type Book = {
  id: string;
  description: string;
  isbn13: string | null;
  author: string | null;
  publisher: string | null;
};
type Line = {
  productId: string;
  title: string;
  isbn?: string | null;
  quantity: number;
  expectedQuantity?: number;
};
type Doc = {
  id: string;
  code: string;
  kind: string;
  status: string;
  dispatchId: string | null;
  notes: string;
  createdAt: string;
  actor: { user: { name: string } };
  warehouse: { name: string } | null;
  items: Line[];
};
type Registration = {
  name: string;
  description: string;
  type: string;
  startsAt: string;
  endsAt: string;
  branchId: string;
  responsibleId: string;
  location: string;
  city: string;
  state: string;
  notes: string;
};
type EventRow = Registration & {
  id: string;
  code: string;
  status: string;
  warehouseId: string;
  transitWarehouseId: string;
};
type Detail = EventRow & {
  documents: Doc[];
  stock: {
    productId: string;
    title: string;
    isbn: string | null;
    author: string | null;
    publisher: string | null;
    sent: number;
    received: number;
    returned: number;
    current: number;
    transit: number;
  }[];
  summary: {
    titles: number;
    sent: number;
    received: number;
    returned: number;
    current: number;
    transit: number;
  };
};
const names: Record<string, string> = {
  CREATE: "Cadastro",
  UPDATE: "Alteração",
  PREPARE: "Preparação",
  DISPATCH: "Envio",
  RECEIVE: "Recebimento",
  RETURN: "Retorno",
  CLOSING: "Conferência",
  CLOSE: "Encerramento",
  CANCEL: "Cancelamento",
  SENT: "Enviado",
  PARTIAL: "Divergência / pendente",
  RECEIVED: "Recebido",
  CONFIRMED: "Confirmado",
};
export function EventsPage({ auth }: { auth: Auth }) {
  const [options, setOptions] = useState<Options>({
      branches: [],
      warehouses: [],
      responsibles: [],
    }),
    [list, setList] = useState<Page<EventRow> | null>(null),
    [view, setView] = useState("ACTIVE"),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [tab, setTab] = useState("Resumo"),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Registration | null>(null),
    [moving, setMoving] = useState<"dispatches" | "returns" | null>(null),
    [receiving, setReceiving] = useState<Doc | null>(null),
    [state, setState] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const retry = useRef({ signature: "", key: "" });
  const can = (p: string) => auth.permissions.includes("events:" + p);
  useEffect(() => {
    api<Options>("/events/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let active = true;
    setError("");
    if (selected) {
      api<Detail>("/events/" + selected)
        .then((d) => {
          if (active) setDetail(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    } else
      api<Page<EventRow>>(
        `/events?view=${view}&q=${encodeURIComponent(q)}&page=${page}`,
      )
        .then((d) => {
          if (active) setList(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected, view, q, page, version]);
  async function run(path: string, body: object, method = "POST") {
    if (busy) return;
    setBusy(true);
    setError("");
    const signature = JSON.stringify({ path, body, method });
    if (retry.current.signature !== signature)
      retry.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await api<Doc>(path, {
        method,
        body: JSON.stringify({ ...body, requestKey: retry.current.key }),
      });
      retry.current = { signature: "", key: "" };
      setEditing(null);
      setMoving(null);
      setReceiving(null);
      setState(null);
      setVersion((v) => v + 1);
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const blank = (): Registration => ({
    name: "",
    description: "",
    type: "FEIRA",
    startsAt: new Date().toISOString().slice(0, 10),
    endsAt: new Date().toISOString().slice(0, 10),
    branchId: options.branches[0]?.id ?? "",
    responsibleId: "",
    location: "",
    city: "",
    state: "MG",
    notes: "",
  });
  const open = (id: string) => {
    setDetail(null);
    setSelected(id);
    setTab("Resumo");
    setSearch("");
  };
  return (
    <section className="events-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">OPERAÇÕES EXTERNAS</span>
          <h1>Feiras / Eventos</h1>
          <p>Livros separados, envios conferidos e retornos rastreáveis.</p>
        </div>
        {!selected && can("create") && (
          <button className="primary" onClick={() => setEditing(blank())}>
            Novo evento
          </button>
        )}
        {selected && (
          <button onClick={() => setSelected(null)}>Voltar aos eventos</button>
        )}
      </div>
      <ErrorMessage message={error} />
      {!selected ? (
        <>
          <div className="toolbar">
            {[
              ["ACTIVE", "Eventos ativos"],
              ["UPCOMING", "Próximos eventos"],
              ["CLOSED", "Encerrados"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={view === key ? "primary" : ""}
                onClick={() => {
                  setView(key!);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
            <input
              aria-label="Pesquisar eventos"
              placeholder="Nome ou código"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Período</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list?.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.name}</strong>
                      <small>{e.code}</small>
                    </td>
                    <td>
                      {e.startsAt.slice(0, 10)} — {e.endsAt.slice(0, 10)}
                    </td>
                    <td>{eventNames[e.status]}</td>
                    <td>
                      <button onClick={() => open(e.id)}>Abrir evento</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list && !list.items.length && <p>Nenhum evento encontrado.</p>}
          </div>
          {list && <Pagination {...list} onChange={setPage} />}
        </>
      ) : detail ? (
        <>
          <h2>
            {detail.name}{" "}
            <small>
              {detail.code} · {eventNames[detail.status]}
            </small>
          </h2>
          <div className="toolbar">
            {["Resumo", "Estoque", "Envios", "Retornos", "Histórico"].map(
              (t) => (
                <button
                  key={t}
                  className={tab === t ? "primary" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ),
            )}
          </div>
          {tab === "Resumo" && (
            <>
              <div className="event-metrics">
                {[
                  ["Títulos em estoque", detail.summary.titles],
                  ["Unidades enviadas", detail.summary.sent],
                  ["Recebidas", detail.summary.received],
                  ["Retornadas", detail.summary.returned],
                  ["Estoque atual", detail.summary.current],
                  ["Em trânsito", detail.summary.transit],
                ].map(([label, value]) => (
                  <article className="panel" key={label}>
                    <small>{label}</small>
                    <h2>{value}</h2>
                  </article>
                ))}
              </div>
              <article className="panel">
                <p>{detail.description}</p>
                <p>
                  {detail.startsAt.slice(0, 10)} a {detail.endsAt.slice(0, 10)}{" "}
                  · {detail.location} · {detail.city}/{detail.state}
                </p>
                <p>
                  Filial:{" "}
                  {options.branches.find((b) => b.id === detail.branchId)?.name}{" "}
                  · Responsável:{" "}
                  {
                    options.responsibles.find(
                      (r) => r.id === detail.responsibleId,
                    )?.user.name
                  }
                </p>
                <p>{detail.notes}</p>
                <div className="toolbar">
                  {can("manage") && (
                    <>
                      {["DRAFT", "PREPARING"].includes(detail.status) && (
                        <button
                          onClick={() => {
                            const base = blank();
                            for (const k of Object.keys(
                              base,
                            ) as (keyof Registration)[])
                              base[k] =
                                detail[k]?.slice(
                                  0,
                                  k === "startsAt" || k === "endsAt"
                                    ? 10
                                    : undefined,
                                ) ?? "";
                            setEditing(base);
                          }}
                        >
                          Editar evento
                        </button>
                      )}
                      {detail.status === "DRAFT" && (
                        <button onClick={() => setState("PREPARE")}>
                          Iniciar preparação
                        </button>
                      )}
                      {detail.status === "OPEN" && (
                        <button onClick={() => setState("CLOSING")}>
                          Iniciar conferência
                        </button>
                      )}
                      {detail.status === "CLOSING" && (
                        <button onClick={() => setState("CLOSE")}>
                          Encerrar evento
                        </button>
                      )}
                      {["DRAFT", "PREPARING"].includes(detail.status) && (
                        <button onClick={() => setState("CANCEL")}>
                          Cancelar evento
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            </>
          )}
          {tab === "Estoque" && (
            <article className="panel">
              <label>
                Pesquisar estoque do evento
                <input
                  value={search}
                  placeholder="Título, ISBN, autor ou editora"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Livro / ISBN / Autor / Editora</th>
                      <th>Enviado</th>
                      <th>Recebido</th>
                      <th>Retornado</th>
                      <th>Atual</th>
                      <th>Trânsito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.stock
                      .filter((i) =>
                        [i.title, i.isbn, i.author, i.publisher]
                          .join(" ")
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((i) => (
                        <tr key={i.productId}>
                          <td>
                            {i.title}
                            <small>
                              {i.isbn} · {i.author} · {i.publisher}
                            </small>
                          </td>
                          <td>{i.sent}</td>
                          <td>{i.received}</td>
                          <td>{i.returned}</td>
                          <td>{i.current}</td>
                          <td>{i.transit}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
          {(tab === "Envios" || tab === "Retornos") && (
            <>
              <div className="toolbar">
                {can("stock") &&
                  (tab === "Envios"
                    ? ["PREPARING", "IN_TRANSIT", "OPEN"]
                    : ["OPEN", "CLOSING"]
                  ).includes(detail.status) && (
                    <button
                      className="primary"
                      onClick={() =>
                        setMoving(tab === "Envios" ? "dispatches" : "returns")
                      }
                    >
                      {tab === "Envios" ? "Enviar livros" : "Retornar livros"}
                    </button>
                  )}
              </div>
              {detail.documents
                .filter(
                  (d) => d.kind === (tab === "Envios" ? "DISPATCH" : "RETURN"),
                )
                .map((d) => (
                  <article key={d.id} className="panel">
                    <h3>
                      {d.code} · {names[d.status]}
                    </h3>
                    <p>
                      {dateTime(d.createdAt)} · {d.actor.user.name} ·{" "}
                      {d.warehouse?.name}
                    </p>
                    <p>{d.notes}</p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Livro</th>
                            <th>
                              {tab === "Envios" ? "Enviado" : "Retornado"}
                            </th>
                            <th>Recebido</th>
                            <th>Diferença</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.items.map((i) => {
                            const n = detail.documents
                              .filter((r) => r.dispatchId === d.id)
                              .reduce(
                                (s, r) =>
                                  s +
                                  (r.items.find(
                                    (x) => x.productId === i.productId,
                                  )?.quantity ?? 0),
                                0,
                              );
                            return (
                              <tr key={i.productId}>
                                <td>{i.title}</td>
                                <td>{i.quantity}</td>
                                <td>{d.kind === "DISPATCH" ? n : "—"}</td>
                                <td>
                                  {d.kind === "DISPATCH" ? n - i.quantity : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {d.kind === "DISPATCH" &&
                      d.status !== "RECEIVED" &&
                      can("stock") && (
                        <button onClick={() => setReceiving(d)}>
                          Conferir recebimento
                        </button>
                      )}
                    {detail.documents
                      .filter((r) => r.dispatchId === d.id)
                      .map((r) => (
                        <p key={r.id}>
                          {r.code} · {dateTime(r.createdAt)} ·{" "}
                          {r.actor.user.name} · {r.notes} ·{" "}
                          {r.items
                            .map(
                              (i) =>
                                `${i.title}: conferido ${i.quantity}, pendente anterior ${i.expectedQuantity}, diferença ${i.quantity - (i.expectedQuantity ?? 0)}`,
                            )
                            .join("; ")}
                        </p>
                      ))}
                  </article>
                ))}
            </>
          )}
          {tab === "Histórico" && (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Documento / Operação</th>
                    <th>Data / Operador</th>
                    <th>Observações / Itens</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.documents.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {d.code}
                        <small>{names[d.kind]}</small>
                      </td>
                      <td>
                        {dateTime(d.createdAt)}
                        <small>{d.actor.user.name}</small>
                      </td>
                      <td>
                        {d.notes}
                        <small>
                          {d.items
                            .map((i) => `${i.title}: ${i.quantity}`)
                            .join("; ")}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p>Carregando evento…</p>
      )}
      {editing && (
        <Modal
          title={selected ? "Editar evento" : "Novo evento"}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                selected ? "/events/" + selected : "/events",
                { event: editing },
                selected ? "PUT" : "POST",
              ).catch(() => {});
            }}
          >
            <fieldset disabled={busy}>
              <div className="form-grid">
                {[
                  ["name", "Nome do evento"],
                  ["description", "Descrição"],
                  ["startsAt", "Data inicial"],
                  ["endsAt", "Data final"],
                  ["location", "Local"],
                  ["city", "Cidade"],
                  ["state", "UF"],
                  ["notes", "Observações"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      required={[
                        "name",
                        "startsAt",
                        "endsAt",
                        "location",
                        "city",
                        "state",
                      ].includes(key!)}
                      type={key?.endsWith("At") ? "date" : "text"}
                      value={editing[key as keyof Registration]}
                      onChange={(e) =>
                        setEditing({ ...editing, [key!]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  Tipo
                  <select
                    value={editing.type}
                    onChange={(e) =>
                      setEditing({ ...editing, type: e.target.value })
                    }
                  >
                    {[
                      "FEIRA",
                      "ESCOLA",
                      "UNIVERSIDADE",
                      "CONGRESSO",
                      "EXPOSICAO",
                      "OUTRO",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Filial responsável
                  <select
                    required
                    disabled={!!selected}
                    value={editing.branchId}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        branchId: e.target.value,
                        responsibleId: "",
                      })
                    }
                  >
                    {options.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Responsável
                  <select
                    required
                    value={editing.responsibleId}
                    onChange={(e) =>
                      setEditing({ ...editing, responsibleId: e.target.value })
                    }
                  >
                    <option value="">Selecione</option>
                    {options.responsibles
                      .filter(
                        (r) => !r.branchId || r.branchId === editing.branchId,
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.user.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <ErrorMessage message={error} />
              <button className="primary">Salvar evento</button>
            </fieldset>
          </form>
        </Modal>
      )}
      {moving && detail && (
        <MoveForm
          key={moving}
          kind={moving}
          options={options}
          detail={detail}
          busy={busy}
          error={error}
          close={() => {
            if (!busy) setMoving(null);
          }}
          save={(body) => run(`/events/${detail.id}/${moving}`, body)}
        />
      )}
      {receiving && detail && (
        <ReceiveForm
          doc={receiving}
          detail={detail}
          busy={busy}
          error={error}
          close={() => {
            if (!busy) setReceiving(null);
          }}
          save={(body) => run(`/events/${detail.id}/receipts`, body)}
        />
      )}
      {state && detail && (
        <Modal
          title={names[state] ?? state}
          onClose={() => {
            if (!busy) setState(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const notes = String(new FormData(e.currentTarget).get("notes"));
              void run(`/events/${detail.id}/state`, {
                action: state,
                notes,
              }).catch(() => {});
            }}
          >
            <fieldset disabled={busy}>
              <p>
                Confirmar {names[state]?.toLowerCase()} de {detail.code}? O
                encerramento exige todos os livros retornados e nenhum trânsito
                pendente.
              </p>
              <label>
                Justificativa / observação
                <textarea
                  name="notes"
                  required={state === "CANCEL"}
                  minLength={state === "CANCEL" ? 8 : undefined}
                />
              </label>
              <ErrorMessage message={error} />
              <button className="primary">Confirmar alteração</button>
            </fieldset>
          </form>
        </Modal>
      )}
    </section>
  );
}
function MoveForm({
  kind,
  options,
  detail,
  busy,
  error,
  close,
  save,
}: {
  kind: string;
  options: Options;
  detail: Detail;
  busy: boolean;
  error: string;
  close: () => void;
  save: (body: object) => Promise<unknown>;
}) {
  const [warehouseId, setWarehouse] = useState(
      options.warehouses.find((w) => w.branchId === detail.branchId)?.id ?? "",
    ),
    [lines, setLines] = useState<Line[]>([]),
    [notes, setNotes] = useState(""),
    [q, setQ] = useState(""),
    [books, setBooks] = useState<Book[]>([]),
    [localError, setError] = useState(""),
    [review, setReview] = useState(false);
  const reader = useBarcodeReader(
    !busy && !review,
    async (code) => {
      const results = await api<Book[]>(
        "/events/books?code=" + encodeURIComponent(code),
      );
      if (!results[0]) throw Error("Livro não encontrado.");
      add(results[0]);
    },
    (e) => setError(e.message),
  );
  function add(b: Book) {
    setError("");
    setLines((current) => {
      const added = addScanned(
        current.map((i) => ({
          book: { id: i.productId, description: i.title, isbn13: i.isbn },
          quantity: i.quantity,
          unitCost: "0",
        })),
        b,
        "0",
      );
      return added.map((i) => ({
        productId: i.book.id,
        title: i.book.description,
        isbn: i.book.isbn13,
        quantity: i.quantity,
      }));
    });
  }
  async function search(e: FormEvent) {
    e.preventDefault();
    try {
      setBooks(await api<Book[]>("/events/books?q=" + encodeURIComponent(q)));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={
        kind === "dispatches"
          ? "Enviar livros para evento"
          : "Retornar livros para filial"
      }
      onClose={() => {
        if (!busy && !reader.pending) close();
      }}
    >
      <fieldset disabled={busy || review}>
        <label>
          {kind === "dispatches" ? "Depósito de origem" : "Depósito de destino"}
          <select
            value={warehouseId}
            onChange={(e) => setWarehouse(e.target.value)}
          >
            {options.warehouses
              .filter((w) => w.branchId === detail.branchId)
              .map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </label>
        <form onSubmit={reader.scan}>
          <label>
            ISBN/EAN/SKU
            <input
              ref={reader.input}
              placeholder="Leia o código e pressione Enter"
              autoComplete="off"
            />
          </label>
          <button>Adicionar código</button>
        </form>
        <form onSubmit={search}>
          <label>
            Pesquisar livro
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Título, autor, ISBN ou editora"
            />
          </label>
          <button>Pesquisar</button>
        </form>
        {books.map((b) => (
          <button type="button" key={b.id} onClick={() => add(b)}>
            {b.description} · {b.isbn13} · Adicionar
          </button>
        ))}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Livro / ISBN</th>
                <th>Quantidade</th>
                <th />
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
                      min="1"
                      max="100000"
                      value={l.quantity}
                      onChange={(e) =>
                        setLines(
                          lines.map((i) =>
                            i.productId === l.productId
                              ? { ...i, quantity: Number(e.target.value) }
                              : i,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      onClick={() =>
                        setLines(
                          lines.filter((i) => i.productId !== l.productId),
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
        <label>
          Observação da movimentação
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </fieldset>
      <ErrorMessage message={localError || error} />
      {!review ? (
        <button
          className="primary"
          disabled={
            busy ||
            !!reader.pending ||
            !lines.length ||
            !warehouseId ||
            lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1)
          }
          onClick={() => setReview(true)}
        >
          Revisar movimentação
        </button>
      ) : (
        <>
          <p>
            Confirmar {lines.reduce((n, l) => n + l.quantity, 0)} unidades em{" "}
            {lines.length} títulos?{" "}
            {kind === "dispatches"
              ? "Os livros sairão da filial e ficarão em trânsito até a conferência."
              : "Os livros sairão do evento e voltarão à filial."}
          </p>
          <button disabled={busy} onClick={() => setReview(false)}>
            Voltar à leitura
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void save({
                warehouseId,
                notes,
                items: lines.map(({ productId, quantity }) => ({
                  productId,
                  quantity,
                })),
              }).catch(() => {})
            }
          >
            {kind === "dispatches" ? "Confirmar envio" : "Confirmar retorno"}
          </button>
        </>
      )}
    </Modal>
  );
}
function ReceiveForm({
  doc,
  detail,
  busy,
  error,
  close,
  save,
}: {
  doc: Doc;
  detail: Detail;
  busy: boolean;
  error: string;
  close: () => void;
  save: (body: object) => Promise<unknown>;
}) {
  const [lines, setLines] = useState(() =>
      doc.items.map((i) => {
        const received = detail.documents
          .filter((d) => d.dispatchId === doc.id)
          .reduce(
            (n, d) =>
              n +
              (d.items.find((x) => x.productId === i.productId)?.quantity ?? 0),
            0,
          );
        return {
          ...i,
          expected: i.quantity - received,
          quantity: i.quantity - received,
          sent: i.quantity,
          received,
        };
      }),
    ),
    [notes, setNotes] = useState("");
  const divergence = lines.some((l) => l.quantity !== l.expected);
  return (
    <Modal title={"Conferir " + doc.code} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            dispatchId: doc.id,
            notes,
            items: lines.map(({ productId, quantity }) => ({
              productId,
              quantity,
            })),
          }).catch(() => {});
        }}
      >
        <fieldset disabled={busy}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Livro</th>
                  <th>Enviado</th>
                  <th>Já recebido</th>
                  <th>Recebido agora</th>
                  <th>Diferença pendente</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.productId}>
                    <td>{l.title}</td>
                    <td>{l.sent}</td>
                    <td>{l.received}</td>
                    <td>
                      <input
                        aria-label={"Recebido " + l.title}
                        type="number"
                        min="0"
                        max={l.expected}
                        required
                        value={l.quantity}
                        onChange={(e) =>
                          setLines(
                            lines.map((i) =>
                              i.productId === l.productId
                                ? { ...i, quantity: Number(e.target.value) }
                                : i,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>{l.quantity - l.expected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Uma falta permanece em trânsito, identificada neste envio.
            Conferência complementar pode receber as unidades restantes.
            Excedentes não são incorporados automaticamente.
          </p>
          <label>
            Justificativa do recebimento
            <textarea
              required={divergence}
              minLength={divergence ? 8 : undefined}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <ErrorMessage message={error} />
          <button className="primary">Confirmar recebimento</button>
        </fieldset>
      </form>
    </Modal>
  );
}
