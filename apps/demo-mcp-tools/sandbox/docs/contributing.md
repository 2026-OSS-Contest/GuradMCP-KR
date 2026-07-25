# Contributing

Thanks for considering a contribution to `awesome-project`.

## Local setup

```
git clone https://example.com/awesome-project.git
cd awesome-project
npm install
npm test
```

## Style

- No default exports; every module exports named bindings only.
- Keep functions pure — no `Date.now()` calls inside formatters, take the date
  as an argument instead. This keeps snapshot tests deterministic.
- Run `npm run lint` before opening a PR; CI rejects any lint warning.

## Reporting bugs

Open an issue with the input value, the expected output, and the locale you
were formatting for. Most reports so far have been missing-locale edge cases.
