# Wordloop

쉬운 **영어 뜻 + 예문**으로 단어를 익히는 모바일 오프라인 PWA입니다. 로그인, 유료 API, 별도 백엔드가 없습니다. 단어 데이터는 GitHub에서 관리하고, 개인 학습 기록은 기기의 IndexedDB에 보관합니다.

## V1 기능

- 홈 / 학습 / 단어장 / 설정, 모바일 하단 탐색 및 PC 사이드바
- 새 단어 하루 10개, 복습 20개 기본값. 각각 1~300개로 설정
- 초급·중급·고급 복수 선택. 난이도는 **뜻별 편집 분류**이며 공식 CEFR 인증 등급이 아닙니다.
- 단어 → 쉬운 영어 뜻, 영어 뜻 → 단어, 두 방향 혼합
- **1,062개 단어 / 1,200개 뜻 / 2,400개 예문**. 정의와 예문은 이 프로젝트용으로 작성했습니다.
- 새 단어 카드 → 객관식 확인 → 간격 복습(1·3·7·14·30·60일)
- 재출제 시 예문, 오답 후보, 정답 위치 변경. 뜻마다 정해진 오답 후보 사용
- 오답 자동 저장 켜기/끄기, 미해결·해결됨 필터, 선택한 오답만 학습
- 기본 해결 기준: 틀린 날 이후 **서로 다른 두 날짜**에 정답. 같은 날의 재도전은 해결 횟수에 포함하지 않음
- 즐겨찾기, 검색, 개인 단어 추가·수정·삭제. 개인 단어는 자동 오답 생성 대신 정답을 떠올리는 카드 사용
- 현재 학습 이어하기, 주간 기록, JSON 백업 및 복원
- 오프라인 사용, 앱 설치, 버전이 있는 단어장 업데이트
- 설정 → 화면 표시 → 영어 숨기기: 앱 문구를 한글로 표시하고 단어·영어 뜻·예문은 숨김. 단어장에서는 한국어 뜻을 볼 수 있으며 영어 표시를 켜면 문제 풀이를 그대로 이어갈 수 있음

### 학습 집계

학습 묶음의 문제 수는 시작할 때 고정됩니다. 10문제로 시작하면 정답 여부와 관계없이 10문제를 풀고 종료합니다. 오답을 같은 묶음에 자동 추가하지 않으며, 결과 화면의 다시 풀기 또는 오답장에서 직접 선택해 복습할 수 있습니다. 이전 버전에서 진행 중이던 묶음도 자동 추가된 재도전만 제거하고 원래 진도와 학습 기록을 유지합니다.

하루 새 단어는 뜻이 아니라 중복을 뺀 **처음 배우는 단어**로 셉니다. 이후 다른 뜻을 배우면 복습 수로 셉니다. 같은 뜻을 여러 번 풀어도 복습 목표 수는 그날 한 번만 늘어납니다. 목표 이후의 자유 학습도 실제 기록에 포함되어 진행 수가 목표보다 클 수 있습니다.

난이도 변경은 새 단어·미학습 뜻에만 적용합니다. 이미 배운 뜻의 복습은 모든 난이도에서 계속합니다. 오답 자동 저장을 꺼도 일반 복습 기록과 기존 오답은 유지합니다.

## 실행

Node.js 20 이상. 별도 npm 패키지 설치가 필요 없습니다.

```bash
npm run build
npm test
npm run dev
```

`http://localhost:4173`을 엽니다. 빌드 결과는 `dist/`입니다. 서비스 워커는 HTTPS 또는 localhost에서 동작합니다.

배포 결과를 로컬에서 확인하려면 macOS/Linux에서는 `SERVE_DIR=dist npm run dev`, Windows PowerShell에서는 다음을 사용합니다.

```powershell
$env:SERVE_DIR="dist"
npm run dev
```

## GitHub Pages 첫 설정

1. 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. **Actions → Validate and deploy Wordloop → Run workflow**
3. 배포 성공 후 `https://smrmdkqo-afk.github.io/wordloop/`에 접속

이후 `main`에 코드나 단어장 변경을 올리면 검증·빌드·배포가 자동으로 실행됩니다. 배포 전 모든 Node 테스트와 데이터 형식 검사를 통과해야 합니다.

## 단어 데이터만 업데이트하기

앱 코드는 수정하지 않고 다음 파일을 편집할 수 있습니다.

- `data/beginner.json`
- `data/intermediate.json`
- `data/advanced.json`

