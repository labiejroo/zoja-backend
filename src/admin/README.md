# admin — scaffold

Pusto celowo. Tu trafi `AdminModule` z operacjami gospodarzy: lista wszystkich
terminów, edycja, blokowanie zakresów i usuwanie.

Wszystkie trasy pod `/api/admin/*` muszą wymagać ważnej sesji. Mechanizm
logowania hasłem (SSM Parameter Store, token podpisany HMAC, nagłówek
`Authorization: Bearer`) jest zaprojektowany osobno i nie wchodzi do tego etapu.

Do czasu jego wdrożenia **nie wolno wpuścić do bazy prawdziwych danych
osobowych** — frontend nadal odsłania panel przez tymczasowy parametr `?zoja`,
który zabezpieczeniem nie jest.
