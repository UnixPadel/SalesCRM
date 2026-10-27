import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../data/api";
import type { MailBody, MailResult, MailSummary } from "../domain/types";
import { useCrm } from "../state/CrmContext";
import { Button, fmtDate, Icon, IconButton, relDays, Skeleton, Zone } from "./ui";

type ListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; result: MailResult; refreshing?: boolean }
  | { status: "err"; error: string; noMailbox?: boolean };
type BodyState = { status: "loading" | "ok" | "err"; text: string };

/**
 * E-mails exchanged with one address, read live from a mailbox: INBOX for incoming, the
 * Sent folder for outgoing. Bodies load on demand.
 *  - `mailbox` empty: the logged-in person's own mailbox.
 *  - `mailbox` = a rep's address: that rep's mailbox (admins only, needs the IMAP master user).
 */
export function MailThread({ address, mailbox: preferredMailbox, ownerName }: { address: string; mailbox?: string; ownerName?: string }) {
  const { user } = useCrm();
  const [mailbox, setMailbox] = useState(preferredMailbox);
  const [st, setSt] = useState<ListState>({ status: "idle" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, BodyState>>({});

  useEffect(() => setMailbox(preferredMailbox), [preferredMailbox]);

  const load = useCallback(
    async (refresh = false) => {
      if (!address) return;
      setSt((s) => (s.status === "ok" ? { ...s, refreshing: true } : { status: "loading" }));
      try {
        const qs = new URLSearchParams({ address });
        if (mailbox) qs.set("mailbox", mailbox);
        if (refresh) qs.set("refresh", "1");
        const result = await api<MailResult>("GET", `/api/mail?${qs}`);
        setSt({ status: "ok", result });
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        setSt({ status: "err", error: err?.message ?? "Posta kutusu okunamadı.", noMailbox: err?.status === 409 });
      }
    },
    [address, mailbox],
  );

  useEffect(() => {
    setSt({ status: "idle" });
    setOpenId(null);
    setBodies({});
    load();
  }, [load]);

  const toggle = async (m: MailSummary) => {
    const next = openId === m.id ? null : m.id;
    setOpenId(next);
    if (!next || bodies[m.id]?.status === "ok") return;
    setBodies((b) => ({ ...b, [m.id]: { status: "loading", text: "" } }));
    try {
      const qs = new URLSearchParams({ folder: m.folder, uid: String(m.uid) });
      if (mailbox) qs.set("mailbox", mailbox);
      const r = await api<MailBody>("GET", `/api/mail/body?${qs}`);
      setBodies((b) => ({ ...b, [m.id]: { status: "ok", text: r.text } }));
    } catch (e) {
      setBodies((b) => ({ ...b, [m.id]: { status: "err", text: e instanceof ApiError ? e.message : "İleti okunamadı." } }));
    }
  };

  const list = st.status === "ok" ? st.result.list : [];
  const inCount = list.filter((m) => m.direction === "in").length;
  const outCount = list.length - inCount;
  const whose = mailbox ? `${ownerName ?? mailbox} kutusu` : user?.hasMailbox ? "kendi kutunuz" : "";

  return (
    <Zone
      tone="blue"
      icon="mail"
      title="E-posta yazışmaları"
      count={st.status === "ok" ? list.length : undefined}
      meta={address ? <span className="mono">{address}</span> : undefined}
      extra={
        address ? (
          <IconButton
            icon="refresh"
            label="Postaları yenile"
            size="sm"
            disabled={st.status === "loading"}
            onClick={() => load(true)}
          />
        ) : undefined
      }
    >
      {!address ? (
        <p className="mail-state empty">
          <Icon name="warn" size={16} /> Kişinin e-posta adresi kayıtlı değil. Müşteri bilgilerine adresi ekleyince yazışmalar burada
          görünür.
        </p>
      ) : st.status === "loading" || st.status === "idle" ? (
        <div className="mail-skel" aria-busy="true" aria-label="Postalar yükleniyor">
          <Skeleton h={56} />
          <Skeleton h={56} />
          <Skeleton h={56} />
        </div>
      ) : st.status === "err" ? (
        <div className="mail-state err" role="alert">
          <Icon name="warn" size={16} /> <span style={{ flex: 1 }}>{st.error}</span>
          {st.noMailbox && mailbox && user?.hasMailbox ? (
            <Button size="sm" onClick={() => setMailbox(undefined)}>
              Kendi kutumda ara
            </Button>
          ) : (
            <Button size="sm" onClick={() => load(true)}>
              Yeniden dene
            </Button>
          )}
        </div>
      ) : (
        <>
          <p className="mail-scan">
            <Icon name="search" size={14} />
            <span>
              {st.result.byDomain ? (
                <>
                  <b>{st.result.pattern}</b> alan adıyla eşleşen iletiler ({whose}).
                </>
              ) : (
                <>
                  <b>{st.result.pattern}</b> adresiyle eşleşen iletiler ({whose}).
                </>
              )}{" "}
              Taranan: {st.result.scanned.map((f) => `${f.folder} (${f.total.toLocaleString("tr-TR")} ileti)`).join(", ")}
              {!st.result.sentFolder && " · gönderilenler klasörü bulunamadı"}
              {st.refreshing && " · yenileniyor…"}
            </span>
          </p>
          {!list.length ? (
            <p className="mail-state empty">
              <Icon name="mail" size={16} /> Bu müşteriyle eşleşen ileti yok. Yazıştığınız adres farklıysa müşteri bilgilerinden
              e-postayı düzeltin.
            </p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
                {inCount} gelen · {outCount} giden · klasör başına son 40 ileti, en yeni üstte
              </p>
              <ul className="mail-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {list.map((m) => {
                  const open = openId === m.id;
                  const body = bodies[m.id];
                  return (
                    <li key={m.id} className="mail">
                      <button className="mail-row" aria-expanded={open} aria-controls={`mb-${m.uid}`} onClick={() => toggle(m)}>
                        <span className={"mail-dir " + m.direction} aria-hidden="true">
                          <Icon name={m.direction === "in" ? "arrowIn" : "arrowOut"} size={18} />
                        </span>
                        <span className="mail-main">
                          <span className="mail-subject">{m.subject}</span>
                          <span className="mail-meta">
                            <b>{m.direction === "in" ? "Gelen" : "Giden"}</b> · {m.direction === "in" ? m.from : `→ ${m.to}`}
                            {m.attachments > 0 && (
                              <>
                                {" "}
                                · <Icon name="paperclip" size={12} /> {m.attachments} ek
                              </>
                            )}
                          </span>
                        </span>
                        <span className="mail-date">
                          <time dateTime={m.date}>{fmtDate(m.date, true)}</time>
                          <span>{relDays(m.date)}</span>
                        </span>
                      </button>
                      {open && (
                        <pre id={`mb-${m.uid}`} className={"mail-body" + (body?.status === "loading" ? " is-loading" : "")}>
                          {!body || body.status === "loading" ? "İleti yükleniyor…" : body.text}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </Zone>
  );
}
