# ACCO first-release approval-policy matrix

Status: **APPROVED**

Decider: Eng Ahmed Shirie

Implementation owner: Abdulsalam

## Activated authoring surface

| Transaction | Allowed transition | Amount basis | Chain by approved band |
|---|---|---|---|
| Material request | `DRAFT → SUBMITTED` | Reporting USD | Project Manager → Procurement Manager |
| Purchase order | `DRAFT → SUBMITTED` | Net USD | 0–10k: Procurement Manager; 10k–50k: Procurement Manager → CFO; >50k: Procurement Manager → CFO → CEO |
| Supplier payment | `DRAFT → SUBMITTED` | Gross payable USD | Finance Manager → CFO; CEO for bands above the approved CFO threshold |
| BOQ baseline | `DRAFT → BASELINED` | N/A | QS Manager → Commercial Manager |

All other transaction types and lifecycle transitions remain `PENDING` and cannot be authored or activated.

## Rollout ownership

- Submitter: relevant process owner.
- Reviewer/publisher: CFO or Governance Administrator, different from the submitter.
- Activator: CFO after the effective date.
- Retire authority: CFO; CEO approval is required for an emergency retirement.
- Access reviewer: Governance Administrator, independent from the role owner.
- Platform Administrator: never an approver for a business transaction.
