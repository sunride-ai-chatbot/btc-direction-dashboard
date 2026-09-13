import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const btcBackendVolume = volume("btc-backend-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 5000 });
  // Each service MUST name its own Dockerfile here. The two services share one repo, so a
  // repo-root railway.json (removed 2026-09-13) applied ONE dockerfilePath to both and made
  // btc-frontend serve a second copy of the backend — twice: once on the first CLI deploy,
  // and again the moment a GitHub source was connected. This file is the only source of truth.
  const repo = { repo: "sunride-ai-chatbot/btc-direction-dashboard", branch: "main" };
  const btcFrontend = service("btc-frontend", {
    replicas: { "us-east4-eqdc4a": 1 },
    source: repo,
    env: { VITE_API_BASE_URL: preserve() },
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.frontend" },
    deploy: { healthcheckPath: "/health", healthcheckTimeout: 120, restartPolicyType: "ALWAYS" },
  });
  const btcBackend = service("btc-backend", {
    replicas: { "us-east4-eqdc4a": 1 },
    source: repo,
    volumeMounts: { "/data": btcBackendVolume },
    env: { CORS_ORIGIN: preserve(), DATABASE_PATH: preserve(), NODE_ENV: preserve() },
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { healthcheckPath: "/health", healthcheckTimeout: 120, restartPolicyType: "ALWAYS" },
  });

  return project("btc-direction-dashboard", {
    resources: [btcFrontend, btcBackend, btcBackendVolume],
  });
});
