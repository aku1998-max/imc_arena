# Content import format (schema version 1)

`POST /v1/admin/imports` (editor or administrator) accepts one JSON document. Items are validated
by a background job and stored as **drafts**; nothing is published by an import. Each draft then
goes through independent review and publication. Maximum 500 questions per file.

```json
{
  "schemaVersion": 1,
  "sourceType": "original",
  "rightsStatus": "cleared",
  "rightsNotes": "Written for IMC Arena by the content team, 2026.",
  "questions": [
    {
      "schemaVersion": 1,
      "sourceReference": "team-2026-g4-arith-001",
      "locale": "en",
      "stemBlocks": [{ "type": "text", "text": "What is 6 × 7?" }],
      "options": [
        { "id": "a", "text": "36" },
        { "id": "b", "text": "42" },
        { "id": "c", "text": "48" },
        { "id": "d", "text": "49" }
      ],
      "correctOptionId": "b",
      "explanationBlocks": [{ "type": "text", "text": "Six groups of seven total 42." }],
      "grade": 4,
      "topicSlug": "arithmetic",
      "difficulty": 1
    }
  ]
}
```

| Field                             | Rules                                                                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceType`                      | `original`, `licensed` or `imc_archive`                                                                                                                                                             |
| `rightsStatus`                    | `cleared`, `unknown` or `restricted`; only `cleared` can be published                                                                                                                               |
| `sourceReference`                 | optional, unique per source type; used for duplicate detection                                                                                                                                      |
| `stemBlocks`, `explanationBlocks` | 1–20 blocks: `{"type":"text","text"}`, `{"type":"math","latex","display","alt"}`, `{"type":"image","assetId","alt"}`. No HTML. `alt` is the spoken alternative; check it does not reveal the answer |
| `options`                         | exactly four distinct choices for publication; stable ids `^[a-z0-9_-]{1,16}$`; `text` and/or `math` (+`alt`)                                                                                       |
| `correctOptionId`                 | must be one of the option ids; never sent to students before they answer                                                                                                                            |
| `grade`                           | 4–6                                                                                                                                                                                                 |
| `topicSlug`                       | an existing active topic                                                                                                                                                                            |
| `difficulty`                      | 1 easy, 2 medium, 3 harder                                                                                                                                                                          |

Images must be uploaded first (`POST /v1/admin/assets/upload-intent` → PUT → `…/complete`) and
referenced by `assetId`. Allowed: PNG, JPEG, WebP up to 2 MB, verified by size, SHA-256 and file
signature.

Per-item results (`GET /v1/admin/imports/:id`) report `INVALID_ITEM`, `ANSWER_NOT_AN_OPTION`,
`OPTION_COUNT`, `DUPLICATE_OPTION`, `UNKNOWN_TOPIC`, `DUPLICATE` (same source reference or same
content hash) and `STORE_FAILED`. A CSV-to-JSON helper may follow (spec §09).
