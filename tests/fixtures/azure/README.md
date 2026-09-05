# Azure Pronunciation Assessment fixtures (real captures)

These JSON files are **verbatim responses captured from LIVE Azure Speech**
(region `southeastasia`, `format=detailed`, `Pronunciation-Assessment` header with
`GradingSystem=HundredMark`, `Granularity=Phoneme`, `Dimension=Comprehensive`) via
the `/speech/recognition/conversation/cognitiveservices/v1` endpoint. They back the
`parseAssessment` regression tests.

The key shape fact they pin down: the pronunciation scores live **directly on the
`NBest[0]` item** (`AccuracyScore` / `FluencyScore` / `CompletenessScore` /
`PronScore`), **not** nested under a `PronunciationAssessment` object. Reading only
the nested path is what made every real clip score `0/100`.

- `success-reluctant.json` — a cleanly-spoken "reluctant" → `PronScore: 100`.
- `mispronounced-low.json` — a wrong word graded against "reluctant" → `PronScore: 76`
  (a real low-ish gradient, still `Success`).
- `initial-silence-timeout.json` — a silent clip → `RecognitionStatus:
  "InitialSilenceTimeout"`, **no `NBest`** (the "couldn't hear you" case that must
  NOT surface as `0/100`).