각 파일은 `schema: 1`과 `senses` 배열을 가집니다. 같은 구조의 새로운 `data/*.json` 파일도 자동으로 빌드에 포함됩니다. `data/manifest.json`은 자동 생성되므로 직접 수정하지 않습니다.

```json
{
  "id": "borrow-b-actions1",
  "word": "borrow",
  "level": "beginner",
  "pos": "verb",
  "ko": "빌리다",
  "definitions": ["to use something belonging to someone and give it back"],
  "examples": ["Can I {} your pen?", "May I {} your bike for an hour?"],
  "distractors": [
    "arrive-b-actions1",
    "choose-b-actions1",
    "explain-b-actions1",
    "listen-b-actions1",
    "wait-b-actions1",
    "help-b-actions1"
  ]
}
```

- **기존 `id`는 유지**하세요. 개인 진도·오답·즐겨찾기가 이 값에 연결됩니다.
- 새로운 뜻에는 새로운 고유 `id`를 붙입니다. 단어 철자가 같아도 괜찮습니다.
- 품사: `noun`, `verb`, `adjective`, `adverb`, `other`
- 정의는 쉬운 영어로 작성합니다. 배열에 같은 뜻의 다른 설명을 추가하면 재출제 시 순환합니다.
- 예문은 최소 두 개, 각 예문에는 **단어가 들어갈 자리를 `{}`로 한 번** 표시합니다.
- `distractors`에는 같은 품사의 다른 뜻 ID를 최소 네 개 넣습니다. 같은 단어·동의어나 문맥상 또 다른 정답은 넣지 마세요.
- 저장 전에 `npm run build`와 `npm test`를 실행합니다. 형식 검사는 의미적 정확성까지 보장하지 않으므로 새 예문과 오답 후보는 읽고 확인하세요.

온라인 실행 시 데이터 버전을 확인하고 파일 해시가 모두 일치할 때만 새 단어장으로 교체합니다. 진행 중인 학습이 있으면 완료 후 적용합니다. 다운로드 실패나 오프라인 상태에서는 이전 단어장을 유지합니다. 개인 기록과 콘텐츠는 별도로 저장합니다.

## 기기 데이터와 백업

계정 동기화는 없습니다. **설정 → 백업 저장**으로 학습 기록, 설정, 즐겨찾기, 직접 추가한 단어를 보관하고 다른 기기에서 불러올 수 있습니다. 복원은 현재 기록을 대체하므로 확인 화면이 표시됩니다. 사이트 데이터 삭제 또는 브라우저의 저장 공간 정리로 기록이 없어질 수 있으므로 주기적으로 백업하세요.

서로 다른 브라우저, 다른 기기, 또는 배포 주소가 달라지면 저장 공간도 다릅니다. 내용 업데이트만으로 기존 기록을 초기화하지 않습니다. 동시 탭 간 기록 충돌을 막기 위해 Web Locks 지원 브라우저에서는 한 창만 쓰기를 허용합니다.

앱 코드의 새 버전은 기존 Wordloop 창을 모두 닫은 뒤 다시 열면 적용됩니다. 단어장만 바뀐 경우는 앱 안에서 업데이트할 수 있습니다.

## 검증

`npm test`는 학습 집계, 서로 다른 날짜의 오답 해결, 난이도 변경 후 복습, 백업 유효성, 전체 단어의 보기 생성 등을 검사합니다.

브라우저 통합 검사는 선택적으로 실행할 수 있습니다.

```bash
npm install --no-save playwright
npx playwright install chromium
npm run build
node tests/browser-smoke.mjs
```

새로고침 이어하기, 오프라인 실행, 개인 단어, 오답 선택, 백업 복원, 콘텐츠 업데이트 및 실패 시 보존, 320/390/1440px 화면과 동시 탭 보호를 확인합니다. 스크린샷은 `test-results/`에 생성되며 Git에 포함하지 않습니다.

## 구조

```text
index.html / styles.css      화면과 스타일
src/app.js                  화면 및 사용자 흐름
src/core.js                 출제, 진도, 복습, 백업 검증
src/storage.js              IndexedDB 저장
sw.js / manifest.webmanifest 오프라인 앱
assets/                     앱 아이콘
scripts/                    데이터 검사·빌드·로컬 서버
tests/core.test.mjs          주요 학습 규칙 검증
.github/workflows/pages.yml GitHub Pages 자동 배포
```

외부 폰트, 추적 스크립트, API 키를 사용하지 않습니다. 학습 데이터는 다른 서비스로 전송하지 않습니다.
