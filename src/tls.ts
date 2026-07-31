import { Platform } from "obsidian";

export interface TlsMaterial {
  cert: string;
  key: string;
  source: "user" | "generated";
  paths: { certPath: string; keyPath: string };
}

function nodeRequire<T>(id: string): T {
  if (!Platform.isDesktopApp) {
    throw new Error("Node modules are desktop-only");
  }
  // Obsidian desktop exposes Node require
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = (window as any).require ?? require;
  return req(id) as T;
}

export async function loadOrCreateTls(options: {
  certPath: string;
  keyPath: string;
  pluginDirAbsolute: string;
}): Promise<TlsMaterial> {
  const fs = nodeRequire<typeof import("fs")>("fs");
  const path = nodeRequire<typeof import("path")>("path");
  const { execFile } = nodeRequire<typeof import("child_process")>("child_process");
  const { promisify } = nodeRequire<typeof import("util")>("util");
  const execFileAsync = promisify(execFile);

  if (options.certPath && options.keyPath) {
    const cert = fs.readFileSync(options.certPath, "utf8");
    const key = fs.readFileSync(options.keyPath, "utf8");
    return {
      cert,
      key,
      source: "user",
      paths: { certPath: options.certPath, keyPath: options.keyPath },
    };
  }

  const tlsDir = path.join(options.pluginDirAbsolute, ".tls");
  const certPath = path.join(tlsDir, "cert.pem");
  const keyPath = path.join(tlsDir, "key.pem");

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath, "utf8"),
      key: fs.readFileSync(keyPath, "utf8"),
      source: "generated",
      paths: { certPath, keyPath },
    };
  }

  fs.mkdirSync(tlsDir, { recursive: true });
  try {
    await execFileAsync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "825",
      "-nodes",
      "-subj",
      "/CN=intelligent-sync",
    ]);
  } catch (err) {
    throw new Error(
      `Failed to generate self-signed TLS cert via openssl. Provide cert/key paths in settings. ${String(err)}`
    );
  }

  return {
    cert: fs.readFileSync(certPath, "utf8"),
    key: fs.readFileSync(keyPath, "utf8"),
    source: "generated",
    paths: { certPath, keyPath },
  };
}
