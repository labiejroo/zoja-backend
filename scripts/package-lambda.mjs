#!/usr/bin/env node
/**
 * Buduje artefakt Lambdy: artifacts/zoja-backend.zip
 *
 * Cały skrypt jest w Node, więc działa tak samo w PowerShellu, w Git Bashu
 * i na Linuksie w CI. Świadomie nie używamy `zip` ani `Compress-Archive` —
 * pierwszego nie ma na Windows, drugiego nigdzie indziej.
 *
 * Jeden artefakt obsługuje DWIE funkcje Lambda:
 *   dist/lambda.handler            — API za API Gateway
 *   dist/migration.lambda.handler  — migracje, bez wyzwalacza
 */

import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// archiver 8: ZipArchive dziedziczy po Archiver i jest samodzielnym archiwum.
import { ZipArchive } from "archiver";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "dist");
const stageDir = join(root, ".package");
const outDir = join(root, "artifacts");
const zipPath = join(outDir, "zoja-backend.zip");

/** `npm` na Windows to plik .cmd — bez tego execFile nie znajdzie polecenia. */
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const log = (message) => console.log(`[package:lambda] ${message}`);

async function main() {
  if (!(await exists(distDir))) {
    throw new Error('Brak katalogu dist/. Uruchom najpierw "npm run build".');
  }

  log("czyszczenie katalogów roboczych");
  await rm(stageDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(stageDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  log("kopiowanie dist/ — sam skompilowany JavaScript, bez źródeł i testów");
  await cp(distDir, join(stageDir, "dist"), { recursive: true });

  log("kopiowanie package.json i package-lock.json");
  await cp(join(root, "package.json"), join(stageDir, "package.json"));
  await cp(join(root, "package-lock.json"), join(stageDir, "package-lock.json"));

  log("instalacja zależności produkcyjnych (npm ci --omit=dev)");
  execFileSync(npmCommand, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: stageDir,
    stdio: "inherit",
    // Node od wersji 18.20.2 / 20.12.2 odmawia uruchamiania plików .cmd i .bat
    // bez powłoki (poprawka bezpieczeństwa) — bez tego dostajemy EINVAL.
    // Argumenty są stałe i nie pochodzą z zewnątrz, więc shell jest tu bezpieczny.
    shell: process.platform === "win32",
  });

  log("pakowanie do ZIP");
  await zipDirectory(stageDir, zipPath);

  const { size } = await stat(zipPath);
  const megabytes = (size / 1024 / 1024).toFixed(1);

  log(`gotowe: artifacts/zoja-backend.zip (${megabytes} MB)`);
  log("handler API:      dist/lambda.handler");
  log("handler migracji: dist/migration.lambda.handler");

  if (size > 50 * 1024 * 1024) {
    log("UWAGA: paczka przekracza 50 MB — bezpośredni upload nie zadziała, wgraj przez S3.");
  }

  await rm(stageDir, { recursive: true, force: true });
}

function zipDirectory(sourceDir, targetZip) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(targetZip);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("warning", (error) => {
      if (error.code === "ENOENT") console.warn(`[package:lambda] ${error.message}`);
      else reject(error);
    });
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}

main().catch((error) => {
  console.error(`[package:lambda] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
