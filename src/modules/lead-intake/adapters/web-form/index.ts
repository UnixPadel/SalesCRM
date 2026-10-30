// lead-intake/adapters/web-form: unixpadel.com formu — HMAC imza, alan eşlemesi, tıklama kimlikleri, onaylar.
export {
  WEB_HONEYPOT_FIELD,
  WEB_PROVIDER,
  WEB_SECRET_NAMES,
  isHoneypotFilled,
  webFormIsTest,
  webFormSourceAdapter,
  webFormSubmissionId,
  type WebFormAttributionPayload,
  type WebFormConsentPayload,
  type WebFormPayload,
} from "./adapter";
export {
  WEB_FORM_HEADERS,
  WEB_FORM_TOLERANCE_SECONDS,
  signWebForm,
  verifyWebFormSignature,
  type SignatureCheck,
  type SignatureFailure,
  type SignatureHeaders,
} from "./signature";
