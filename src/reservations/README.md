# reservations — scaffold

Pusto celowo. Tu trafi `ReservationsModule`: encja `Reservation`, kontroler
z trasami `/api/reservations`, serwis i DTO z walidacją `class-validator`.

Kolejność, w której to powstanie:

1. Działający `GET /api/health` przez pełną ścieżkę
   CloudFront → API Gateway → Lambda → TypeORM → RDS.
2. Dopiero potem projekt encji `Reservation` i pierwsza migracja.

Kontrakt danych jest już opisany po stronie frontendu w `zoja-frontend`,
w katalogu `src/types/` — statusy rezerwacji, kształt odpowiedzi kalendarza
i błędy API. Warto z niego skorzystać, żeby backend nie rozjechał się z tym,
czego oczekuje aplikacja.
