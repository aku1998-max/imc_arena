# Content shortage

Trigger: `content_shortage` ops alerts or 503 `CONTENT_UNAVAILABLE` for daily/topic starts.

1. **Inspect coverage:** admin _Metrics_ → published inventory by grade; `GET /v1/topics?grade=N`
   shows per-topic `inventory` (`ready` ≥ 10, `limited` ≥ 5, `unavailable` < 5). The alert detail
   includes grade, locale, topic and available count.
2. **Publish reviewed additions** through the normal workflow (import → review → publish).
3. **Never serve unpublished material** and never relax rights or publication state. Selection
   already relaxes difficulty and recency automatically before failing.
