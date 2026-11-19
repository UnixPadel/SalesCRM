import { useId, useRef, useState } from "react";
import { Icon } from "../../components/ui";
import { localeOf, useLang } from "../../i18n";
import type { AttachmentRulesDto } from "../../modules/sales-pipeline/api/dto.attachment";
import { fileProblem, fileSize } from "./attachmentApi";

/**
 * "Dosya ekle" düğmesi ve seçilen dosyaların listesi (pdf, görsel, belge, tablo). Dosyalar pencere kaydedilince
 * yüklenir; burada yalnız seçilir ve ön denetimden geçer.
 */
export function FilePicker({
  files,
  onChange,
  rules,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  rules: AttachmentRulesDto;
  disabled?: boolean;
}) {
  const { t, lang } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const hintId = useId();

  const add = (picked: FileList | null) => {
    if (!picked) return;
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of Array.from(picked)) {
      const p = fileProblem(f, rules);
      if (p) bad.push(`${f.name}: ${t(p, { mb: Math.round(rules.maxBytes / 1024 / 1024) })}`);
      else if (!files.some((x) => x.name === f.name && x.size === f.size)) ok.push(f);
    }
    setProblems(bad);
    if (ok.length) onChange([...files, ...ok]);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="fp">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={rules.extensions.map((e) => "." + e).join(",")}
        onChange={(e) => add(e.target.files)}
      />
      <button
        type="button"
        className="btn btn-sec btn-sm"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={() => input.current?.click()}
      >
        <Icon name="paperclip" size={14} /> {t("attach.add")}
      </button>
      <span className="field-h" id={hintId}>
        {t("attach.hint", { mb: Math.round(rules.maxBytes / 1024 / 1024) })}
      </span>
      {files.length > 0 && (
        <ul className="fp-list">
          {files.map((f, i) => (
            <li key={f.name + f.size}>
              <Icon name="file" size={14} />
              <span className="fp-name">{f.name}</span>
              <small className="muted">{fileSize(f.size, localeOf(lang))}</small>
              <button
                type="button"
                className="link-btn danger"
                disabled={disabled}
                aria-label={t("attach.removeNamed", { name: f.name })}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problems.map((p) => (
        <p key={p} className="field-err" role="alert">
          <Icon name="warn" size={14} /> {p}
        </p>
      ))}
    </div>
  );
}
