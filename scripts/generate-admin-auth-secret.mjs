#!/usr/bin/env node
/**
 * Generuje zawartość sekretu zoja/admin-auth.
 *
 * Wynik wypisuje na stdout jako JSON gotowy do wgrania:
 *
 *   {"passwordHash":"scrypt-v1$...$...","sessionSecret":"..."}
 *
 * HASŁO CZYTAMY ZE STDIN, NIGDY Z ARGUMENTU.
 * `node skrypt.mjs mojehaslo` wygląda niewinnie i jest najgorszym możliwym
 * sposobem: argument trafia do historii powłoki, jest widoczny w liście
 * procesów dla każdego użytkownika maszyny i zostaje w logach terminala.
 * Przy terminalu interaktywnym dodatkowo wyłączamy echo, żeby hasło nie
 * pojawiło się na ekranie ani w przewijaniu.
 *
 * Wygenerowanego wyniku NIE ZAPISUJEMY W REPOZYTORIUM. Wgrywa się go raz,
 * ręcznie, przez AWS CLI — tak samo jak hasło do bazy:
 *
 *   aws secretsmanager put-secret-value \
 *     --secret-id zoja/admin-auth \
 *     --secret-string file://sekret.json
 *
 * ...a plik pośredni kasuje zaraz potem.
 */

import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/** Muszą zgadzać się z SCRYPT_PARAMS w src/admin-auth/password.ts. */
const PARAMS = { N: 16_384, r: 8, p: 1, keyLength: 64 };
const MAX_MEMORY = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const SESSION_SECRET_BYTES = 32;

/**
 * Pyta o hasło bez wypisywania go na ekran.
 *
 * Node nie ma wbudowanego "readPassword", więc podmieniamy metodę, przez którą
 * readline wypisuje echo wpisywanych znaków. Przy wejściu nieinteraktywnym
 * (potok, plik) nie ma czego ukrywać — czytamy wprost.
 */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;

    if (!input.isTTY) {
      let data = "";
      input.setEncoding("utf8");
      input.on("data", (chunk) => (data += chunk));
      input.on("end", () => {
        /**
         * NORMALIZACJA WEJŚCIA Z POTOKU.
         *
         * BOM (U+FEFF) na początku nie jest zmartwieniem teoretycznym:
         * PowerShell na Windows koduje dane wysyłane do procesu potomnego jako
         * UTF-8 Z SYGNATURĄ, więc pierwszym znakiem, jaki tu dociera, bywa
         * niewidoczny U+FEFF. Bez obcięcia hashujemy ciąg o jeden znak dłuższy
         * niż ten, który człowiek wpisał — a objawia się to dopiero przy
         * logowaniu w przeglądarce: poprawne hasło dostaje odpowiedź
         * "nieprawidłowe hasło". Kosztowało nas to jedno wdrożenie.
         *
         * Znak BOM nie może być częścią hasła wpisanego w formularzu, więc
         * jego usunięcie niczego poprawnego nie psuje.
         */
        resolve(data.replace(/^﻿/, "").replace(/\r?\n$/, ""));
      });
      input.on("error", reject);
      return;
    }

    const rl = createInterface({ input, output, terminal: true });

    // Od momentu zadania pytania readline nie wypisuje już nic — dzięki temu
    // wpisywane znaki nie pojawiają się na ekranie.
    let muted = false;
    const originalWrite = output.write.bind(output);
    output.write = (chunk, ...rest) => (muted ? true : originalWrite(chunk, ...rest));

    originalWrite(question);
    muted = true;

    rl.question("", (answer) => {
      muted = false;
      output.write = originalWrite;
      originalWrite("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);

  const hash = await scrypt(password, salt, PARAMS.keyLength, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAX_MEMORY,
  });

  return `scrypt-v1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function main() {
  const password = await askHidden("Hasło gospodarzy (nie zostanie wyświetlone): ");

  if (password.length < 12) {
    // To jedyne poświadczenie do panelu z danymi osobowymi gości. Krótkie
    // hasło da się zgadnąć, a rotacja wymaga ręcznego wgrania sekretu.
    console.error("Hasło musi mieć co najmniej 12 znaków.");
    process.exitCode = 1;
    return;
  }

  const secret = {
    passwordHash: await hashPassword(password),
    // 256 bitów. Klucz służy WYŁĄCZNIE do podpisywania sesji — nigdy nie jest
    // nim passwordHash, bo wtedy złamanie jednego dawałoby oba.
    sessionSecret: randomBytes(SESSION_SECRET_BYTES).toString("base64url"),
  };

  // Sam JSON na stdout, żeby dało się go przekierować do pliku bez obróbki.
  // Podpowiedzi idą na stderr.
  console.error("\nWgraj poniższą zawartość do sekretu zoja/admin-auth i skasuj plik pośredni.");
  console.log(JSON.stringify(secret));
}

main().catch((error) => {
  // Bez stacka: mógłby zawierać fragment wejścia.
  console.error(`Nie udało się wygenerować sekretu: ${error instanceof Error ? error.name : "błąd"}`);
  process.exitCode = 1;
});
