// composition root: fetch・DOM・document を束ねる唯一の場所。
import { createApiClient } from "./api-client.js";
import { createApp } from "./app.js";
import { createView } from "./view.js";

const api = createApiClient({ fetch: window.fetch.bind(window) });
const view = createView(document);
const app = createApp({ api, view });

view.bind(app.handlers);
app.start();
