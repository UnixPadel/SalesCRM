import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Icon } from "../../components/ui";
import { localeOf, useLang } from "../../i18n";
import type { AttachmentRulesDto } from "../../modules/sales-pipeline/api/dto.attachment";
import { extensionOf, fileProblem, fileSize, pastedName } from "./attachmentApi";

/**
 * "Dosya ekle" düğmesi ve seçilen dosyaların listesi (pdf, görsel, belge, tablo). Dosyalar pencere kaydedilince
 * yüklenir; burada yalnız seçilir ve ön denetimden geçer.
 *
 * `boxed` (2026-11-24): temas ve aşama pencerelerinde alan "Ekran görüntüsü veya dosya ekleyin" kutusu olur; panodan
 * yapıştırma (Ctrl+V) ve sürükle-bırak kabul eder. `required` ise kutu vurgulanır, "Zorunlu" rozeti görünür ve
 * dosyasız kayıtta hata gösterilir. Kural pencereye bağlıdır: bir pencere = bir kanıt.
 */
export function FilePicker({
  files,
  onChange,
  rules,
  disabled,
  boxed = false,
  required = false,
  purpose,
  showError = false,
  buttonRef,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  rules: AttachmentRulesDto;
  disabled?: boolean;
  /** Kutu görünümü: başlık, ipucu, yapıştırma ve sürükle-bırak. */
  boxed?: boolean;
  /** En az bir dosya zorunlu (kutu görünümünü de açar): vurgu, "Zorunlu" rozeti, hata. */
  required?: boolean;
  /** Kutuda ne eklenebileceğini söyleyen tek satır. */
  purpose?: string;
  /** Kaydetmeye çalışıldı ve dosya yok: hata görünümü. */
  showError?: boolean;
  /** Hata anında odaklanacak "Dosya seç" düğmesi. */
  buttonRef?: RefObject<HTMLButtonElement>;
}) {
  const { t, lang } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const hintId = useId();
  const errId = useId();
  const mb = Math.round(rules.maxBytes / 1024 / 1024);

  const add = useCallback(
    (picked: FileList | readonly File[] | null) => {
      if (!picked) return;
      const ok: File[] = [];
      const bad: string[] = [];
      for (const f of Array.from(picked)) {
        const p = fileProblem(f, rules);
        if (p) bad.push(`${f.name}: ${t(p, { mb })}`);
        else if (![...files, ...ok].some((x) => x.name === f.name && x.size === f.size)) ok.push(f);
      }
      setProblems(bad);
      if (ok.length) onChange([...files, ...ok]);
      if (input.current) input.current.value = "";
    },
    [files, onChange, rules, t, mb],
  );
  // Panodan yapıştırma (Win+Shift+S → Ctrl+V): panoda dosya varsa alınır, yalnız metin varsa dokunulmaz. Dinleyici
  // güncel seçimi görmek için her çizimde yeniden bağlanır (ucuz).
  useEffect(() => {
    if (!(boxed || required) || disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.files ?? []);
      if (!items.length) return;
      e.preventDefault();
      const now = new Date();
      add(
        items.map((f, i) => {
          // Pano görüntüsünün adı genelde "image.png"dir; anlamlı ve benzersiz bir ad verilir.
          const generic = !f.name || /^image\.\w+$/i.test(f.name);
          if (!generic) return f;
          const ext = extensionOf(f.name) || f.type.split("/")[1] || "png";
          return new File([f], pastedName(now, ext, items.length > 1 ? i + 1 : 0), { type: f.type });
        }),
      );
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [boxed, required, disabled, add]);

  const pick = () => input.current?.click();
  const fileInput = (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      accept={rules.extensions.map((e) => "." + e).join(",")}
      onChange={(e) => add(e.target.files)}
    />
  );
  const list = files.length > 0 && (
    <ul className="fp-list">
      {files.map((f, i) => (
        <li key={f.name + f.size}>
          <Thumb file={f} />
          <span className="fp-name">{f.name}</span>
          <small className="muted">{fileSize(f.size, localeOf(lang))}</small>
          <button
            type="button"
            className="link-btn danger fp-remove"
            disabled={disabled}
            aria-label={t("attach.removeNamed", { name: f.name })}
            onClick={() => onChange(files.filter((_, j) => j !== i))}
          >
            <Icon name="x" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
  const problemList = problems.map((p) => (
    <p key={p} className="field-err" role="alert">
      <Icon name="warn" size={14} /> {p}
    </p>
  ));

  if (!boxed && !required) {
    return (
      <div className="fp">
        {fileInput}
        <button
          type="button"
          className="btn btn-sec btn-sm"
          disabled={disabled}
          aria-describedby={hintId}
          onClick={pick}
        >
          <Icon name="paperclip" size={14} /> {t("attach.add")}
        </button>
        <span className="field-h" id={hintId}>
          {t("attach.hint", { mb })}
        </span>
        {list}
        {problemList}
      </div>
    );
  }

  const done = files.length > 0;
  const error = required && showError && !done;
  return (
    <div
      className={
        "fp-req" +
        (required ? "" : " is-optional") +
        (done ? " is-done" : "") +
        (error ? " is-error" : "") +
        (over ? " is-over" : "")
      }
      role="group"
      aria-labelledby={hintId + "-t"}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) add(e.dataTransfer.files);
      }}
    >
      {fileInput}
      <div className="fp-req-head">
        <Icon name={done ? "checkCircle" : "paperclip"} size={18} />
        <span className="fp-req-title" id={hintId + "-t"}>
          {done ? t("attach.required.done") : t("attach.required.title")}
        </span>
        {!done && required && <span className="fp-req-badge">{t("attach.required.badge")}</span>}
      </div>
      {!done && purpose && (
        <p className="fp-req-purpose" id={hintId + "-p"}>
          {purpose}
        </p>
      )}
      {list}
      <div className="fp-req-actions">
        <button
          ref={buttonRef}
          type="button"
          className={"btn btn-sec" + (done ? " btn-sm" : " fp-req-pick")}
          disabled={disabled}
          aria-describedby={[error ? errId : "", purpose && !done ? hintId + "-p" : "", hintId]
            .filter(Boolean)
            .join(" ")}
          onClick={pick}
        >
          <Icon name={done ? "plus" : "upload"} size={14} /> {done ? t("attach.addMore") : t("attach.required.pick")}
        </button>
        {!done && <span className="fp-req-paste">{t("attach.required.paste")}</span>}
      </div>
      {error && (
        <p className="field-err" id={errId} role="alert">
          <Icon name="warn" size={14} /> {t("attach.required.err")}
        </p>
      )}
      {problemList}
      <span className="field-h" id={hintId}>
        {t("attach.hint", { mb })}
      </span>
    </div>
  );
}

/** Görselse küçük resim, değilse dosya simgesi; sabit boyut (yerleşim kaymaz). */
function Thumb({ file }: { file: File }) {
  const isImage = /^image\/(png|jpe?g|gif|webp)$/.test(file.type);
  const img = useRef<HTMLImageElement>(null);
  // Adres efekt içinde oluşturulup kapanışta bırakılır (StrictMode'un çift çalıştırmasında da geçerli kalır).
  useEffect(() => {
    if (!isImage || !img.current) return;
    const url = URL.createObjectURL(file);
    img.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);
  if (!isImage) return <Icon name="file" size={14} />;
  return (
    <span className="fp-thumb">
      <img ref={img} alt="" width={40} height={40} />
    </span>
  );
}
