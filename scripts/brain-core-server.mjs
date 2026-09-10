import http from "node:http";
import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";

import {
  createBrainCoreEndpoint
} from "./brain-core-runtime.mjs";

const env = process.env;

function send(res, status, body) {
  res.writeHead(
    status,
    {
      "content-type":
        "application/json; charset=utf-8"
    }
  );

  res.end(
    JSON.stringify(body)
  );
}

function fail(
  res,
  status,
  code,
  message
) {
  send(
    res,
    status,
    {
      error: {
        code,
        message
      }
    }
  );
}

async function raw(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return Buffer.concat(
    chunks
  ).toString();
}

export function verifyServiceAuth(
  req,
  body = "",
  environment = env
) {
  const secret =
    environment.SERVICE_AUTH_SECRET;

  if (!secret) {
    if (
      environment.NODE_ENV === "production"
    ) {
      return {
        ok: false,
        code: "AUTHENTICATION_ERROR",
        message:
          "SERVICE_AUTH_SECRET is required in production"
      };
    }

    return {
      ok: true,
      service: "development"
    };
  }

  const service =
    req.headers[
      "x-avatarx-service"
    ];

  const timestamp =
    req.headers[
      "x-avatarx-timestamp"
    ];

  const signature =
    req.headers[
      "x-avatarx-signature"
    ];

  if (
    !service ||
    !timestamp ||
    !signature
  ) {
    return {
      ok: false,
      code: "AUTHENTICATION_ERROR",
      message:
        "Signed service authentication is required"
    };
  }

  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(
      Date.now() -
      Number(timestamp)
    ) > 300000
  ) {
    return {
      ok: false,
      code: "AUTHENTICATION_ERROR",
      message:
        "Authentication timestamp is outside the allowed window"
    };
  }

  const pathname =
    new URL(
      req.url,
      "http://localhost"
    ).pathname;

  const digest =
    createHash("sha256")
      .update(body)
      .digest("hex");

  const expected =
    createHmac(
      "sha256",
      secret
    )
      .update(
        [
          req.method,
          pathname,
          timestamp,
          digest
        ].join("\n")
      )
      .digest("hex");

  const supplied =
    String(signature);

  if (
    supplied.length !==
      expected.length ||
    !timingSafeEqual(
      Buffer.from(supplied),
      Buffer.from(expected)
    )
  ) {
    return {
      ok: false,
      code: "AUTHENTICATION_ERROR",
      message:
        "Service signature is invalid"
    };
  }

  return {
    ok: true,
    service: String(service)
  };
}

const brainCore =
  createBrainCoreEndpoint({
    env
  });

export const server =
  http.createServer(
    async (req, res) => {
      if (
        req.method === "GET" &&
        req.url === "/health"
      ) {
        return send(
          res,
          200,
          {
            status: "ok",
            service: "avatarx-brain"
          }
        );
      }

      try {
        const bodyText =
          await raw(req);

        const auth =
          verifyServiceAuth(
            req,
            bodyText
          );

        if (!auth.ok) {
          return fail(
            res,
            401,
            auth.code,
            auth.message
          );
        }

        const url =
          new URL(
            req.url,
            "http://localhost"
          );

        const rawTenant =
          req.headers[
            "x-tenant-id"
          ] ??
          req.headers[
            "x-avatarx-tenant"
          ];

        const tenantId =
          Array.isArray(rawTenant)
            ? rawTenant[0]
            : rawTenant;

        if (
          await brainCore({
            req,
            res,
            url,
            bodyText,
            tenantId,
            send,
            fail
          })
        ) {
          return;
        }

        return fail(
          res,
          404,
          "NOT_FOUND",
          "Route not found"
        );
      } catch {
        return fail(
          res,
          500,
          "INTERNAL_ERROR",
          "Internal server error"
        );
      }
    }
  );

if (
  process.env.NODE_ENV !== "test"
) {
  const port =
    Number(
      env.BRAIN_CORE_PORT ??
      4120
    );

  server.listen(
    port,
    () =>
      console.log(
        `avatarx-brain core runtime listening on :${port}`
      )
  );
}