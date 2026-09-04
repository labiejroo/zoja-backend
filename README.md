# zoja-backend

Backend aplikacji „Odwiedziny u Zoi". NestJS + TypeORM + PostgreSQL, uruchamiany
w AWS Lambda za API Gateway HTTP API. Jeden artefakt obsługuje dwie funkcje:
API i migracje bazy.

To repozytorium jest **niezależne** od frontendu (`zoja-frontend`) i od
infrastruktury (`zoja-infra`).

## Spis treści

- [Architektura w skrócie](#architektura-w-skrócie)
- [Wymagania](#wymagania)
- [Uruchomienie lokalne](#uruchomienie-lokalne)
- [Zmienne środowiskowe i sekrety](#zmienne-środowiskowe-i-sekrety)
- [Struktura projektu](#struktura-projektu)
- [Cold start i pula połączeń](#cold-start-i-pula-połączeń)
- [Model danych](#model-danych)
- [API](#api)
- [Terminy materializują się na żądanie](#terminy-materializują-się-na-żądanie)
- [Prywatność w odczycie publicznym](#prywatność-w-odczycie-publicznym)
- [Migracje przy prywatnym RDS](#migracje-przy-prywatnym-rds)
- [Build i paczka Lambdy](#build-i-paczka-lambdy)
- [Konfiguracja API Gateway](#konfiguracja-api-gateway)
- [Checklista testów](#checklista-testów)
- [Decyzje techniczne](#decyzje-techniczne)
- [TODO](#todo)

## Architektura w skrócie

```
przeglądarka
   │
   ▼
CloudFront  (xxxx.cloudfront.net)
   ├── /*        → S3 → statyczny frontend Next.js
   └── /api/*    → API Gateway HTTP API → Lambda → NestJS
                                              │
                                              ▼
                                     RDS PostgreSQL (prywatny)
```

Frontend woła `fetch("/api/...")` na tym samym originie co sam siebie, więc
żądania nie są cross-origin i nie ma CORS-a ani preflightów.

## Wymagania

- Node.js 24 (taki sam runtime jak Lambda w AWS: `nodejs24.x`)
- npm
- Docker — tylko do lokalnego PostgreSQL

## Uruchomienie lokalne

```bash
npm install
cp .env.example .env      # wartości lokalne, żadnych sekretów produkcyjnych
npm run db:up             # PostgreSQL w kontenerze
npm run start:dev
```

Sprawdzenie:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"connected"}
```

**Lokalnie nie łączymy się z produkcyjnym RDS** i nie da się tego zrobić — baza
ma `Public access = No`. To celowe, nie usterka.

## Zmienne środowiskowe i sekrety

| Zmienna | Sekret? | Znaczenie |
| --- | --- | --- |
| `DB_HOST` | nie | Host bazy. W AWS: endpoint RDS. |
| `DB_PORT` | nie | 5432. |
| `DB_NAME` | nie | W AWS `zojaDB`. Lokalnie dowolna. |
| `DB_USER` | nie | Master username. |
| `DB_PASSWORD` | **tak** | Hasło. Nigdy w repozytorium. |
| `DB_SSL` | nie | `true` w AWS, `false` lokalnie (kontener nie ma TLS). |
| `DB_POOL_MAX` | nie | Rozmiar puli **na jedno środowisko wykonawcze**. Domyślnie 2. |
| `DB_LOGGING` | nie | Logowanie zapytań TypeORM. Na produkcji `false`. |

`.env.example` zawiera **wyłącznie wartości przykładowe** i trafia do
repozytorium. `.env` jest w `.gitignore` i nigdy nie ma tam trafić.

Konfiguracja jest walidowana przy starcie (`src/config/env.validation.ts`).
Brakująca zmienna wywala zimny start z komunikatem zawierającym **nazwy** pól —
nigdy ich wartości, bo wśród nich jest hasło.

### Gdzie żyje `DB_PASSWORD` na produkcji

Na tym etapie: **zmienna środowiskowa Lambdy**, ustawiana ręcznie w konsoli.

To **świadome uproszczenie na czas laba**, nie rozwiązanie docelowe. Warto znać
kontekst: Lambda stoi w VPC bez NAT Gateway, więc nie ma trasy do publicznych
endpointów AWS. Sięgnięcie po SSM Parameter Store albo Secrets Manager
wymagałoby najpierw **Interface VPC Endpointu** dla tej usługi. Zmienne
środowiskowe wstrzykuje sama usługa Lambda, zanim kod ruszy, więc działają bez
żadnego ruchu sieciowego.

Z tego samego powodu CloudWatch Logs działa mimo braku NAT-a: logi wysyła usługa
Lambda w imieniu funkcji, a nie kod przez ENI.

Docelowy secret management projektujemy osobno.

## Struktura projektu

```
src/
  main.ts                    lokalny serwer HTTP (app.listen)
  lambda.ts                  handler API — cache bootstrapu poza handlerem
  migration-lambda.ts        handler migracji — bez wyzwalacza
  app.setup.ts               wspólna konfiguracja obu entrypointów
  app.module.ts

  config/
    env.validation.ts        walidacja env, fail fast, bez wycieku wartości
    configuration.ts         typowany odczyt z ConfigService

  database/
    typeorm.options.ts       JEDNO źródło opcji + rejestr encji i migracji
    data-source.ts           DataSource dla CLI i Lambdy migracyjnej
    database.module.ts       TypeOrmModule.forRootAsync

  health/                    GET /api/health z prawdziwym SELECT 1
  migrations/                migracje TypeORM (pusty do pierwszej encji)
  reservations/              scaffold
  admin/                     scaffold

scripts/package-lambda.mjs   budowa ZIP-a, ten sam kod na Windows i Linux
test/                        testy jednostkowe
```

### Odstępstwa od pierwotnego szkicu

Cztery, każde z powodem:

**`database/typeorm.options.ts`** — jedno źródło opcji połączenia dla aplikacji
Nest i dla migracji. Gdyby każda ścieżka budowała je osobno, prędzej czy później
migracje pojechałyby na innym SSL, schemacie albo bazie niż aplikacja. Taki błąd
ujawnia się dopiero na produkcji.

**`app.setup.ts`** — z tego samego powodu: `main.ts` i `lambda.ts` muszą ustawiać
prefiks i pipe'y identycznie, inaczej coś działa lokalnie i zwraca 404 w AWS.

**`migrations/` pod `src/`, nie w katalogu głównym** — migracje muszą zostać
skompilowane do `dist/` i trafić do artefaktu Lambdy. Katalog poza `src/`
wymagałby zmiany `rootDir` i przesunąłby handlery na `dist/src/lambda.handler`.

**Scaffoldy mają `README.md` zamiast `.gitkeep`** — pusty katalog nic nie mówi
osobie wracającej do projektu po pół roku.

## Cold start i pula połączeń

### Czym jest cold start

Gdy Lambda nie ma wolnego środowiska wykonawczego, tworzy nowe: pobiera
artefakt, uruchamia runtime Node i wykonuje kod modułu, zanim wywoła handler.
Ten narzut nazywamy zimnym startem. Kolejne żądania trafiające w to samo
środowisko (**warm invocation**) pomijają go w całości.

### Dlaczego NestJS startuje wolniej niż goły handler

Nest przy starcie skanuje dekoratory, buduje graf zależności, tworzy instancje
providerów i inicjalizuje moduły — w tym połączenie z bazą. Prosty handler
eksportujący funkcję nie robi nic z tego. To realna cena za strukturę,
walidację i testowalność.

### Jak to ograniczamy

`src/lambda.ts` cache'uje **obietnicę** bootstrapu w zakresie modułu, a nie
w funkcji handlera:

```ts
let bootstrapPromise: Promise<ProxyHandler> | undefined;

export const handler = async (event, context) => {
  bootstrapPromise ??= bootstrap();
  const proxy = await bootstrapPromise;
  return proxy(event, context);
};
```

Kod na poziomie modułu wykonuje się raz na środowisko wykonawcze. Ciepłe
wywołanie zastaje gotowy graf DI i **otwartą pulę połączeń** — nie buduje ich
ponownie i nie otwiera nowych połączeń do RDS.

Cache'ujemy obietnicę, a nie wynik: gdyby dwa wywołania trafiły w to samo zimne
środowisko, oba poczekają na ten sam bootstrap zamiast wykonać go dwa razy.

### `callbackWaitsForEmptyEventLoop`

Nasz handler zwraca obietnicę i nie korzysta z parametru `callback`, więc runtime
kończy wywołanie w momencie jej rozwiązania. Przy takim podejściu to ustawienie
**nie ma znaczenia**.

Warto je znać, bo dotyczy handlerów w stylu callback: tam otwarta pula połączeń
potrafi zablokować opróżnienie pętli zdarzeń i wywołanie kończy się timeoutem
mimo poprawnej odpowiedzi. Nie jest to jednak bezwzględny wymóg każdego
asynchronicznego handlera w Node i nie należy go tak traktować.

### Ile połączeń zniesie baza

Górny limit połączeń zależy od **dwóch** czynników:

```
maksymalna liczba połączeń ≈ liczba równoległych środowisk × DB_POOL_MAX
```

Oba trzeba kontrolować — jedno bez drugiego nie wystarcza:

- **`DB_POOL_MAX`** (domyślnie 2) ogranicza, ile połączeń trzyma pojedyncze
  środowisko wykonawcze.
- **reserved concurrency** na Lambdzie ogranicza liczbę środowisk działających
  równolegle. Ustawia się ją w `zoja-infra` (`lambda.tf`, na razie zakomentowana).

Przy `db.t4g.micro` limit `max_connections` to około 110. Z pulą 2 i rezerwacją
10 równoległych wykonań górny pułap to około 20 — zapas jest spory, ale rośnie
liniowo ze współbieżnością, więc rezerwacji nie zostawiaj na „nieograniczona".

### Kiedy RDS Proxy zacznie mieć sens

Gdy pojawi się przynajmniej jedno z tych zjawisk:

- współbieżność Lambdy zaczyna zbliżać liczbę połączeń do `max_connections`,
- w CloudWatch widać błędy „too many connections" albo długie oczekiwanie na połączenie,
- dochodzi drugi konsument bazy (kolejna usługa, zadanie wsadowe),
- chcemy przetrwać failover RDS bez błędów po stronie aplikacji.

Do tego czasu Proxy to koszt bez korzyści — dlatego go nie ma.

## Model danych

Dwa pojęcia, świadomie rozłączone:

| Encja | Tabela | Co reprezentuje |
|---|---|---|
| `VisitSlot` | `visit_slots` | termin/opcję przyjazdu wystawioną przez gospodarzy |
| `Reservation` | `reservations` | prośbę konkretnej osoby o dany termin |

Termin istnieje **niezależnie** od tego, czy ktoś o niego poprosił. To
rozłączenie jest sednem modelu:

```
termin istnieje + nie jest zablokowany + brak aktywnej rezerwacji = termin wolny
```

Gdyby wszystko siedziało w jednej tabeli, „wolny weekend" musiałby być
reprezentowany przez brak wiersza — a wtedy nie da się ani zablokować terminu,
ani zachować historii odrzuconych próśb.

### Statusy rezerwacji

| Status | Znaczenie | Termin |
|---|---|---|
| `PENDING` | czeka na decyzję rodziców | **zajęty** |
| `CONFIRMED` | zaakceptowana | **zajęty** |
| `REJECTED` | odrzucona | wolny |
| `CANCELLED` | odwołana | wolny |

Odrzucenie i odwołanie **nie kasują** rekordu — historia zostaje.

Blokada terminu nie jest statusem rezerwacji, tylko cechą samego terminu
(`visit_slots.is_blocked`). Blokada nie ma gościa, e-maila ani decyzji do
podjęcia, więc trzymanie jej jako rezerwacji wymuszałoby wiersze, które
rezerwacjami nie są.

### Jedna aktywna rezerwacja na termin

Pilnuje tego **częściowy unikalny indeks** w PostgreSQL, a nie kod aplikacji:

```sql
CREATE UNIQUE INDEX "uq_reservations_active_slot"
  ON "reservations" ("slot_id")
  WHERE "status" IN ('PENDING', 'CONFIRMED');
```

Sprawdzenie „czy wolny?" w kodzie nie wystarcza — między odczytem a zapisem
mieści się drugie żądanie, a Lambda bywa zwielokrotniona. Baza odrzuci drugi
INSERT niezależnie od liczby równoległych procesów, bez żadnego locka.

Warunek `WHERE` musi pozostać zgodny z `ACTIVE_RESERVATION_STATUSES`
w `src/reservations/reservation.enums.ts`.

### Prywatność

`reservations.is_private` (domyślnie `false`) decyduje wyłącznie o tym, czy
publicznie pokazujemy, **kto** przyjeżdża. Zaznaczone = inni widzą tylko
„Zajęte". E-mail i notatki nie są publiczne nigdy, niezależnie od tej flagi.

### Rejestr encji i migracji

`ENTITIES` i `MIGRATIONS` w `src/database/typeorm.options.ts` są
**jawnymi listami**, nie globami — powód opisany w komentarzu przy rejestrze.

```
ENTITIES   = [VisitSlot, Reservation]
MIGRATIONS = [CreateVisitSlotsAndReservations1788517800000]
```

`synchronize = false` i `migrationsRun = false` — zawsze. Schemat bazy zmienia
**wyłącznie Lambda migracyjna**, nigdy start aplikacji API.

## API

Globalny prefiks `api` ustawia `configureApp()`, więc kontroler `@Controller("reservations")`
odpowiada pod `/api/reservations`. Ten sam `ValidationPipe` (`whitelist`,
`forbidNonWhitelisted`, `transform`) obowiązuje lokalnie i w Lambdzie.

### POST /api/reservations

Tworzy prośbę o wizytę. Zwraca **201**.

```json
{
  "id": "…", "status": "PENDING",
  "slot": { "id": "…", "dateStart": "2026-09-05", "dateEnd": "2026-09-06" },
  "message": "Twoja prośba o wizytę została wysłana i oczekuje na potwierdzenie…"
}
```

| Sytuacja | Odpowiedź |
|---|---|
| termin zablokowany | 409 „Ten termin jest obecnie niedostępny." |
| termin już minął | 409 „Ten termin już minął." |
| ktoś był szybszy | 409 „Ten termin jest już zajęty." |
| `dateEnd` < `dateStart` | 400 |
| błąd walidacji / obce pole | 400 |

`turnstileToken` jest przyjmowany, ale **nie zapisywany i nie logowany**.

### GET /api/visit-slots?from=YYYY-MM-DD&to=YYYY-MM-DD

Zwraca **wyłącznie terminy istniejące w bazie**, nachodzące na zakres. Maksymalny
zakres to 366 dni.

```json
[{ "id": "…", "dateStart": "2026-09-05", "dateEnd": "2026-09-06",
   "isWeekend": true, "isBlocked": false, "blockedReason": null,
   "reservation": { "status": "CONFIRMED", "guestName": "Babcia Krysia" } }]
```

## Terminy materializują się na żądanie

**Nie pregenerujemy weekendów.** Kalendarz powstaje na frontendzie, a brak wiersza
w `visit_slots` znaczy po prostu *zwykły wolny termin*. Wiersz pojawia się dopiero
wtedy, gdy termin przestaje być zwyczajny — ktoś go rezerwuje albo gospodarze go
blokują. Przy dwunastu weekendach w oknie `GET` potrafi zwrócić trzy pozycje;
pozostałe dziewięć frontend traktuje jako wolne.

Dwa równoległe żądania mogą chcieć utworzyć ten sam termin, więc INSERT idzie
z `ON CONFLICT DO NOTHING` (`orIgnore()`), a wiersz odczytujemy po zakresie dat.
Świadomie **nie** używamy `repository.upsert()` — generuje `DO UPDATE`, co
nadpisałoby `is_blocked` ustawione wcześniej przez gospodarzy.

Ostatecznym bezpiecznikiem przed dwiema aktywnymi rezerwacjami jest częściowy
unikalny indeks w PostgreSQL, nie kod aplikacji. Serwis rozpoznaje naruszenie po
**nazwie constraintu** (`uq_reservations_active_slot`), a nie po samym kodzie
`23505`, i tłumaczy je na 409. Klient nie dostaje ani SQL-a, ani nazwy indeksu.

## Prywatność w odczycie publicznym

`GET /api/visit-slots` buduje odpowiedź **allowlistą**, pole po polu — nigdy przez
rozlanie encji. Przy odejmowaniu wrażliwych kluczy każde nowe pole w encji
domyślnie by wyciekło; przy dodawaniu domyślnie nie wychodzi nic.

| Stan | Co widać publicznie |
|---|---|
| `PENDING` | `{ "status": "PENDING" }` — **bez** `guestName`, to dopiero prośba |
| `CONFIRMED` + `isPrivate=false` | `{ "status": "CONFIRMED", "guestName": "…" }` |
| `CONFIRMED` + `isPrivate=true` | `{ "status": "CONFIRMED" }` |
| `REJECTED` / `CANCELLED` | nie są aktywne — termin wygląda na wolny |

`guestEmail`, `notes`, `isPrivate` i znaczniki czasu rezerwacji **nie wychodzą
nigdy**, niezależnie od statusu.

Daty porównujemy w strefie `Europe/Warsaw`, nie w UTC Lambdy — inaczej między
północą a drugą w nocy termin, który właśnie się zaczął, wyglądałby na przyszły.

## Migracje przy prywatnym RDS

RDS ma `Public access = No`. TypeORM CLI z laptopa nie ma do niego trasy,
standardowy runner GitHuba też nie. Rozwiązaniem jest **osobna Lambda w VPC**.

```
laptop / CI
   │  aws lambda invoke          ← publiczne API sterujące Lambdą
   ▼
zoja-db-migrations-lambda        ← w VPC, grupa zoja-lambda-sg
   │  TCP 5432
   ▼
zoja-postgres                    ← prywatny, bez publicznego dostępu
```

Łatwo pomylić dwie rzeczy: `aws lambda invoke` z laptopa idzie do **płaszczyzny
sterowania** Lambdy przez publiczny internet i to jest w porządku. Osobną sprawą
jest ruch wychodzący **z samej funkcji** — ten faktycznie nie ma jak wyjść bez
NAT-a. Migracjom to nie przeszkadza, bo baza leży w tej samej VPC.

### Lokalnie

```bash
npm run db:up
npm run migration:generate -- src/migrations/NazwaMigracji
npm run migration:run
npm run migration:show
```

### Na produkcji

```bash
aws lambda invoke --function-name zoja-db-migrations-lambda response.json
cat response.json
```

Handler (`src/migration-lambda.ts`) uruchamia migracje z `transaction: "all"` —
albo przejdą wszystkie, albo żadna. Zwraca wyłącznie nazwy zastosowanych
migracji; pełny stack błędu zostaje w CloudWatch, bo może zawierać host
i użytkownika bazy.

**Czego świadomie nie robimy:** nie otwieramy bazy na świat, nie tworzymy
publicznego `/api/migrate`, nie stawiamy bastionu EC2.

## Build i paczka Lambdy

```bash
npm run build            # nest build → dist/
npm run package:lambda   # artifacts/zoja-backend.zip
```

Skrypt pakujący jest w Node, więc działa identycznie w PowerShellu, Git Bashu
i na Linuksie w CI. Kroki: kopiuje `dist/`, kopiuje `package.json`
i `package-lock.json`, uruchamia `npm ci --omit=dev` w katalogu roboczym,
pakuje całość przez `archiver`.

Jeden artefakt, **dwie funkcje Lambda**:

| Funkcja | Handler | Wyzwalacz |
| --- | --- | --- |
| API | `dist/lambda.handler` | API Gateway HTTP API |
| Migracje | `dist/migration-lambda.handler` | brak — ręcznie albo CI |

Konfiguracja funkcji API w AWS (zarządza nią `zoja-infra`, nie ten skrypt):
**256 MB, timeout 10 s, `nodejs24.x`**. Pierwsze 128 MB i 3 s nie wystarczyły —
NestJS wstawał, ale wywołanie kończyło się timeoutem przy ~116 MB zużycia.

### Rozmiar paczki

Aktualnie **21,9 MB spakowane, 113 MB rozpakowane**. Limity Lambdy to 50 MB
(bezpośredni upload) i 250 MB (rozpakowane), więc zapas jest.

Warto wiedzieć, skąd bierze się rozmiar: `typeorm@1` zależy od `ts-node`, który
zależy od `typescript` — same 24 MB. W runtime wykonujemy skompilowany JavaScript,
więc te pakiety nie są potrzebne. Świadomie ich **nie przycinamy**: priorytetem
jest stabilny i przewidywalny deployment, a limitów nie dotykamy. Gdyby paczka
zaczęła się o nie ocierać, najprostszym krokiem jest usunięcie `typescript`
i `ts-node` z katalogu roboczego po `npm ci`, tuż przed spakowaniem.

### Dlaczego nie bundlujemy

TypeORM i NestJS opierają się na metadanych dekoratorów. Agresywne tree-shaking
przez esbuild albo webpack potrafi je zgubić w sposób ujawniający się dopiero
w runtime, jako `EntityMetadataNotFound` albo błąd wstrzykiwania zależności.
Klasyczne `npm ci --omit=dev` jest większe, ale przewidywalne.

### Dlaczego ZIP zbudowany na Windows działa na Amazon Linux

Żadna zależność produkcyjna nie zawiera kodu natywnego — `pg` jest czystym
JavaScriptem (opcjonalnego `pg-native` nie instalujemy), TypeORM i Nest też.

**To przestanie być prawdą**, gdy dojdzie `bcrypt`, `sharp` albo inna paczka
z binariami. Wtedy paczkę trzeba budować na Linuksie (kontener albo runner CI)
albo użyć `npm ci --os=linux --cpu=x64`.

## Konfiguracja API Gateway

NestJS routuje sam, więc HTTP API ma trasę **catch-all**:

```
ANY /api/{proxy+}  → integracja z Lambdą NestJS
```

Zastąpiła pierwotną `GET /api/hello`. Zasób w Terraformie nadal nazywa się
`aws_apigatewayv2_route.hello` — nazwy celowo nie zmienialiśmy, żeby nie robić
`state mv` bez korzyści.

`{proxy+}` **nie łapie gołego `/api`**. Na to potrzebna jest osobna trasa
`ANY /api`, która czeka zakomentowana jako `api_root` w
`zoja-infra/terraform/api-gateway.tf`. Dziś nic to nie blokuje, bo każdy
endpoint ma segment po `/api`.

### Dlaczego ścieżki się zgadzają

Stage nazywa się `$default`, a HTTP API w tym trybie **nie dokleja nazwy stage
do ścieżki** (inaczej niż REST API). CloudFront przekazuje `/api/health` bez
zmian, API Gateway podaje w `rawPath` dokładnie `/api/health`, a Nest z globalnym
prefiksem `api` właśnie tego oczekuje.

Gdyby stage miał nazwę, w ścieżce pojawiłoby się `/nazwa/api/health` i wszystko
wracałoby 404 — warto o tym wiedzieć, zanim zacznie się szukać błędu w Nescie.

CloudFront ma już behavior `/api/*` z wyłączonym cache i polityką
`AllViewerExceptHostHeader`. Nagłówek `Host` musi zostać hostem API Gateway,
inaczej brama nie rozpozna żądania — dlatego nie `AllViewer`.

## Checklista testów

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm test                 # vitest run
npm run build            # nest build
npm run package:lambda   # artifacts/zoja-backend.zip
```

Stan na dziś: **typecheck czysty, lint czysty, 8 testów w 3 plikach przechodzi,
build i paczka działają, oba handlery ładują się z rozpakowanego artefaktu.**

Testy jednostkowe mockują `DataSource` i **nie łączą się z żadną bazą ani z AWS**.
Pokrywają: poprawną odpowiedź health, zwrot 503 przy awarii bazy, brak wycieku
danych połączenia do odpowiedzi, konwersję typów env i odrzucenie braków.

Ręcznie, po wdrożeniu:

1. `curl https://<dystrybucja>.cloudfront.net/api/health` → `{"status":"ok","database":"connected"}`
2. Ten sam adres z wyłączoną Lambdą albo zablokowaną grupą → 503 bez szczegółów w treści.
3. CloudWatch: pełny błąd widoczny, hasło nigdzie nie występuje.

## Decyzje techniczne

**NestJS 12 wymusza ESM.** Paczki `@nestjs/*` w tej wersji mają `"type": "module"`
i nie mają buildu CommonJS, więc projekt jest modułem ESM. Stąd `"type": "module"`
w `package.json`, rozszerzenia `.js` przy importach względnych i `import.meta`
zamiast `__dirname`.

**Vitest zamiast Jest.** Jest z ESM wymaga `--experimental-vm-modules`, a to
zmienna środowiskowa, której nie da się ustawić przenośnie w skrypcie npm.
Vitest obsługuje ESM i TypeScript bez obejść. API jest zgodne z Jestem.

**Encje i migracje rejestrujemy jawnie, bez globów.** W trybie ESM globy TypeORM
bywają zawodne: na Windows `path.join` daje odwrotne ukośniki, których matcher
nie rozumie, a ładowanie idzie przez dynamiczny `import()` wrażliwy na
rozszerzenie. Jawna lista w `typeorm.options.ts` kosztuje jedną linijkę przy
dodaniu encji i oszczędza wieczór debugowania `EntityMetadataNotFound`.

**`strictPropertyInitialization: false`.** Standardowe odstępstwo dla encji
TypeORM, w których kolumny deklaruje się bez inicjalizacji. Reszta `strict`
pozostaje włączona.

**Adapter `@codegenie/serverless-express`.** Utrzymywany następca
`@vendia/serverless-express`. Używamy nazwanego eksportu `configure`, bo
deklaracja typów tej paczki mapuje `export default` na `.default`, przez co
domyślny import nie jest wywoływalny.

## TODO

- [x] Zaprojektować encje `VisitSlot` i `Reservation` oraz pierwszą migrację.
- [x] Dopisać encje do `ENTITIES` i migracje do `MIGRATIONS` w `typeorm.options.ts`.
- [ ] **Uruchomić pierwszą migrację na RDS** przez `zoja-db-migrations-lambda`.
      Do tego czasu tabele istnieją wyłącznie w kodzie.
- [x] `ReservationsModule` i `VisitSlotsModule`: POST /api/reservations
      oraz publiczny GET /api/visit-slots.
- [ ] **Serwerowa weryfikacja tokenu Cloudflare Turnstile** — dziś token jest
      przyjmowany i ignorowany. Wymagane przed publicznym uruchomieniem.
- [ ] Wdrożyć ten kod do API Lambdy (`zoja-hello-api-lambda-central`).
- [ ] E-mail do gościa po utworzeniu prośby.
- [ ] E-mail do rodziców z linkami Potwierdź / Odrzuć.
- [ ] Endpointy confirm/reject oraz kolumny `action_token_hash`
      i `action_token_expires_at` (osobna migracja — do maila trafia token
      jawny, w bazie ląduje wyłącznie hash).
- [ ] E-mail do gościa po zmianie rezerwacji przez rodziców.
- [ ] Admin CRUD dla trybu `?zoja`: lista terminów, edycja, blokowanie, zmiana
      terminu, zwalnianie.
- [ ] Podłączyć frontend do prawdziwego API (dziś działa na mockach).
- [ ] Concurrency group w CI dla Lambdy migracyjnej — zastępuje niedostępną
      na tym koncie rezerwację współbieżności.
- [ ] Uzgodnić słownik statusów z frontendem: backend ma
      `PENDING/CONFIRMED/REJECTED/CANCELLED`, frontend
      `pending/booked/rejected/cancelled/blocked/expired`.
- [ ] Włączyć pełną weryfikację TLS wobec RDS: dołożyć bundle `rds-ca` i zmienić
      `rejectUnauthorized` na `true`. Dziś połączenie jest szyfrowane, ale
      łańcuch zaufania nie jest weryfikowany.
- [ ] Ustawić reserved concurrency na Lambdzie (`zoja-infra/terraform/lambda.tf`).
- [x] Trasa catch-all `ANY /api/{proxy+}` — zastąpiła `GET /api/hello`.
- [ ] Dodać trasę `ANY /api` (`api_root`), gdy pojawi się endpoint na gołym `/api`.
- [x] Utworzyć `zoja-db-migrations-lambda`.
- [x] Docelowy secret management dla `DB_PASSWORD` — Secrets Manager przez
      Interface VPC Endpoint. `DB_PASSWORD` nie istnieje już w env żadnej Lambdy.
- [ ] Rotacja credentiala RDS i przegląd historycznych plików `terraform.tfstate`.
- [ ] `AdminModule` z autoryzacją — dopóki go nie ma, do bazy nie wolno wpuścić
      prawdziwych danych osobowych.
