import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const btcBackendVolume = volume("btc-backend-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 5000 });
  const btcFrontend = service("btc-frontend", {
    replicas: { "us-east4-eqdc4a": 1 },
    env: { VITE_API_BASE_URL: preserve() },
    build: { dockerfilePath: "Dockerfile.frontend" },
  });
  const btcBackend = service("btc-backend", {
    replicas: { "us-east4-eqdc4a": 1 },
    volumeMounts: { "/data": btcBackendVolume },
    env: { CORS_ORIGIN: preserve(), DATABASE_PATH: preserve(), NODE_ENV: preserve() },
  });

  return project("btc-direction-dashboard", {
    resources: [btcFrontend, btcBackend, btcBackendVolume],
  });
});
