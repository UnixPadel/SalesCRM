import { useState } from "react";
import { Button, Field, Icon, IconButton } from "../components/ui";
import { MAIL_DOMAIN } from "../domain/constants";
import { useCrm } from "../state/CrmContext";

/** Sign in with the company user table (KullaniciBilgileri); the server does the check. */
export function LoginPage() {
  const { login } = useCrm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const emailErr = touched && !email.trim() ? "Kullanıcı adınızı girin." : "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!email.trim() || !password || emailErr) return;
    setBusy(true);
    setError("");
    const err = await login(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="wordmark">
          <b>unixpadel</b>
          <span>satış panosu</span>
        </div>
        <h1>Giriş yap</h1>
        <form onSubmit={submit} noValidate>
          <Field label="Kullanıcı adı" error={emailErr} errorId="login-email-err">
            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="kullanıcı adı ya da e-posta"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={!!emailErr}
              aria-describedby={emailErr ? "login-email-err" : undefined}
            />
          </Field>
          <Field label="Şifre">
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
                label={show ? "Şifreyi gizle" : "Şifreyi göster"}
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
            Giriş yap
          </Button>
        </form>
        <p className="login-note">
          <Icon name="lock" size={16} />
          <span>
            Şirket kullanıcı tablosundaki kullanıcı adı ve şifrenizle girersiniz; şifre bu uygulamada saklanmaz.
            Yönetici hesabı: admin@{MAIL_DOMAIN} (şifresi sunucudaki server/data/config.json dosyasında).
          </span>
        </p>
      </div>
    </div>
  );
}
