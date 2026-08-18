// Stejná tailnet-only politika jako personal/dashboard (viz jeho DECISIONS.md):
// jen Tailscale rozhraní, žádné auth, veřejné 0.0.0.0 záměrně vynecháno.
export const HOST = "100.108.179.97";
export const PORT = 8766;

export const DATA_FILE = "/home/agent/agent-system/personal/zpravodaj/webapp/data/digests.json";
export const MAX_DIGESTS = 200;

export const CLIENT_DIST = "/home/agent/agent-system/personal/zpravodaj/webapp/client/dist";
