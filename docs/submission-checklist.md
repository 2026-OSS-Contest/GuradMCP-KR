# 최종 제출 패키징 체크리스트 (GMCP-48)

제출 마감(2026-08-27) 전 v1.0.0 태깅부터 외부 재현 증빙까지, 무엇을 어디에 두고 무엇을 실행해야 하는지 정리한 실행 문서입니다. 기능 동결 절차는 [기능 동결 런북](feature-freeze.md)(GMCP-43)을 따릅니다.

## 1. 제출물 목록

| 항목 | 산출물 경로 | 상태 | Plane 티켓 |
| --- | --- | --- | --- |
| `v1.0.0` 태그 | `git tag v1.0.0` (GitHub Release) | 대기 | GMCP-48 |
| README (ko/en) | `README.md`, `README.en.md` | 확인 필요(Quick Start·문서 표 최신화) | GMCP-48 |
| 시연 영상 최종본 | `docs/submission/demo-video.md`(영상 링크·로컬 사본 경로 기록) | 대기 | GMCP-45 |
| 결과보고서 | `docs/submission/final-report.md`(또는 PDF 링크) | 초안 완료 | GMCP-47 |
| 라이선스 리포트 | `artifacts/licenses/`(`npm run license:report`로 생성) | 대기 | GMCP-51 |
| 저장소 공개 설정 점검 | GitHub 저장소 Settings(Visibility, LICENSE 파일, 브랜치 보호) | 대기 | GMCP-51 |
| 제출 체크리스트 검수 | 본 문서 | 진행 중 | GMCP-48 |
| 외부 1인 Quick Start 재현 증빙 | `docs/submission/reproduction-report.md`(재현자, 일시, 결과 스크린샷/로그) | 템플릿 완료·재현 대기 | GMCP-48 |
| 시연 영상 기록 | `docs/submission/demo-video.md` | 템플릿 완료·영상 대기 | GMCP-45 |

`docs/submission/` 아래 세 문서 골격은 준비되어 있습니다. 외부 재현자·시연 영상 URL·최종 PDF만 마감 전 채우면 됩니다.

## 2. 태깅·패키징 절차

1. 기능 동결이 끝나고 회귀 버그 수정이 안정화되면 `dev`에서 `main`으로 최종 릴리스 PR을 병합합니다.
2. 태그를 생성합니다.

   ```bash
   git checkout main && git pull origin main
   git tag -a v1.0.0 -m "GuardMCP-KR v1.0.0"
   git push origin v1.0.0
   ```

3. GitHub Release를 만듭니다.

   ```bash
   gh release create v1.0.0 --title "GuardMCP-KR v1.0.0" --generate-notes
   ```

4. 소스 아카이브와 라이선스·재현 증빙을 한곳에 모읍니다.

   ```bash
   bash scripts/package-submission.sh
   ```

   `artifacts/submission/`에 소스 아카이브(`git archive`), 라이선스 리포트, README, 시연 영상·결과보고서·재현 증빙 문서(존재하는 것만)가 모입니다. `artifacts/`는 `.gitignore` 대상이므로 저장소에는 커밋되지 않고, 업로드용 산출물로만 사용합니다.

## 3. 제출 전 최종 검증 커맨드

```bash
npm ci
npm run check
npm run test:e2e
docker compose config -q
```

- `npm run check`는 lint, typecheck, 단위 테스트, 정책 검증, 벤치마크를 순서대로 실행합니다.
- `npm run test:e2e`는 Playwright 콘솔 플로우를 검증합니다.
- `docker compose config -q`는 `docker-compose.yml`(및 `--profile demo`/`--profile dev`) 구성이 유효한지 확인합니다. 전체 컨테이너 기동 검증이 필요하면 [`scripts/compose-verify.sh`](../scripts/compose-verify.sh)를 함께 실행합니다.
- CI와 동일한 필수 체크 전체 목록(`required / ci`, `required / policy-benchmark`, `required / licenses`, `required / containers`)은 [CI·품질 게이트 문서](ci/quality-gates.md)를 참고합니다.

## 4. 외부 재현 증빙

1. 팀 외부 인원 1명에게 [Quick Start](quickstart.md)만 보고 저장소를 클론해 5분 데모를 재현하도록 요청합니다.
2. 재현자는 사용한 OS/Docker 버전, 소요 시간, `docker compose ps` 결과 스크린샷을 남깁니다.
3. 결과를 `docs/submission/reproduction-report.md`에 정리하고, 실패했다면 어느 단계에서 막혔는지 기록해 Quick Start 문서를 함께 보완합니다.
4. 재현 성공이 GMCP-48의 최종 DoD이므로, 실패 시 제출 전 재시도합니다.
