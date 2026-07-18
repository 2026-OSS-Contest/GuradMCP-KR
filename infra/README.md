# Container runtime

The Compose stack has two mutually exclusive profiles:

- `demo`: immutable, deterministic demo services.
- `dev`: the same network contract with `APP_MODE=development`, intended for
  local source iteration.

Start either mode and run the GMCP-30 readiness gate in one command:

```bash
./scripts/compose-up.sh demo
# or
./scripts/compose-up.sh dev
```

The equivalent direct Compose command is also a single line:

```bash
docker compose --profile demo up --build --detach
```

The gate writes machine-readable evidence to
`reports/gmcp-30-readiness.json` and fails unless the console and every exposed
service become healthy within 300 seconds, including image build time.
`./scripts/compose-down.sh` stops the stack. Add `--volumes` only when
deterministic database and Redis state should be recreated from scratch.

All local ports bind to `127.0.0.1`. Copy `.env.example` to `.env` to override
ports or disposable local credentials.

## Multi-architecture images

Dockerfiles use multi-architecture upstream images and contain no host-arch
downloads. A BuildKit builder can produce both targets, for example:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f packages/gateway/Dockerfile -t ghcr.io/example/guardmcp-gateway:dev .
```
