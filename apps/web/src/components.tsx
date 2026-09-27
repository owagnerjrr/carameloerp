import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
export function Loading() {
  return (
    <div className="state">
      <LoaderCircle className="spin" size={24} />
      <p>Carregando seus dados…</p>
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      <TriangleAlert size={18} />
      {message}
    </div>
  ) : null;
}
export function Empty({
  text = "Nenhum registro encontrado.",
}: {
  text?: string;
}) {
  return <div className="empty">{text}</div>;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="modal"
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Fechar">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total} registro{total !== 1 ? "s" : ""} · Página {page} de{" "}
        {Math.max(1, Math.ceil(total / limit))}
      </span>
      <div>
        <button
          className="icon-button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="icon-button"
          disabled={page * limit >= total}
          onClick={() => onChange(page + 1)}
          aria-label="Próxima página"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
