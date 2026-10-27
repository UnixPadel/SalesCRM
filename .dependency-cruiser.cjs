/* Mimari sınırlar (ADR-0007, Genel plan kural 1–3). `npm run arch` bu kuralları zorlar;
 * ihlal varsa çıkış kodu sıfır olmaz ve build kırılır. */
const MODULE = "^src/modules/([^/]+)/";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-no-external",
      comment:
        "Kural 1: domain katmanı framework, ORM, HTTP, Meta/Google kütüphanesi veya Node çekirdek modülü import etmez.",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-peer", "npm-optional", "npm-bundled", "npm-no-pkg", "core"] },
    },
    {
      name: "domain-no-outer-layer",
      comment: "Kural 1: domain, üst katmanları (application, infrastructure, api, adapters, builders) bilmez.",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { path: "^src/modules/[^/]+/(application|infrastructure|api|adapters|builders)/" },
    },
    {
      name: "domain-only-own-domain-and-shared",
      comment: "Domain yalnız kendi domain'ini ve shared/* paketlerini görür.",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/domain/" },
      to: {
        path: "^src/modules/",
        pathNot: ["^src/modules/$1/domain/", "^src/modules/shared/"],
      },
    },
    {
      name: "application-no-infrastructure",
      comment: "Kural 2: uygulama katmanı portları kullanır; somut altyapı ve adaptörleri import etmez.",
      severity: "error",
      from: { path: "^src/modules/[^/]+/application/" },
      to: { path: "^src/modules/[^/]+/(infrastructure|api|adapters)/" },
    },
    {
      name: "cross-module-only-via-application",
      comment:
        "Modüller birbirine yalnız application katmanı (komut / sorgu) üzerinden erişir; tablo ve iç yapı paylaşılmaz.",
      severity: "error",
      from: { path: MODULE, pathNot: "^src/modules/shared/" },
      to: {
        path: "^src/modules/(?!shared/)([^/]+)/",
        pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/application/"],
      },
    },
    {
      name: "shared-imports-no-module",
      comment: "Kural: shared hiçbir iş modülünü import etmez.",
      severity: "error",
      from: { path: "^src/modules/shared/" },
      to: { path: "^src/modules/", pathNot: "^src/modules/shared/" },
    },
    {
      name: "modules-no-legacy-ui",
      comment:
        "Modüller eski arayüz koduna (src/components, src/pages, src/state…) bağlanmaz; taşıma tersi yönde olur.",
      severity: "error",
      from: { path: "^src/modules/" },
      to: { path: "^src/", pathNot: "^src/modules/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "Yalnız bilgi amaçlı: kimsenin import etmediği dosya.",
      severity: "info",
      from: { orphan: true, pathNot: ["\\.d\\.ts$", "index\\.ts$", "\\.test\\.ts$", "^src/main\\.tsx$"] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["^dist/", "^legacy/", "^coverage/"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.modules.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
