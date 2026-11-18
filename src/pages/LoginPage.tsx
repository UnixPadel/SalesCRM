import { useState } from "react";
import { LangMenu } from "../components/LangMenu";
import { Button, Field, Icon, IconButton } from "../components/ui";
import { MAIL_DOMAIN } from "../domain/constants";
import { useLang } from "../i18n";
import { useCrm } from "../state/CrmContext";

const LOGIN_ERR: Record<number, string> = {
  0: "err.network",
  400: "login.invalid",
  401: "login.invalid",
  429: "login.tooMany",
  502: "login.unavailable",
  [-1]: "login.failed",
};

/** Sign in with the company user table (KullaniciBilgileri); the server does the check. */
export function LoginPage() {
  const { login } = useCrm();
  const { t, lang } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const emailErr = touched && !email.trim() ? t("login.usernameErr") : "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!email.trim() || !password || emailErr) return;
    setBusy(true);
    setError("");
    const err = await login(email.trim(), password);
    setBusy(false);
    if (!err) return;
    // Sunucu giriş hatalarını yalnız Türkçe yazar; diğer dillerde HTTP durumundan çevrilir.
    const key = LOGIN_ERR[err.status];
    setError(lang === "tr" && err.message ? err.message : key ? t(key) : err.message || t("login.failed"));
  };

  return (
    <div className="login">
      <LangMenu variant="standalone" />
      <div className="login-card">
        <div className="wordmark">
          <b>Unixpadel</b>
          <span>{t("app.name")}</span>
        </div>
        <h1>{t("login.title")}</h1>
        <form onSubmit={submit} noValidate>
          <Field label={t("login.username")} error={emailErr} errorId="login-email-err">
            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder={t("login.usernamePh")}
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={!!emailErr}
              aria-describedby={emailErr ? "login-email-err" : undefined}
            />
          </Field>
          <Field label={t("login.password")}>
            <div className="pair">
              <input
                type={show ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <IconButton
                icon={show ? "eyeOff" : "eye"}
                label={show ? t("login.hidePassword") : t("login.showPassword")}
                aria-pressed={show}
                onClick={() => setShow((s) => !s)}
              />
            </div>
          </Field>
          {error && (
            <div className="login-err" role="alert">
              <Icon name="warn" /> {error}
            </div>
          )}
          <Button variant="pri" size="lg" type="submit" loading={busy} disabled={!email || !password}>
            {t("login.title")}
          </Button>
        </form>
        <p className="login-note">
          <Icon name="lock" size={16} />
          <span>{t("login.note", { admin: `admin@${MAIL_DOMAIN}` })}</span>
        </p>
      </div>
    </div>
  );
}
