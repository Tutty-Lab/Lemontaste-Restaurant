# Algorithm Audit: Khang / Ngon

Date: 2026-10-18. Actual September 2026 input roster, salary targets, two stores planned sequentially.

## Findings and Fixes

- Fixed shared-person consecutive days: other-store workdays now count toward the six-day consecutive and six-day weekly limits. Before the fix, the January manager roster reached nine consecutive workdays across stores.
- Added a store-specific demand profile for Ngon: 13:00-15:00 and 18:00-21:00. The scheduler and trial-plan suggestions use this profile instead of the inherited demo peaks.
- Demand weights prioritize Khang Tuesday/Wednesday/Thursday and Ngon Thursday/Friday/Sunday. Weights are relative assumptions, not staffing headcounts.

## Automated Checks

All 12 months of 2026, both stores together: opening blocks, closures, Munich holidays, minimum coverage, 30-minute grid, no excess contractual minutes, no same-day cross-store assignments, at most eight paid hours per person/day, six consecutive days, six workdays per week. Busy-day average staffing hours exceed normal-day averages by at least 10%.

The audit resets between months. It does not establish rest-day correctness across archived month boundaries. It does not prove global optimality.

| Month | Store | Target Hours | Planned Hours | Missing Hours |
| --- | --- | ---: | ---: | ---: |
| 01/2026 | khang | 909.22 | 903.50 | 5.72 |
| 01/2026 | ngon | 1028.58 | 985.00 | 43.58 |
| 02/2026 | khang | 909.22 | 883.00 | 26.22 |
| 02/2026 | ngon | 1028.58 | 988.00 | 40.58 |
| 03/2026 | khang | 909.22 | 902.50 | 6.72 |
| 03/2026 | ngon | 1028.58 | 1010.50 | 18.08 |
| 04/2026 | khang | 909.22 | 896.00 | 13.22 |
| 04/2026 | ngon | 1028.58 | 989.50 | 39.08 |
| 05/2026 | khang | 909.22 | 895.00 | 14.22 |
| 05/2026 | ngon | 1028.58 | 997.00 | 31.58 |
| 06/2026 | khang | 909.22 | 885.50 | 23.72 |
| 06/2026 | ngon | 1028.58 | 1007.50 | 21.08 |
| 07/2026 | khang | 909.22 | 908.00 | 1.22 |
| 07/2026 | ngon | 1028.58 | 995.50 | 33.08 |
| 08/2026 | khang | 909.22 | 904.00 | 5.22 |
| 08/2026 | ngon | 1028.58 | 1003.00 | 25.58 |
| 09/2026 | khang | 909.22 | 907.00 | 2.22 |
| 09/2026 | ngon | 1028.58 | 988.00 | 40.58 |
| 10/2026 | khang | 909.22 | 907.00 | 2.22 |
| 10/2026 | ngon | 1028.58 | 980.50 | 48.08 |
| 11/2026 | khang | 909.22 | 899.00 | 10.22 |
| 11/2026 | ngon | 1028.58 | 1010.50 | 18.08 |
| 12/2026 | khang | 909.22 | 908.00 | 1.22 |
| 12/2026 | ngon | 1028.58 | 985.00 | 43.58 |

## September Detail

| Store | Employee | Target Hours | Planned Hours | Days |
| --- | --- | ---: | ---: | ---: |
| khang | Phạm H. N. Khanh | 42.00 | 42.00 | 12 |
| khang | Trịnh Hoàng Sơn | 106.00 | 106.00 | 26 |
| khang | Phạm Văn Chất | 172.00 | 172.00 | 26 |
| khang | Nguyễn Mạnh Hà | 154.00 | 154.00 | 26 |
| khang | Vũ Văn Toàn | 176.00 | 176.00 | 26 |
| khang | Trần Thanh Vân | 107.92 | 106.50 | 15 |
| khang | Nguyễn Hữu Hòa | 107.92 | 107.50 | 25 |
| khang | Dương Thị Khánh | 43.38 | 43.00 | 12 |
| ngon | Nguyễn Đức Tùng | 102.00 | 102.00 | 26 |
| ngon | Nguyễn Thị Lang | 102.00 | 102.00 | 26 |
| ngon | Hồ Thái D. Trường | 114.00 | 114.00 | 23 |
| ngon | Phạm Văn Lý | 160.00 | 160.00 | 26 |
| ngon | Phạm Quốc Trung | 166.00 | 166.00 | 26 |
| ngon | Đặng Việt Anh | 110.00 | 110.00 | 26 |
| ngon | Trần Thanh Vân | 107.92 | 67.50 | 9 |
| ngon | Nguyễn Đức Duy | 166.67 | 166.50 | 26 |

## Limits Requiring Business Decisions

- September total: 1,895 planned / 1,937.80 target hours. Shortfall: 42.80 hours, mainly the manager (174 planned / 215.83 target). The UI shows the warning; the audit does not mistake warnings for fulfilled targets.
- Even an ideal manager roster cannot reach 215.83 hours under the current opening blocks and six-consecutive-day rule: at most 26 days in September, at most 7.5 opening hours/day, hence at most 195 hours. This is an upper bound, not proof the current allocation is optimal; part of the observed shortfall may be avoidable.
- Reference workday counts from the image are retained as referenceDays, not enforced. For example, Nguyen Duc Tung has 26 generated days instead of 17 reference days, despite the same 102 hours.
- No required headcount by kitchen/service/sushi/bar was supplied. Minimum coverage currently means one person in the restaurant, not adequate department staffing.
- Salary conversion is a target estimate, not evidence of actual attendance. Fractional targets cannot always be matched exactly on a 30-minute grid.

## Reproduce

```powershell
$env:AUDIT_OUTPUT = "algorithm-audit.json"
npm test -- src/lib/__tests__/restaurant.test.ts src/lib/__tests__/restaurantAudit.test.ts
```
