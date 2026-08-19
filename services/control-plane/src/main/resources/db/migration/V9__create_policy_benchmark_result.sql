-- SPEC-POL-04 §4.3/§6.2/§8.3 (GMCP-77): a snapshot of each Benchmark Runner (`guardmcp bench
-- run`) execution's FPR for one policy, against a labeled Attack Lab dataset.
--
-- Append-only by design, per §8.3's own resolution of its open question: "MVP는 최신 1건만
-- 저장하고, 이력 테이블 스키마만 확장 여지를 남겨둔다... 마이그레이션 시 컬럼 추가가 아니라 새
-- 행 추가로 자연스럽게 이력이 쌓이도록". `GET /policies/{id}/stats` (PolicyController) reads
-- only the latest row per policy; nothing here ever UPDATEs or DELETEs a row, so a later
-- ticket can serve a full trend chart from this same table with no migration.
CREATE TABLE policy_benchmark_result (
  id                    uuid PRIMARY KEY,
  policy_id             text NOT NULL,
  ran_at                timestamptz NOT NULL,
  dataset_version       text NOT NULL,
  normal_sample_count   integer NOT NULL,
  false_positive_count  integer NOT NULL,
  fpr                   numeric NOT NULL
);

CREATE INDEX policy_benchmark_result_policy_id_ran_at_idx
  ON policy_benchmark_result (policy_id, ran_at DESC);
