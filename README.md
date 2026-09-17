# 사건관리 대시보드 — 배포 가이드

Claude(Anthropic) 서버에 의존하지 않고, 무료 서비스(Firebase + GitHub Pages)만으로 크롬 브라우저에서
접속해 쓸 수 있는 개인용 웹앱입니다. 아래 순서대로 따라 하면 약 20~30분 안에 본인만의 주소로
접속할 수 있습니다.

- 데이터 저장: **Firebase Firestore** (무료 Spark 플랜)
- 로그인 보호: **Firebase Authentication** (이메일/비밀번호, 본인 계정 1개)
- 호스팅: **GitHub Pages** (무료 정적 호스팅)

---

## 1단계. Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속 후 구글 계정으로 로그인
2. **"프로젝트 추가"** 클릭 → 프로젝트 이름 입력 (예: `lawyer-dashboard`) → 애널리틱스는 꺼도 무방 → 프로젝트 생성

### 1-1. Firestore Database 활성화
1. 왼쪽 메뉴 **빌드 > Firestore Database** 클릭 → **"데이터베이스 만들기"**
2. 위치는 `asia-northeast3 (서울)` 선택 (한국 기준 속도가 가장 빠름)
3. 보안 규칙은 일단 아무거나 선택하고 만든 뒤, 아래 1-2에서 바로 교체합니다.

