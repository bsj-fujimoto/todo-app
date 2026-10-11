# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey.spec.js >> [MON-007] J-01 追加すると一覧に出て、再読込しても残る
- Location: e2e/synthetic/journey.spec.js:37:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/
Call log:
  - navigating to "http://localhost:8080/", waiting until "load"

```

```
AggregateError: apiRequestContext.get: connect ECONNREFUSED ::1:8080
connect ECONNREFUSED 127.0.0.1:8080
Call log:
  - → GET http://localhost:8080/api/v1/tasks
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br

```