# Initial data model

```mermaid
erDiagram
  USERS ||--o{ LEADS : owns
  LEADS ||--o| APPLICATIONS : converts_to
  APPLICATIONS ||--o{ DOCUMENTS : has
  APPLICATIONS ||--o{ VIDEO_KYC_APPOINTMENTS : has
  APPLICATIONS ||--o{ PAYMENTS : owes
  APPLICATIONS ||--o| AGREEMENTS : signs
  APPLICATIONS }o--o| TERRITORIES : requests
  TERRITORIES ||--o{ TERRITORY_ASSIGNMENTS : allocates
  APPLICATIONS ||--o{ TRAINING_ENROLLMENTS : completes
  USERS ||--o{ AUDIT_LOGS : performs
```

All exposed entities use UUID public identifiers, timestamps and soft deletes where appropriate. Payments, territory assignments and agreement transitions are transactionally locked and audited.