### 1-2. 보안 규칙 설정 (중요 — 반드시 진행)
1. Firestore Database 화면에서 **"규칙(Rules)"** 탭 클릭
2. 아래 내용(이 프로젝트의 `firestore.rules` 파일 내용)을 그대로 붙여넣고 **"게시(Publish)"**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /cases/{caseId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

이 규칙은 **로그인한 사용자만** 사건 데이터를 읽고 쓸 수 있게 막아줍니다. 이 단계를 건너뛰면
누구든 인터넷에서 데이터를 열람/수정할 수 있으니 꼭 설정하세요.

### 1-3. 로그인(Authentication) 설정
1. 왼쪽 메뉴 **빌드 > Authentication** → **"시작하기"**
2. **"Sign-in method"** 탭 → **"이메일/비밀번호"** 선택 → 사용 설정 → 저장
3. **"Users"** 탭 → **"사용자 추가"** → 본인이 사용할 이메일/비밀번호 입력 후 저장
   - 이 계정이 곧 대시보드 로그인 계정입니다. 다른 사람에게 알려주지 마세요.
   - 계정을 더 추가하지 않는 한 이 이메일/비밀번호를 아는 사람만 앱에 접속해 데이터를 볼 수 있습니다.

### 1-4. 웹 앱 등록 & 설정값 복사
1. 프로젝트 설정(⚙️ 아이콘) > **"프로젝트 설정"** 클릭
2. 아래로 스크롤 → **"내 앱"** → `</>` (웹 앱 추가) 아이콘 클릭
3. 앱 닉네임 입력 (예: `dashboard-web`) → Firebase 호스팅은 체크하지 않아도 됨 → 앱 등록
4. 화면에 나오는 `firebaseConfig` 객체 값을 복사합니다. 예:

```js
const firebaseConfig = {
  apiKey: "AIzaSy....",
  authDomain: "lawyer-dashboard-xxxx.firebaseapp.com",
  projectId: "lawyer-dashboard-xxxx",
  storageBucket: "lawyer-dashboard-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
```

5. 이 프로젝트 폴더의 **`firebase-config.js`** 파일을 열어 `YOUR_API_KEY` 등 자리표시자 값을
   위에서 복사한 실제 값으로 교체 후 저장합니다. (이 값은 비밀키가 아니라 앱 식별용 공개 설정이라
   GitHub에 그대로 올려도 안전합니다 — 실제 보호는 1-2단계의 보안 규칙과 1-3단계의 로그인이 담당합니다.)

---

## 2단계. GitHub 저장소 만들고 GitHub Pages로 배포

1. https://github.com 에서 계정이 없다면 무료로 가입
2. 우측 상단 **"+" > "New repository"** → 저장소 이름 입력 (예: `lawyer-dashboard`) →
   **Public**으로 설정(GitHub Pages 무료 사용을 위해 Public 권장) → **Create repository**
3. 저장소 페이지에서 **"uploading an existing file"** 링크 클릭 (또는 "Add file > Upload files")
4. 이 폴더 안의 파일들을 전부 드래그해서 업로드:
   - `index.html`
   - `style.css`
   - `app.js`
   - `firebase-config.js` (실제 값으로 수정한 버전)
   - (참고용) `firestore.rules`, `README.md`
5. 하단에 커밋 메시지 입력 후 **"Commit changes"**

### 2-1. GitHub Pages 활성화
1. 저장소 상단 메뉴 **Settings > Pages** 이동
2. **"Build and deployment"** 의 Source를 **"Deploy from a branch"**로 선택
3. Branch를 `main` (또는 `master`), 폴더는 `/ (root)` 선택 후 **Save**
4. 1~2분 후 같은 화면 상단에 `https://<본인계정>.github.io/lawyer-dashboard/` 형태의 주소가 생성됩니다.

### 2-2. Firebase에 배포 주소 등록 (승인된 도메인)
GitHub Pages 주소가 Firebase 로그인에서 차단되지 않도록 등록해야 합니다.
1. Firebase 콘솔 > Authentication > **Settings** 탭 > **"승인된 도메인(Authorized domains)"**
2. **"도메인 추가"** → `<본인계정>.github.io` 입력 후 추가

---

## 3단계. 접속 & 사용

1. 크롬에서 `https://<본인계정>.github.io/lawyer-dashboard/` 접속
2. 1-3단계에서 만든 이메일/비밀번호로 로그인
3. **사건 총집합 탭**: "새 사건 등록"으로 사건번호·구분(민사/형사)·사건명·의뢰인·의뢰인 신분(피고/피의자)·
   사건분류·법원지역·피고인 목록·재판기일/변론기일을 한 번에 등록합니다.
   - 피고인 목록에서 각 피고인의 "대응완료" 체크박스를 켜면 대응현황(예: 2/4)이 자동 계산되고,
     전원 응답 전까지는 빨간색으로 표시됩니다.
4. **캘린더 탭**: 이번 달 캘린더가 표시되며, 기일이 등록된 날짜에 사건명과 대응현황이 표시됩니다.
   - 대응 미완료 기일은 빨간색, 완료된 기일은 초록색으로 구분됩니다.
   - 앞으로 4주 이내로 다가온 기일에는 주황색 테두리(예정 표시)가 추가로 붙습니다.
   - 날짜를 클릭하면 그 날짜에 새 기일을 바로 등록하거나, 이미 등록된 기일의 사건을 열 수 있습니다.
   - "‹ 이전달 / 이번달 / 다음달 ›" 버튼으로 다른 달도 볼 수 있습니다.
5. **대응 필요 탭**: 피고인 중 한 명이라도 대응하지 않은 기일이 날짜순으로 자동 정리됩니다.
   기본적으로 "오늘부터 4주 이내(+ 기한 경과)" 기일만 보여주며, 체크박스로 전체 기간을 볼 수도 있습니다.
   카드를 클릭하면 해당 사건이 열려 바로 대응 여부를 체크할 수 있습니다.

여러 기기(사무실 PC, 집, 휴대폰 크롬 등)에서 같은 주소로 로그인하면 Firestore를 통해
실시간으로 같은 데이터가 동기화됩니다.

---

## 이후 내용을 수정하고 싶을 때

GitHub 저장소의 **"Add file > Upload files"**로 수정한 파일을 다시 올리고 커밋하면
1~2분 내로 같은 주소에 자동 반영됩니다. (Git을 쓸 줄 안다면 `git clone` 후 수정 → `git push`도 가능합니다.)

## 참고 / 주의사항

- Firebase 무료(Spark) 플랜은 읽기/쓰기 횟수와 저장 용량에 여유로운 무료 한도가 있어 1인 로펌/개인 변호사
  사용량으로는 사실상 비용이 발생하지 않습니다.
- 로그인 계정의 이메일/비밀번호는 곧 사건 데이터에 대한 접근권한이므로 안전하게 보관하세요.
- 별도 자동 백업은 없으므로, 중요한 사건 데이터는 주기적으로 Firebase 콘솔의 Firestore 데이터를
  확인하거나 내보내기(Export)하는 것을 권장합니다.
- 사건분류·법원지역 드롭다운 목록은 `index.html`의 `<select>` 옵션을 직접 수정해 자유롭게
  추가/변경할 수 있습니다.
