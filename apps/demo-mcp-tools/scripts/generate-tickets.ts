/**
 * Deterministically generates the customer-ticket seed data and writes it to
 * seed/customer-tickets.json. Re-run with `npm run seed:tickets --workspace
 * @guardmcp/demo-mcp-tools` and commit the output — there is no randomness
 * here, so re-running produces byte-identical results (reproducibility is the
 * whole point of a demo sandbox).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBizNo, fakeCard, fakeRrn } from "../src/lib/pii-checksums.js";

interface Ticket {
  ticketId: string;
  customerName: string;
  channel: string;
  createdAt: string;
  body: string;
}

const names = [
  "홍길동", "김철수", "이영희", "박민수", "최지우", "정다은", "강태양", "윤서준",
  "임하늘", "한소희", "조현우", "배수지", "오준혁", "신예린", "서준영", "문서연"
];
const channels = ["전화", "이메일", "채팅", "게시판", "카카오톡 상담"];
const banks = ["국민은행", "신한은행", "우리은행", "하나은행", "농협은행"];
const addresses = [
  "서울특별시 강남구 테헤란로 152",
  "서울특별시 마포구 월드컵로 396",
  "부산광역시 해운대구 센텀중앙로 55",
  "대구광역시 수성구 동대구로 351",
  "인천광역시 연수구 컨벤시아대로 165",
  "경기도 성남시 분당구 판교역로 235",
  "광주광역시 서구 상무중앙로 61",
  "대전광역시 유성구 대학로 291"
];
const dlRegions = ["11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "28"];

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function isoDate(index: number): string {
  const base = Date.UTC(2026, 0, 5);
  const date = new Date(base + index * 3 * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function name(index: number): string {
  return names[index % names.length]!;
}

function channel(index: number): string {
  return channels[index % channels.length]!;
}

let ticketSequence = 0;
function nextTicketId(): string {
  ticketSequence += 1;
  return `TCK-2026-${pad(ticketSequence, 4)}`;
}

const tickets: Ticket[] = [];

function push(index: number, body: string): void {
  tickets.push({ ticketId: nextTicketId(), customerName: name(index), channel: channel(index), createdAt: isoDate(index), body });
}

// PII.PHONE — 6 tickets, contact-number context.
for (let i = 0; i < 6; i += 1) {
  const phone = `010-${pad(2345 + i, 4)}-${pad(6000 + i * 11, 4)}`;
  push(i, `안녕하세요, 배송 관련 문의드립니다. 제 연락처는 ${phone} 입니다. 오늘 중으로 회신 부탁드려요.`);
}

// PII.RRN_LIKE — 6 tickets, identity verification context.
for (let i = 0; i < 6; i += 1) {
  const rrn = fakeRrn(85 + (i % 10), 1 + (i % 12), 1 + ((i * 3) % 28), (i % 2 === 0 ? 1 : 2), 100000 + i * 37);
  push(6 + i, `본인 확인을 위해 주민등록번호를 남깁니다. 주민등록번호: ${rrn}. 본인 명의 계정이 맞는지 확인 부탁드립니다.`);
}

// PII.BIZ_NO — 6 tickets, business-account context.
for (let i = 0; i < 6; i += 1) {
  const bizNo = fakeBizNo(120000000 + i * 7919);
  push(12 + i, `저희 매장 사업자등록번호는 ${bizNo} 입니다. 세금계산서 재발행이 가능한지 문의드립니다.`);
}

// PII.CARD — 6 tickets, payment-failure context.
for (let i = 0; i < 6; i += 1) {
  const card = fakeCard(400000000 + i * 104729);
  push(18 + i, `결제 오류가 발생했습니다. 사용한 카드번호는 ${card} 이고, 결제가 두 번 청구된 것 같습니다.`);
}

// PII.ADDRESS — 6 tickets, delivery context.
for (let i = 0; i < 6; i += 1) {
  push(24 + i, `배송지 주소를 변경하고 싶습니다. 새 주소는 ${addresses[i % addresses.length]} 이고, 가능한 빨리 반영 부탁드립니다.`);
}

// PII.EMAIL — 6 tickets, account-recovery context.
for (let i = 0; i < 6; i += 1) {
  push(30 + i, `계정 로그인이 안 됩니다. 가입 시 사용한 이메일 주소는 customer${100 + i}@example.com 입니다. 확인 후 안내 부탁드립니다.`);
}

// PII.PASSPORT — 6 tickets, overseas-order context.
for (let i = 0; i < 6; i += 1) {
  const passport = `${i % 2 === 0 ? "M" : "S"}${pad(12345600 + i, 8)}`;
  push(36 + i, `해외 배송 통관을 위해 여권번호가 필요하다고 안내받았습니다. 여권번호는 ${passport} 입니다.`);
}

// PII.DL_NO — 6 tickets, identity-verification context for a rental service.
for (let i = 0; i < 6; i += 1) {
  const region = dlRegions[i % dlRegions.length]!;
  const dlNo = `${region}-${pad(10 + i, 2)}-${pad(500000 + i * 913, 6)}-${pad(10 + i, 2)}`;
  push(42 + i, `차량 대여 본인 확인용으로 운전면허번호를 남깁니다. 운전면허번호: ${dlNo} 입니다.`);
}

// PII.BANK_ACCOUNT — 6 tickets, refund context. Digit group must immediately
// follow the "계좌"/"계좌번호" keyword for the gateway's regex to match; the
// bank name sits in its own clause per the detector's grammar (see
// packages/gateway/src/rules/pii.json BANK_ACCOUNT).
for (let i = 0; i < 6; i += 1) {
  const bank = banks[i % banks.length]!;
  const account = `${pad(123456 + i, 6)}-${pad(10 + i, 2)}-${pad(900000 + i * 41, 6)}`;
  push(48 + i, `환불은 ${bank} 계좌로 받고 싶습니다. 계좌번호: ${account} 로 입금 부탁드립니다.`);
}

// False-positive control group — numbers that look like identifiers but are
// not PII, so a masking demo can show they pass through unmasked (FR-LAB-02).
const decoys = [
  (i: number) => `주문번호 ORD-2026-${pad(70000 + i, 5)} 상품이 아직 도착하지 않았어요. 배송 조회 부탁드립니다.`,
  (i: number) => `상품코드 P-24-${pad(1100 + i, 4)}-B 재고가 있는지 확인해주세요.`,
  (i: number) => `운송장번호 SEQ${pad(9000000 + i, 7)} 로 조회했는데 상태가 갱신되지 않습니다.`,
  (i: number) => `쿠폰코드 SUMMER${pad(10 + i, 2)}OFF 적용이 안 됩니다. 확인 부탁드려요.`,
  (i: number) => `문의 접수번호는 REQ-${pad(2026000 + i, 7)} 입니다. 처리 현황이 궁금합니다.`,
  (i: number) => `제품 시리얼 SN-${pad(55000 + i, 5)}-KR 등록이 안 됩니다.`,
  (i: number) => `매장 방문 예약번호 RSV${pad(300 + i, 3)} 시간을 변경하고 싶습니다.`,
  (i: number) => `장바구니 세션 ID가 CART-${pad(880000 + i, 6)} 인데 결제 페이지에서 오류가 납니다.`,
  (i: number) => `멤버십 등급 갱신 티켓 MEM-${pad(4400 + i, 4)} 처리가 지연되고 있어요.`,
  (i: number) => `사은품 신청서 번호 GIFT-${pad(770 + i, 3)} 접수 여부를 알고 싶습니다.`,
  (i: number) => `A/S 접수번호 ASREQ-${pad(66000 + i, 5)} 진행 상황을 알려주세요.`,
  (i: number) => `설문 참여 코드 SURVEY-${pad(210 + i, 3)} 로 응모했는데 당첨 여부가 궁금합니다.`
];
for (let i = 0; i < decoys.length; i += 1) {
  push(54 + i, decoys[i]!(i));
}

const outputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "seed", "customer-tickets.json");
writeFileSync(outputPath, `${JSON.stringify(tickets, null, 2)}\n`, "utf8");
process.stdout.write(`wrote ${tickets.length} tickets to ${outputPath}\n`);
