# 포트폴리오 사이트

노션 DB에 글을 쓰면 이 사이트에 반영됩니다.

## 파일

- `index.html` — 사이트 본체. 프로필과 이력은 이 파일 안에서 직접 수정합니다.
- `data.json` — 노션에서 자동으로 만들어지는 프로젝트 데이터. 직접 고치지 마세요.
- `images/` — 노션에서 내려받은 이미지. 직접 고치지 마세요.
- `scripts/sync-notion.js` — 노션을 읽어 위 두 가지를 만드는 스크립트.
- `.github/workflows/sync-notion.yml` — 매일 한 번 자동 실행 설정.

## 노션에 새 프로젝트를 쓸 때

페이지 맨 위:

    ## 프로젝트 제목
    기간   2026.02 ~ 2026.07
    역할   (줄글로 자유롭게)
    협업   UI Designer 1명 / FE 1명 / BE 1명

그 다음부터 단계별로:

    ## Problem              ← 단계 이름
    ## 한 문장 제목           ← 그 단계의 제목
    본문 문단
    > 강조할 핵심 문장
    - 나열 항목
    ### 소단락 제목

쓸 수 있는 단계 이름 (순서대로, 빼도 됩니다):
Business Context / Problem / Evidence / Goal / Hypothesis /
Decision / Execution / Result / Learning

이미지는 원하는 자리에 그냥 붙여넣으면 됩니다.
각 프로젝트의 **첫 이미지가 갤러리 썸네일**이 되므로 맨 앞에 대표 이미지를 하나 두세요.

## 바로 반영하고 싶을 때

저장소 Actions 탭 → 왼쪽 "노션 동기화" → Run workflow 버튼.
1~2분 뒤 사이트에 반영됩니다.
