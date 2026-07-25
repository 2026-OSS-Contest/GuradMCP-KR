# Changelog

## 0.4.0

- Added `formatDate` preset `"relative"` for "n일 전" / "n일 후" phrasing.
- Dropped Node 16 from the CI matrix; minimum supported runtime is now Node 18.

## 0.3.1

- Fixed `formatWon` rounding negative amounts away from zero instead of toward it.

## 0.3.0

- Initial public release. `formatWon` and `formatDate` only; more formatters
  are tracked in the project board but not yet scheduled.
