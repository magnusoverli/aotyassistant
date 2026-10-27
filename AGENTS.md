# Project verification

Do not run Playwright tests by default, locally or in CI. Run them only when the user explicitly requests browser testing. Default verification uses release validation, typecheck, unit tests and build; packaged-app tests use Docker when available. Keep Playwright available as an opt-in check.
