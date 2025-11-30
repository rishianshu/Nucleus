# Page snapshot

```yaml
- alert [ref=e3]:
  - heading "500" [level=1] [ref=e4]
  - paragraph [ref=e5]: Uh oh. There's an error.
  - paragraph [ref=e6]: Internal Error
  - paragraph [ref=e7]:
    - button "Try a refresh" [ref=e8] [cursor=pointer]
    - text: or
    - link "jump on our Slack Channel" [ref=e9] [cursor=pointer]:
      - /url: https://temporal.io/slack
    - text: .
```