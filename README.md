# Expedition Lines

탐험대(색별 열)를 쌓아 점수를 모으는 2~4인 온라인 카드 게임. 각자 휴대폰/PC로 QR·링크를 열어 바로 참가한다.
규칙 메커니즘은 고전 2인 카드 게임(조사: `docs/01-원작-룰-조사.md`)을 바탕으로 하되, 이름·일러스트·외형은 자체 제작이다.

## 기능

- 방 만들기 → 4자리 코드 + QR/공유 링크, 선택적 방 암호(QR에 암호 포함 토글)
- 2~4인 + 관전, 끊겨도 같은 기기에서 다시 열면 자동 복귀, 방장 자동 승계
- 규칙 커스텀: 색 2~6, 숫자 범위, 색당 투자 카드, 덱 배수, 손패, 탐험대 비용(자동 보정), 보너스 기준/점수/배수, 판 수,
  턴 타이머(초과 시 자동 진행), 같은 숫자 허용, 방금 버린 카드 재획득 금지, 덱 장수 공개, 점수 미리보기, 버림 더미 펼쳐보기, 4인 2:2 팀전
- 프리셋: 원작 / 롱게임(6색) / 3인 권장 / 4인 권장 / 빠른 게임, 로비에서 "1인당 예상 턴 수" 표시
- 카드 일러스트(숫자가 클수록 목적지 유적이 가까워짐), 카드 날아가기/덱에서 뒤집으며 뽑기/나눠주기 애니메이션,
  버림 더미 호버(모바일은 장수 배지 탭) 시 쌓인 카드가 펼쳐짐, 드래그로 내려놓기/버리기

## 개발

```bash
npm install
npm run dev        # 서버 :3001 + Vite :5173 (휴대폰은 같은 Wi-Fi에서 로비의 QR로 접속)
npm test           # 엔진·방 로직 테스트
npm run build && npm start   # 프로덕션 빌드 → :3001 (PORT로 변경)
```

구조: `packages/engine`(순수 게임 로직), `apps/server`(Node + Socket.IO, 권위 서버, 방 상태는 메모리),
`apps/web`(React + Vite).

## 배포 (oh-my-homelab)

- `main` push → `.github/workflows/release.yml`이 `ghcr.io/shinkeonkim/my-lost-city:sha-xxxx` 빌드 후 `deploy/kustomization.yaml` 태그 갱신
- oh-my-homelab의 `helm-charts/apps/my-lost-city.yaml`이 `deploy/`를 ArgoCD로 동기화
- 방 상태가 메모리에 있으므로 replicas 1 + Recreate. 재배포하면 진행 중인 게임은 사라진다.
- 환경변수 `PUBLIC_URL`: QR/공유 링크에 쓰는 외부 주소
