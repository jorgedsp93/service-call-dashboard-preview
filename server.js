import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dashboardStateHandler from "./api/dashboard-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);

const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/script.js", "script.js"],
  ["/styles.css", "styles.css"],
  ["/assets/meadowbrook-logo.png", "assets/meadowbrook-logo.png"],
]);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function createApiResponse(response) {
  return {
    status(statusCode) {
      response.statusCode = statusCode;
      return this;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
      return this;
    },
    end(body) {
      response.end(body);
    },
  };
}

async function serveStaticFile(requestPath, response) {
  const relativePath = staticFiles.get(requestPath);

  if (!relativePath) {
    response.writeHead(404, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
    return;
  }

  const filePath = path.join(__dirname, relativePath);
  const fileStat = await stat(filePath);
  const extension = path.extname(filePath);

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": fileStat.size,
    "Content-Type": contentTypes[extension] || "application/octet-stream",
  });

  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/healthz") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/dashboard-state") {
      await dashboardStateHandler(request, createApiResponse(response));
      return;
    }

    await serveStaticFile(url.pathname, response);
  } catch (error) {
    console.error("Request failed.", error);
    response.writeHead(500, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error: "Internal server error." }));
  }
});

server.listen(port, () => {
  console.log(`Service dashboard listening on ${port}`);
});
