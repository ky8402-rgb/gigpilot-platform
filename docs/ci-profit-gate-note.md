# CI Profit-Gate Notes

The profit-gate characterization suite (`npm run test:profit`, from PR #66)
must run as a mandatory CI gate on every pull_request and every push to
main/master, after the typecheck and before the production build.

- Job/check name `Typecheck and production build` in `.github/workflows/ci.yml`
  must not be renamed: `.github/workflows/deploy.yml` waits for that exact
  check-run name before deploying.
