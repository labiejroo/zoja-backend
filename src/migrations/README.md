# migrations

Katalog na migracje TypeORM. Pusty do czasu zaprojektowania pierwszej encji.

Migracje leżą pod `src/`, a nie w katalogu głównym, ponieważ muszą zostać
skompilowane do `dist/` i trafić do artefaktu Lambdy. Przy katalogu poza `src/`
wymagałoby to zmiany `rootDir` i zmieniłoby ścieżki handlerów na
`dist/src/lambda.handler`.

Generowanie i uruchamianie — patrz README projektu, sekcja „Migracje".
